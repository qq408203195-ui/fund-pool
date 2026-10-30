import type { MetaInfo, PoolView, PoolTrace, FundDetail, Criteria } from './types';

const BASE = '/api';

async function get<T>(path: string, params?: Record<string, string | string[]>): Promise<T> {
  const url = new URL(BASE + path, window.location.origin);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (Array.isArray(v)) {
        for (const item of v) if (item) url.searchParams.append(k, item);
      } else if (v) {
        url.searchParams.set(k, v);
      }
    }
  }
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`请求失败 ${res.status}`);
  return res.json();
}

export type PoolQuery = {
  company?: string[];
  type?: string[];
  q?: string;
  mode?: string;
  criteria?: Criteria;
};

/**
 * 口径参数序列化。
 * 回撤/收益/卡玛在前端是百分比（50 表示前 50%），后端按比例接收，这里除 100。
 * 经理年限关掉时传 0，后端识别为「不限」。
 * 三条业绩窗口各自独立传，后端不共用。
 */
function criteriaParams(c?: Criteria): Record<string, string> {
  if (!c) return {};
  return {
    mgr: String(c.managerMinYears),
    mdd: String(Math.round(c.mddKeepRatio * 100)),
    ret: String(Math.round(c.returnKeepRatio * 100)),
    cal: String(Math.round(c.calmarKeepRatio * 100)),
    mddYears: String(c.mddYears),
    returnYears: String(c.returnYears),
    calmarYears: String(c.calmarYears),
    purchase: c.purchaseMode,
  };
}

export const api = {
  meta: () => get<MetaInfo>('/meta'),
  pool: (id: string, opts: PoolQuery = {}) =>
    get<PoolView>(`/pools/${id}`, {
      company: opts.company ?? [],
      type: opts.type ?? [],
      q: opts.q ?? '',
      mode: opts.mode ?? 'filter',
      ...criteriaParams(opts.criteria),
    }),
  fund: (code: string, criteria?: Criteria) => get<FundDetail>(`/funds/${code}`, criteriaParams(criteria)),
  trace: (id: string, criteria?: Criteria) => get<PoolTrace>(`/pools/${id}/trace`, criteriaParams(criteria)),
};
