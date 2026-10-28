#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
全量重算近 3 年回撤与区间收益（复权净值口径）。

背景：早期版本用东财 Data_ACWorthTrend（累计净值）算收益，累计净值只把分红
加回本金、不做再投资，遇到高分红基金会把收益严重低估——易方达科讯近 3 年
用累计净值算出 86.7%，Wind 复权口径是 177.4%，差一倍。

本脚本无视 em-full.json 里已有的 mdd3y / cum3y，对每一行都重新拉净值重算，
把全库切到复权口径。与 fill_nav.py 的分工：
  fill_nav.py   —— 只补 mdd3y 为空的（增量补齐）
  recalc_nav.py —— 全部重算（口径切换 / 定期刷新时用）

可反复执行；拉取失败的基金保留原值，不会被置空。

用法：
  python recalc_nav.py                 # 全量重算
  python recalc_nav.py --workers 5     # 调并发
  python recalc_nav.py --limit 200     # 调试
"""
import argparse
import json
import os
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from sync_eastmoney import fetch_nav, max_drawdown, interval_return, DATA_DATE, RETURN_WINDOW_START

HERE = os.path.dirname(os.path.abspath(__file__))
SNAPSHOT = os.path.join(os.path.dirname(HERE), 'data', 'snapshot', 'em-full.json')


def _finite(v):
    """NaN/Infinity 不是合法 JSON，写盘前统一转 None。"""
    if isinstance(v, float) and (v != v or v in (float('inf'), float('-inf'))):
        return None
    return v


def _save(doc):
    doc['rows'] = [[_finite(v) for v in r] for r in doc['rows']]
    tmp = SNAPSHOT + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(doc, f, ensure_ascii=False)
    os.replace(tmp, SNAPSHOT)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--workers', type=int, default=5)
    ap.add_argument('--limit', type=int, default=0)
    ap.add_argument('--retries', type=int, default=3)
    args = ap.parse_args()

    doc = json.load(open(SNAPSHOT, encoding='utf-8'))
    cols = doc['cols']
    i_code = cols.index('code')
    i_mdd = cols.index('mdd3y')
    i_cum = cols.index('cum3y')
    i_calc = cols.index('cum3y_calc')

    rows = doc['rows']
    if args.limit:
        rows = rows[:args.limit]
    print('全量重算 %d 只（共 %d 只），%d 并发' % (len(rows), len(doc['rows']), args.workers), flush=True)

    s_ms = int(datetime.strptime(RETURN_WINDOW_START, '%Y-%m-%d').timestamp() * 1000)
    e_ms = int(datetime.strptime(DATA_DATE, '%Y-%m-%d').timestamp() * 1000) + 86400000

    by_code = {r[i_code]: r for r in rows}
    ok = 0
    changed = 0
    t0 = time.time()
    round_no = 0
    pending = list(by_code.keys())

    while pending and round_no < args.retries:
        round_no += 1
        print('第 %d 轮，待处理 %d 只' % (round_no, len(pending)), flush=True)
        nxt = []
        with ThreadPoolExecutor(max_workers=args.workers) as ex:
            futs = {ex.submit(fetch_nav, c): c for c in pending}
            done = 0
            for fut in as_completed(futs):
                c = futs[fut]
                done += 1
                try:
                    _, series = fut.result()
                except Exception:
                    series = None
                if series:
                    mdd = max_drawdown(series, s_ms, e_ms)
                    ret = interval_return(series, s_ms, e_ms)
                    if mdd is not None and ret is not None:
                        row = by_code[c]
                        old = row[i_cum]
                        # 复权口径普遍高于累计净值口径，差 30% 以上说明原来吃过分红的亏
                        if old is not None and abs(ret - old) > 30:
                            changed += 1
                        row[i_mdd] = mdd
                        row[i_cum] = ret
                        row[i_calc] = ret
                        ok += 1
                        continue
                nxt.append(c)
                if done % 500 == 0:
                    _save(doc)
                    print('  %d/%d（成功 %d，%.0fs）' % (done, len(pending), ok, time.time() - t0), flush=True)
        pending = nxt
        _save(doc)
        print('  第 %d 轮完成：成功 %d，仍缺 %d，已落盘（%.0fs）'
              % (round_no, ok, len(pending), time.time() - t0), flush=True)
        if pending:
            time.sleep(20)

    _save(doc)
    print('完成：成功 %d / %d，收益修正幅度 >30%% 的有 %d 只，仍缺 %d 只，用时 %.0fs'
          % (ok, len(by_code), changed, len(pending), time.time() - t0))
    print('已写回 %s' % SNAPSHOT)


if __name__ == '__main__':
    main()
