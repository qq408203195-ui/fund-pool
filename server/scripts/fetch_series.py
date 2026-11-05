#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
拉取主动权益池全部基金的日度复权净值全历史，存入独立库 navseries.db。

回测（backtest_quarterly.py）需要从 2016 年起逐季度重算「近 3 年」指标，
每次都要完整序列——快照里的 win_json 只有截止日的窗口值，不够用。

存储格式（每只一行）：
    nav_series(code TEXT PRIMARY KEY, dates TEXT, navs TEXT)
    dates: "20130104,20130105,..." （YYYYMMDD，按日升序）
    navs:  "1.000000,1.012345,..."   （复权净值，equityReturn 累乘）

增量友好：已有数据的基金默认跳过，断了重跑即可。
用法：
    python fetch_series.py                # 全量补齐
    python fetch_series.py --limit 20     # 调试
"""

import argparse
import json
import os
import sqlite3
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from sync_eastmoney import fetch_nav  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SNAPSHOT_DB = os.path.join(ROOT, 'data', 'fundpool.db')
SERIES_DB = os.path.join(ROOT, 'data', 'navseries.db')

POOL = 'active-equity'


def pool_codes():
    con = sqlite3.connect(SNAPSHOT_DB)
    try:
        rows = con.execute('select code from pool_members where pool_id=?', (POOL,)).fetchall()
    finally:
        con.close()
    return [r[0] for r in rows]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--workers', type=int, default=6)
    ap.add_argument('--limit', type=int, default=0)
    ap.add_argument('--retries', type=int, default=3)
    args = ap.parse_args()

    codes = pool_codes()
    if args.limit:
        codes = codes[:args.limit]

    con = sqlite3.connect(SERIES_DB)
    con.execute('''create table if not exists nav_series(
        code text primary key, dates text not null, navs text not null)''')
    con.commit()

    have = {r[0] for r in con.execute('select code from nav_series').fetchall()}
    pending = [c for c in codes if c not in have]
    print('主动权益池 %d 只，已存 %d 只，待拉 %d 只，%d 并发'
          % (len(codes), len(codes) - len(pending), len(pending), args.workers), flush=True)

    ok = 0
    t0 = time.time()

    def store(code, series):
        # 只留 2013-01-01 之后的点：回测最早调仓日 2016-01，往前看 3 年足够
        lo = int(datetime(2013, 1, 1).timestamp() * 1000)
        pts = [(ts, v) for ts, v in series if ts >= lo]
        if not pts:
            return False
        dates = ','.join(datetime.fromtimestamp(ts / 1000).strftime('%Y%m%d') for ts, _ in pts)
        navs = ','.join('%.6f' % v for _, v in pts)
        con.execute('insert or replace into nav_series values(?,?,?)', (code, dates, navs))
        return True

    round_no = 0
    failed = pending
    while failed and round_no < args.retries:
        round_no += 1
        print('第 %d 轮，待处理 %d 只' % (round_no, len(failed)), flush=True)
        nxt = []
        done = 0
        with ThreadPoolExecutor(max_workers=args.workers) as ex:
            futs = {ex.submit(fetch_nav, c): c for c in failed}
            for fut in as_completed(futs):
                c = futs[fut]
                done += 1
                try:
                    _, series = fut.result()
                except Exception:
                    series = None
                if series and len(series) >= 20:
                    store(c, series)
                    con.commit()
                    ok += 1
                else:
                    nxt.append(c)
                if done % 300 == 0:
                    print('  %d/%d（成功 %d，%.0fs）' % (done, len(failed), ok, time.time() - t0), flush=True)
        failed = nxt
        print('  第 %d 轮完成：成功 %d，仍缺 %d（%.0fs）' % (round_no, ok, len(failed), time.time() - t0), flush=True)
        if failed:
            time.sleep(10)

    con.commit()
    n = con.execute('select count(*) from nav_series').fetchone()[0]
    con.close()
    print('完成：本轮成功 %d，库中共 %d 只，失败 %d 只，用时 %.0fs'
          % (ok, n, len(failed), time.time() - t0))


if __name__ == '__main__':
    main()
