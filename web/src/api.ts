import type { MetaInfo, PoolView, PoolTrace, FundDetail } from './types';

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
};

export const api = {
  meta: () => get<MetaInfo>('/meta'),
  pool: (id: string, opts: PoolQuery = {}) =>
    get<PoolView>(`/pools/${id}`, {
      company: opts.company ?? [],
      type: opts.type ?? [],
      q: opts.q ?? '',
      mode: opts.mode ?? 'filter',
    }),
  fund: (code: string) => get<FundDetail>(`/funds/${code}`),
  trace: (id: string) => get<PoolTrace>(`/pools/${id}/trace`),
};
