import { useMemo, useState } from 'react';
import type { FundItem } from '../types';
import { fmtNum, fmtPct, fmtScale } from '../utils/format';

const PALETTE = [
  '#1a5fb4',
  '#c0392b',
  '#c2185b',
  '#8e44ad',
  '#d68910',
  '#34495e',
  '#7f8c8d',
  '#a04000',
  '#2e86c1',
  '#7d3c98',
];

const KILL = '#d9480f';
const KILL_SOFT = 'rgba(217, 72, 15, 0.05)';

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

interface Plot {
  item: FundItem;
  x: number;
  y: number;
}

/**
 * 斩杀线 = (回撤, 收益) 平面上的非支配集。
 *
 * 从最稳（回撤最小）的一只开始往激进方向走，只有「收益创出新高」的才留在线上。
 * 没留下的那些，一定能在它左边找到一只回撤不比它大、收益却比它高的基金——
 * 也就是用户说的「落在线下方的，都能找到更好的选择」。
 *
 * 同回撤的两只只留收益高的那一个（回撤一样、收益低，直接被支配）。
 */
function killLine(pts: Plot[]): Plot[] {
  const sorted = [...pts].sort((a, b) => a.x - b.x || b.y - a.y);
  const kept: Plot[] = [];
  let best = -Infinity;
  for (const p of sorted) {
    if (p.y > best + 1e-9) {
      kept.push(p);
      best = p.y;
    }
  }
  return kept;
}

/** 估算一段文字在 SVG 里的像素宽度：中文按 1em，其余按 0.56em */
function estWidth(s: string, fs: number) {
  let w = 0;
  for (const ch of s) w += /[\u3000-\u9fff\uff00-\uffef]/.test(ch) ? fs : fs * 0.56;
  return w;
}

/** 斩杀线标注的第二行 */
const metricText = (it: FundItem) => `年化 ${fmtPct(it.ann3y)} · 回撤 ${fmtPct(it.mdd3y)}`;

/** 圆点半径由规模开方而来，太小看不见、太大会糊成一片 */
const dotR = (it: FundItem) => Math.max(2.6, Math.min(11, Math.sqrt(Math.max(it.scale ?? 1, 0.5)) * 0.9));

interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

const overlaps = (a: Box, b: Box) =>
  a.x0 < b.x1 + 8 && a.x1 > b.x0 - 8 && a.y0 < b.y1 + 3 && a.y1 > b.y0 - 3;

interface Props {
  items: FundItem[];
  onSelect: (code: string) => void;
}

export default function Scatter({ items, onSelect }: Props) {
  const [hovered, setHovered] = useState<string | null>(null);
  const [showKill, setShowKill] = useState(true);

  const points = useMemo<Plot[]>(
    () =>
      items
        .filter((i) => i.mdd3y != null && i.ann3y != null)
        .map((i) => ({ item: i, x: Math.abs(i.mdd3y!), y: i.ann3y! })),
    [items]
  );

  const types = useMemo(() => {
    const set = new Set<string>();
    points.forEach((p) => set.add(p.item.typeL2 ?? '其他'));
    return [...set];
  }, [points]);

  const colorOf = (t: string | null) => PALETTE[Math.max(0, types.indexOf(t ?? '其他')) % PALETTE.length];

  // 横轴（最大回撤）只覆盖数据实际所在的那一段，左侧不再从 0 铺起
  const xAxis = useMemo<Axis>(() => fitAxis(points.map((p) => p.x), 0.3, true), [points]);

  // 纵轴（年化收益）同理：原来强制含 0 且按 5 取整，正收益池子会空出半屏
  const yAxis = useMemo<Axis>(() => fitAxis(points.map((p) => p.y), 0.3), [points]);

  const xTicks = xAxis.ticks;
  const yTicks = yAxis.ticks;

  const sx = (v: number) => PAD.l + ((v - xAxis.lo) / (xAxis.hi - xAxis.lo || 1)) * (W - PAD.l - PAD.r);
  const sy = (v: number) => H - PAD.b - ((v - yAxis.lo) / (yAxis.hi - yAxis.lo || 1)) * (H - PAD.t - PAD.b);

  // 只有 2 只时连不成线，画斩杀线反而误导
  const killed = useMemo(() => (showKill && points.length >= 3 ? killLine(points) : []), [points, showKill]);
  const onLine = useMemo(() => new Set(killed.map((p) => p.item.code)), [killed]);

  // 标注排布必须赶在提前 return 之前算完——hooks 不能挂在条件分支后面
  //
  // 线上的每一只都必须有名字：最左那只是「最稳的」，最高那只是「收益王」，
  // 少标任何一个，用户第一眼就会问「这个点是谁」。
  // 好在斩杀线上方没有任何数据点（有的话它就在线上了），
  // 所以标签全部放进线上方的空白区：贴着点上方右对齐，挤了就向上叠层，
  // 叠不到的位置点在左侧、再不行放点下方兜底，配合虚线引导认点。
  const labels = useMemo(() => {
    const boxes: Box[] = [];
    const out: {
      p: Plot;
      name: string;
      x0: number;
      x1: number;
      btop: number;
      anchor: 'end' | 'start';
      leader: [number, number, number, number] | null;
    }[] = [];
    if (!killed.length) return out;
    const fs = 10.5;
    const h = 24;
    const rightEdge = W - PAD.r;
    const leftEdge = PAD.l + 2;
    // 线上的点一多，名字截短一点，标签变窄能少叠好几层
    const nameMax = killed.length > 8 ? 9 : 13;
    const cut = (s: string) => (s.length > nameMax ? s.slice(0, nameMax - 1) + '…' : s);

    // 占位顺序：最左（最稳）和最高（收益王）先落位——这两个是用户最先问
    // 「这是谁」的点，绝不能被挤掉；其余的从左到右，挤不下的才放弃
    const first = killed[0];
    const best = killed.reduce((a, b) => (b.y > a.y ? b : a), killed[0]);
    const rest = killed.filter((p) => p !== first && p !== best);
    const seq = best !== first ? [first, best, ...rest] : [first, ...rest];

    for (const p of seq) {
      const r = dotR(p.item);
      const name = cut(p.item.name);
      // 宽度取两行里宽的那行，否则第二行会比盒子宽出去、和隔壁标签黏在一起
      const w = Math.max(estWidth(name, fs), estWidth(metricText(p.item), 9.5)) + 10;
      const px = sx(p.x);
      const py = sy(p.y);

      // 候选位置从近到远：点上方叠层（优先，线上方必然没有点）→ 点左侧居中 →
      // 点下方叠层（会压到已被压暗的点，白描边文字仍可读，最后的选择）
      const cands: { x0: number; btop: number; anchor: 'end' | 'start'; above: boolean }[] = [];
      const rightAligned = px - 6 - w >= leftEdge;
      for (let k = 0; k < 6; k++) {
        const btop = py - r - 6 - h - k * (h + 2);
        if (btop < PAD.t + 2) break;
        cands.push({ x0: rightAligned ? px - 6 - w : px + 6, btop, anchor: rightAligned ? 'end' : 'start', above: true });
      }
      cands.push({ x0: px - r - 8 - w, btop: py - h / 2, anchor: 'end', above: false });
      for (let k = 0; k < 4; k++) {
        const btop = py + r + 7 + k * (h + 2);
        if (btop + h > H - PAD.b - 2) break;
        cands.push({ x0: rightAligned ? px - 6 - w : px + 6, btop, anchor: rightAligned ? 'end' : 'start', above: false });
      }

      let placed: (typeof cands)[number] | null = null;
      for (const c of cands) {
        const x0 = Math.min(Math.max(c.x0, leftEdge), rightEdge - w);
        if (x0 !== c.x0 && c.anchor === 'end' && c.above) continue; // 右对齐被夹偏就别硬放，换下一个候选
        const box: Box = { x0, y0: c.btop, x1: x0 + w, y1: c.btop + h };
        if (c.btop < PAD.t + 2 || c.btop + h > H - PAD.b - 2) continue;
        if (boxes.some((b) => overlaps(b, box))) continue;
        placed = { ...c, x0 };
        boxes.push(box);
        break;
      }
      if (!placed) continue;

      // 引导线：标签离点远了就补一根，从盒子边缘指向圆点
      const cx = Math.min(Math.max(px, placed.x0), placed.x0 + w);
      const cy = Math.min(Math.max(py, placed.btop), placed.btop + h);
      const dx = px - cx;
      const dy = py - cy;
      const len = Math.hypot(dx, dy) || 1;
      const gap = Math.max(0, len - 4 - (r + 3));
      const leader: [number, number, number, number] | null =
        gap > 12
          ? [cx + (dx / len) * 4, cy + (dy / len) * 4, px - (dx / len) * (r + 3), py - (dy / len) * (r + 3)]
          : null;
      out.push({ p, name, x0: placed.x0, x1: placed.x0 + w, btop: placed.btop, anchor: placed.anchor, leader });
    }
    return out;
    // sx/sy 只依赖下面这两个轴
  }, [killed, xAxis, yAxis]);

  if (!points.length) return null;

  const zeroY = sy(0);
  const right = W - PAD.r;
  const top = PAD.t;

  // 阶梯线：先横着走到下一只的回撤位置，再竖着升到它的收益
  const stair: [number, number][] = [];
  killed.forEach((p, i) => {
    if (i === 0) stair.push([sx(p.x), sy(p.y)]);
    else {
      stair.push([sx(p.x), sy(killed[i - 1].y)]);
      stair.push([sx(p.x), sy(p.y)]);
    }
  });
  const stairPath = stair.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
  const lastPt = killed[killed.length - 1];
  const zonePath =
    killed.length > 1
      ? `M${sx(killed[0].x).toFixed(1)} ${top} ${stairPath.replace(/^M/, 'L')} L${right} ${sy(
          lastPt.y
        ).toFixed(1)} L${right} ${top} Z`
      : '';

  return (
    <div className="scatter-card">
      <div className="card-head">
        <span className="card-title">收益 — 回撤分布</span>
        {points.length >= 3 && (
          <button
            className={`kill-toggle${showKill ? ' on' : ''}`}
            onClick={() => setShowKill((v) => !v)}
            title="连起每个回撤档位里收益最高的基金；线下方（右下）的点，都能找到回撤更小、收益更高的替代"
          >
            <span className="kill-mark" />
            {showKill ? '斩杀线已开' : '斩杀线已关'}
          </button>
        )}
      </div>
      <div className="card-hint kill-hint">
        横轴最大回撤（越左越稳）· 纵轴年化收益 · 圆点大小代表规模。
        {showKill && killed.length > 0 ? (
          <>
            {' '}
            <b style={{ color: KILL }}>斩杀线</b>连起当前视图里每个回撤档位中收益最高的 {killed.length}{' '}
            只——落在线右下方的点，都能找到回撤不比它大、收益却更高的基金。
            {labels.length < killed.length && ' 标签挤不下的点，悬停圆点可看名字。'}
          </>
        ) : (
          <> 坐标轴按实际分布收紧。</>
        )}
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: 'block', height: 'auto' }}>
        {/* 高效区（斩杀线上方）淡色底，让「更好」的一侧有实体感 */}
        {zonePath && <path d={zonePath} fill={KILL_SOFT} />}

        {/* 网格 */}
        {yTicks.map((t) => (
          <g key={`y${t}`}>
            <line
              x1={PAD.l}
              x2={right}
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
            <line x1={sx(t)} x2={sx(t)} y1={top} y2={H - PAD.b} stroke="#f2f4f8" strokeWidth={1} />
            <text x={sx(t)} y={H - PAD.b + 16} textAnchor="middle" fontSize="10.5" fill="#8b95a5">
              {tickText(t, xAxis.step)}%
            </text>
          </g>
        ))}

        {/* 零轴 */}
        {zeroY > top && zeroY < H - PAD.b && (
          <line x1={PAD.l} x2={right} y1={zeroY} y2={zeroY} stroke="#c9d1dc" strokeWidth={1} />
        )}

        {/* 数据点：被支配的压暗，在线上的加重并套白圈 */}
        {points.map((p) => {
          const it = p.item;
          const r = dotR(it);
          const isHot = hovered === it.code;
          const isKill = onLine.has(it.code);
          return (
            <g key={it.code}>
              {isKill && (
                <circle cx={sx(p.x)} cy={sy(p.y)} r={r + 3.2} fill="none" stroke={KILL} strokeWidth={1.2} strokeOpacity={0.55} />
              )}
              <circle
                cx={sx(p.x)}
                cy={sy(p.y)}
                r={isHot ? r + 2.5 : r}
                fill={colorOf(it.typeL2)}
                fillOpacity={isHot ? 0.95 : isKill ? 0.85 : showKill && killed.length ? 0.26 : 0.6}
                stroke={isHot ? '#10151d' : '#fff'}
                strokeWidth={isHot ? 1.6 : isKill ? 1.4 : 0.8}
                style={{ cursor: 'pointer', transition: 'r .12s' }}
                onMouseEnter={() => setHovered(it.code)}
                onMouseLeave={() => setHovered(null)}
                onClick={() => onSelect(it.code)}
              >
                <title>
                  {`${it.name} (${it.code})\n年化 ${fmtPct(it.ann3y)} · 回撤 ${fmtPct(it.mdd3y)} · 卡玛 ${fmtNum(
                    it.calmar,
                    2
                  )} · 规模 ${fmtScale(it.scale)}${showKill && killed.length ? (isKill ? '\n· 在斩杀线上' : '\n· 有更优替代') : ''}`}
                </title>
              </circle>
            </g>
          );
        })}

        {/* 斩杀线本体 + 向右的虚线尾（更靠右的同收益选择都被支配） */}
        {stair.length > 1 && (
          <>
            <path d={stairPath} fill="none" stroke="#fff" strokeWidth={4.5} strokeLinejoin="round" strokeLinecap="round" />
            <path d={stairPath} fill="none" stroke={KILL} strokeWidth={2.1} strokeLinejoin="round" strokeLinecap="round" />
            <line
              x1={sx(lastPt.x)}
              y1={sy(lastPt.y)}
              x2={right}
              y2={sy(lastPt.y)}
              stroke={KILL}
              strokeWidth={1.4}
              strokeDasharray="4 4"
              strokeOpacity={0.6}
            />
          </>
        )}

        {/* 线上基金的标注：全部标注，放不下的叠到更高层，配虚线引导 */}
        {labels.map(({ p, name, x0, x1, btop, anchor, leader }) => {
          const it = p.item;
          const tx = anchor === 'end' ? x1 : x0;
          return (
            <g key={`l${it.code}`} style={{ cursor: 'pointer' }} onClick={() => onSelect(it.code)}>
              {leader && (
                <line
                  x1={leader[0]}
                  y1={leader[1]}
                  x2={leader[2]}
                  y2={leader[3]}
                  stroke={KILL}
                  strokeWidth={1}
                  strokeOpacity={0.4}
                  strokeDasharray="2 2"
                />
              )}
              <text
                x={tx}
                y={btop + 10}
                textAnchor={anchor}
                fontSize={10.5}
                fontWeight={600}
                fill="#10151d"
                paintOrder="stroke"
                stroke="#fff"
                strokeWidth={2.6}
                strokeLinejoin="round"
              >
                {name}
              </text>
              <text
                x={tx}
                y={btop + 21}
                textAnchor={anchor}
                fontSize={9.5}
                fill={KILL}
                paintOrder="stroke"
                stroke="#fff"
                strokeWidth={2.4}
                strokeLinejoin="round"
              >
                {metricText(it)}
              </text>
            </g>
          );
        })}

        {/* 轴标题 */}
        <text x={right} y={H - 4} textAnchor="end" fontSize="10.5" fill="#8b95a5">
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
        {showKill && killed.length > 1 && (
          <span className="legend-kill">
            <span className="legend-line" />
            斩杀线 · 压暗的 = 有更优替代
          </span>
        )}
      </div>
    </div>
  );
}
