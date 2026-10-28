/**
 * 快照导入器
 *
 * 读取 data/snapshot/*.json，规范化后写入 SQLite。
 * 快照文件结构（列式，便于人工核对与增量补充）：
 * {
 *   "poolId": "active-equity",
 *   "fetchedAt": "2026-10-27",
 *   "source": "Wind / search_funds",
 *   "cols": ["code","name","company","type","initial","status","mgrStart","cum3y","mdd3y","calmarWind","scale","idxName","idxCode"],
 *   "rows": [["000082.OF","嘉实研究阿尔法A","嘉实基金管理有限公司","普通股票型基金",1,"开放申购","2017-08-11",17.2955,-21.4119,0.51,2.1,null,null]]
 * }
 */

import fs from 'node:fs';
import path from 'node:path';
import { db, SNAPSHOT_DIR, setMeta, bumpDataVersion } from './db.js';
import { POOLS } from './config/pools.js';
import { classifyIndex, classifyQdiiAlt, classifyQdiiBond } from './config/indexTaxonomy.js';
import { MIN_TRACK_YEARS, MIN_SCALE_YI, cutoffEstab } from './config/caliber.js';
import { cumulativeToAnnual, calmarRatio, yearsBetween, round } from './engine/metrics.js';

const UPSERT = `
INSERT INTO funds (
  code, name, company, type_l2, is_initial, purchase_status,
  manager_start, manager_tenure, manager_names, manager_count,
  cum3y, ann3y, ann3y_wind, mdd3y, calmar, calmar_wind,
  scale, nav,
  track_index, track_index_code, index_category, index_theme, index_source, tracking_error,
  estab, source,
  data_date, updated_at
) VALUES (
  $code, $name, $company, $type_l2, $is_initial, $purchase_status,
  $manager_start, $manager_tenure, $manager_names, $manager_count,
  $cum3y, $ann3y, $ann3y_wind, $mdd3y, $calmar, $calmar_wind,
  $scale, $nav,
  $track_index, $track_index_code, $index_category, $index_theme, $index_source, $tracking_error,
  $estab, $source,
  $data_date, $updated_at
)
ON CONFLICT(code) DO UPDATE SET
  name = excluded.name,
  company = excluded.company,
  type_l2 = excluded.type_l2,
  is_initial = excluded.is_initial,
  purchase_status = excluded.purchase_status,
  manager_start = excluded.manager_start,
  manager_tenure = excluded.manager_tenure,
  manager_names = COALESCE(excluded.manager_names, funds.manager_names),
  manager_count = COALESCE(excluded.manager_count, funds.manager_count),
  cum3y = excluded.cum3y,
  ann3y = excluded.ann3y,
  ann3y_wind = excluded.ann3y_wind,
  mdd3y = excluded.mdd3y,
  calmar = excluded.calmar,
  calmar_wind = excluded.calmar_wind,
  scale = COALESCE(excluded.scale, funds.scale),
  nav = COALESCE(excluded.nav, funds.nav),
  track_index = COALESCE(excluded.track_index, funds.track_index),
  track_index_code = COALESCE(excluded.track_index_code, funds.track_index_code),
  index_category = COALESCE(excluded.index_category, funds.index_category),
  index_theme = COALESCE(excluded.index_theme, funds.index_theme),
  index_source = COALESCE(excluded.index_source, funds.index_source),
  tracking_error = COALESCE(excluded.tracking_error, funds.tracking_error),
  estab = COALESCE(excluded.estab, funds.estab),
  source = excluded.source,
  data_date = excluded.data_date,
  updated_at = excluded.updated_at
`;

/** 基金公司简称：「汇添富基金管理股份有限公司」-> 「汇添富」 */
export function shortCompany(name) {
  if (!name) return null;
  return String(name)
    .replace(/(基金管理(股份)?有限公司|基金管理有限责任公司|基金管理有限公司)$/, '')
    .replace(/证券资产管理(股份)?有限公司$/, '')
    .replace(/资产管理(股份)?有限公司$/, '资管')
    .trim();
}

/** 「是否初始基金」在 Wind 里返回的是中文「是/否」，直接当布尔用会把「否」也判成真 */
function parseInitial(v) {
  if (v === true) return 1;
  if (v === false || v == null || v === '') return 0;
  const s = String(v).trim();
  if (['否', '非初始基金', 'false', 'N', 'n', '0'].includes(s)) return 0;
  if (['是', '初始基金', 'true', 'Y', 'y', '1'].includes(s)) return 1;
  const n = Number(s);
  return Number.isFinite(n) && n ? 1 : 0;
}

function rowToRecord(row, cols, dataDate, raw_source) {
  const o = {};
  cols.forEach((c, i) => {
    o[c] = row[i];
  });
  if (!o.code || !o.name) return null;

  // 只采信「近3年累计收益率」，年化与卡玛自行计算（见 metrics.js 口径说明）
  const cum3y = num(o.cum3y);
  const ann3y = cumulativeToAnnual(cum3y, 3);
  const mdd3y = num(o.mdd3y);
  const calmar = calmarRatio(ann3y, mdd3y);

  const idx = classifyIndex(o.idxCode, o.idxName);
  let category = null;
  let theme = null;
  let indexSource = null;
  if (o.idxName || o.idxCode) {
    category = idx.category;
    theme = idx.theme;
    indexSource = idx.source;
  } else if (o.type === '国际(QDII)债券型基金') {
    // 境内跨境债券几乎都不披露跟踪指数，按名称识别区域敞口
    const guess = classifyQdiiBond(o.name);
    category = guess.category;
    theme = guess.theme;
    indexSource = guess.source;
  } else if (o.type === '国际(QDII)另类投资基金') {
    // 跨境另类普遍不披露跟踪指数，按名称识别商品敞口
    const guess = classifyQdiiAlt(o.name);
    if (guess) {
      category = guess.category;
      theme = guess.theme;
      indexSource = guess.source;
    }
  }

  return {
    code: String(o.code).trim(),
    name: String(o.name).trim(),
    company: shortCompany(o.company),
    type_l2: o.type || null,
    is_initial: parseInitial(o.initial),
    purchase_status: o.status || null,
    manager_start: o.mgrStart || null,
    manager_tenure: round(yearsBetween(o.mgrStart, dataDate), 4),
    manager_names: o.mgrNames || null,
    manager_count: o.mgrCount != null ? Number(o.mgrCount) : null,
    cum3y: round(cum3y, 4),
    ann3y: round(ann3y, 4),
    ann3y_wind: round(num(o.ann3yWind), 4),
    mdd3y: round(mdd3y, 4),
    calmar: round(calmar, 4),
    calmar_wind: round(num(o.calmarWind), 4),
    scale: round(num(o.scale), 4),
    nav: round(num(o.nav), 4),
    track_index: o.idxName || null,
    track_index_code: o.idxCode || null,
    index_category: category,
    index_theme: theme,
    index_source: indexSource,
    tracking_error: round(num(o.trackingError), 4),
    estab: o.estab || null,
    source: o.source || raw_source || null,
    data_date: dataDate,
    updated_at: new Date().toISOString(),
  };
}

function num(v) {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[%,]/g, ''));
  return Number.isFinite(n) ? n : null;
}

export function importAll() {
  const files = fs
    .readdirSync(SNAPSHOT_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => path.join(SNAPSHOT_DIR, f));

  if (!files.length) {
    console.log(`[import] ${SNAPSHOT_DIR} 下没有快照文件`);
    return { files: 0, funds: 0 };
  }

  const stmt = db.prepare(UPSERT);
  const seen = new Set();
  const dates = [];
  let total = 0;
  const sources = new Set();
  // 成立年限与规模门槛在导入层执行，采集层只负责把「有完整业绩可算」的宽口径捞全。
  // 这样改门槛（3 年 / 5 年 / 10 年）只改 config/caliber.js，不用重跑几小时的全量采集。
  const skipped = { estab: 0, scale: 0 };

  db.exec('BEGIN');
  try {
    // 快照是全量真相：先清空再重建。UPSERT 不会删除那些「口径收紧后不再达标」的旧记录，
    // 不清表的话，成立 3–5 年那批会继续留在库里并混进池成员。
    db.exec('DELETE FROM funds');
    for (const file of files) {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
      const dataDate = raw.dataDate || raw.fetchedAt || new Date().toISOString().slice(0, 10);
      const cols = raw.cols;
      dates.push(dataDate);
      if (raw.source) sources.add(raw.source);

      const estCutoff = cutoffEstab(dataDate, MIN_TRACK_YEARS);
      setMeta('min_track_years', MIN_TRACK_YEARS);
      setMeta('cutoff_estab', estCutoff);

      for (const row of raw.rows) {
        const rec = rowToRecord(row, cols, dataDate, raw.source);
        if (!rec) continue;
        if (seen.has(rec.code)) continue;
        // 成立日缺失无法确认年限，按不合格处理——宁可少一只，不让资历不明的进池
        if (!estCutoff || !rec.estab || rec.estab > estCutoff) {
          skipped.estab += 1;
          continue;
        }
        if (rec.scale != null && rec.scale < MIN_SCALE_YI) {
          skipped.scale += 1;
          continue;
        }
        seen.add(rec.code);
        stmt.run(rec);
        total += 1;
      }
    }

    // 重新计算池成员关系
    db.exec('DELETE FROM pool_members');
    const allFunds = db.prepare('SELECT code, type_l2, index_category, track_index, track_index_code FROM funds').all();
    const insMember = db.prepare('INSERT OR IGNORE INTO pool_members(pool_id, code) VALUES(?, ?)');
    for (const pool of POOLS) {
      const hasIndex = Array.isArray(pool.indexCategories) && pool.indexCategories.length > 0;
      for (const f of allFunds) {
        if (!pool.types.includes(f.type_l2)) continue;
        if (hasIndex) {
          if (!f.index_category || !pool.indexCategories.includes(f.index_category)) continue;
          if (!pool.allowNoTrackIndex && !f.track_index && !f.track_index_code) continue;
        }
        insMember.run(pool.id, f.code);
      }
    }

    // 清表在前，若一只都没通过说明口径或快照出了问题，宁可回滚也不留空库
    if (total === 0) {
      throw new Error(
        `导入后 0 只基金通过口径（成立满 ${MIN_TRACK_YEARS} 年、规模 ≥ ${MIN_SCALE_YI} 亿），已回滚。` +
          `请检查快照的 dataDate / estab 字段。`
      );
    }

    const dataDate = dates.sort().at(-1);
    setMeta('data_date', dataDate);
    setMeta('synced_at', new Date().toISOString());
    setMeta('source', [...sources].join(', ') || 'Wind');
    bumpDataVersion();
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  return { files: files.length, funds: total, skipped };
}

const isMain = process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('importSnapshot.js');
if (isMain) {
  const r = importAll();
  const n = db.prepare('SELECT COUNT(*) AS n FROM funds').get().n;
  const perPool = db
    .prepare(
      `SELECT pool_id, COUNT(*) AS n FROM pool_members GROUP BY pool_id ORDER BY pool_id`
    )
    .all();
  console.log(`[import] 导入 ${r.files} 个快照，写入 ${r.funds} 只基金，库内共 ${n} 只`);
  console.log(
    `  口径：成立满 ${MIN_TRACK_YEARS} 年、规模 ≥ ${MIN_SCALE_YI} 亿；` +
      `剔除成立年限不足 ${r.skipped.estab} 只、规模不足 ${r.skipped.scale} 只`
  );
  for (const p of perPool) console.log(`  ${p.pool_id.padEnd(26)} ${p.n}`);
}
