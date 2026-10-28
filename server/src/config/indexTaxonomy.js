/**
 * 指数分类映射表
 *
 * Wind 只返回「跟踪指数名称 + 代码」，不提供「宽基 / 行业 / 策略」这类配置口径的标签。
 * 这里用两层判定：
 *   1) 显式映射表（EXPLICIT）：覆盖主流指数，最高优先级
 *   2) 名称规则（RULES）：按关键词归类，兜住长尾
 *   3) 兜底 '其他'：前端可提示人工补录
 *
 * 补录方式：在 EXPLICIT 里加一行即可，键为 Wind 指数代码（如 000300.SH）。
 */

export const INDEX_CATEGORIES = [
  { id: '宽基', name: '股票宽基', desc: '覆盖全市场或大中盘的广谱指数' },
  { id: '行业', name: '股票行业', desc: '单一行业或细分主题' },
  { id: '策略', name: '股票策略', desc: '因子、加权方式或规则驱动的策略指数' },
  { id: '债券', name: '债券', desc: '利率债、信用债、综合债指数' },
  { id: 'QDII股票', name: 'QDII股票', desc: '海外股票指数' },
  { id: 'QDII债券', name: 'QDII债券', desc: '海外债券指数' },
  { id: 'QDII商品', name: 'QDII商品', desc: '海外商品指数' },
  { id: '其他', name: '其他', desc: '未归类，可人工补录' },
];

/** 显式映射：指数代码 -> [分类, 主题] */
export const EXPLICIT = {
  // ── 宽基 ──────────────────────────────────────────────
  '000300.SH': ['宽基', '沪深300'],
  '000905.SH': ['宽基', '中证500'],
  '000852.SH': ['宽基', '中证1000'],
  '932000.CSI': ['宽基', '中证2000'],
  '000016.SH': ['宽基', '上证50'],
  '000010.SH': ['宽基', '上证180'],
  '000009.SH': ['宽基', '上证380'],
  '000903.SH': ['宽基', '中证100'],
  '000985.CSI': ['宽基', '中证全指'],
  '399001.SZ': ['宽基', '深证成指'],
  '399006.SZ': ['宽基', '创业板指'],
  '399005.SZ': ['宽基', '中小100'],
  '399330.SZ': ['宽基', '深证100'],
  '000688.SH': ['宽基', '科创50'],
  '000698.SH': ['宽基', '科创200'],
  '931643.CSI': ['宽基', '科创创业50'],
  '931643.CNI': ['宽基', '科创创业50'],
  '000906.SH': ['宽基', '中证800'],
  '000510.SH': ['宽基', '中证A500'],

  // ── 行业 ──────────────────────────────────────────────
  '399975.SZ': ['行业', '证券公司'],
  '931412.CSI': ['行业', '证券公司30'],
  '399967.SZ': ['行业', '中证军工'],
  '000991.SH': ['行业', '全指医药卫生'],

  // ── 策略 ──────────────────────────────────────────────
  '000922.CSI': ['策略', '中证红利'],
  '000015.SH': ['策略', '上证红利'],
  'H30269.CSI': ['策略', '红利低波'],
  '000925.SH': ['策略', '基本面50'],
  '399324.SZ': ['策略', '深证红利'],
  '931446.CSI': ['策略', '红利质量'],
  '932315.CSI': ['策略', '中证红利质量'],
  '931468.CSI': ['策略', '中证A50'],
  '930050.CSI': ['策略', '中证A50'],
  'H30533.CSI': ['策略', '中证低波'],

  // ── 债券 ──────────────────────────────────────────────
  'CBA00101.CS': ['债券', '中债综合'],
  'CBA00301.CS': ['债券', '中债国债'],
  'CBA00601.CS': ['债券', '中债企业债'],
  'CBA20901.CS': ['债券', '中债优选投资级信用债'],
  'CBA08203.CS': ['债券', '中债7-10年政策性金融债'],
  'H11001.CSI': ['债券', '中证全债'],
  'H11014.CSI': ['债券', '中证短融'],
  'H11077.CSI': ['债券', '中证短融'],
  'H01098.SH': ['债券', '上证城投债'],
  '931078.CSI': ['债券', '中证转债及可交换债'],
  '000012.SH': ['债券', '上证国债'],
  '000013.SH': ['债券', '上证企业债'],

  // ── QDII 股票 ─────────────────────────────────────────
  'NDX.GI': ['QDII股票', '纳斯达克100'],
  'SPX.GI': ['QDII股票', '标普500'],
  'HSI.HI': ['QDII股票', '恒生指数'],
  'HSTECH.HI': ['QDII股票', '恒生科技'],
  'N225.GI': ['QDII股票', '日经225'],
  'GDAXI.GI': ['QDII股票', '德国DAX'],
  'FTSE.GI': ['QDII股票', '富时100'],
  'DJI.GI': ['QDII股票', '道琼斯工业'],
  'IXIC.GI': ['QDII股票', '纳斯达克综合'],

  // ── QDII 债券 ─────────────────────────────────────────
  'SPBDUB3T.GI': ['QDII债券', '彭博美元投资级债'],

  // ── QDII 商品 ─────────────────────────────────────────
  'SPGSCI.GI': ['QDII商品', '标普高盛商品'],
  'CL.NYM': ['QDII商品', 'WTI原油'],
  'GC.COMEX': ['QDII商品', 'COMEX黄金'],

  // ── 其他 ──────────────────────────────────────────────
  'DWRTF.GI': ['其他', '道琼斯美国精选REIT'],
};

/** QDII 另类/商品类基金多数不披露跟踪指数，按基金名称兜底识别商品敞口 */
const QDII_COMMODITY_NAME_RE = /(原油|石油|天然气|能源|商品|大豆|豆粕|有色|铜|白银|贵金属|黄金|抗通胀|大宗)/;

/**
 * 商品的细分主题。
 * 主题必须是「可归类」的资产标签，不能直接拿基金名当主题——
 * 否则每只基金自成一类，分组退化成一行一组，等于没分。
 */
const QDII_COMMODITY_THEME = [
  { re: /(原油|石油|能源)/, theme: '原油' },
  { re: /白银/, theme: '白银' },
  { re: /(黄金|贵金属)/, theme: '黄金' },
  { re: /(大豆|豆粕|农产品)/, theme: '农产品' },
  { re: /(有色|铜|金属)/, theme: '有色金属' },
  { re: /(商品|大宗|抗通胀)/, theme: '大宗商品' },
];

export function classifyQdiiAlt(fundName) {
  const n = (fundName || '').trim();
  if (!n) return null;
  if (!QDII_COMMODITY_NAME_RE.test(n)) return null;
  for (const r of QDII_COMMODITY_THEME) {
    if (r.re.test(n)) return { category: 'QDII商品', theme: r.theme, source: 'name' };
  }
  return { category: 'QDII商品', theme: '大宗商品', source: 'name' };
}

/** QDII 债券的区域敞口，同样按名称识别，避免主题退化成基金名 */
const QDII_BOND_THEME = [
  { re: /亚洲/, theme: '亚洲美元债' },
  { re: /新兴市场/, theme: '新兴市场债' },
  { re: /(中资|中国)/, theme: '中资美元债' },
  { re: /(美国|美元|美债)/, theme: '美元债' },
  { re: /(欧洲|欧元)/, theme: '欧元债' },
  { re: /(全球|世界)/, theme: '全球债券' },
];

export function classifyQdiiBond(fundName) {
  const n = (fundName || '').trim();
  for (const r of QDII_BOND_THEME) {
    if (r.re.test(n)) return { category: 'QDII债券', theme: r.theme, source: 'name' };
  }
  return { category: 'QDII债券', theme: '跨境债券', source: 'type' };
}

/** 名称规则：按顺序命中，先命中先生效 */
const RULES = [
  // QDII 债券
  { re: /(美债|美元债|亚洲美元债|全球.*债|新兴市场.*债|彭博.*债|iBoxx)/i, cat: 'QDII债券' },
  // QDII 商品
  { re: /(原油|黄金|白银|商品|能源|大豆|豆粕|有色|铜|天然气|农产品)/, cat: 'QDII商品', onlyIf: /(标普|高盛|COMEX|NYMEX|伦敦|海外|全球|纳斯达克|日经)/ },
  // QDII 股票
  { re: /(纳斯达克|标普500|道琼斯|恒生|日经|德国DAX|法国CAC|富时|韩国|印度|越南|东南亚|亚太|美国|美股|欧洲|日本|全球|海外|MSCI|罗素)/i, cat: 'QDII股票' },
  // 债券
  { re: /(债|国债|政金债|金融债|信用债|城投|短融|中票|利率债|综合债)/, cat: '债券' },
  // 策略
  { re: /(红利|低波|价值|成长|质量|等权|基本面|龙头|动量|多因子|股息|自由现金流|A50|A500)/, cat: '策略' },
  // 宽基
  { re: /(沪深300|中证500|中证1000|中证2000|上证50|上证180|上证380|创业板|科创50|科创200|科创创业50|深证100|深证成指|中证100|中证800|中证全指|北证50|全指)/, cat: '宽基' },
  // 行业
  { re: /(医药|医疗|生物|创新药|军工|国防|芯片|半导体|消费|食品|饮料|白酒|银行|证券|保险|非银|地产|房地产|建筑|建材|钢铁|煤炭|化工|有色|金属|新能源|光伏|锂电|储能|电池|汽车|智能车|机械|电力|公用|环保|农业|养殖|传媒|游戏|通信|5G|计算机|软件|互联网|电子|家电|纺织|服装|旅游|航空|物流|基建|央企|国企|科技|人工智能|机器人|云计算|大数据|网络安全|卫星|低空)/, cat: '行业' },
];

/**
 * 判定指数分类
 * @param {string} indexCode Wind 指数代码，如 000300.SH
 * @param {string} indexName 指数名称
 * @returns {{category: string, theme: string, source: 'explicit'|'rule'|'fallback'}}
 */
/** 指数名称规范化：东财给的是「沪深300指数」，去掉后缀才能和显式映射的简称对齐 */
function normTheme(name) {
  return String(name || '')
    .replace(/(全收益|净收益|价格|指数)$/g, '')
    .replace(/(全收益|净收益|价格|指数)$/g, '')
    .trim();
}

export function classifyIndex(indexCode, indexName) {
  const code = (indexCode || '').trim().toUpperCase();
  const name = (indexName || '').trim();
  const theme = normTheme(name) || code || '未知指数';

  if (code && EXPLICIT[code]) {
    return { category: EXPLICIT[code][0], theme: EXPLICIT[code][1], source: 'explicit' };
  }

  for (const rule of RULES) {
    if (rule.onlyIf) {
      if (rule.re.test(name) && rule.onlyIf.test(name)) {
        return { category: rule.cat, theme, source: 'rule' };
      }
      continue;
    }
    if (rule.re.test(name)) {
      return { category: rule.cat, theme, source: 'rule' };
    }
  }

  return { category: '其他', theme, source: 'fallback' };
}

/** 是否为跨境类指数 */
export function isQdiiCategory(cat) {
  return typeof cat === 'string' && cat.startsWith('QDII');
}
