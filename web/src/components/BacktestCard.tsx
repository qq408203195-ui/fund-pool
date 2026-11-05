import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api';

interface QuarterPick {
  code: string;
  name: string;
  ann3y: number;
  mdd3y: number;
}
interface Quarter {
  date: string;
  universe: number;
  passed: number;
  onLine: number;
  filled?: boolean;
  picks: QuarterPick[];
}
/** 指数晚于回测起点上市时（如 930950），nav 前段为 null */
interface Benchmark {
  name: string;
  start: string;
  nav: (number | null)[];
  stats: { cum: number; ann: number; mdd: number; calmar: number | null };
}
interface BtStats {
  cum: number;
  ann: number;
  mdd: number;
  calmar: number | null;
}
interface BacktestData {
  generatedAt: string;
  start: string;
  end: string;
  dates: string[];
  strategyNav: number[];
  benchmarks: Record<string, Benchmark>;
  quarters: Quarter[];
  stats: { strategy: BtStats };
  rules: string;
}

const ORANGE = '#d9480f';
const GRAY = '#9aa4b2';
const W = 960;
const H = 300;
const PAD = { l: 46, r: 16, t: 14, b: 26 };

function niceTicks(lo: number, hi: number): { lo: number; hi: number; step: number; ticks: number[] } {
  const span = hi - lo || 1;
  for (const c of [1, 2, 2.5, 5]) {
    for (let e = -2; e <= 2; e++) {
      const step = c * Math.pow(10, e);
      const n = span / step;
      if (n < 3 || n > 8) continue;
      const a = Math.floor(lo / step + 1e-6) * step;
      const b = Math.ceil(hi / step - 1e-6) * step;
      const ticks: number[] = [];
      for (let v = a; v <= b + step * 0.01; v += step) ticks.push(Math.round(v * 1000) / 1000);
      return { lo: a, hi: b, step, ticks };
    }
  }
  return { lo, hi, step: span / 4, ticks: [lo, (lo + hi) / 2, hi] };
}

const fmtDate = (s: string) => s; // "2016-01-05"

export default function BacktestCard() {
  const [data, setData] = useState<BacktestData | null>(null);
  const [err, setErr] = useState('');
  const [open, setOpen] = useState(false);
  const [hover, setHover] = useState<number | null>(null);
  const [benchKey, setBenchKey] = useState('pool');
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    api
      .backtest()
      .then(setData)
      .catch((e) => setErr(String(e.message || e)));
  }, []);

  const chart = useMemo(() => {
    if (!data || data.dates.length < 2) return null;
    const bench = data.benchmarks[benchKey] ?? Object.values(data.benchmarks)[0];
    if (!bench) return null;
    const navB = bench.nav;
    // Y 轴范围只看有效段
    const valid = navB.filter((v): v is number => v != null);
    if (!valid.length) return null;
    const all = [...data.strategyNav, ...valid, 1];
    const { lo, hi, ticks } = niceTicks(Math.min(...all), Math.max(...all));
    const sy = (v: number) => PAD.t + (hi - v) / (hi - lo) * (H - PAD.t - PAD.b);
    const sx = (i: number) => PAD.l + (i / (data.dates.length - 1)) * (W - PAD.l - PAD.r);
    const line = (nav: (number | null)[]) => {
      // 上市前的 null 断开线段，别连到 0
      let d = '';
      let pen = false;
      nav.forEach((v, i) => {
        if (v == null) {
          pen = false;
          return;
        }
        d += `${pen ? 'L' : 'M'}${sx(i).toFixed(1)} ${sy(v).toFixed(1)} `;
        pen = true;
      });
      return d.trim();
    };
    // 年度刻度：每年第一个交易日
    const yearTicks: { i: number; label: string }[] = [];
    let lastYear = '';
    data.dates.forEach((d, i) => {
      const y = d.slice(0, 4);
      if (y !== lastYear) {
        yearTicks.push({ i, label: y });
        lastYear = y;
      }
    });
    return {
      sy,
      sx,
      pathS: line(data.strategyNav),
      pathB: line(navB),
      bench,
      lo,
      hi,
      ticks,
      yearTicks,
    };
  }, [data, benchKey]);

  if (err) return null;
  if (!data) return null;

  const benchList = Object.entries(data.benchmarks);
  const onMove = (e: React.MouseEvent) => {
    if (!chart || !svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * W;
    const i = Math.round(((x - PAD.l) / (W - PAD.l - PAD.r)) * (data.dates.length - 1));
    setHover(Math.max(0, Math.min(data.dates.length - 1, i)));
  };

  const s = data.stats.strategy;
  const benchNow = data.benchmarks[benchKey] ?? Object.values(data.benchmarks)[0];
  const bv = hover != null && benchNow ? benchNow.nav[hover] : null;
  // 悬停位置当时生效的调仓：取日期 ≤ 悬停日 的最后一个季度
  const hq =
    hover != null
      ? [...data.quarters].reverse().find((q) => q.date <= data.dates[hover]) ?? null
      : null;
  const shown = open ? data.quarters : data.quarters.slice(-1);

  return (
    <div className="scatter-card bt-card">
      <div className="card-head">
        <span className="card-title">斩杀线组合回测 · 2016 至今</span>
        <span className="card-hint">每季度换仓一次，等权持有斩杀线右上角 5 只，回测起点净值 = 1</span>
      </div>

      <div className="bt-switch" role="tablist">
        {benchList.map(([key, bm]) => (
          <button
            key={key}
            className={`bt-switch-btn${key === benchKey ? ' on' : ''}`}
            onClick={() => setBenchKey(key)}
          >
            {bm.name}
          </button>
        ))}
      </div>

      <div className="bt-stats">
        <div className="bt-stat">
          <span className="bt-dot" style={{ background: ORANGE }} />
          <b>斩杀线组合</b>
          <span>累计 <em style={{ color: ORANGE }}>{s.cum > 0 ? '+' : ''}{s.cum}%</em></span>
          <span>年化 {s.ann}%</span>
          <span>回撤 {s.mdd}%</span>
          <span>卡玛 {s.calmar ?? '—'}</span>
        </div>
        <div className="bt-stat">
          <span className="bt-dot" style={{ background: GRAY }} />
          <b>{benchNow.name}</b>
          <span>累计 <em>{benchNow.stats.cum > 0 ? '+' : ''}{benchNow.stats.cum}%</em></span>
          <span>年化 {benchNow.stats.ann}%</span>
          <span>回撤 {benchNow.stats.mdd}%</span>
          <span>卡玛 {benchNow.stats.calmar ?? '—'}</span>
          {benchNow.start > data.start && <span className="card-hint">（{benchNow.start} 起）</span>}
        </div>
        <div className="spacer" />
        <span className="card-hint">{data.start} ~ {data.end}</span>
      </div>

      {chart && (
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          className="bt-svg"
          onMouseMove={onMove}
          onMouseLeave={() => setHover(null)}
        >
          {chart.ticks.map((t) => (
            <g key={`y${t}`}>
              <line x1={PAD.l} x2={W - PAD.r} y1={chart.sy(t)} y2={chart.sy(t)} stroke="#eef1f5" strokeWidth={1} />
              <text x={PAD.l - 8} y={chart.sy(t) + 3.5} textAnchor="end" fontSize={10} fill="#8b95a5">
                {t}×
              </text>
            </g>
          ))}
          {chart.yearTicks.map((yt) => (
            <g key={`x${yt.label}`}>
              <line x1={chart.sx(yt.i)} x2={chart.sx(yt.i)} y1={H - PAD.b} y2={H - PAD.b + 4} stroke="#c9d1dc" strokeWidth={1} />
              <text x={chart.sx(yt.i)} y={H - PAD.b + 15} textAnchor="middle" fontSize={10} fill="#8b95a5">
                {yt.label}
              </text>
            </g>
          ))}
          <path d={chart.pathB} fill="none" stroke={GRAY} strokeWidth={1.6} />
          <path d={chart.pathS} fill="none" stroke={ORANGE} strokeWidth={2} strokeLinejoin="round" />
          {/* 起点净值 1 的参考线 */}
          {1 > chart.lo && 1 < chart.hi && (
            <line x1={PAD.l} x2={W - PAD.r} y1={chart.sy(1)} y2={chart.sy(1)} stroke="#c9d1dc" strokeWidth={1} strokeDasharray="4 4" />
          )}
          {hover != null && (
            <g>
              <line x1={chart.sx(hover)} x2={chart.sx(hover)} y1={PAD.t} y2={H - PAD.b} stroke={ORANGE} strokeWidth={1} strokeOpacity={0.45} />
              <circle cx={chart.sx(hover)} cy={chart.sy(data.strategyNav[hover])} r={3.2} fill={ORANGE} />
              {bv != null && <circle cx={chart.sx(hover)} cy={chart.sy(bv)} r={2.6} fill={GRAY} />}
              <g transform={`translate(${Math.min(chart.sx(hover) + 10, W - PAD.r - 168)},${PAD.t + 6})`}>
                <rect width={162} height={52} rx={6} fill="#fff" stroke="#e4e8ef" />
                <text x={10} y={16} fontSize={10.5} fontWeight={600} fill="#10151d">{fmtDate(data.dates[hover])}</text>
                <text x={10} y={31} fontSize={10} fill={ORANGE}>组合 {data.strategyNav[hover].toFixed(4)}</text>
                <text x={10} y={45} fontSize={10} fill="#67707f">
                  {bv != null ? `${benchNow.name} ${bv.toFixed(4)}` : `${benchNow.name} 未上市`}
                </text>
              </g>
            </g>
          )}
        </svg>
      )}

      <div className="bt-quarters">
        <div className="trace-bar">
          <span className="trace-bar-title">
            各季度入选名单{hq ? `（${hq.date} 调仓·当时持有这 5 只）` : ''}
          </span>
          <span className="card-hint">共 {data.quarters.length} 次调仓</span>
          <div className="spacer" />
          <button className="btn ghost sm" onClick={() => setOpen((v) => !v)}>
            {open ? '收起名单' : '展开全部季度'}
          </button>
        </div>
        <div className="bt-quarter-list">
          {shown.map((q) => (
            <div className="bt-quarter" key={q.date}>
              <div className="bt-q-head">
                <b>{q.date}</b>
                <span className="card-hint">
                  候选 {q.universe} · 过筛 {q.passed} · 斩杀线上 {q.onLine}
                  {q.filled ? ' · 线上不足 5 只已按收益补足' : ''}
                </span>
              </div>
              <div className="bt-q-picks">
                {q.picks.map((p) => (
                  <span className="bt-pick" key={p.code} title={`${p.name} (${p.code})`}>
                    {p.name.length > 14 ? p.name.slice(0, 13) + '…' : p.name}
                    <i>年化 {p.ann3y}% · 回撤 {p.mdd3y}%</i>
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      <p className="bt-note">{data.rules} 基准指数来自腾讯/雪球行情接口的日收盘点位。经理任职年限按<b>现任经理</b>的任职起始日回溯——早年季度里中途换过经理的基金会被排除，候选因此偏少；调仓只用了当时可得的数据，不含未来信息。<b>本回测基于公开历史数据机械模拟，费税未计，过往业绩不预示未来表现。</b></p>
    </div>
  );
}
