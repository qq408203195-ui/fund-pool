#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
补跑回撤：对 em-full.json 里 mdd3y 为空的基金重新拉净值序列并计算。

全量同步时详情阶段连打 1.4 万次请求，紧接着拉净值会被东财临时频控，
导致回撤大面积缺失。这个脚本单独跑，可以反复执行直到补齐。

用法：python fill_nav.py [--workers 4] [--limit N]
"""
import argparse
import json
import os
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime

import requests

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from sync_eastmoney import fetch_nav, max_drawdown, interval_return, DATA_DATE, RETURN_WINDOW_START

HERE = os.path.dirname(os.path.abspath(__file__))
SNAPSHOT = os.path.join(os.path.dirname(HERE), 'data', 'snapshot', 'em-full.json')



def _finite(v):
    """NaN/Infinity 不是合法 JSON，写盘前统一转 None。"""
    if isinstance(v, float) and (v != v or v in (float('inf'), float('-inf'))):
        return None
    return v

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--workers', type=int, default=4)
    ap.add_argument('--limit', type=int, default=0)
    ap.add_argument('--retries', type=int, default=3)
    args = ap.parse_args()

    doc = json.load(open(SNAPSHOT, encoding='utf-8'))
    cols = doc['cols']
    i_code = cols.index('code')
    i_mdd = cols.index('mdd3y')
    i_cum = cols.index('cum3y')
    i_calc = cols.index('cum3y_calc')

    todo = [r for r in doc['rows'] if r[i_mdd] is None]
    if args.limit:
        todo = todo[:args.limit]
    print('待补回撤 %d 只（共 %d 只）' % (len(todo), len(doc['rows'])), flush=True)
    if not todo:
        return

    s_ms = int(datetime.strptime(RETURN_WINDOW_START, '%Y-%m-%d').timestamp() * 1000)
    e_ms = int(datetime.strptime(DATA_DATE, '%Y-%m-%d').timestamp() * 1000) + 86400000

    by_code = {r[i_code]: r for r in todo}
    ok = 0
    t0 = time.time()
    round_no = 0
    pending = list(by_code.keys())

    while pending and round_no < args.retries:
        round_no += 1
        print('第 %d 轮，剩余 %d 只' % (round_no, len(pending)), flush=True)
        nxt = []
        with ThreadPoolExecutor(max_workers=args.workers) as ex:
            futs = {ex.submit(fetch_nav, c): c for c in pending}
            done = 0
            for fut in as_completed(futs):
                c = futs[fut]
                _, series = fut.result()
                done += 1
                if series:
                    mdd = max_drawdown(series, s_ms, e_ms)
                    ret = interval_return(series, s_ms, e_ms)
                    if mdd is not None:
                        row = by_code[c]
                        row[i_mdd] = mdd
                        if ret is not None:
                            row[i_cum] = ret
                            row[i_calc] = ret
                        ok += 1
                        continue
                nxt.append(c)
                if done % 500 == 0:
                    print('  %d/%d（成功 %d，%.0fs）' % (done, len(pending), ok, time.time() - t0), flush=True)
        pending = nxt
        if pending:
            print('  本轮后仍缺 %d 只，等待 20s 再试' % len(pending), flush=True)
            time.sleep(20)

    doc['rows'] = [[_finite(v) for v in r] for r in doc['rows']]
    json.dump(doc, open(SNAPSHOT, 'w', encoding='utf-8'), ensure_ascii=False)
    print('补齐 %d 只，仍缺 %d 只，用时 %.0fs' % (ok, len(pending), time.time() - t0))
    print('已写回 %s' % SNAPSHOT)


if __name__ == '__main__':
    main()
