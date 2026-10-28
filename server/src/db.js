import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const DATA_DIR = path.resolve(__dirname, '..', 'data');
export const SNAPSHOT_DIR = path.join(DATA_DIR, 'snapshot');
export const DB_PATH = path.join(DATA_DIR, 'fundpool.db');

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });

export const db = new DatabaseSync(DB_PATH);

db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS funds (
  code                TEXT PRIMARY KEY,
  name                TEXT NOT NULL,
  company             TEXT,
  type_l2             TEXT,
  is_initial          INTEGER DEFAULT 0,
  purchase_status     TEXT,
  manager_start       TEXT,
  manager_tenure      REAL,
  manager_names       TEXT,
  manager_count       INTEGER,

  cum3y               REAL,
  ann3y               REAL,
  ann3y_wind          REAL,
  mdd3y               REAL,
  calmar              REAL,
  calmar_wind         REAL,

  scale               REAL,
  nav                 REAL,

  track_index         TEXT,
  track_index_code    TEXT,
  index_category      TEXT,
  index_theme         TEXT,
  index_source        TEXT,
  tracking_error      REAL,

  estab               TEXT,
  source              TEXT,

  data_date           TEXT,
  updated_at          TEXT
);

CREATE INDEX IF NOT EXISTS idx_funds_type     ON funds(type_l2);
CREATE INDEX IF NOT EXISTS idx_funds_company  ON funds(company);
CREATE INDEX IF NOT EXISTS idx_funds_calmar   ON funds(calmar DESC);
`);

// 老库补列（CREATE TABLE IF NOT EXISTS 不会给已有表加字段）
for (const [col, decl] of [
  ['estab', 'TEXT'],
  ['source', 'TEXT'],
]) {
  const cols = db.prepare('PRAGMA table_info(funds)').all().map((c) => c.name);
  if (!cols.includes(col)) db.exec(`ALTER TABLE funds ADD COLUMN ${col} ${decl}`);
}

db.exec(`
CREATE TABLE IF NOT EXISTS pool_members (
  pool_id  TEXT NOT NULL,
  code     TEXT NOT NULL,
  PRIMARY KEY (pool_id, code)
);

CREATE INDEX IF NOT EXISTS idx_pm_pool ON pool_members(pool_id);

CREATE TABLE IF NOT EXISTS sync_meta (
  key    TEXT PRIMARY KEY,
  value  TEXT
);
`);

export function setMeta(key, value) {
  db.prepare(
    'INSERT INTO sync_meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(key, typeof value === 'string' ? value : JSON.stringify(value));
}

export function getMeta(key, fallback = null) {
  const row = db.prepare('SELECT value FROM sync_meta WHERE key = ?').get(key);
  if (!row) return fallback;
  try {
    return JSON.parse(row.value);
  } catch {
    return row.value;
  }
}

export function countFunds() {
  return db.prepare('SELECT COUNT(*) AS n FROM funds').get().n;
}

export function dataVersion() {
  return getMeta('data_version', 0);
}

export function bumpDataVersion() {
  const next = Number(dataVersion()) + 1;
  setMeta('data_version', next);
  return next;
}
