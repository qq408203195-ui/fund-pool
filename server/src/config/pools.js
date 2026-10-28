/**
 * 基金池定义
 *
 * 每个池子的筛选范围由 Wind「投资类型_二级分类」白名单界定；
 * 被动类池子额外用指数分类（indexCategories）二次过滤。
 *
 * 修改池子范围只需改这里，筛选引擎与前端会自动跟随。
 */

export const POOL_GROUPS = [
  { id: 'active', name: '主动方向', desc: '以基金经理主动管理能力为核心' },
  { id: 'passive', name: '被动方向', desc: '以跟踪指数与工具属性为核心' },
];

/** 主动类池子共用的类型白名单片段 */
const ACTIVE_TYPES = {
  普通股票: '普通股票型基金',
  指数增强: '增强指数型基金',
  偏股混合: '偏股混合型基金',
  灵活配置: '灵活配置型基金',
  平衡混合: '平衡混合型基金',
  偏债混合: '偏债混合型基金',
  可转债: '可转换债券型基金',
  混债一级: '混合债券型一级基金',
  混债二级: '混合债券型二级基金',
  中长期债: '中长期纯债型基金',
  短期债: '短期纯债型基金',
  被动指数: '被动指数型基金',
  被动债券: '被动指数型债券基金',
  股票FOF: '股票型FOF基金',
  混合FOF: '混合型FOF基金',
  债券FOF: '债券型FOF基金',
};

const QDII_TYPES = [
  '国际(QDII)股票型基金',
  '国际(QDII)混合型基金',
  '国际(QDII)债券型基金',
  '国际(QDII)另类投资基金',
  '国际(QDII)房地产基金',
];

export const POOLS = [
  {
    id: 'active-equity',
    group: 'active',
    order: 1,
    name: '主动权益池',
    badge: '权益',
    desc: '主动管理的权益类产品集合，覆盖普通股票、指数增强、偏股混合、灵活配置、可转债与权益类 FOF。',
    rationale: '用回撤与收益的双重同类中位数剔除高风险低效产品，再以卡玛比率衡量单位回撤换来的收益。',
    types: [
      ACTIVE_TYPES.普通股票,
      ACTIVE_TYPES.指数增强,
      ACTIVE_TYPES.偏股混合,
      ACTIVE_TYPES.灵活配置,
      ACTIVE_TYPES.可转债,
      ACTIVE_TYPES.股票FOF,
      ACTIVE_TYPES.混合FOF,
    ],
  },
  {
    id: 'mid-fixed-income',
    group: 'active',
    order: 2,
    name: '中波固收池',
    badge: '中波',
    desc: '中等波动区间的固收及固收+产品，含平衡混合、偏债混合、灵活配置、混债一级/二级、债券 FOF 与可转债。',
    rationale: '这一池的风险预算介于纯债与权益之间，重点看回撤可控性而非绝对收益。',
    types: [
      ACTIVE_TYPES.平衡混合,
      ACTIVE_TYPES.偏债混合,
      ACTIVE_TYPES.灵活配置,
      ACTIVE_TYPES.混债一级,
      ACTIVE_TYPES.混债二级,
      ACTIVE_TYPES.债券FOF,
      ACTIVE_TYPES.可转债,
    ],
  },
  {
    id: 'low-fixed-income',
    group: 'active',
    order: 3,
    name: '低波固收池',
    badge: '低波',
    desc: '以纯债与一级债基为主体的低波动产品，含混债一级、中长期纯债、短期纯债与债券 FOF。',
    rationale: '低波池的核心是净值稳定性，同池内短期品种天然回撤更小，榜单结构会向短债倾斜，这是该池的预期特征。',
    types: [ACTIVE_TYPES.混债一级, ACTIVE_TYPES.中长期债, ACTIVE_TYPES.短期债, ACTIVE_TYPES.债券FOF],
  },
  {
    id: 'overseas',
    group: 'active',
    order: 4,
    name: '海外池',
    badge: '海外',
    desc: 'QDII 及跨境配置产品，覆盖海外股票、混合、债券、另类与房地产。',
    rationale: '海外资产与 A 股相关性低，池内同时保留股票与债券型 QDII，以便观察跨市场分散效果。',
    types: [...QDII_TYPES],
  },
  {
    id: 'commodity',
    group: 'active',
    order: 5,
    name: '商品池',
    badge: '商品',
    desc: '商品型基金，含黄金、白银、原油、有色金属、农产品等期货与现货标的。',
    rationale: '商品池标的少、相关性结构特殊，指标更多用于横向对比同类工具而非绝对优劣。',
    types: ['商品型基金'],
  },
  {
    id: 'passive-equity-broad',
    group: 'passive',
    order: 6,
    name: '股票宽基',
    badge: '宽基',
    desc: '跟踪沪深300、中证500、中证1000、科创50 等宽基指数的被动产品。',
    rationale: '宽基指数同质化高，跟踪误差与费率是主要区分点，收益差异更多来自指数本身。',
    types: [ACTIVE_TYPES.被动指数],
    indexCategories: ['宽基'],
  },
  {
    id: 'passive-equity-industry',
    group: 'passive',
    order: 7,
    name: '股票行业',
    badge: '行业',
    desc: '跟踪单一行业或主题指数的被动产品，如医药、军工、芯片、消费、新能源。',
    rationale: '行业 ETF 是配置工具，池内排序反映的是「同一行业里谁做得更贴合、更省成本」。',
    types: [ACTIVE_TYPES.被动指数],
    indexCategories: ['行业'],
  },
  {
    id: 'passive-equity-strategy',
    group: 'passive',
    order: 8,
    name: '股票策略',
    badge: '策略',
    desc: '跟踪红利、低波、价值、成长、质量、等权等策略型指数的被动产品。',
    rationale: '策略指数带明确的因子暴露，适合作为风格切换的执行工具。',
    types: [ACTIVE_TYPES.被动指数],
    indexCategories: ['策略'],
  },
  {
    id: 'passive-bond',
    group: 'passive',
    order: 9,
    name: '债券',
    badge: '债',
    desc: '债券指数基金与债券 ETF，覆盖利率债、信用债、综合债等。',
    rationale: '债券被动产品看久期暴露与跟踪质量，收益差距主要来自指数久期差异。',
    types: [ACTIVE_TYPES.被动债券, ACTIVE_TYPES.被动指数],
    indexCategories: ['债券'],
  },
  {
    id: 'passive-qdii-equity',
    group: 'passive',
    order: 10,
    name: 'QDII 股票',
    badge: 'QDII股',
    desc: '跟踪海外股票指数的跨境被动产品，如纳指100、标普500、恒生科技、日经225。',
    rationale: '跨境产品需额外关注跟踪误差与汇率暴露，池内排序会同时体现这两点。',
    types: [...QDII_TYPES, ACTIVE_TYPES.被动指数],
    indexCategories: ['QDII股票'],
  },
  {
    id: 'passive-qdii-bond',
    group: 'passive',
    order: 11,
    name: 'QDII 债券',
    badge: 'QDII债',
    desc: '跨境债券工具。境内几乎没有真正跟踪海外债券指数的被动产品，本池按类型收录全部跨境债券基金。',
    rationale:
      '跨境债券受外汇额度约束，主流产品长期处于「暂停大额申购」。按必须开放申购的严格口径，本池常年无产品入榜——这不是数据缺失，而是额度现实，需要实际配置时应单独走机构额度或场内通道。',
    types: [...QDII_TYPES, ACTIVE_TYPES.被动债券],
    indexCategories: ['QDII债券'],
    allowNoTrackIndex: true,
  },
  {
    id: 'passive-qdii-commodity',
    group: 'passive',
    order: 12,
    name: 'QDII 商品',
    badge: 'QDII商',
    desc: '跟踪海外商品指数的跨境被动产品，如原油、黄金、大宗商品综合指数。',
    rationale: 'QDII 商品是境内少见的海外商品敞口，池内主要看跟踪标的口径与流动性。',
    types: ['国际(QDII)另类投资基金', '商品型基金'],
    indexCategories: ['QDII商品'],
    // 跨境另类普遍不披露跟踪指数，按名称识别商品敞口后放行
    allowNoTrackIndex: true,
  },
];

export const POOL_BY_ID = Object.fromEntries(POOLS.map((p) => [p.id, p]));

/** 所有池子涉及的二级分类并集，供同步脚本判断拉取范围 */
export function allPoolTypes() {
  const set = new Set();
  for (const p of POOLS) for (const t of p.types) set.add(t);
  return [...set];
}

/** 主动类池子的全部类型（不含被动） */
export const ACTIVE_POOL_TYPES = [
  ...new Set(POOLS.filter((p) => p.group === 'active').flatMap((p) => p.types)),
];
