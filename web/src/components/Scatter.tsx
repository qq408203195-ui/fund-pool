import { useMemo, useState } from 'react';
import type { FundItem } from '../types';
import { fmtNum, fmtPct, fmtScale } from '../utils/format';

const PALETTE = [
  '#1a5fb4',
  '#c0392b',
  '#0e8a52',
  '#8e44ad',
  '#d68910',
  '#16788a',
  '#7f8c8d',
  '#a04000',
  '#2e86c1',
  '#7d3c98',
];

const W = 960;
const H = 340;
const PAD = { l: 52, r: 20, t: 18, b: 38 };

interface Axis {
  lo: number;
  hi: number;
  step: number;
  ticks: number[];
}

/**
 * 把数据区间扩成「刻度落在整点上」的坐标轴。
 *
 * 关键点是**不强行包含 0，也不按固定 5 的倍数取整**。原来横轴从 0 起、
 * 纵轴强制含 0 再按 5 取整，33 只基金回撤实际落在 11–24%、收益 9–22%，
 * 画出来左边四成宽度、上下近一半高度全是空白，点挤在右上一小块。
 *
 * 现在遍历一组候选步长，只保留刻度数在 3–9 之间的，再挑「取整后多出来的
 * 空白最少」的那个。这样轴不会被拉得过宽，刻度也不会密到读不清。
 */
function niceAxis(rawLo: number, rawHi: number): Axis {
  if (!Number.isFinite(rawLo) || !Number.isFinite(rawHi)) {
    return { lo: 0, hi: 10, step: 2, ticks: [0, 2, 4, 6, 8, 10] };
  }
  let a = rawLo;
  let b = rawHi;
  if (b - a < 1e-9) {
    const pad = Math.max(Math.abs(b) * 0.1, 1);
    a -= pad;
    b += pad;
  }
  const span = b - a;

  // 优先整数步长（1/2/5）：轴上出现 12.5、17.5 这类刻度读起来碎，
  // 只有在整数步长凑不出 3–9 格时才退到 2.5
  const pick = (steps: number[]): { step: number; lo: number; hi: number; score: number } | null => {
    let found: { step: number; lo: number; hi: number; score: number } | null = null;
    for (let e = -3; e <= 3; e++) {
      for (const c of steps) {
        const step = c * Math.pow(10, e);
        const count = span / step;
        if (count < 3 || count > 9) continue;
        // 外扩量按步长的 5% 给，而不是按跨度的百分比：
        // 23.65 离 24 只差 0.35，若按跨度 7% 外扩到 24.03 就会被进位到 26，
        // 平白多出一整格空白。
        const pad = step * 0.05;
        // 加容差再取整：22.0 / 0.2 在浮点下会算出 109.99999，floor 后平白多出一格
        const lo = Math.floor((a - pad) / step + 1e-6) * step;
        const hi = Math.ceil((b + pad) / step - 1e-6) * step;
        // 取整多出来的空白越少越好；同等条件下偏好约 6 格，读数不费力
        const score = (hi - lo - span) / span + Math.abs((hi - lo) / step - 6) * 0.02;
        if (!found || score < found.score) found = { step, lo, hi, score };
      }
    }
    return found;
  };

  const best = pick([1, 2, 5]) ?? pick([1, 2, 2.5, 5]) ?? { step: span / 5, lo: a, hi: b, score: 0 };

  const snap = (v: number) => Number(v.toFixed(6));
  const step = snap(best.step);
  const lo = snap(best.lo);
  const hi = snap(best.hi);
  const ticks: number[] = [];
  const n = Math.round((hi - lo) / step);
  for (let i = 0; i <= n; i++) ticks.push(snap(lo + i * step));
  return { lo, hi, step, ticks };
}

/** 刻度标签的小数位跟着步长走，避免步长 2.5 时 12.5 被四舍五入成 13 */
function tickText(v: number, step: number) {
  const dec = (String(step).split('.')[1] || '').length;
  return v.toFixed(Math.min(dec, 3));
}

/**
 * 按数据实际范围定轴，并保证一个最小跨度。
 *
 * 没有最小跨度兜底时，小池子会出问题：低波固收只有 2 只基金、回撤都在
 * 0.62% 附近，跨度不到 0.001 个百分点，轴被放大到这个量级后 7 个刻度
 * 全显示成 0.62%，等于没标。最小跨度让这种情形退回一个可读的区间，
 * 那两只基金的点会在图上重叠——它们本来就几乎一样。
 */
function fitAxis(values: number[], minSpan: number, clampZero = false): Axis {
  if (!values.length) return niceAxis(0, 10);
  let lo = Math.min(...values);
  let hi = Math.max(...values);
  if (hi - lo < minSpan) {
    const mid = (lo + hi) / 2;
    lo = mid - minSpan / 2;
    hi = mid + minSpan / 2;
  }
  if (clampZero && lo < 0) {
    hi += -lo;
    lo = 0;
  }
  return niceAxis(lo, hi);
}

interface Props {
  items: FundItem[];
  onSelect: (code: string) => void;
}

export default function Scatter({ items, onSelect }: Props) {
  const [hovered, setHovered] = useState<string | null>(null);

  const points = useMemo(
    () => items.filter((i) => i.mdd3y != null && i.ann3y != null),
    [items]
  );

  const types = useMemo(() => {
    const set = new Set<string>();
    points.forEach((p) => set.add(p.typeL2 ?? '其他'));
    return [...set];
  }, [points]);

  const colorOf = (t: string | null) => PALETTE[Math.max(0, types.indexOf(t ?? '其他')) % PALETTE.length];

  // 横轴（最大回撤）只覆盖数据实际所在的那一段，左侧不再从 0 铺起
  const xAxis = useMemo<Axis>(
    () => fitAxis(points.map((p) => Math.abs(p.mdd3y!)), 0.3, true),
    [points]
  );

  // 纵轴（年化收益）同理：原来强制含 0 且按 5 取整，正收益池子会空出半屏
  const yAxis = useMemo<Axis>(() => fitAxis(points.map((p) => p.ann3y!), 0.3), [points]);

  const xTicks = xAxis.ticks;
  const yTicks = yAxis.ticks;

  const sx = (v: number) => PAD.l + ((v - xAxis.lo) / (xAxis.hi - xAxis.lo || 1)) * (W - PAD.l - PAD.r);
  const sy = (v: number) => H - PAD.b - ((v - yAxis.lo) / (yAxis.hi - yAxis.lo || 1)) * (H - PAD.t - PAD.b);

  if (!points.length) return null;

  const zeroY = sy(0);

  return (
    <div className="scatter-card">
      <div className="card-head">
        <span className="card-title">收益 — 回撤分布</span>
        <span className="card-hint">
          横轴为最大回撤（越左越稳）· 纵轴为年化收益 · 圆点大小代表规模 · 坐标轴按实际分布收紧，
          横轴起点 {tickText(xAxis.lo, xAxis.step)}%
        </span>
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: 'block', height: 'auto' }}>
        {/* 网格 */}
        {yTicks.map((t) => (
          <g key={`y${t}`}>
            <line
              x1={PAD.l}
              x2={W - PAD.r}
              y1={sy(t)}
              y2={sy(t)}
              stroke={t === 0 ? '#c9d1dc' : '#eef1f5'}
              strokeWidth={1}
            />
            <text x={PAD.l - 8} y={sy(t) + 3.5} textAnchor="end" fontSize="10.5" fill="#8b95a5">
              {tickText(t, yAxis.step)}%
            </text>
          </g>
        ))}
        {xTicks.map((t) => (
          <g key={`x${t}`}>
            <line x1={sx(t)} x2={sx(t)} y1={PAD.t} y2={H - PAD.b} stroke="#f2f4f8" strokeWidth={1} />
            <text x={sx(t)} y={H - PAD.b + 16} textAnchor="middle" fontSize="10.5" fill="#8b95a5">
              {tickText(t, xAxis.step)}%
            </text>
          </g>
        ))}

        {/* 零轴 */}
        {zeroY > PAD.t && zeroY < H - PAD.b && (
          <line x1={PAD.l} x2={W - PAD.r} y1={zeroY} y2={zeroY} stroke="#c9d1dc" strokeWidth={1} />
        )}

        {/* 数据点 */}
        {points.map((p) => {
          const r = Math.max(2.6, Math.min(11, Math.sqrt(Math.max(p.scale ?? 1, 0.5)) * 0.9));
          const isHot = hovered === p.code;
          return (
            <g key={p.code}>
              <circle
                cx={sx(Math.abs(p.mdd3y!))}
                cy={sy(p.ann3y!)}
                r={isHot ? r + 2.5 : r}
                fill={colorOf(p.typeL2)}
                fillOpacity={isHot ? 0.95 : 0.6}
                stroke={isHot ? '#10151d' : '#fff'}
                strokeWidth={isHot ? 1.6 : 0.8}
                style={{ cursor: 'pointer', transition: 'r .12s' }}
                onMouseEnter={() => setHovered(p.code)}
                onMouseLeave={() => setHovered(null)}
                onClick={() => onSelect(p.code)}
              >
                <title>
                  {`${p.name} (${p.code})\n年化 ${fmtPct(p.ann3y)} · 回撤 ${fmtPct(p.mdd3y)} · 卡玛 ${fmtNum(
                    p.calmar,
                    2
                  )} · 规模 ${fmtScale(p.scale)}`}
                </title>
              </circle>
            </g>
          );
        })}

        {/* 轴标题 */}
        <text x={W - PAD.r} y={H - 4} textAnchor="end" fontSize="10.5" fill="#8b95a5">
          最大回撤 →
        </text>
      </svg>

      <div className="scatter-legend">
        {types.map((t) => (
          <span key={t}>
            <span className="legend-dot" style={{ background: colorOf(t) }} />
            {t?.replace('基金', '') ?? '其他'}
          </span>
        ))}
      </div>
    </div>
  );
}
