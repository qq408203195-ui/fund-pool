/**
 * 指标计算
 *
 * 口径说明（已用 5 只基金逐只交叉验证，结论重要）：
 *
 * Wind 返回的「近3年年化收益率」字段本身不可信。实测：
 *   易方达科讯     近3年累计 177.38%  → 几何年化应为 40.5%，字段却报 80.71%
 *   中欧医疗健康A  近3年累计  -6.21%  → 几何年化应为 -2.11%，字段却报 +2.75%（连符号都错）
 *   富国天惠       近3年累计   7.52%  → 几何年化应为  2.45%，字段报 6.80%
 *
 * 但 Wind 的「近3年卡玛比率」= 几何年化收益 ÷ |最大回撤|，是自洽的：
 *   易方达科讯 40.5 ÷ 34.57 = 1.17  ← Wind 卡玛 1.1704 ✓
 *   兴全合润A  12.03 ÷ 34.23 = 0.351 ← Wind 卡玛 0.3513 ✓
 *   中欧医疗  -2.11 ÷ 33.00 = -0.064 ← Wind 卡玛 -0.0640 ✓
 *
 * 因此本系统只采信「近3年累计收益率」与「近3年最大回撤」，年化与卡玛一律自行计算，
 * 并把 Wind 原始卡玛存为 calmar_wind 用于逐只对账。
 */

export const TRADING_DAYS = 244;

/** 区间累计涨幅(%) -> 几何年化(%) */
export function cumulativeToAnnual(cumPct, years = 3) {
  if (cumPct == null || !Number.isFinite(cumPct)) return null;
  const growth = 1 + cumPct / 100;
  if (growth <= 0) return null;
  return (Math.pow(growth, 1 / years) - 1) * 100;
}

/** 年化(%) -> 区间累计涨幅(%) */
export function annualToCumulative(annualPct, years = 3) {
  if (annualPct == null || !Number.isFinite(annualPct)) return null;
  const growth = Math.pow(1 + annualPct / 100, years);
  return (growth - 1) * 100;
}

/** 卡玛比率 = 年化收益 / |最大回撤| */
export function calmarRatio(annualPct, mddPct) {
  if (annualPct == null || mddPct == null) return null;
  const dd = Math.abs(mddPct);
  if (dd < 1e-9) return null;
  return annualPct / dd;
}

/** 两个日期之间的年数（按 365.25 天） */
export function yearsBetween(fromISO, toISO) {
  if (!fromISO || !toISO) return null;
  const a = new Date(fromISO);
  const b = new Date(toISO);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return null;
  return (b - a) / 86400000 / 365.25;
}

/**
 * 份额类别去重键
 * 「易方达稳健收益A / C / E」视为同一只基金；货币不同币种份额不合并。
 */
const CLASS_SUFFIX = /(?:[（(][^（）()]*[）)])?$/;

export function shareClassKey(name) {
  if (!name) return '';
  let base = name.trim();
  // 去掉尾部 (LOF) / （人民币）之类的括号内容后再去掉字母份额后缀
  base = base.replace(/[（(]\s*(LOF|QDII|人民币|美元|美元现汇|美元现钞|港币|A类|B类|C类|E类|I类)\s*[）)]$/i, '');
  base = base.replace(CLASS_SUFFIX, '');
  // 尾部单个份额字母
  base = base.replace(/[\s\-_]*(A|B|C|D|E|F|H|I|O|R|Y|S|Z)$/i, '');
  return base.trim();
}

/**
 * 在给定数组里计算名次（1 = 最优）
 * @param {Array} rows
 * @param {(r:any)=>number|null} getValue
 * @param {'asc'|'desc'} direction  asc = 数值越小越优；desc = 数值越大越优
 */
export function rankBy(rows, getValue, direction = 'desc') {
  const withVal = rows
    .map((r) => ({ row: r, v: getValue(r) }))
    .filter((x) => x.v != null && Number.isFinite(x.v));

  withVal.sort((a, b) => (direction === 'desc' ? b.v - a.v : a.v - b.v));

  const rank = new Map();
  let lastVal = null;
  let lastRank = 0;
  withVal.forEach((x, i) => {
    if (lastVal === null || x.v !== lastVal) {
      lastRank = i + 1;
      lastVal = x.v;
    }
    rank.set(x.row, lastRank);
  });
  return { rank, total: withVal.length };
}

export function round(v, digits = 4) {
  if (v == null || !Number.isFinite(v)) return null;
  const p = Math.pow(10, digits);
  return Math.round(v * p) / p;
}

/** 中位数 */
export function median(arr) {
  const xs = arr.filter((x) => x != null && Number.isFinite(x)).sort((a, b) => a - b);
  if (!xs.length) return null;
  const mid = Math.floor(xs.length / 2);
  return xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2;
}

/** 简单分位数（0~1） */
export function quantile(arr, q) {
  const xs = arr.filter((x) => x != null && Number.isFinite(x)).sort((a, b) => a - b);
  if (!xs.length) return null;
  const pos = (xs.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return xs[lo];
  return xs[lo] + (xs[hi] - xs[lo]) * (pos - lo);
}
