/**
 * 基金池筛选引擎
 *
 * 管线（严格按业务口径顺序执行）：
 *   0. 池内样本       —— 按投资类型 / 指数分类归入池子，只保留初始基金份额
 *   1. 申购状态        —— 仅保留「开放申购」
 *   2. 基金经理年限    —— 现任基金经理中至少一位管理本基金满 3 年
 *   3. 回撤分位        —— 剔除近 3 年最大回撤排名池内后 50%（保留回撤较小的）
 *   4. 收益分位        —— 剔除近 3 年年化收益排名池内后 50%
 *   5. 卡玛排序        —— 剩余基金按卡玛比率降序
 *
 * 「同类」口径 = 池内排名：在第 2 步之后留下的池内集合里统一排序。
 *
 * 每一层都会留下完整的进出名单（stages），既能给前端做逐层追溯，
 * 也让「为什么这只基金没进榜」可以被逐条回答，而不是只给一个总数。
 */

import { rankBy, cumulativeToAnnual, calmarRatio } from './metrics.js';

export const MANAGER_MIN_YEARS = 3;
export const KEEP_RATIO = 0.5;
export const DEFAULT_YEARS = 3;

/** 业绩窗口的可选值。快照里预算了这几档，超出范围的请求会被夹回来 */
export const SUPPORTED_YEARS = [1, 2, 3, 4, 5];

/** 默认口径 —— 前端未传参时按业务原始规则执行 */
export const DEFAULT_CRITERIA = {
  managerMinYears: MANAGER_MIN_YEARS,
  mddKeepRatio: KEEP_RATIO,
  returnKeepRatio: KEEP_RATIO,
  calmarKeepRatio: 1, // 1 = 不过滤，卡玛只用于最终排序
  purchaseMode: 'strict',
  years: DEFAULT_YEARS,
};

/**
 * 把外部传入的口径参数规整成合法值。
 *
 * 这几个值是用户能拖滑块的，必须夹在区间内：
 * 经理年限 0–20（0 表示不限）、保留比例 0.05–1（1 表示不筛）。
 * 越界或非法值一律回落到默认，不能让一个 NaN 把整条管线搞成空池。
 */
export function normalizeCriteria(raw = {}) {
  const num = (v, def, lo, hi) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return def;
    return Math.min(hi, Math.max(lo, n));
  };
  const years = Math.round(num(raw.years, DEFAULT_CRITERIA.years, 1, 5));
  return {
    managerMinYears: num(raw.managerMinYears, DEFAULT_CRITERIA.managerMinYears, 0, 20),
    mddKeepRatio: num(raw.mddKeepRatio, DEFAULT_CRITERIA.mddKeepRatio, 0.05, 1),
    returnKeepRatio: num(raw.returnKeepRatio, DEFAULT_CRITERIA.returnKeepRatio, 0.05, 1),
    calmarKeepRatio: num(raw.calmarKeepRatio, DEFAULT_CRITERIA.calmarKeepRatio, 0.05, 1),
    purchaseMode: raw.purchaseMode === 'loose' ? 'loose' : 'strict',
    // 只允许预算过的整年窗口，否则取不到指标会把整池筛空
    years: SUPPORTED_YEARS.includes(years) ? years : DEFAULT_CRITERIA.years,
  };
}

/**
 * 取某只基金在第 N 年窗口下的区间收益与最大回撤。
 *
 * 窗口指标离线预算在 win_json 里（1/2/3/4/5 各一套）。取不到就返回 null，
 * 由调用方按「指标缺失」处理——绝不能悄悄退回 3 年口径，那会让「近 5 年」
 * 的榜单里混进 3 年的数据。
 */
export function windowMetrics(f, years) {
  const raw = f.win?.[String(years)];
  if (raw && Number.isFinite(raw.cum) && Number.isFinite(raw.mdd)) {
    return { cum: raw.cum, mdd: raw.mdd };
  }
  return null;
}

export const REJECT = {
  NOT_OPEN: '非开放申购',
  MANAGER_SHORT: '基金经理任职不足3年',
  DUPLICATE_CLASS: '同一基金的其他份额',
  MDD_BOTTOM_HALF: '近3年最大回撤排名池内后50%',
  RETURN_BOTTOM_HALF: '近3年年化收益排名池内后50%',
  MISSING_DATA: '关键指标缺失',
};

/** 剔除原因带上用户设置的口径值，否则滑到 5 年时提示仍写「不足3年」 */
function managerShortReason(years) {
  return years > 0 ? `基金经理任职不足${years}年` : REJECT.MANAGER_SHORT;
}

/**
 * 「可执行买入」的判定 —— 严格口径。
 *
 * 两类放行：
 *   1. 申购状态为「开放申购」的场外份额
 *   2. 申购状态为「场内交易」的 ETF / LOF —— 这类产品本来就不靠申购，
 *      买入走交易所撮合，把 510300 这类核心宽基剔掉会让被动池彻底失去意义
 *
 * 「暂停大额申购」「暂停申购」「限大额」「封闭期」一律剔除：
 * 榜单要能被直接执行，金额受限的产品即便仍可小额买入，也不构成可落地的推荐。
 * 跨境 QDII 因外汇额度长期限购，严格口径下海外类池子会显著变小甚至为空，
 * 这属于数据事实，前端有对应的空态说明。
 */
function isOpenForPurchase(status, loose = false) {
  const s = String(status ?? '').trim();
  if (!s) return false;

  // 这两类任何口径下都不能买：产品已停止运作或处于封闭期
  if (/封闭|终止/.test(s)) return false;
  // 注意「暂停大额申购」不含连续的「暂停申购」子串，不会被这条误伤
  if (/暂停申购/.test(s)) return false;

  if (loose) {
    // 放宽口径：限大额、暂停大额申购仍可小额买入，算可执行
    return true;
  }

  // 严格口径：只要带暂停、限大额、限购字样就剔除
  if (/暂停|限大额|限购/.test(s)) return false;
  if (s.includes('场内交易')) return true;
  return s.includes('开放申购');
}

/**
 * 把内部字段压成前端要的扁平结构。
 * 逐层明细与最终榜单共用同一套字段名，避免两处口径漂移。
 *
 * cum3y / ann3y / mdd3y / calmar 这几个字段名沿用历史命名，实际含义是
 * 「当前业绩窗口（years）下的值」——窗口由用户在页面上调节。
 * 改字段名会牵动前端十几处引用，收益不抵风险，故在文档里说明。
 */
function traceRow(f, years = DEFAULT_YEARS) {
  const w = windowMetrics(f, years);
  const cum = w ? w.cum : null;
  const mdd = w ? w.mdd : null;
  const ann = cumulativeToAnnual(cum, years);
  const calmar = calmarRatio(ann, mdd);
  return {
    code: f.code,
    name: f.name,
    company: f.company,
    typeL2: f.type_l2,
    isInitial: !!f.is_initial,
    purchaseStatus: f.purchase_status ?? null,
    managerNames: f.manager_names ?? null,
    managerTenure: f.manager_tenure ?? null,
    cum3y: cum,
    ann3y: ann,
    mdd3y: mdd,
    calmar,
    scale: f.scale ?? null,
    trackIndex: f.track_index ?? null,
    indexTheme: f.index_theme ?? null,
  };
}

function makeStage({ key, label, desc, rows }) {
  const passed = rows.filter((r) => r.ok).length;
  return {
    key,
    label,
    desc,
    input: rows.length,
    passed,
    dropped: rows.length - passed,
    rows,
  };
}

/**
 * @param {object} pool 池子定义
 * @param {Array<object>} universe 该池子的全部候选基金（已按初始份额去重）
 * @param {object} [rawOpts] 用户可调节的口径（经理年限 / 回撤保留比例 / 收益保留比例 / 申购口径）
 * @returns {{stats:object, items:Array, rejectReasons:Array, stages:Array}}
 */
export function screenPool(pool, universe, rawOpts = {}) {
  const criteria = normalizeCriteria(rawOpts);
  const { managerMinYears, mddKeepRatio, returnKeepRatio, calmarKeepRatio, years } = criteria;
  const loose = criteria.purchaseMode === 'loose';
  const stages = [];

  const stats = {
    universe: universe.length,
    passPurchase: 0,
    passManager: 0,
    managerUnknown: 0,
    passMdd: 0,
    passReturn: 0,
    passCalmar: 0,
    selected: 0,
    criteria,
  };

  // ── 步骤 0：池内样本 ────────────────────────────────
  // 按池子定义的类型顺序分组，组内按规模降序，前端直接按此顺序分段渲染
  const typeOrder = new Map((pool?.types || []).map((t, i) => [t, i]));
  const universeRows = universe
    .map((f) => ({ ...traceRow(f, years), ok: true, reason: null, layerRank: null, layerTotal: null }))
    .sort((a, b) => {
      const ta = typeOrder.get(a.typeL2) ?? 999;
      const tb = typeOrder.get(b.typeL2) ?? 999;
      if (ta !== tb) return ta - tb;
      return (b.scale ?? 0) - (a.scale ?? 0);
    });
  stages.push(
    makeStage({
      key: 'universe',
      label: '池内样本',
      desc: '该池投资类型范围内的全部初始基金份额，按投资类型分组、组内按规模降序。同一只基金的 A/C/E 等非初始份额在入池前已剔除。',
      rows: universeRows,
    })
  );

  // ── 步骤 1：申购状态 ────────────────────────────────
  const purchaseRows = universe.map((f) => {
    const ok = isOpenForPurchase(f.purchase_status, loose);
    return {
      ...traceRow(f, years),
      ok,
      reason: ok ? null : REJECT.NOT_OPEN,
      layerRank: null,
      layerTotal: null,
    };
  });
  // 通过的在前提，剔除的在后，各自保持入池顺序
  purchaseRows.sort((a, b) => Number(b.ok) - Number(a.ok));
  const afterPurchase = universe.filter((f) => isOpenForPurchase(f.purchase_status, loose));
  stats.passPurchase = afterPurchase.length;
  stages.push(
    makeStage({
      key: 'passPurchase',
      label: loose ? '可买入（放宽）' : '可买入',
      desc: loose
        ? '放宽口径：除「暂停申购」「封闭」「终止」外全部保留，「暂停大额申购」「限大额」视为可小额买入。「场内交易」的 ETF / LOF 一并保留。'
        : '保留申购状态为「开放申购」的场外份额，以及「场内交易」的 ETF / LOF（这类产品买入走交易所撮合，不靠申购）。带暂停、限大额、限购、封闭、终止字样的一律剔除——金额受限的产品不构成可直接执行的推荐。',
      rows: purchaseRows,
    })
  );

  // ── 步骤 2：基金经理任职年限 ────────────────────────
  // 东财口径拿不到「在本基金的任职起始日」，这部分由 Wind 复核阶段补齐。
  // 补齐之前不能把「数据缺失」当成「不合格」——那会把整个池子清空；
  // 也不能当成「合格」蒙混过去——所以单列一个 managerUnknown 计数，前端如实标注。
  const managerRows = afterPurchase.map((f) => {
    const tenure = f.manager_tenure;
    const missing = tenure == null || !Number.isFinite(tenure);
    // managerMinYears = 0 表示用户关掉了这条筛选，全部放行
    const ok = missing ? true : managerMinYears <= 0 || tenure >= managerMinYears;
    return {
      ...traceRow(f, years),
      ok,
      managerUnknown: missing,
      reason: ok ? null : managerShortReason(managerMinYears),
      layerRank: null,
      layerTotal: null,
    };
  });
  managerRows.sort((a, b) => {
    if (a.ok !== b.ok) return Number(b.ok) - Number(a.ok);
    return (b.managerTenure ?? -1) - (a.managerTenure ?? -1);
  });
  const afterManager = afterPurchase.filter((f) => {
    const t = f.manager_tenure;
    if (t == null || !Number.isFinite(t)) return true;   // 待核，放行并单独标注
    return managerMinYears <= 0 || t >= managerMinYears;
  });
  const managerUnknownCount = managerRows.filter((r) => r.managerUnknown).length;
  stats.passManager = afterManager.length;
  stats.managerUnknown = managerUnknownCount;
  stages.push(
    makeStage({
      key: 'passManager',
      label: managerMinYears <= 0 ? '经理年限不限' : `经理满 ${managerMinYears} 年`,
      desc:
        managerMinYears <= 0
          ? '经理任职年限这道筛选已关闭，本层全部放行。'
          : `现任基金经理中至少一位管理本基金满 ${managerMinYears} 年。多基金经理时按「最长任期」判断，只要有一位达标即通过。` +
            (managerUnknownCount
              ? ` 其中 ${managerUnknownCount} 只的任职起始日缺失，暂按「待核」放行并单独标注。`
              : ''),
      rows: managerRows,
    })
  );

  // ── 窗口指标预处理 ──────────────────────────────────
  // 回撤、收益、卡玛三层都按用户选的「近 N 年」取值，这里统一算一次，
  // 避免每层各自重复解析 win_json。
  const wm = new Map(); // 原始基金对象 -> {cum, mdd, ann, calmar} | null
  for (const f of afterManager) {
    const w = windowMetrics(f, years);
    if (!w) {
      wm.set(f, null);
      continue;
    }
    const ann = cumulativeToAnnual(w.cum, years);
    wm.set(f, { cum: w.cum, mdd: w.mdd, ann, calmar: calmarRatio(ann, w.mdd) });
  }
  const wn = (f) => wm.get(f);

  // ── 步骤 3：最大回撤分位 ────────────────────────────
  const withMdd = afterManager.filter((f) => wn(f)?.mdd != null);
  // mdd 为负值，desc = 越接近 0 越优
  const mddRank = rankBy(withMdd, (f) => wn(f).mdd, 'desc');
  const mddKeepPct = Math.round(mddKeepRatio * 100);
  const mddKeep = mddKeepRatio >= 1 ? mddRank.total : Math.max(1, Math.ceil(mddRank.total * mddKeepRatio));
  const afterMdd = [];
  const mddRows = afterManager.map((f) => {
    const r = mddRank.rank.get(f) ?? null;
    const ok = r != null && r <= mddKeep;
    if (ok) afterMdd.push(f);
    return {
      ...traceRow(f, years),
      ok,
      reason: ok ? null : r == null ? REJECT.MISSING_DATA : `近${years}年最大回撤排名池内后${100 - mddKeepPct}%`,
      layerRank: r,
      layerTotal: mddRank.total,
    };
  });
  mddRows.sort((a, b) => (a.layerRank ?? 1e9) - (b.layerRank ?? 1e9));
  stats.passMdd = afterMdd.length;
  stages.push(
    makeStage({
      key: 'passMdd',
      label: mddKeepRatio >= 1 ? '回撤不限' : `近${years}年回撤前 ${mddKeepPct}%`,
      desc:
        mddKeepRatio >= 1
          ? '回撤这道筛选已关闭，本层全部放行（回撤值仍会参与卡玛比率计算）。'
          : `按近 ${years} 年最大回撤排序（越接近 0 越优），保留排名前 ${mddKeep} / ${mddRank.total} 只，即剔除回撤最大的后 ${100 - mddKeepPct}%。`,
      rows: mddRows,
    })
  );

  // ── 步骤 4：年化收益分位 ────────────────────────────
  const withReturn = afterMdd.filter((f) => wn(f)?.ann != null);
  const retRank = rankBy(withReturn, (f) => wn(f).ann, 'desc');
  const retKeepPct = Math.round(returnKeepRatio * 100);
  const retKeep = returnKeepRatio >= 1 ? retRank.total : Math.max(1, Math.ceil(retRank.total * returnKeepRatio));
  const afterReturn = [];
  const returnRows = afterMdd.map((f) => {
    const r = retRank.rank.get(f) ?? null;
    const ok = r != null && r <= retKeep;
    if (ok) afterReturn.push(f);
    return {
      ...traceRow(f, years),
      ok,
      reason: ok ? null : r == null ? REJECT.MISSING_DATA : `近${years}年年化收益排名池内后${100 - retKeepPct}%`,
      layerRank: r,
      layerTotal: retRank.total,
    };
  });
  returnRows.sort((a, b) => (a.layerRank ?? 1e9) - (b.layerRank ?? 1e9));
  stats.passReturn = afterReturn.length;
  stages.push(
    makeStage({
      key: 'passReturn',
      label: returnKeepRatio >= 1 ? '收益不限' : `近${years}年收益前 ${retKeepPct}%`,
      desc:
        returnKeepRatio >= 1
          ? '收益这道筛选已关闭，本层全部放行（收益值仍会参与卡玛比率计算）。'
          : `按近 ${years} 年几何年化收益排序，保留排名前 ${retKeep} / ${retRank.total} 只，即剔除收益最低的后 ${100 - retKeepPct}%。`,
      rows: returnRows,
    })
  );

  // ── 步骤 5：卡玛比率分位 ────────────────────────────
  // 卡玛 = 年化收益 ÷ |最大回撤|，本身已经综合了收益与风险。
  // 单列一层让用户可以「既要收益靠前、也要风险调整后效率靠前」。
  const withCalmar = afterReturn.filter((f) => wn(f)?.calmar != null);
  const calRank = rankBy(withCalmar, (f) => wn(f).calmar, 'desc');
  const calKeepPct = Math.round(calmarKeepRatio * 100);
  const calKeep = calmarKeepRatio >= 1 ? calRank.total : Math.max(1, Math.ceil(calRank.total * calmarKeepRatio));
  const afterCalmar = [];
  const calmarRows = afterReturn.map((f) => {
    const r = calRank.rank.get(f) ?? null;
    const ok = r != null && r <= calKeep;
    if (ok) afterCalmar.push(f);
    return {
      ...traceRow(f, years),
      ok,
      reason: ok ? null : r == null ? REJECT.MISSING_DATA : `近${years}年卡玛比率排名池内后${100 - calKeepPct}%`,
      layerRank: r,
      layerTotal: calRank.total,
    };
  });
  calmarRows.sort((a, b) => (a.layerRank ?? 1e9) - (b.layerRank ?? 1e9));
  stats.passCalmar = afterCalmar.length;
  stages.push(
    makeStage({
      key: 'passCalmar',
      label: calmarKeepRatio >= 1 ? '卡玛不限' : `近${years}年卡玛前 ${calKeepPct}%`,
      desc:
        calmarKeepRatio >= 1
          ? '卡玛这道筛选已关闭，本层全部放行（卡玛仍作为最终排序键）。'
          : `按近 ${years} 年卡玛比率（年化收益 ÷ |最大回撤|）排序，保留排名前 ${calKeep} / ${calRank.total} 只，即剔除风险调整后收益最差的后 ${100 - calKeepPct}%。`,
      rows: calmarRows,
    })
  );

  // ── 步骤 6：卡玛比率降序 ────────────────────────────
  const rankable = afterCalmar.filter((f) => {
    const m = wn(f);
    return m && m.calmar != null && Number.isFinite(m.calmar) && Math.abs(m.mdd) > 0.5;
  });
  rankable.sort((a, b) => wn(b).calmar - wn(a).calmar);

  const items = rankable.map((f, i) => {
    const m = wn(f);
    return {
      rank: i + 1,
      code: f.code,
      name: f.name,
      company: f.company,
      typeL2: f.type_l2,
      purchaseStatus: f.purchase_status,
      managerNames: f.manager_names,
      managerTenure: f.manager_tenure,
      cum3y: m.cum,
      ann3y: m.ann,
      mdd3y: m.mdd,
      calmar: m.calmar,
      calmarWind: f.calmar_wind,
      scale: f.scale,
      nav: f.nav,
      trackIndex: f.track_index,
      trackIndexCode: f.track_index_code,
      indexCategory: f.index_category,
      indexTheme: f.index_theme,
      trackingError: f.tracking_error,
      windowYears: years,
      mddRankInPool: mddRank.rank.get(f) ?? null,
      mddRankTotal: mddRank.total,
      returnRankInPool: retRank.rank.get(f) ?? null,
      returnRankTotal: retRank.total,
      calmarRankInPool: calRank.rank.get(f) ?? null,
      calmarRankTotal: calRank.total,
      mddPercentile: mddRank.rank.get(f)
        ? 1 - (mddRank.rank.get(f) - 1) / Math.max(mddRank.total - 1, 1)
        : null,
      returnPercentile: retRank.rank.get(f)
        ? 1 - (retRank.rank.get(f) - 1) / Math.max(retRank.total - 1, 1)
        : null,
      calmarPercentile: calRank.rank.get(f)
        ? 1 - (calRank.rank.get(f) - 1) / Math.max(calRank.total - 1, 1)
        : null,
    };
  });
  stats.selected = items.length;

  // 入榜层：把最终排名作为 layerRank，前端可直接复用同一张表
  const rankMap = new Map(items.map((i) => [i.code, i.rank]));
  const selectedRows = afterCalmar
    .map((f) => traceRow(f, years))
    .filter((r) => rankMap.has(r.code))
    .sort((a, b) => rankMap.get(a.code) - rankMap.get(b.code))
    .map((r) => ({
      ...r,
      ok: true,
      reason: null,
      layerRank: rankMap.get(r.code),
      layerTotal: items.length,
    }));
  stages.push(
    makeStage({
      key: 'selected',
      label: '入榜',
      desc: `通过全部前置条件的基金，按近 ${years} 年卡玛比率（年化收益 ÷ |最大回撤|）降序排列。`,
      rows: selectedRows,
    })
  );

  // 剔除汇总（保留给页面底部的快速概览）
  const rejectBuckets = new Map();
  for (const st of stages) {
    if (st.key === 'universe' || st.key === 'selected') continue;
    for (const r of st.rows) {
      if (r.ok || !r.reason) continue;
      const list = rejectBuckets.get(r.reason) || [];
      list.push({ code: r.code, name: r.name, company: r.company });
      rejectBuckets.set(r.reason, list);
    }
  }
  const rejectReasons = [...rejectBuckets.entries()]
    .map(([reason, list]) => ({
      reason,
      count: list.length,
      samples: list.slice(0, 5),
    }))
    .sort((a, b) => b.count - a.count);

  return { stats, items, rejectReasons, stages };
}

/** 池内类型分布，用于前端展示筛选范围 */
export function typeBreakdown(universe) {
  const map = new Map();
  for (const f of universe) {
    const k = f.type_l2 || '未分类';
    map.set(k, (map.get(k) || 0) + 1);
  }
  return [...map.entries()]
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count);
}

/** 公司维度的聚合，用于前端筛选器 */
export function companyBreakdown(universe) {
  const map = new Map();
  for (const f of universe) {
    const k = f.company || '未知';
    map.set(k, (map.get(k) || 0) + 1);
  }
  return [...map.entries()]
    .map(([company, count]) => ({ company, count }))
    .sort((a, b) => b.count - a.count);
}
