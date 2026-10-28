#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
回填基金经理姓名。

快照里原来只有「经理任职起始日」，没有姓名，页面「基金经理」列只能显示 —。
姓名其实就在净值脚本同源的 pingzhongdata 里：Data_currentFundManager 给出
现任经理的姓名与从业年限，不需要再走 F10 经理变动页逐只解析表格。

用法：
    python sync_manager_names.py            # 补全为空的
    python sync_manager_names.py --all      # 全部重拉

输出写回 server/data/snapshot/em-full.json 的新列 mgrNames。
"""

import argparse
import json
import os
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

import requests

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from sync_eastmoney import UA_WEB, _session  # noqa: E402

SNAPSHOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'data', 'snapshot', 'em-full.json')
WORKERS = 5
RETRIES = 3


def grab_array(text, name):
    """从 var xxx = [...] 里取出数组。不能靠正则——数组内部含嵌套对象，非贪婪会截断。"""
    i = text.find('var %s' % name)
    if i < 0:
        return None
    j = text.find('[', i)
    if j < 0:
        return None
    depth = 0
    for k in range(j, len(text)):
        ch = text[k]
        if ch == '[':
            depth += 1
        elif ch == ']':
            depth -= 1
            if depth == 0:
                try:
                    return json.loads(text[j:k + 1])
                except Exception:
                    return None
    return None


def fetch_names(code):
    url = 'https://fund.eastmoney.com/pingzhongdata/%s.js' % code
    last = None
    for attempt in range(RETRIES):
        try:
            r = _session().get(url, headers={'User-Agent': UA_WEB}, timeout=20)
            if r.status_code != 200:
                last = 'HTTP %d' % r.status_code
                time.sleep(0.4 * (attempt + 1))
                continue
            arr = grab_array(r.text, 'Data_currentFundManager')
            if arr is None:
                return code, None
            names = []
            for m in arr:
                nm = (m.get('name') or '').strip()
                if nm and nm not in names:
                    names.append(nm)
            return code, ','.join(names) if names else None
        except Exception as e:
            last = str(e)
            time.sleep(0.4 * (attempt + 1))
    return code, None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--all', action='store_true', help='全部重拉，不只补空缺')
    ap.add_argument('--workers', type=int, default=WORKERS)
    ap.add_argument('--limit', type=int, default=0)
    args = ap.parse_args()

    with open(SNAPSHOT, encoding='utf-8') as f:
        data = json.load(f)

    cols = data['cols']
    rows = data['rows']
    if 'mgrNames' not in cols:
        cols.append('mgrNames')
        for r in rows:
            r.append(None)
    ni = cols.index('mgrNames')
    ci = cols.index('code')

    pending = [r[ci] for r in rows if args.all or not r[ni]]
    if args.limit:
        pending = pending[:args.limit]
    print('待补 %d 只（全库 %d）' % (len(pending), len(rows)), flush=True)
    if not pending:
        return

    result = {}
    t0 = time.time()
    done = ok = 0
    with ThreadPoolExecutor(max_workers=args.workers) as ex:
        futs = {ex.submit(fetch_names, c): c for c in pending}
        for fut in as_completed(futs):
            code, names = fut.result()
            done += 1
            if names:
                result[code] = names
                ok += 1
            if done % 500 == 0:
                rate = done / max(time.time() - t0, 1e-6)
                eta = (len(pending) - done) / max(rate, 1e-6)
                print('  %d/%d（成功 %d，%.0fs，剩余约 %.0fs）' % (done, len(pending), ok, time.time() - t0, eta), flush=True)

    for r in rows:
        v = result.get(r[ci])
        if v:
            r[ni] = v

    # 原子落盘，避免中途失败把快照写坏
    tmp = SNAPSHOT + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, separators=(',', ':'))
    os.replace(tmp, SNAPSHOT)

    filled = sum(1 for r in rows if r[ni])
    print('完成：本次成功 %d，全库已有姓名 %d / %d，耗时 %.0fs' % (ok, filled, len(rows), time.time() - t0))


if __name__ == '__main__':
    main()
