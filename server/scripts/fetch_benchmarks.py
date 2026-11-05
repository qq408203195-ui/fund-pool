#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
抓取回测基准指数的日收盘价，存 data/benchmarks.json。

- 沪深300 / 中证500 / 中证1000：腾讯 ifzq.gtimg.cn 分年拉日K（指数不复权，
  收盘即点位）；
- 中证偏股型基金指数 930950：雪球 kline（symbol=CSI930950），一次拉全。

输出结构：
{
  "hs300":  {"name": "沪深300", "points": [[20130104, 2522.95], ...]},
  ...
}

腾讯单次请求最多返回 640 根K线，所以按年分段拼；
雪球一次给够，直接 count=-10000。
"""

import json
import os
import time

import requests

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', 'data', 'benchmarks.json')

TX_CODES = {
    'hs300': ('sh000300', '沪深300'),
    'zz500': ('sh000905', '中证500'),
    'zz1000': ('sh000852', '中证1000'),
}
XQ_CODE = ('CSI930950', '偏股基金指数')

START_YEAR = 2013


def make_session():
    s = requests.Session()
    s.trust_env = False  # 本机系统代理会掐断行情接口
    s.headers['User-Agent'] = ('Mozilla/5.0 (Windows NT 10.0; Win64; x64) '
                               'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36')
    return s


def tx_kline_year(s, code, year):
    url = ('https://web.ifzq.gtimg.cn/appstock/app/fqkline/get'
           '?param=%s,day,%d-01-01,%d-12-31,640,' % (code, year, year))
    d = s.get(url, timeout=20).json()['data'][code]
    key = 'day' if d.get('day') else next(k for k in d if k.endswith('day'))
    rows = d.get(key) or []
    out = []
    for row in rows:
        # [date, open, close, high, low, ...]：指数点位只认收盘
        out.append([int(row[0].replace('-', '')), float(row[2])])
    return out


def fetch_tx(s, code):
    pts = {}
    for y in range(START_YEAR, time.localtime().tm_year + 1):
        for d, v in tx_kline_year(s, code, y):
            pts[d] = v
        time.sleep(0.3)
    return sorted(pts.items())


def fetch_xq(s, code):
    # 先访问首页换 xq_a_token
    s.get('https://xueqiu.com/', timeout=20)
    now = int(time.time() * 1000)
    url = ('https://stock.xueqiu.com/v5/stock/chart/kline.json?symbol=%s'
           '&begin=%d&period=day&type=before&count=-10000&indicator=kline' % (code, now))
    d = s.get(url, timeout=20).json()
    if d.get('error_code') != 0:
        raise SystemExit('雪球返回错误: %s' % d)
    cols = d['data']['column']
    ci = {c: i for i, c in enumerate(cols)}
    import datetime
    pts = []
    for item in d['data']['item']:
        day = int(datetime.datetime.fromtimestamp(item[ci['timestamp']] / 1000).strftime('%Y%m%d'))
        pts.append([day, float(item[ci['close']])])
    return sorted(pts, key=lambda p: p[0])


def main():
    s = make_session()
    doc = {}
    for key, (code, name) in TX_CODES.items():
        pts = fetch_tx(s, code)
        doc[key] = {'name': name, 'points': pts}
        print('%s %s: %d 点（%d ~ %d）' % (key, name, len(pts), pts[0][0], pts[-1][0]))
    code, name = XQ_CODE
    pts = fetch_xq(s, code)
    doc['pcf'] = {'name': name, 'points': pts}
    print('pcf %s: %d 点（%d ~ %d）' % (name, len(pts), pts[0][0], pts[-1][0]))
    with open(OUT, 'w', encoding='utf-8') as f:
        json.dump(doc, f, ensure_ascii=False, separators=(',', ':'))
    print('写入', os.path.normpath(OUT))


if __name__ == '__main__':
    main()
