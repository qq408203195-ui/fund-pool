#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
季度轮换回测：斩杀线右上角 5 只等权组合。

规则（严格无前视偏差）：
  1. 调仓日 = 2016 年起每季度首个交易日；
  2. 调仓日 t 当天，在主动权益池里筛：
     - 近 3 年（t-3y ~ t）最大回撤处于池内最小的 30%（回撤前 30%）；
     - 近 3 年几何年化收益处于池内最大的 30%（收益前 30%）；
     - 现任基金经理任职起始日 ≤ t - 3 年（任职超 3 年）；
     - 近 3 年内数据点 ≥ 690 个（序列完整，防新发基金混入）；
  3. 在过滤后的池内画斩杀线（按回撤升序、收益创新高者留下，同回撤取收益高者），
     取「右上角」即收益最高的 5 只（不足 5 只按实际数量）；
  4. 等权买入，持有到下个调仓日，再平衡回等权；
  5. 收益从调仓日后的第一个交易日起算（用截至 t 的数据决策、按 t 收盘价成交）；
  6. 基准 = 主动权益池全体等权日收益（同库同源）。

输入：data/fundpool.db（池成员、经理任职）+ data/navseries.db（日度复权净值）
输出：data/backtest.json
"""

import json
import math
import os
import sqlite3
from datetime import datetime, timedelta

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SNAPSHOT_DB = os.path.join(ROOT, 'data', 'fundpool.db')
SERIES_DB = os.path.join(ROOT, 'data', 'navseries.db')
OUT = os.path.join(ROOT, 'data', 'backtest.json')

POOL = 'active-equity'
START_YEAR = 2016
TOP_N = 5
# 回撤/收益的筛选分位：回撤处于池内最小 KEEP_Q，收益处于池内最大 KEEP_Q
KEEP_Q = 0.3
MIN_POINTS_3Y = 690          # 3 年约 730 个交易日，允许少量停牌缺日
LOOKBACK_YEARS = 3

D = datetime.strptime


def load_series():
    """{code: (dates[list[int]], navs[list[float]])}，dates 为 YYYYMMDD 升序"""
    con = sqlite3.connect(SERIES_DB)
    try:
        out = {}
        for code, dates, navs in con.execute('select code, dates, navs from nav_series'):
            d = [int(x) for x in dates.split(',')]
            v = [float(x) for x in navs.split(',')]
            if len(d) == len(v):
                out[code] = (d, v)
        return out
    finally:
        con.close()


def load_meta():
    """code -> {name, manager_start}"""
    con = sqlite3.connect(SNAPSHOT_DB)
    try:
        rows = con.execute(
            "select f.code, f.name, f.manager_start from funds f "
            "join pool_members m on m.code = f.code and m.pool_id = ?", (POOL,)).fetchall()
        return {r[0]: {'name': r[1], 'mgr': r[2]} for r in rows}
    finally:
        con.close()


def window_metrics(dates, navs, lo, hi):
    """[lo, hi]（YYYYMMDD，含端点）内的累计收益、几何年化、最大回撤。"""
    import bisect
    i0 = bisect.bisect_left(dates, lo)
    i1 = bisect.bisect_right(dates, hi) - 1
    if i1 - i0 + 1 < MIN_POINTS_3Y:
        return None
    seg = navs[i0:i1 + 1]
    if seg[0] <= 0:
        return None
    cum = seg[-1] / seg[0] - 1
    # 年化用日历日：窗口首尾日期差
    d0 = datetime.strptime(str(dates[i0]), '%Y%m%d')
    d1 = datetime.strptime(str(dates[i1]), '%Y%m%d')
    days = max((d1 - d0).days, 30)
    ann = (1 + cum) ** (365.25 / days) - 1
    peak = seg[0]
    mdd = 0.0
    for v in seg:
        if v > peak:
            peak = v
        dd = v / peak - 1
        if dd < mdd:
            mdd = dd
    return {'cum': cum, 'ann': ann, 'mdd': mdd, 'n': i1 - i0 + 1}


def _quantile(sorted_vals, q):
    """线性插值分位数（与 numpy.quantile 默认行为一致），输入须已升序。"""
    if not sorted_vals:
        raise ValueError('empty')
    if len(sorted_vals) == 1:
        return sorted_vals[0]
    pos = (len(sorted_vals) - 1) * q
    lo = math.floor(pos)
    hi = math.ceil(pos)
    if lo == hi:
        return sorted_vals[lo]
    return sorted_vals[lo] + (sorted_vals[hi] - sorted_vals[lo]) * (pos - lo)


def kill_line(cands):
    """
    斩杀线：从最稳的一只往激进方向走，收益创新高者留下（同回撤只留收益最高的）。
    mdd 是负数，「更稳」= 数值更大，所以必须按 -mdd 升序（即回撤从浅到深），
    直接对 mdd 升序会把回撤最深的排最前、整条前沿算错。
    输入 cands: [{code, ann, mdd, ...}]，输出线上的点，按回撤从浅到深。
    """
    seen = {}
    for c in cands:
        key = round(c['mdd'], 6)
        if key not in seen or c['ann'] > seen[key]['ann']:
            seen[key] = c
    pts = sorted(seen.values(), key=lambda c: -c['mdd'])
    line = []
    best = -math.inf
    for p in pts:
        if p['ann'] > best:
            line.append(p)
            best = p['ann']
    return line


def quarter_starts(dates_all, step_months=3):
    """2016Q1 起每隔 step_months 个月的首个交易日（3=季度、6=半年度、12=年度）。"""
    out = []
    y = START_YEAR
    m = 1
    last = dates_all[-1]
    while True:
        first_of_q = y * 10000 + m * 100 + 1
        nxt = [d for d in dates_all if d >= first_of_q]
        if not nxt:
            break
        out.append(nxt[0])
        if first_of_q > last:
            break
        m += step_months
        if m > 12:
            m = 1
            y += 1
    return out


def shift_years(yyyymmdd, years):
    d = datetime.strptime(str(yyyymmdd), '%Y%m%d')
    try:
        d = d.replace(year=d.year - years)
    except ValueError:
        d = d.replace(year=d.year - years, day=28)
    return int(d.strftime('%Y%m%d'))


def fmt(yyyymmdd):
    s = str(yyyymmdd)
    return '%s-%s-%s' % (s[:4], s[4:6], s[6:8])


def main():
    series = load_series()
    meta = load_meta()
    codes = sorted(set(series) & set(meta))
    print('有序列的池内基金 %d 只' % len(codes))

    # 全市场交易日历（并集）
    day_set = set()
    for ds, _ in series.values():
        day_set.update(ds)
    all_days = sorted(day_set)
    print('交易日 %d 个（%s ~ %s）' % (len(all_days), fmt(all_days[0]), fmt(all_days[-1])))

    rebals_q = [d for d in quarter_starts(all_days, 3) if d >= 20160101]
    print('季度调仓日 %d 个：%s ~ %s' % (len(rebals_q), fmt(rebals_q[0]), fmt(rebals_q[-1])))

    # 预置每只基金的 date->index
    idx = {c: {d: i for i, d in enumerate(ds)} for c, (ds, _) in series.items()}

    def select_picks(rebals_list):
        """给定调仓日列表，逐日选基：分位过滤 → 斩杀线 → 右上角 5 只。"""
        picks_log = []
        for t in rebals_list:
            lo = shift_years(t, LOOKBACK_YEARS)
            mgr_deadline = (datetime.strptime(str(t), '%Y%m%d') - timedelta(days=365.25 * 3)).strftime('%Y%m%d')
            cands = []
            for c in codes:
                m = meta[c]
                if not m['mgr'] or m['mgr'].replace('-', '') > mgr_deadline:
                    continue
                ds, nv = series[c]
                met = window_metrics(ds, nv, lo, t)
                if not met:
                    continue
                cands.append({'code': c, 'name': m['name'], **met})
            if len(cands) < 10:
                picks_log.append({'date': fmt(t), 'picks': [], 'universe': len(cands), 'note': '候选不足，跳过'})
                continue
            mdds = sorted(abs(c['mdd']) for c in cands)
            anns = sorted(c['ann'] for c in cands)
            # 分位截断：回撤取最小的 KEEP_Q，收益取最大的 KEEP_Q（线性插值取分位值）
            q_mdd = _quantile(mdds, KEEP_Q)
            q_ann = _quantile(anns, 1 - KEEP_Q)
            half = [c for c in cands if abs(c['mdd']) <= q_mdd and c['ann'] >= q_ann]
            line = kill_line(half)
            # 右上角 = 收益最高的 5 只；线上不足 5 只时（早期季度经理任职卡得狠）
            # 从过筛候选里按年化收益补足——它们同样过了回撤/收益/年限三道闸
            tail = sorted(line, key=lambda c: -c['ann'])[:TOP_N]
            if len(tail) < TOP_N:
                on = {c['code'] for c in tail}
                fill = sorted((c for c in half if c['code'] not in on),
                              key=lambda c: -c['ann'])[:TOP_N - len(tail)]
                tail.extend(fill)
            tail = sorted(tail, key=lambda c: -c['mdd'])  # 展示时按回撤从稳到激进
            picks_log.append({
                'date': fmt(t),
                'universe': len(cands),
                'passed': len(half),
                'onLine': len(line),
                'filled': len(line) < TOP_N,
                'picks': [{'code': c['code'], 'name': c['name'],
                           'ann3y': round(c['ann'] * 100, 2), 'mdd3y': round(c['mdd'] * 100, 2)} for c in tail],
            })
        return picks_log

    # —— 逐日净值模拟 ——

    def daily_returns(code, day_list):
        """给定交易日序列，返回该基金每日收益率（缺日=0，停牌视作持平）。"""
        ds, nv = series[code]
        pos = idx[code]
        out = []
        prev_v = None
        pi = 0
        prev_day = None
        for d in day_list:
            i = pos.get(d)
            if i is None:
                # 非该基金净值日（停牌/未成立）：收益 0，延续前值
                out.append(0.0)
                continue
            v = nv[i]
            if prev_v is None or prev_day is None:
                out.append(0.0)
            else:
                out.append(v / prev_v - 1)
            prev_v = v
            prev_day = d
        return out

    def build_sim(rebals_list):
        """组合计息日：每个调仓日的次一交易日起，至下一调仓日（含其前一天）；
        最后一个调仓日之后算到数据末尾。"""
        sim_days, seg_bounds = [], []  # seg_bounds: (start_idx_in_sim, rebal_t, seglen)
        for k, t in enumerate(rebals_list):
            nxt = rebals_list[k + 1] if k + 1 < len(rebals_list) else None
            seg = [d for d in all_days if d > t and (nxt is None or d <= nxt)]
            if not seg:
                continue
            seg_bounds.append((len(sim_days), t, len(seg)))
            sim_days.extend(seg)
        return sim_days, seg_bounds

    def simulate(seg_bounds, picks_log):
        """组合收益从每个调仓日后的第一个交易日起算；调仓日当天收盘换仓。"""
        nav_s = []
        vs = 1.0
        for si, t, seglen in seg_bounds:
            pick = next((p for p in picks_log if p['date'] == fmt(t)), None)
            members = [p['code'] for p in (pick['picks'] if pick else [])]
            seg_days = SIM[si:si + seglen]
            if members:
                rets = [daily_returns(c, seg_days) for c in members]
                w = 1.0 / len(rets)
                for j in range(seglen):
                    r = sum(w * rr[j] for rr in rets)
                    vs *= (1 + r)
                    nav_s.append(vs)
            else:
                for _ in seg_days:
                    nav_s.append(vs)
        return nav_s

    # 三种频率下的计息日都是 (首个调仓日, 数据末尾] 的全部交易日，先建一份公共序列
    SIM, _ = build_sim(rebals_q)
    if not SIM:
        raise SystemExit('无可模拟区间')

    # 基准（池内等权）与再平衡频率无关：全池逐日等权，算一次共用
    nav_b = []
    vb = 1.0
    for d in SIM:
        rb = 0.0
        cnt = 0
        for c in codes:
            i = idx[c].get(d)
            if i is None:
                continue
            ds, nv = series[c]
            if i == 0:
                continue
            pv = nv[i - 1]
            # 前一净值日距离太远（长期停牌后复牌）按真实复权差算
            rb += nv[i] / pv - 1
            cnt += 1
        vb *= (1 + (rb / cnt if cnt else 0.0))
        nav_b.append(vb)

    # —— 三种再平衡频率分别跑一遍（半年/年度的调仓日都是季度调仓日的子集，
    # 选基结果按日期复用不到——选基虽然只依赖日期，但缓存键就是日期，直接各查各的）——
    def stats(nav, days, d0, d1):
        cum = nav[-1] - 1
        years = (d1 - d0).days / 365.25
        ann = (1 + cum) ** (1 / years) - 1 if years > 0 else 0
        peak = nav[0]
        mdd = 0.0
        for v in nav:
            peak = max(peak, v)
            mdd = min(mdd, v / peak - 1)
        return {'cum': round(cum * 100, 1), 'ann': round(ann * 100, 1),
                'mdd': round(mdd * 100, 1), 'calmar': round(ann / abs(mdd), 2) if mdd else None}

    freq_defs = [('quarterly', 3, '季度再平衡'), ('semi', 6, '半年度再平衡'), ('annual', 12, '年度再平衡')]
    freqs = {}
    ref_days = None
    for key, step, label in freq_defs:
        rb = [d for d in quarter_starts(all_days, step) if d >= 20160101]
        pl = select_picks(rb)
        sd, sb = build_sim(rb)
        if ref_days is None:
            ref_days = sd
        elif sd != ref_days:
            raise SystemExit('%s 计息日与季度不一致，基准对不齐' % key)
        nav = simulate(sb, pl)
        d0 = datetime.strptime(fmt(sd[0]), '%Y-%m-%d')
        d1 = datetime.strptime(fmt(sd[-1]), '%Y-%m-%d')
        freqs[key] = {
            'name': label,
            'rebalances': len(rb),
            'start': fmt(sd[0]),
            'end': fmt(sd[-1]),
            'strategyNav': [round(v, 6) for v in nav],
            'quarters': pl,
            'stats': stats(nav, sd, d0, d1),
        }
        print('%s: 调仓 %d 次，累计 %.1f%% 年化 %.1f%% 回撤 %.1f%%'
              % (label, len(rb), freqs[key]['stats']['cum'], freqs[key]['stats']['ann'], freqs[key]['stats']['mdd']))

    sim_days = ref_days

    # —— 指数基准：从 data/benchmarks.json 读取（fetch_benchmarks.py 生成），
    # 对齐到组合计息日；指数晚于起点上市的（如 930950），上市前的日子留 None，
    # 净值从它自己首个有效日起 1.0 起——统计也只算有效段。 ——
    bench_file = os.path.join(HERE, '..', 'data', 'benchmarks.json')
    raw_bench = {}
    if os.path.exists(bench_file):
        with open(bench_file, encoding='utf-8') as f:
            raw_bench = json.load(f)

    d_start = datetime.strptime(fmt(sim_days[0]), '%Y-%m-%d')
    d_end = datetime.strptime(fmt(sim_days[-1]), '%Y-%m-%d')

    benchmarks = {
        'pool': {'name': '池内等权', 'nav': [round(v, 6) for v in nav_b],
                 'stats': stats(nav_b, sim_days, d_start, d_end), 'start': fmt(sim_days[0])},
    }
    for key, b in raw_bench.items():
        close = {p[0]: p[1] for p in b['points']}
        nav_i, prev, first_v = [], None, None
        for d in sim_days:
            if d in close:
                prev = close[d]
                if first_v is None:
                    first_v = prev
            # 指数停发/缺日 → 沿用前值；首个有效日之前留 None
            nav_i.append(prev / first_v if (first_v and prev is not None) else None)
        if not first_v:
            continue
        i0 = next(i for i, v in enumerate(nav_i) if v is not None)
        seg = nav_i[i0:]
        benchmarks[key] = {
            'name': b['name'],
            'nav': [round(v, 6) if v is not None else None for v in nav_i],
            'stats': stats(seg, sim_days[i0:],
                           datetime.strptime(fmt(sim_days[i0]), '%Y-%m-%d'), d_end),
            'start': fmt(sim_days[i0]),
        }
        print('%s(%s): %s 起，累计 %.1f%% 回撤 %.1f%%'
              % (key, b['name'], fmt(sim_days[i0]), benchmarks[key]['stats']['cum'],
                 benchmarks[key]['stats']['mdd']))

    doc = {
        'generatedAt': datetime.now().strftime('%Y-%m-%d %H:%M'),
        'pool': POOL,
        'start': fmt(sim_days[0]),
        'end': fmt(sim_days[-1]),
        'dates': [fmt(d) for d in sim_days],
        # 顶层保留季度版字段（兼容），完整结果在 freqs 里
        'strategyNav': freqs['quarterly']['strategyNav'],
        'benchmarks': benchmarks,
        'freqs': freqs,
        'quarters': freqs['quarterly']['quarters'],
        'stats': {'strategy': freqs['quarterly']['stats']},
        'rules': ('每个再平衡周期的首个交易日：近3年回撤池内前30%、近3年年化前30%、经理任职超3年的基金中，'
                  '画斩杀线并取收益最高的5只等权买入，持有一个周期后等权再平衡；'
                  '再平衡频率可选季度/半年度/年度。'
                  '线上不足5只时从过筛候选按收益补足。'
                  '选基只用截至调仓日的数据，收益从次一交易日起算。'),
    }
    with open(OUT, 'w', encoding='utf-8') as f:
        json.dump(doc, f, ensure_ascii=False, separators=(',', ':'))
    print('策略: %s 累计 %.1f%% 年化 %.1f%% 回撤 %.1f%%' % (
        doc['start'], doc['stats']['strategy']['cum'], doc['stats']['strategy']['ann'], doc['stats']['strategy']['mdd']))
    print('写入 %s（%.1f KB）' % (OUT, os.path.getsize(OUT) / 1024))


if __name__ == '__main__':
    main()
