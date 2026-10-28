import { db, getMeta, dataVersion } from './db.js';
import { POOLS, POOL_BY_ID, POOL_GROUPS } from './config/pools.js';
import { MIN_TRACK_YEARS, MIN_SCALE_YI } from './config/caliber.js';
import {
  screenPool,
  normalizeCriteria,
  typeBreakdown,
  companyBreakdown,
  windowMetrics,
  DEFAULT_YEARS,
  SUPPORTED_YEARS,
} from './engine/screen.js';
import { shareClassKey, cumulativeToAnnual, calmarRatio } from './engine/metrics.js';

let cache = { version: null, funds: null, pools: new Map() };

export function invalidate() {
  cache = { version: null, funds: null, pools: new Map() };
}

function parseWin(raw) {
  if (!raw) return null;
  try {
    const o = JSON.parse(raw);
    return o && typeof o === 'object' ? o : null;
  } catch {
    return null;
  }
}

function loadFunds() {
  const v = dataVersion();
  if (cache.version === v && cache.funds) return cache.funds;
  const rows = db.prepare('SELECT * FROM funds').all();
  // 多窗口指标是 JSON 字符串，解析一次挂在行上，后面筛选直接取，不必每层重复 parse
  for (const r of rows) r.win = parseWin(r.win_json);
  cache = { version: v, funds: rows, pools: new Map() };
  return rows;
}

/**
 * 池内样本 —— 「池子都有哪些基金」的唯一口径。
 *
 * 只收初始基金份额（is_initial = 1）：同一只基金的 A/C/E 类只是费率与销售渠道的差别，
 * 放在池子里会让同一只产品重复占位，也会让「池内样本数」虚高。
 * 万一数据源里同一只基金有多个份额都标了初始份额，再按「名称归一 + 管理人」兜底合并，保留规模最大的。
 */
export function poolUniverse(pool, funds) {
  const hasIndexFilter = Array.isArray(pool.indexCategories) && pool.indexCategories.length > 0;
  const matched = funds.filter((f) => {
    if (!pool.types.includes(f.type_l2)) return false;
    if (hasIndexFilter) {
      if (!f.index_category || !pool.indexCategories.includes(f.index_category)) return false;
      if (!pool.allowNoTrackIndex && !f.track_index && !f.track_index_code) return false;
    }
    return true;
  });

  const initial = matched.filter((f) => f.is_initial === 1 || f.is_initial === true);
  // 数据源若未提供初始份额标识，退化为「按份额名归一去重」，不能整池空掉
  const pool0 = initial.length ? initial : matched;

  const byKey = new Map();
  for (const f of pool0) {
    const key = `${shareClassKey(f.name)}|${f.company || ''}`;
    const prev = byKey.get(key);
    if (!prev || (f.scale || 0) > (prev.scale || 0)) byKey.set(key, f);
  }
  return [...byKey.values()];
}

/** 口径缓存键：任何一个参数变了结果就不同，漏掉一个会串味 */
function criteriaKey(poolId, c) {
  return [
    poolId,
    c.years,
    c.managerMinYears,
    c.mddKeepRatio,
    c.returnKeepRatio,
    c.calmarKeepRatio,
    c.purchaseMode,
  ].join('|');
}

export function getPoolResult(poolId, rawCriteria) {
  const criteria = normalizeCriteria(rawCriteria);
  // 同一池子在不同口径下结果不同，缓存必须带上口径，否则拖一次滑块就串味
  const cacheKey = criteriaKey(poolId, criteria);
  const v = dataVersion();
  const cached = cache.pools.get(cacheKey);
  if (cached && cached.version === v) return cached.value;

  const pool = POOL_BY_ID[poolId];
  if (!pool) return null;

  const funds = loadFunds();
  const universe = poolUniverse(pool, funds);
  const result = screenPool(pool, universe, criteria);

  const value = {
    pool: {
      id: pool.id,
      group: pool.group,
      name: pool.name,
      badge: pool.badge,
      desc: pool.desc,
      rationale: pool.rationale,
      types: pool.types,
      indexCategories: pool.indexCategories || null,
    },
    stats: result.stats,
    items: result.items,
    rejects: result.rejectReasons,
    types: typeBreakdown(universe),
    companies: companyBreakdown(universe),
    // 逐层名单不进主视图（体积大），单独走 getPoolTrace
  };

  cache.pools.set(cacheKey, { version: v, value, stages: result.stages });
  return value;
}

/**
 * 逐层追溯：每一层的完整进出名单。
 * 与 getPoolResult 共用同一份缓存，不重复跑管线。
 */
export function getPoolTrace(poolId, rawCriteria) {
  const criteria = normalizeCriteria(rawCriteria);
  const base = getPoolResult(poolId, criteria);
  if (!base) return null;
  const cacheKey = criteriaKey(poolId, criteria);
  const entry = cache.pools.get(cacheKey);
  const stages = entry?.stages ?? [];

  return {
    pool: base.pool,
    caliber: criteria,
    stages: stages.map((s) => ({
      key: s.key,
      label: s.label,
      desc: s.desc,
      input: s.input,
      passed: s.passed,
      dropped: s.dropped,
      // 类型分布附带在每一层，前端做类型筛选时不必自己统计
      types: typeBreakdown(
        s.rows.map((r) => ({ type_l2: r.typeL2 }))
      ),
      rows: s.rows,
    })),
  };
}

function applyFilters(items, { company, companyList, typeList, q }) {
  let out = items;
  // 注意：空数组必须当成「没筛」，否则 [] 会被 concat 成空 Set 把榜单整个滤掉
  if (company && [].concat(company).length) {
    const set = new Set([].concat(company));
    out = out.filter((i) => set.has(i.company));
  }
  if (companyList && companyList.length) {
    const set = new Set(companyList);
    out = out.filter((i) => set.has(i.company));
  }
  if (typeList && typeList.length) {
    const set = new Set(typeList);
    out = out.filter((i) => set.has(i.typeL2));
  }
  if (q) {
    const needle = String(q).trim().toLowerCase();
    if (needle) {
      out = out.filter(
        (i) =>
          i.name.toLowerCase().includes(needle) ||
          i.code.toLowerCase().includes(needle) ||
          (i.company || '').toLowerCase().includes(needle) ||
          (i.trackIndex || '').toLowerCase().includes(needle)
      );
    }
  }
  return out;
}

/**
 * 池子视图
 * mode = 'filter'   先按全池口径算好榜单，再按公司/类型过滤（默认，符合「筛掉不要的」直觉）
 * mode = 'recompute' 先按公司/类型缩小范围，再在这个范围内重跑整条管线
 */
export function getPoolView(poolId, query = {}) {
  const base = getPoolResult(poolId, query);
  if (!base) return null;

  const mode = query.mode === 'recompute' ? 'recompute' : 'filter';

  if (mode === 'recompute') {
    const pool = POOL_BY_ID[poolId];
    const funds = loadFunds();
    let universe = poolUniverse(pool, funds);
    if (query.company) {
      const set = new Set([].concat(query.company));
      universe = universe.filter((f) => set.has(f.company));
    }
    const result = screenPool(pool, universe, query);
    const items = applyFilters(result.items, { typeList: query.types, q: query.q });
    return {
      ...base,
      mode,
      stats: result.stats,
      items,
      rejects: result.rejectReasons,
      types: typeBreakdown(universe),
      companies: companyBreakdown(universe),
    };
  }

  const items = applyFilters(base.items, query);
  return { ...base, mode, items };
}

export function listPools() {
  return POOLS.map((p) => {
    const r = getPoolResult(p.id);
    return {
      id: p.id,
      group: p.group,
      name: p.name,
      badge: p.badge,
      desc: p.desc,
      universe: r?.stats.universe ?? 0,
      selected: r?.stats.selected ?? 0,
    };
  });
}

export function getMetaInfo() {
  return {
    groups: POOL_GROUPS,
    pools: listPools(),
    dataDate: getMeta('data_date', null),
    syncedAt: getMeta('synced_at', null),
    source: getMeta('source', 'Wind'),
    coverage: getMeta('coverage', null),
    totalFunds: loadFunds().length,
    caliber: {
      minTrackYears: MIN_TRACK_YEARS,
      minScaleYi: MIN_SCALE_YI,
      managerMinYears: 3,
      keepRatio: 0.5,
      years: DEFAULT_YEARS,
      supportedYears: SUPPORTED_YEARS,
      rankBasis: '池内排名',
      returnField: '近N年累计涨幅折年化',
      calmarFormula: '年化收益 ÷ |最大回撤|',
    },
  };
}

export function getFundDetail(code, rawCriteria = {}) {
  const row = db.prepare('SELECT * FROM funds WHERE code = ?').get(code);
  if (!row) return null;
  // 详情页的收益/回撤/卡玛要跟页面上的业绩窗口一致，否则抽屉写「近3年」、
  // 榜单写「近5年」，同一只基金出现两个数
  const { years } = normalizeCriteria(rawCriteria);
  const w = windowMetrics({ ...row, win: parseWin(row.win_json) }, years);
  const fund = { ...row, windowYears: years };
  if (w) {
    fund.cum3y = w.cum;
    fund.mdd3y = w.mdd;
    fund.ann3y = cumulativeToAnnual(w.cum, years);
    fund.calmar = calmarRatio(fund.ann3y, w.mdd);
  }
  const pools = [];
  const members = db.prepare('SELECT pool_id FROM pool_members WHERE code = ?').all(code);
  const memberSet = new Set(members.map((m) => m.pool_id));
  for (const id of memberSet) {
    const r = getPoolResult(id, rawCriteria);
    const hit = r?.items.find((i) => i.code === code);
    if (hit) pools.push({ poolId: id, poolName: r.pool.name, rank: hit.rank, calmar: hit.calmar });
  }
  return { fund, pools };
}
