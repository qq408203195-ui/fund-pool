export function fmtPct(v: number | null | undefined, digits = 2): string {
  if (v == null || !Number.isFinite(v)) return '—';
  return `${v.toFixed(digits)}%`;
}

export function fmtNum(v: number | null | undefined, digits = 2): string {
  if (v == null || !Number.isFinite(v)) return '—';
  return v.toFixed(digits);
}

export function fmtScale(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—';
  if (v >= 100) return `${v.toFixed(0)} 亿`;
  if (v >= 10) return `${v.toFixed(1)} 亿`;
  return `${v.toFixed(2)} 亿`;
}

export function fmtYears(v: number | null | undefined): string {
  // 东财口径不带经理任职起始日，缺失时显示「待核」而不是「—」，
  // 避免被读成「0 年」或「没有数据」这类误导
  if (v == null || !Number.isFinite(v)) return '待核';
  return `${v.toFixed(1)} 年`;
}

/** 中国习惯：正数红、负数绿 */
export function signClass(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v) || v === 0) return '';
  return v > 0 ? 'pos' : 'neg';
}

export function fmtPercentile(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—';
  return `${Math.round(v * 100)}%`;
}

export function pctWidth(v: number | null | undefined): number {
  if (v == null || !Number.isFinite(v)) return 0;
  return Math.max(2, Math.min(100, v * 100));
}
