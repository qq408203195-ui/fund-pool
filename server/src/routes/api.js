import express from 'express';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { getPoolView, getPoolTrace, listPools, getMetaInfo, getFundDetail } from '../repo.js';
import { POOL_BY_ID } from '../config/pools.js';
import { getMeta } from '../db.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BACKTEST_FILE = path.join(HERE, '..', '..', 'data', 'backtest.json');

/** 回测结果读一次缓存住；文件更新（重跑脚本）后重启进程即可生效 */
let backtestCache;
function loadBacktest() {
  if (backtestCache === undefined) {
    try {
      backtestCache = existsSync(BACKTEST_FILE)
        ? JSON.parse(readFileSync(BACKTEST_FILE, 'utf-8'))
        : null;
    } catch {
      backtestCache = null;
    }
  }
  return backtestCache;
}

export function createApiRouter() {
  const router = express.Router();

  /**
   * 从 query 解析用户可调节的筛选口径。
   * 前端传百分比（mdd=50 表示保留回撤最好的前 50%），后端按比例使用。
   * 业绩窗口三条各自独立：mddYears / returnYears / calmarYears；
   * 老的 years 参数仍接收，作为三者的共同回退值。
   * 未传的项返回 undefined，由 normalizeCriteria 回落到默认值。
   */
  const criteriaOf = (req) => {
    const pct = (v) => (v == null || v === '' ? undefined : Number(v) / 100);
    const n = (v) => (v == null || v === '' ? undefined : Number(v));
    return {
      managerMinYears: n(req.query.mgr),
      mddKeepRatio: pct(req.query.mdd),
      returnKeepRatio: pct(req.query.ret),
      calmarKeepRatio: pct(req.query.cal),
      years: n(req.query.years),
      mddYears: n(req.query.mddYears),
      returnYears: n(req.query.returnYears),
      calmarYears: n(req.query.calmarYears),
      purchaseMode: req.query.purchase === 'loose' ? 'loose' : req.query.purchase === 'strict' ? 'strict' : undefined,
    };
  };

  router.get('/health', (_req, res) => {
    res.json({ ok: true, dataDate: getMeta('data_date', null) });
  });

  router.get('/meta', (_req, res) => {
    res.json(getMetaInfo());
  });

  router.get('/pools', (_req, res) => {
    res.json({ pools: listPools() });
  });

  // 逐层追溯：每一层的完整进出名单，必须在 /pools/:id 之前注册
  router.get('/pools/:id/trace', (req, res) => {
    const id = req.params.id;
    if (!POOL_BY_ID[id]) {
      return res.status(404).json({ error: `未找到池子：${id}` });
    }
    const trace = getPoolTrace(id, criteriaOf(req));
    if (!trace) return res.status(404).json({ error: '池子数据不可用' });
    res.json(trace);
  });

  router.get('/pools/:id', (req, res) => {
    const id = req.params.id;
    if (!POOL_BY_ID[id]) {
      return res.status(404).json({ error: `未找到池子：${id}` });
    }
    const asArray = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);
    const view = getPoolView(id, {
      company: asArray(req.query.company),
      types: asArray(req.query.type),
      q: req.query.q || '',
      mode: req.query.mode,
      ...criteriaOf(req),
    });
    if (!view) return res.status(404).json({ error: '池子数据不可用' });
    res.json(view);
  });

  // 季度轮换回测（斩杀线右上角 5 只等权），数据由 server/scripts/backtest_quarterly.py 生成
  router.get('/backtest', (_req, res) => {
    const doc = loadBacktest();
    if (!doc) return res.status(404).json({ error: '回测数据尚未生成' });
    res.json(doc);
  });

  router.get('/funds/:code', (req, res) => {
    const detail = getFundDetail(req.params.code, criteriaOf(req));
    if (!detail) return res.status(404).json({ error: '未找到该基金' });
    res.json(detail);
  });

  return router;
}
