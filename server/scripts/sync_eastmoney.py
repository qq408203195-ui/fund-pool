#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
全市场基金数据同步（东财全量口径）。

背景：Wind MCP 单次只返回 100 条且无分页，数值筛选与排序会静默失效，
无法在一次会话里拉到全市场。因此改用东财接口做「池内样本」的全量覆盖，
最终入榜的少量基金再由 Wind 逐只复核（见 scripts/verify_wind.md）。

产出：server/data/snapshot/em-full.json（列式，供 src/importSnapshot.js 导入）

用法：
  python sync_eastmoney.py                 # 全量同步
  python sync_eastmoney.py --stage base    # 只拉基础表，不逐只补详情
  python sync_eastmoney.py --limit 200     # 调试：只处理前 200 只
"""
import argparse
import json
import os
import re
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime

import requests

# ── 口径参数 ───────────────────────────────────────────────────
DATA_DATE = '2026-10-27'          # 数据截止日

# 业绩统计窗口起点（近 3 年）。和下面「成立年限门槛」是两件事：
# 一个是算多久的业绩，一个是基金得存在多久才有资格入池。混用会让改成立门槛
# 时把收益窗口一起改掉，所以严格分开。
RETURN_WINDOW_START = '2023-10-27'

# 采集层门槛：只捞「有完整 3 年业绩可算」的基金，这是最宽口径。
# 实际入池门槛（成立满 5 年）在导入层按 server/src/config/caliber.js 的
# MIN_TRACK_YEARS 收紧——成立满 5 年是满 3 年的子集，所以调紧门槛不必重跑采集。
CUTOFF_ESTAB = '2023-10-27'

MIN_SCALE_YI = 2.0                # 规模门槛（亿元），剔除迷你基金
MAX_WORKERS = 6

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)                       # server/
SNAPSHOT_DIR = os.path.join(ROOT, 'data', 'snapshot')
RAW_DIR = os.path.join(ROOT, 'data', 'raw')

# fundmobapi 接口会拒绝完整 Chrome UA（ErrCode 61136403），只认短 UA；
# pingzhongdata 走普通网页通道，长 UA 才正常。两者分开设置。
UA_API = 'Mozilla/5.0'
UA_WEB = ('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
          '(KHTML, like Gecko) Chrome/120.0 Safari/537.36')


# ── 东财类型 → Wind 投资类型二级分类 ────────────────────────────
TYPE_MAP = {
    '股票型': '普通股票型基金',
    '混合型-偏股': '偏股混合型基金',
    '混合型-灵活': '灵活配置型基金',
    '混合型-平衡': '平衡混合型基金',
    '混合型-偏债': '偏债混合型基金',
    '混合型-绝对收益': '偏债混合型基金',
    '债券型-长债': '中长期纯债型基金',
    '债券型-利率债': '中长期纯债型基金',
    '债券型-信用债': '中长期纯债型基金',
    '债券型-中短债': '短期纯债型基金',
    '债券型-混合一级': '混合债券型一级基金',
    '债券型-混合二级': '混合债券型二级基金',
    '指数型-股票': '被动指数型基金',
    '指数型-固收': '被动指数型债券基金',
    '指数型-其他': '被动指数型基金',
    # 跨境指数基金在 Wind 口径里归入国际(QDII)股票型，不进境内被动池
    '指数型-海外股票': '国际(QDII)股票型基金',
    'QDII-普通股票': '国际(QDII)股票型基金',
    'QDII-混合偏股': '国际(QDII)混合型基金',
    'QDII-混合灵活': '国际(QDII)混合型基金',
    'QDII-混合平衡': '国际(QDII)混合型基金',
    'QDII-FOF': '国际(QDII)混合型基金',
    'QDII-纯债': '国际(QDII)债券型基金',
    'QDII-混合债': '国际(QDII)债券型基金',
    'QDII-商品': '国际(QDII)另类投资基金',
    'QDII-REITs': '国际(QDII)另类投资基金',
    '商品': '商品型基金',
    'FOF-稳健型': '混合型FOF基金',
    'FOF-均衡型': '混合型FOF基金',
    # 东财的「进取型」按风险等级分，多数仍是混合型 FOF；Wind 的股票型 FOF 只认合同约定股票仓位的
    'FOF-进取型': '混合型FOF基金',
}

# 东财没有独立分类、只能靠名称判定的类型
RE_ENHANCED = re.compile(r'增强')
RE_CONVERT = re.compile(r'(转债|可转)')
# 商品标的必须点名具体品种，不能用「银」「有色」「能源」这类宽泛词——单字「银」会把银行指数基金全卷进来
RE_COMMODITY = re.compile(r'(黄金|白银|豆粕|大豆|原油|石油|天然气|有色金属期货|能源化工|商品期货|大宗商品|抗通胀)')
RE_QDII = re.compile(r'(QDII|海外|全球|纳斯达克|标普|恒生|港股|美国|日本|德国|法国|印度|越南|亚太|欧洲|新兴市场|金砖)')

# 份额后缀：末尾单字母份额类别
RE_SHARE_SUFFIX = re.compile(
    r'(\(后端\)|（后端）|\(美元现汇\)|\(美元现钞\)|\(人民币\)|\(美元\)|'
    r'(?<![A-Za-z0-9])[A-Za-z]$)'
)
# 这些词结尾的基金名不含份额含义，不能去掉
KEEP_TAIL_WORDS = ('ETF', 'LOF', 'QDII', 'FOF', 'MSCI', 'REITs')


def share_base(name):
    """把「易方达蓝筹精选混合A」归一成「易方达蓝筹精选混合」，用于份额合并。"""
    n = (name or '').strip()
    if not n:
        return ''
    # ETF / LOF 等结尾本身是产品类型，不是份额
    for w in KEEP_TAIL_WORDS:
        if n.endswith(w):
            return n
    prev = None
    while prev != n:
        prev = n
        n = RE_SHARE_SUFFIX.sub('', n).strip()
    return n


def share_rank(name, code):
    """同一只基金多个份额时的优选顺序：无后缀 > A > 其他字母。"""
    n = (name or '').strip()
    if n == share_base(n):
        return (0, code)
    m = re.search(r'([A-Za-z])$', n)
    if m and m.group(1).upper() == 'A':
        return (1, code)
    return (2, code)


def to_float(v):
    try:
        if v is None or v == '' or v == '--':
            return None
        return float(v)
    except (TypeError, ValueError):
        return None


def fetch_detail(code):
    """东财基金详情：净资产、成立日、公司、跟踪指数。"""
    url = 'https://fundmobapi.eastmoney.com/FundMNewApi/FundMNDetailInformation'
    # deviceid/plat 必须是 Wap，用 Android/1 会被风控拒绝（ErrCode 61136403）
    params = {'FCODE': code, 'deviceid': 'Wap', 'plat': 'Wap',
              'product': 'EFund', 'version': '6.2.8'}
    d = None
    for attempt in range(3):
        try:
            r = requests.get(url, params=params, timeout=20, headers={'User-Agent': UA_API})
            j = r.json() or {}
            if j.get('Success') and j.get('Datas'):
                d = j['Datas']
                break
        except Exception:
            pass
        time.sleep(0.6 * (attempt + 1))
    if not d:
        return code, None
    nav = to_float(d.get('ENDNAV')) or to_float(d.get('NETNAV'))
    return code, {
        'scale': (nav / 1e8) if nav else None,          # 元 → 亿元
        'estab': (d.get('ESTABDATE') or '')[:10] or None,
        'company': d.get('JJGS') or None,
        'em_type_detail': d.get('FTYPE') or None,
        'idx_name': (d.get('INDEXNAME') or '').strip('-- ') or None,
        'idx_code': (d.get('INDEXCODE') or '').strip('-- ') or None,
        'manager': (d.get('JJJL') or '').strip('-- ') or None,
    }


# pingzhongdata 里各变量用 `var X =[...]` 或 `var X ={...}`，值内不含 `;`
RE_VAR = r'var\s+{name}\s*=\s*([\[{{].*?[\]}}])\s*;'


def _extract(text, name):
    m = re.search(RE_VAR.format(name=re.escape(name)), text, re.S)
    if not m:
        return None
    try:
        return json.loads(m.group(1))
    except Exception:
        return None


# 每次都新建连接会把本地临时端口打满（Windows 动态端口 16384 个、TIME_WAIT 240s），
# 几千只基金跑下来必然大面积 WinError 10048。每线程常驻一个 Session 复用连接，
# 端口占用降到与并发数同级，同时也更像正常浏览器行为。
_TLS = threading.local()


def _session():
    s = getattr(_TLS, 's', None)
    if s is None:
        s = requests.Session()
        ad = requests.adapters.HTTPAdapter(pool_connections=4, pool_maxsize=4, max_retries=0)
        s.mount('https://', ad)
        s.mount('http://', ad)
        _TLS.s = s
    return s


def fetch_nav(code):
    """
    拉净值并重建成「复权净值」序列。

    不能用累计净值（Data_ACWorthTrend）直接算收益：累计净值只是把分红加回本金、
    不做再投资，遇到高分红基金会把收益严重低估——实测易方达科讯近 3 年用累计净值
    算出 86.7%，而 Wind 的复权口径是 177.4%，差一倍。

    Data_netWorthTrend 里每个点都带 equityReturn（已考虑分红的当日增长率），
    按它累乘才是复权净值，与 Wind「复权单位净值增长率」同口径。
    """
    url = 'https://fund.eastmoney.com/pingzhongdata/%s.js' % code
    for attempt in range(2):
        try:
            r = _session().get(url, timeout=25, headers={'User-Agent': UA_WEB})
            if r.status_code != 200 or len(r.text) < 200:
                time.sleep(1.2 * (attempt + 1))
                continue
            text = r.text
            nw = _extract(text, 'Data_netWorthTrend')

            series = []
            adj = 1.0
            for item in (nw or []):
                if not isinstance(item, dict) or 'x' not in item:
                    continue
                try:
                    ts = int(item['x'])
                except (TypeError, ValueError):
                    continue
                r_pct = item.get('equityReturn')
                try:
                    r_pct = float(r_pct) if r_pct not in (None, '') else 0.0
                except (TypeError, ValueError):
                    r_pct = 0.0
                adj *= (1 + r_pct / 100.0)
                series.append((ts, adj))

            if len(series) < 20:
                # 退化为累计净值
                ac = _extract(text, 'Data_ACWorthTrend')
                series = []
                for item in (ac or []):
                    if isinstance(item, list) and len(item) >= 2:
                        try:
                            series.append((int(item[0]), float(item[1])))
                        except (TypeError, ValueError):
                            continue
            series.sort(key=lambda x: x[0])
            if series:
                return code, series
        except Exception:
            time.sleep(1.2 * (attempt + 1))
    return code, None


def max_drawdown(series, start_ms, end_ms):
    """区间内最大回撤（负值，%）。"""
    vals = [v for ts, v in series if start_ms <= ts <= end_ms and v is not None and v > 0]
    if len(vals) < 20:
        return None
    peak = vals[0]
    mdd = 0.0
    for v in vals:
        if v > peak:
            peak = v
        if peak > 0:
            dd = (v - peak) / peak
            if dd < mdd:
                mdd = dd
    return round(mdd * 100, 4)


def interval_return(series, start_ms, end_ms):
    """
    区间累计涨幅（%），与 Wind「近 3 年复权单位净值增长率」同口径。

    基准必须取「窗口起点日或之前最后一个净值」：起点当天常常不是净值披露日
    （周末/节假日/暂停披露），若直接用窗口内第一个净值当基准，就会漏掉
    起点到首个披露日之间的涨跌——实测诺安创新驱动因此偏高 3 个百分点。
    """
    if not series:
        return None
    base = None
    for ts, v in series:
        if ts <= start_ms and v:
            base = v
        else:
            break
    seg = [(ts, v) for ts, v in series if start_ms <= ts <= end_ms and v]
    if len(seg) < 20 or not base:
        return None
    return round((seg[-1][1] / base - 1) * 100, 4)


def classify(em_type, name, idx_name):
    """东财类型 + 名称规则 → Wind 二级分类。"""
    t = TYPE_MAP.get(em_type or '')
    if t is None:
        return None
    # 增强指数：东财归在被动指数里
    if t == '被动指数型基金' and RE_ENHANCED.search(name or ''):
        return '增强指数型基金'
    # 可转债：东财归在混合二级或长债里
    if t in ('混合债券型二级基金', '中长期纯债型基金', '短期纯债型基金') and RE_CONVERT.search(name or ''):
        return '可转换债券型基金'
    # 黄金/原油等商品基金，非 QDII 口径
    if t == '被动指数型基金' and not RE_QDII.search(name or '') and RE_COMMODITY.search(idx_name or name or ''):
        return '商品型基金'
    return t


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--stage', default='all', choices=['base', 'all'])
    ap.add_argument('--limit', type=int, default=0)
    args = ap.parse_args()

    os.makedirs(SNAPSHOT_DIR, exist_ok=True)
    os.makedirs(RAW_DIR, exist_ok=True)
    t0 = time.time()

    def log(msg):
        print('[%6.1fs] %s' % (time.time() - t0, msg), flush=True)

    # ── 1. 基础表：代码、简称、东财类型、申购状态 ──────────────
    log('拉取申购状态表 fund_purchase_em ...')
    import akshare as ak
    pur = ak.fund_purchase_em()
    log('  申购状态表 %d 条' % len(pur))

    rows = {}
    for rec in pur.to_dict('records'):
        code = str(rec.get('基金代码') or '').strip()
        if not re.fullmatch(r'\d{6}', code):
            continue
        rows[code] = {
            'code': code,
            'name': (rec.get('基金简称') or '').strip(),
            'em_type': (rec.get('基金类型') or '').strip(),
            'status': (rec.get('申购状态') or '').strip(),
            'limit_amount': rec.get('日累计限定金额'),
        }
    log('  规范化后 %d 只' % len(rows))

    # ── 2. 近 3 年收益（东财官方口径，用于交叉校验） ────────────
    log('拉取区间收益 fund_open_fund_rank_em ...')
    try:
        rank = ak.fund_open_fund_rank_em(symbol='全部')
        n_ret = 0
        for rec in rank.to_dict('records'):
            code = str(rec.get('基金代码') or '').strip()
            if code in rows:
                v = to_float(rec.get('近3年'))
                if v is not None:
                    rows[code]['cum3y_em'] = v
                    n_ret += 1
        log('  匹配到近3年收益 %d 只' % n_ret)
    except Exception as e:
        log('  区间收益拉取失败：%s' % e)

    # ── 3. 份额合并：一只基金只留一个代表份额 ──────────────────
    groups = {}
    for code, r in rows.items():
        key = share_base(r['name'])
        if not key:
            continue
        groups.setdefault(key, []).append(r)
    picked = []
    for key, lst in groups.items():
        lst.sort(key=lambda r: share_rank(r['name'], r['code']))
        best = lst[0]
        best['share_count'] = len(lst)
        best['is_initial'] = 1 if share_rank(best['name'], best['code'])[0] <= 1 else 0
        picked.append(best)
    log('份额合并：%d 个代码 → %d 只基金' % (len(rows), len(picked)))

    # 只保留属于目标池类型的基金
    cand = []
    for r in picked:
        wt = classify(r['em_type'], r['name'], None)
        if wt:
            r['type_l2'] = wt
            cand.append(r)
    log('命中目标池类型：%d 只' % len(cand))

    if args.limit:
        cand = cand[:args.limit]

    if args.stage == 'base':
        _dump(cand, os.path.join(RAW_DIR, 'em_base.json'))
        log('已输出基础表，跳过逐只补详情')
        return

    # ── 4. 逐只补详情：规模、成立日、公司、跟踪指数 ────────────
    log('逐只补详情（%d 只，%d 并发）...' % (len(cand), MAX_WORKERS))
    detail_ok = 0
    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as ex:
        futs = {ex.submit(fetch_detail, r['code']): r for r in cand}
        done = 0
        for fut in as_completed(futs):
            r = futs[fut]
            code, d = fut.result()
            done += 1
            if d:
                r.update({
                    'scale': d['scale'],
                    'estab': d['estab'],
                    'company': d['company'],
                    'idx_name': d['idx_name'],
                    'idx_code': d['idx_code'],
                    'manager': d['manager'],
                })
                detail_ok += 1
            if done % 1000 == 0:
                log('  详情 %d/%d（成功 %d）' % (done, len(cand), detail_ok))
    log('  详情完成：%d/%d' % (detail_ok, len(cand)))

    # 补完详情后重判类型（商品类需要跟踪指数名）
    for r in cand:
        r['type_l2'] = classify(r['em_type'], r['name'], r.get('idx_name')) or r['type_l2']

    # ── 5. 口径过滤：成立满 3 年 + 规模 ≥ 门槛 ──────────────────
    kept = []
    for r in cand:
        estab = r.get('estab')
        if not estab or estab > CUTOFF_ESTAB:
            continue
        sc = r.get('scale')
        if sc is None or sc < MIN_SCALE_YI:
            continue
        kept.append(r)
    log('口径过滤（采集宽口径：成立满3年 + 规模≥%.0f亿）：%d → %d' % (MIN_SCALE_YI, len(cand), len(kept)))

    # ── 6. 本地计算近 3 年回撤与区间收益 ───────────────────────
    log('计算近 3 年回撤（%d 只）...' % len(kept))
    start_ms = int(datetime.strptime(RETURN_WINDOW_START, '%Y-%m-%d').timestamp() * 1000)
    end_ms = int(datetime.strptime(DATA_DATE, '%Y-%m-%d').timestamp() * 1000) + 86400000

    nav_ok = 0
    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as ex:
        futs = {ex.submit(fetch_nav, r['code']): r for r in kept}
        done = 0
        for fut in as_completed(futs):
            r = futs[fut]
            code, series = fut.result()
            done += 1
            if series:
                r['mdd3y'] = max_drawdown(series, start_ms, end_ms)
                r['cum3y_calc'] = interval_return(series, start_ms, end_ms)
                if r['mdd3y'] is not None:
                    nav_ok += 1
            if done % 1000 == 0:
                log('  回撤 %d/%d（成功 %d）' % (done, len(kept), nav_ok))
    log('  回撤完成：%d/%d' % (nav_ok, len(kept)))

    # ── 7. 输出快照 ────────────────────────────────────────────
    out = os.path.join(SNAPSHOT_DIR, 'em-full.json')
    _dump(kept, out)
    log('已写出 %s（%d 只）' % (out, len(kept)))

    # 统计
    from collections import Counter
    c = Counter(r['type_l2'] for r in kept)
    for k, v in c.most_common():
        print('  %-22s %5d' % (k, v))



def _finite(v):
    """NaN/Infinity 不是合法 JSON，写盘前统一转 None。"""
    if isinstance(v, float) and (v != v or v in (float('inf'), float('-inf'))):
        return None
    return v

def _dump(rows, path):
    cols = ['code', 'name', 'company', 'type', 'initial', 'status', 'mgrStart',
            'cum3y', 'mdd3y', 'calmarWind', 'scale', 'idxName', 'idxCode',
            'estab', 'cum3y_em', 'cum3y_calc', 'shareCount']
    out_rows = []
    for r in rows:
        out_rows.append([
            r['code'],
            r['name'],
            r.get('company'),
            r['type_l2'],
            1 if r.get('is_initial') else 0,
            r.get('status'),
            None,                                    # mgrStart 由 Wind 复核阶段补
            r.get('cum3y_calc'),                     # 本地按累计净值算的近3年涨幅
            r.get('mdd3y'),
            None,                                    # calmarWind 由 Wind 复核阶段补
            round(r['scale'], 4) if r.get('scale') is not None else None,
            r.get('idx_name'),
            r.get('idx_code'),
            r.get('estab'),
            r.get('cum3y_em'),
            r.get('cum3y_calc'),
            r.get('share_count'),
        ])
    with open(path, 'w', encoding='utf-8') as f:
        json.dump({
            'dataDate': DATA_DATE,
            'source': 'eastmoney',
            'cutoffEstab': CUTOFF_ESTAB,
            'minScaleYi': MIN_SCALE_YI,
            'cols': cols,
            'rows': [[_finite(v) for v in r] for r in out_rows],
        }, f, ensure_ascii=False)
    print('  → %s (%d rows)' % (path, len(out_rows)))


if __name__ == '__main__':
    main()
