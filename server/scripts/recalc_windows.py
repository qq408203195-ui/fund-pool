#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
多窗口业绩重算：把近 1–10 年的区间收益与最大回撤一次性算进快照。

背景：页面上的「近 X 年」原来是写死 3 年，只能算出一套指标。窗口要可调，
就必须预先算好各窗口的指标——净值序列不可能在每次请求时重拉。
回撤、收益、卡玛三条现在各有一个独立的窗口选择器，所以六到十年也要有。

输出写入快照的新列 wins（JSON 字符串）：
    {"1": {"cum": 12.3, "mdd": -8.4}, "2": {...}, ..., "10": {...}}
同时回填 cum3y / mdd3y，保证老逻辑读到的仍是 3 年口径。

增量友好：已有窗口一律保留，只补算缺失的窗口。所以同一份快照可以从
1–5 年扩到 1–10 年，也可以中途断了重跑，不会把已算好的数据冲掉。

用法：
    python recalc_windows.py            # 补齐全部窗口
    python recalc_windows.py --only 6,7,8,9,10
    python recalc_windows.py --limit 50 # 调试
"""

import argparse
import json
import os
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from sync_eastmoney import fetch_nav, max_drawdown, interval_return, DATA_DATE  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
SNAPSHOT = os.path.join(os.path.dirname(HERE), 'data', 'snapshot', 'em-full.json')

YEARS = list(range(1, 11))


def add_years(d, years):
    """按整年回退。2 月 29 日回退到非闰年时落到 2 月 28 日，避免直接抛错。"""
    try:
        return d.replace(year=d.year - years)
    except ValueError:
        return d.replace(year=d.year - years, day=28)


def ms(dt):
    return int(dt.timestamp() * 1000)


def _finite(v):
    if isinstance(v, float) and (v != v or v in (float('inf'), float('-inf'))):
        return None
    return v


def _load_wins(raw):
    """wins 列可能是字符串也可能已是对象（重复跑的结果），统一成 dict"""
    if not raw:
        return {}
    if isinstance(raw, dict):
        return raw
    try:
        d = json.loads(raw)
        return d if isinstance(d, dict) else {}
    except (TypeError, ValueError):
        return {}


def _has(d, y):
    v = d.get(str(y))
    return bool(v) and v.get('cum') is not None and v.get('mdd') is not None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--workers', type=int, default=5)
    ap.add_argument('--limit', type=int, default=0)
    ap.add_argument('--retries', type=int, default=3)
    ap.add_argument('--only', type=str, default='',
                    help='只补这些窗口，逗号分隔，如 6,7,8,9,10；默认补齐全部')
    args = ap.parse_args()

    doc = json.load(open(SNAPSHOT, encoding='utf-8'))
    cols = doc['cols']
    rows = doc['rows']
    for c in ('wins',):
        if c not in cols:
            cols.append(c)
            for r in rows:
                r.append(None)
    i_code = cols.index('code')
    i_wins = cols.index('wins')
    i_cum = cols.index('cum3y')
    i_mdd = cols.index('mdd3y')

    want = YEARS
    if args.only:
        want = [int(x) for x in args.only.split(',') if x.strip()]
        want = [y for y in want if y in YEARS]
    if not want:
        print('没有需要补的窗口')
        return

    end_dt = datetime.strptime(DATA_DATE, '%Y-%m-%d')
    e_ms = ms(end_dt) + 86400000
    windows = {y: (ms(add_years(end_dt, y)), e_ms) for y in want}

    target = rows if not args.limit else rows[:args.limit]
    by_code = {r[i_code]: r for r in target}

    # 只挑「至少缺一个目标窗口」的基金，已经不缺的直接跳过——
    # 同一份快照可以从 1–5 年扩到 1–10 年，也可以中断后重跑，不会重复做无用请求
    pending = [c for c, r in by_code.items()
               if not all(_has(_load_wins(r[i_wins]), y) for y in want)]
    skipped = len(by_code) - len(pending)
    print('多窗口重算 %d 只（共 %d 只，已完整跳过 %d 只），补 %s 年窗口，%d 并发'
          % (len(pending), len(rows), skipped, want, args.workers), flush=True)

    ok = 0
    skipped_short = 0
    t0 = time.time()
    round_no = 0

    while pending and round_no < args.retries:
        round_no += 1
        print('第 %d 轮，待处理 %d 只' % (round_no, len(pending)), flush=True)
        nxt = []
        done = 0
        with ThreadPoolExecutor(max_workers=args.workers) as ex:
            futs = {ex.submit(fetch_nav, c): c for c in pending}
            for fut in as_completed(futs):
                c = futs[fut]
                done += 1
                try:
                    _, series = fut.result()
                except Exception:
                    series = None
                found = {}
                no_data = False
                if series:
                    for y in want:
                        s_ms, e2_ms = windows[y]
                        mdd = max_drawdown(series, s_ms, e2_ms)
                        cum = interval_return(series, s_ms, e2_ms)
                        if mdd is not None and cum is not None:
                            found[str(y)] = {'cum': round(cum, 4), 'mdd': round(mdd, 4)}
                    # 拿到了净值序列却一个窗口都算不出，说明这只基金成立时间不够长，
                    # 不是网络问题——重试三遍也不会有数据，直接跳过
                    no_data = not found
                if found:
                    row = by_code[c]
                    merged = _load_wins(row[i_wins])
                    merged.update(found)
                    row[i_wins] = json.dumps(merged, separators=(',', ':'))
                    # 3 年口径回填，老字段继续保持可用
                    if '3' in merged:
                        row[i_cum] = merged['3']['cum']
                        row[i_mdd] = merged['3']['mdd']
                    ok += 1
                elif no_data:
                    skipped_short += 1
                else:
                    nxt.append(c)
                if done % 500 == 0:
                    _save(doc)
                    print('  %d/%d（成功 %d，%.0fs）' % (done, len(pending), ok, time.time() - t0), flush=True)
        pending = nxt
        _save(doc)
        print('  第 %d 轮完成：成功 %d，仍缺 %d，已落盘（%.0fs）'
              % (round_no, ok, len(pending), time.time() - t0), flush=True)
        if pending:
            time.sleep(15)

    _save(doc)
    print('完成：成功 %d / %d，成立不足 %d 只，网络失败 %d 只，用时 %.0fs'
          % (ok, len(by_code), skipped_short, len(pending), time.time() - t0))


def _save(doc):
    """
    就地清理 NaN 后落盘。

    不能写成 `doc['rows'] = [[_finite(v) for v in r] for r in doc['rows']]`——
    那会用一个新列表替换掉原列表，而主流程里的 rows 仍指向旧列表，
    下一次中途落盘之后所有修改就全丢了（表现为只有最早的 500 只有值）。
    """
    for r in doc['rows']:
        for i, v in enumerate(r):
            if isinstance(v, float) and (v != v or v in (float('inf'), float('-inf'))):
                r[i] = None
    tmp = SNAPSHOT + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(doc, f, ensure_ascii=False, separators=(',', ':'))
    os.replace(tmp, SNAPSHOT)


if __name__ == '__main__':
    main()
