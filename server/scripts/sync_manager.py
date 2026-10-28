#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
补齐基金经理在本基金的任职起始日（mgrStart）与任期年数。

背景：之前判断「经理满 3 年」唯一缺的就是「现任经理在本基金的任职起始日」。
东财的行情接口（FundMNDetailInformation / Data_currentFundManager）都只给姓名和
从业年限，不含在本基金的起任日；djapi、FundMNManagerInfo、FundArchivesDatas
几条路都返回空。唯一稳定可用的来源是 F10 的经理变动页：

  https://fundf10.eastmoney.com/jjjl_{code}.html

这张表是服务端直出的，表头为「起始期 / 截止期 / 基金经理 / 任职期间 / 任职回报」，
截止期为「至今」的那些行就是现任经理，起始期即他们接手本基金的日子。
取其中最早的一个作为「最长任期」——对应业务口径「多基金经理时只要有一位满 3 年」。

产出：直接回填 em-full.json 的 mgrStart 列（ISO 日期），并打印任期分布。

用法：
  python sync_manager.py                # 全量补齐（只补 mgrStart 为空的）
  python sync_manager.py --all          # 全部重拉
  python sync_manager.py --limit 50     # 调试
"""
import argparse
import json
import os
import re
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime

import requests

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from sync_eastmoney import UA_WEB, DATA_DATE, _session

HERE = os.path.dirname(os.path.abspath(__file__))
SNAPSHOT = os.path.join(os.path.dirname(HERE), 'data', 'snapshot', 'em-full.json')

RE_TABLE = re.compile(r'<table[^>]*class="[^"]*comm[^"]*"[^>]*>(.*?)</table>', re.S)
RE_TR = re.compile(r'<tr[^>]*>(.*?)</tr>', re.S)
RE_TD = re.compile(r'<td[^>]*>(.*?)</td>', re.S)
RE_TAG = re.compile(r'<[^>]+>')
RE_DATE = re.compile(r'(\d{4})-(\d{2})-(\d{2})')


def _clean(s):
    return RE_TAG.sub('', s or '').replace('&nbsp;', ' ').strip()


def parse_managers(html):
    """
    从经理变动页抽出「现任经理在本基金的最早连续任职起始日」。

    东财这张表会在「增聘/解聘某一位共同经理」时把同一段管理期拆成两行。
    例如中欧医疗健康：葛兰 2016-09-29 起管理，2025-07-04 增聘赵磊后，
    她的记录被拆成「2016-09-29~2025-07-03」和「2025-07-04~至今」两行。
    直接取「至今」那一行的起始期，会把管了 9 年的经理误判成只满 1 年。

    所以对每位现任经理，沿「同一姓名 + 上一行截止期紧接下一行起始期」向前串接，
    直到断链为止，取串接后的最早起始日。多经理时取最早的那个——对应业务口径
    「只要有一位满 3 年即可」。

    返回 (start_date, names)；页面里没有现任经理记录时返回 (None, None)。
    """
    for tbl in RE_TABLE.findall(html):
        if '起始期' not in tbl or '截止期' not in tbl:
            continue

        recs = []
        for tr in RE_TR.findall(tbl):
            raw = RE_TD.findall(tr)
            if len(raw) < 4:
                continue
            tds = [_clean(x) for x in raw]
            m = RE_DATE.search(tds[0])
            if not m:
                continue
            start = m.group(0)
            end_raw = tds[1]
            e = RE_DATE.search(end_raw)
            end = e.group(0) if e else ('9999-12-31' if '至今' in end_raw else None)
            if not end:
                continue
            names = [n.strip() for n in re.findall(r'>([^<>]{2,12})</a>', raw[2]) if n.strip()]
            if not names:
                nm = tds[2].strip()
                if nm:
                    names = [x for x in re.split(r'[\s/、]+', nm) if x]
            recs.append({'start': start, 'end': end, 'names': names, 'current': '至今' in end_raw})

        if not recs:
            continue

        def _d(s):
            return datetime.strptime(s, '%Y-%m-%d')

        current = [r for r in recs if r['current']]
        if not current:
            continue

        best = None
        live_names = []
        for cur in current:
            for nm in cur['names']:
                if nm not in live_names:
                    live_names.append(nm)
                chain_start = cur['start']
                # 向前串接：找截止期紧贴当前链首、且含同一位经理的那一行
                cursor = chain_start
                for _ in range(60):
                    prev = None
                    for r in recs:
                        if nm not in r['names'] or r['current']:
                            continue
                        gap = (_d(cursor) - _d(r['end'])).days
                        if 0 <= gap <= 15:
                            prev = r
                            break
                    if not prev:
                        break
                    cursor = prev['start']
                if best is None or cursor < best:
                    best = cursor

        if best:
            return best, ','.join(live_names) or None
    return None, None


def fetch_managers(code):
    url = 'https://fundf10.eastmoney.com/jjjl_%s.html' % code
    for attempt in range(3):
        try:
            r = _session().get(url, timeout=25, headers={'User-Agent': UA_WEB})
            if r.status_code != 200 or len(r.text) < 500:
                time.sleep(0.5 * (attempt + 1))
                continue
            text = r.text
            if '任职期间' not in text and '截止期' not in text:
                # 编码猜错会看不出关键词，按 gbk 再解一次
                try:
                    text = r.content.decode('gbk', 'ignore')
                except Exception:
                    pass
            start, names = parse_managers(text)
            return code, start, names
        except Exception:
            time.sleep(0.5 * (attempt + 1))
    return code, None, None


def _save(doc):
    tmp = SNAPSHOT + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(doc, f, ensure_ascii=False)
    os.replace(tmp, SNAPSHOT)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--workers', type=int, default=5)
    ap.add_argument('--limit', type=int, default=0)
    ap.add_argument('--all', action='store_true')
    ap.add_argument('--retries', type=int, default=3)
    args = ap.parse_args()

    doc = json.load(open(SNAPSHOT, encoding='utf-8'))
    cols = doc['cols']
    i_code = cols.index('code')
    i_mgr = cols.index('mgrStart')

    rows = doc['rows']
    if args.limit:
        rows = rows[:args.limit]
    todo = [r for r in rows if args.all or r[i_mgr] is None]
    print('待补经理任职起始日 %d 只（共 %d 只）' % (len(todo), len(doc['rows'])), flush=True)
    if not todo:
        return

    by_code = {r[i_code]: r for r in todo}
    ok = 0
    t0 = time.time()
    round_no = 0
    pending = list(by_code.keys())

    while pending and round_no < args.retries:
        round_no += 1
        print('第 %d 轮，待处理 %d 只' % (round_no, len(pending)), flush=True)
        nxt = []
        with ThreadPoolExecutor(max_workers=args.workers) as ex:
            futs = {ex.submit(fetch_managers, c): c for c in pending}
            done = 0
            for fut in as_completed(futs):
                done += 1
                try:
                    c, start, _names = fut.result()
                except Exception:
                    c, start = futs[fut], None
                if start:
                    by_code[c][i_mgr] = start
                    ok += 1
                else:
                    nxt.append(c)
                if done % 500 == 0:
                    _save(doc)
                    print('  %d/%d（成功 %d，%.0fs）' % (done, len(pending), ok, time.time() - t0), flush=True)
        pending = nxt
        _save(doc)
        print('  第 %d 轮完成：成功 %d，仍缺 %d（%.0fs）' % (round_no, ok, len(pending), time.time() - t0), flush=True)
        if pending:
            time.sleep(15)

    _save(doc)

    # 任期分布：按数据截止日回算年数
    asof = datetime.strptime(DATA_DATE, '%Y-%m-%d')
    buckets = {'<1年': 0, '1-2年': 0, '2-3年': 0, '3-5年': 0, '5-8年': 0, '8年以上': 0}
    for r in doc['rows']:
        s = r[i_mgr]
        if not s:
            continue
        try:
            yrs = (asof - datetime.strptime(s, '%Y-%m-%d')).days / 365.25
        except ValueError:
            continue
        if yrs < 1:
            buckets['<1年'] += 1
        elif yrs < 2:
            buckets['1-2年'] += 1
        elif yrs < 3:
            buckets['2-3年'] += 1
        elif yrs < 5:
            buckets['3-5年'] += 1
        elif yrs < 8:
            buckets['5-8年'] += 1
        else:
            buckets['8年以上'] += 1

    print('完成：补齐 %d / %d，仍缺 %d，用时 %.0fs' % (ok, len(by_code), len(pending), time.time() - t0))
    print('任期分布：' + '  '.join('%s %d' % (k, v) for k, v in buckets.items()))
    print('已写回 %s' % SNAPSHOT)


if __name__ == '__main__':
    main()
