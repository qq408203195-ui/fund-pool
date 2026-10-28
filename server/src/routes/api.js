import express from 'express';
import { getPoolView, getPoolTrace, listPools, getMetaInfo, getFundDetail } from '../repo.js';
import { POOL_BY_ID } from '../config/pools.js';
import { getMeta } from '../db.js';

export function createApiRouter() {
  const router = express.Router();

  /**
   * 从 query 解析用户可调节的筛选口径。
   * 前端传百分比（mdd=50 表示保留回撤最好的前 50%），后端按比例使用。
   * 未传的项返回 undefined，由 normalizeCriteria 回落到默认值。
   */
  const criteriaOf = (req) => {
    const pct = (v) => (v == null || v === '' ? undefined : Number(v) / 100);
    return {
      managerMinYears: req.query.mgr == null || req.query.mgr === '' ? undefined : Number(req.query.mgr),
      mddKeepRatio: pct(req.query.mdd),
      returnKeepRatio: pct(req.query.ret),
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

  router.get('/funds/:code', (req, res) => {
    const detail = getFundDetail(req.params.code);
    if (!detail) return res.status(404).json({ error: '未找到该基金' });
    res.json(detail);
  });

  return router;
}
