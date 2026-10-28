export interface PoolSummary {
  id: string;
  group: 'active' | 'passive';
  name: string;
  badge: string;
  desc: string;
  universe: number;
  selected: number;
}

export interface Caliber {
  minTrackYears: number;
  minScaleYi: number;
  managerMinYears: number;
  keepRatio: number;
  rankBasis: string;
  returnField: string;
  calmarFormula: string;
}

/** 用户可调节的筛选口径，与后端 normalizeCriteria 的字段一一对应 */
export interface Criteria {
  managerMinYears: number;
  mddKeepRatio: number;
  returnKeepRatio: number;
  purchaseMode: 'strict' | 'loose';
}

export interface MetaInfo {
  groups: { id: string; name: string; desc: string }[];
  pools: PoolSummary[];
  dataDate: string | null;
  syncedAt: string | null;
  source: string;
  coverage: string | null;
  totalFunds: number;
  caliber: Caliber;
}

export interface FundItem {
  rank: number;
  code: string;
  name: string;
  company: string;
  typeL2: string;
  purchaseStatus: string;
  managerNames: string | null;
  managerTenure: number | null;
  cum3y: number | null;
  ann3y: number | null;
  mdd3y: number | null;
  calmar: number | null;
  calmarWind: number | null;
  scale: number | null;
  nav: number | null;
  trackIndex: string | null;
  trackIndexCode: string | null;
  indexCategory: string | null;
  indexTheme: string | null;
  trackingError: number | null;
  mddRankInPool: number | null;
  mddRankTotal: number | null;
  returnRankInPool: number | null;
  returnRankTotal: number | null;
  mddPercentile: number | null;
  returnPercentile: number | null;
}

export interface RejectReason {
  reason: string;
  count: number;
  samples: { code: string; name: string; company: string }[];
}

export interface PoolView {
  pool: {
    id: string;
    group: string;
    name: string;
    badge: string;
    desc: string;
    rationale: string;
    types: string[];
    indexCategories: string[] | null;
  };
  mode: 'filter' | 'recompute';
  stats: {
    universe: number;
    passPurchase: number;
    passManager: number;
    managerUnknown?: number;
    passMdd: number;
    passReturn: number;
    selected: number;
    criteria?: Criteria;
  };
  items: FundItem[];
  rejects: RejectReason[];
  types: { type: string; count: number }[];
  companies: { company: string; count: number }[];
}

export interface FundDetail {
  fund: Record<string, any>;
  pools: { poolId: string; poolName: string; rank: number; calmar: number }[];
}

/** 逐层追溯里的一行 —— 该基金进入本层时的状态与本层判定结果 */
export interface TraceRow {
  code: string;
  name: string;
  company: string;
  typeL2: string;
  isInitial: boolean;
  purchaseStatus: string | null;
  managerNames: string | null;
  managerTenure: number | null;
  cum3y: number | null;
  ann3y: number | null;
  mdd3y: number | null;
  calmar: number | null;
  scale: number | null;
  trackIndex: string | null;
  indexTheme: string | null;
  /** 本层是否通过 */
  ok: boolean;
  /** 未通过时的原因 */
  reason: string | null;
  /** 本层的池内排名（仅回撤层、收益层、入榜层有） */
  layerRank: number | null;
  layerTotal: number | null;
}

export interface TraceStage {
  key: string;
  label: string;
  desc: string;
  input: number;
  passed: number;
  dropped: number;
  types: { type: string; count: number }[];
  rows: TraceRow[];
}

export interface PoolTrace {
  pool: PoolView['pool'];
  caliber: Criteria;
  stages: TraceStage[];
}
