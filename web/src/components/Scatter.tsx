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
const H = 300;
const PAD = { l: 52, r: 20, t: 16, b: 34 };

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

  const xDomain = useMemo(() => {
    const xs = points.map((p) => Math.abs(p.mdd3y!));
    if (!xs.length) return [0, 10];
    const max = Math.max(...xs);
    return [0, Math.ceil(max / 5) * 5 || 10];
  }, [points]);

  const yDomain = useMemo(() => {
    const ys = points.map((p) => p.ann3y!);
    if (!ys.length) return [-10, 10];
    const min = Math.min(0, ...ys);
    const max = Math.max(...ys);
    const pad = (max - min) * 0.1 || 5;
    return [Math.floor((min - pad) / 5) * 5, Math.ceil((max + pad) / 5) * 5];
  }, [points]);

  const sx = (v: number) => PAD.l + ((v - xDomain[0]) / (xDomain[1] - xDomain[0] || 1)) * (W - PAD.l - PAD.r);
  const sy = (v: number) => H - PAD.b - ((v - yDomain[0]) / (yDomain[1] - yDomain[0] || 1)) * (H - PAD.t - PAD.b);

  const xTicks = useMemo(() => {
    const step = (xDomain[1] - xDomain[0]) / 6;
    return Array.from({ length: 7 }, (_, i) => xDomain[0] + step * i);
  }, [xDomain]);

  const yTicks = useMemo(() => {
    const span = yDomain[1] - yDomain[0];
    const step = span <= 40 ? 5 : span <= 80 ? 10 : 20;
    const out: number[] = [];
    for (let v = Math.ceil(yDomain[0] / step) * step; v <= yDomain[1]; v += step) out.push(v);
    return out;
  }, [yDomain]);

  if (!points.length) return null;

  const zeroY = sy(0);

  return (
    <div className="scatter-card">
      <div className="card-head">
        <span className="card-title">收益 — 回撤分布</span>
        <span className="card-hint">横轴为最大回撤（越左越稳）· 纵轴为年化收益 · 圆点大小代表规模</span>
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
              {t}%
            </text>
          </g>
        ))}
        {xTicks.map((t) => (
          <g key={`x${t}`}>
            <line x1={sx(t)} x2={sx(t)} y1={PAD.t} y2={H - PAD.b} stroke="#f2f4f8" strokeWidth={1} />
            <text x={sx(t)} y={H - PAD.b + 16} textAnchor="middle" fontSize="10.5" fill="#8b95a5">
              {Math.round(t)}%
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
