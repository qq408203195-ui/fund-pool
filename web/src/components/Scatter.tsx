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

const KILL = '#0f766e';
const KILL_SOFT = 'rgba(15, 118, 110, 0.055)';

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

/** 最多标几只，多了就互相打架 */
const LABEL_MAX = 6;

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
  const labels = useMemo(() => {
    const boxes: Box[] = [];
    const out: { p: Plot; cx: number; btop: number; x0: number; x1: number; above: boolean }[] = [];
    if (!killed.length) return out;
    const fs = 10.5;
    const h = 24;
    const rightEdge = W - PAD.r;
    const leftEdge = PAD.l + 2;

    // 点多了不逐个标：一个密集阶梯挤上七八个标签，谁也认不出谁。
    // 只留收益最高的 6 只（这才是大家真正会挑的）。
    const picked = [...killed].sort((a, b) => b.y - a.y).slice(0, LABEL_MAX);
    // 收益最高的先占位——它是这个池子的最优解，标签最不该被挤掉；
    // 其余的按回撤从左到右排，读起来是自然的顺序
    const seq = [picked[0], ...picked.slice(1).sort((a, b) => a.x - b.x)].filter(Boolean);

    // 标签压住别人的圆点比压住空白难看得多，所以把点也当障碍物
    const coversDot = (box: Box, self: Plot) =>
      points.some((q) => {
        if (q === self) return false;
        const qx = sx(q.x);
        const qy = sy(q.y);
        const qr = dotR(q.item) + 2;
        return qx > box.x0 - qr && qx < box.x1 + qr && qy > box.y0 - qr && qy < box.y1 + qr;
      });

    for (const p of seq) {
      const r = dotR(p.item);
      const name = p.item.name.length > 13 ? p.item.name.slice(0, 12) + '…' : p.item.name;
      // 宽度取两行里宽的那行，否则第二行会比盒子宽出去、和隔壁标签黏在一起
      const w = Math.max(estWidth(name, fs), estWidth(metricText(p.item), 9.5)) + 10;
      const cx = sx(p.x);
      const py = sy(p.y);
      // 上下两行都先算出理想位置；顶到画布边就往回收，只要别盖住自己的点
      const aboveRaw = py - r - 7 - h;
      const above = Math.max(aboveRaw, PAD.t + 2);
      const belowRaw = py + r + 7;
      const below = Math.min(belowRaw, H - PAD.b - 2 - h);
      const rows = [
        above + h <= py - r - 2 ? above : null,
        below >= py + r + 2 ? below : null,
      ];
      // 候选位置按「离点越近越优先」排：先正上方、正下方，再左右错开半格、一格。
      // 位移优先、上下其次——否则标签会为了留在上方被推到老远，
      // 两根相邻标签读起来像同一行字。
      const shifts = [0, w * 0.5, -w * 0.5, w * 0.9, -w * 0.9];
      let placed: { x0: number; btop: number; above: boolean; si: number } | null = null;
      // 先按「不许压别的点」找位置；实在找不到再放宽，总比不标强
      for (const avoidDots of [true, false]) {
        for (let si = 0; si < shifts.length && !placed; si++) {
          for (let ri = 0; ri < rows.length; ri++) {
            const btop = rows[ri];
            if (btop == null) continue;
            const x0 = Math.min(Math.max(cx - w / 2 + shifts[si], leftEdge), rightEdge - w);
            const box: Box = { x0, y0: btop, x1: x0 + w, y1: btop + h };
            if (boxes.some((b) => overlaps(b, box))) continue;
            if (avoidDots && coversDot(box, p)) continue;
            placed = { x0, btop, above: ri === 0, si };
            break;
          }
        }
        if (placed) break;
      }
      // 被推到快一格远的地方就别标了——那个位置离开自己的点太远，
      // 与其画一根跨半个图的引导线，不如让位给更该标的（收益最高的那只除外）
      if (placed && placed.si >= 3 && p !== picked[0]) placed = null;
      // 仍挤不下就丢掉这只的标签，别硬塞
      if (placed) {
        boxes.push({ x0: placed.x0, y0: placed.btop, x1: placed.x0 + w, y1: placed.btop + h });
        out.push({ p, cx: placed.x0 + w / 2, btop: placed.btop, x0: placed.x0, x1: placed.x0 + w, above: placed.above });
      }
    }
    return out;
    // sx/sy 只依赖下面这两个轴
  }, [killed, points, xAxis, yAxis]);

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

        {/* 线上基金的标注 */}
        {labels.map(({ p, cx, btop, x0, x1, above }) => {
          const it = p.item;
          const name = it.name.length > 13 ? it.name.slice(0, 12) + '…' : it.name;
          const px = sx(p.x);
          const py = sy(p.y);
          const r = dotR(it);
          // 标签被挤开后补一根引导线，否则认不出它说的是哪个点
          const shifted = Math.abs(cx - px) > 10;
          return (
            <g key={`l${it.code}`} style={{ cursor: 'pointer' }} onClick={() => onSelect(it.code)}>
              {shifted && (
                <line
                  x1={Math.min(Math.max(px, x0 + 6), x1 - 6)}
                  y1={above ? btop + 24 : btop}
                  x2={px}
                  y2={above ? py - r - 3 : py + r + 3}
                  stroke={KILL}
                  strokeWidth={1}
                  strokeOpacity={0.35}
                  strokeDasharray="2 2"
                />
              )}
              <text
                x={cx}
                y={btop + 10}
                textAnchor="middle"
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
                x={cx}
                y={btop + 21}
                textAnchor="middle"
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
