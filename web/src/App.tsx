import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from './api';
import type { MetaInfo, PoolTrace, PoolView } from './types';
import Sidebar from './components/Sidebar';
import Funnel, { type StageKey } from './components/Funnel';
import StageTrace from './components/StageTrace';
import CompanyFilter from './components/CompanyFilter';
import FundTable from './components/FundTable';
import Scatter from './components/Scatter';
import FundDrawer from './components/FundDrawer';
import EmptyState from './components/EmptyState';
import { fmtPercentile } from './utils/format';

const DEFAULT_POOL = 'active-equity';

export default function App() {
  const [meta, setMeta] = useState<MetaInfo | null>(null);
  const [poolId, setPoolId] = useState<string>(() => window.location.hash.slice(1) || DEFAULT_POOL);
  const [view, setView] = useState<PoolView | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  const [selectedCompanies, setSelectedCompanies] = useState<string[]>([]);
  const [q, setQ] = useState('');
  const [mode, setMode] = useState<'filter' | 'recompute'>('filter');
  const [showScatter, setShowScatter] = useState(true);
  const [drawerCode, setDrawerCode] = useState<string | null>(null);

  // 逐层追溯：默认展开第一层，让「池子里都有哪些基金」开屏即可见
  // ?stage=passMdd 这类链接可直接定位到某一层，方便分享具体某一步的结果
  const [trace, setTrace] = useState<PoolTrace | null>(null);
  const [traceErr, setTraceErr] = useState('');
  const [activeStage, setActiveStage] = useState<StageKey>(() => {
    const s = new URLSearchParams(window.location.search).get('stage');
    const allowed: StageKey[] = ['universe', 'passPurchase', 'passManager', 'passMdd', 'passReturn', 'selected'];
    return allowed.includes(s as StageKey) ? (s as StageKey) : 'universe';
  });
  const [showTrace, setShowTrace] = useState(true);

  useEffect(() => {
    api
      .meta()
      .then(setMeta)
      .catch((e) => setErr(String(e.message || e)));
  }, []);

  useEffect(() => {
    const onHash = () => setPoolId(window.location.hash.slice(1) || DEFAULT_POOL);
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const selectPool = useCallback((id: string) => {
    window.location.hash = id;
    setPoolId(id);
    setSelectedCompanies([]);
    setQ('');
    setActiveStage('universe');
  }, []);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setErr('');
    api
      .pool(poolId, { company: selectedCompanies, q, mode })
      .then((v) => {
        if (!alive) return;
        setView(v);
        setLoading(false);
      })
      .catch((e) => {
        if (!alive) return;
        setErr(String(e.message || e));
        setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [poolId, selectedCompanies, q, mode]);

  useEffect(() => {
    let alive = true;
    setTrace(null);
    setTraceErr('');
    api
      .trace(poolId)
      .then((t) => {
        if (alive) setTrace(t);
      })
      .catch((e) => {
        if (alive) setTraceErr(String(e.message || e));
      });
    return () => {
      alive = false;
    };
  }, [poolId]);

  const totalSelected = useMemo(
    () => meta?.pools.reduce((s, p) => s + p.selected, 0) ?? 0,
    [meta]
  );

  return (
    <div className="app">
      <Sidebar meta={meta} activePool={poolId} onSelect={selectPool} />

      <main className="main">
        <div className="main-inner">
          {err && (
            <div className="note-banner" style={{ borderColor: '#f2c9c4', background: '#fdf1ef', color: '#8f2f22' }}>
              <span>⚠</span>
              <span>{err}</span>
            </div>
          )}

          {view && (
            <>
              <div className="pool-head">
                <div>
                  <div className="pool-title-row">
                    <h1 className="pool-title">{view.pool.name}</h1>
                    <span className="pool-badge">{view.pool.badge}</span>
                  </div>
                  <p className="pool-desc">{view.pool.desc}</p>
                  <div className="pool-meta">
                    <span className="chip">
                      数据日期 <b>{meta?.dataDate ?? '—'}</b>
                    </span>
                    <span className="chip">
                      池内样本 <b>{view.stats.universe}</b>
                    </span>
                    <span className="chip">
                      入榜 <b>{view.items.length}</b>
                    </span>
                    <span className="chip">
                      池内公司 <b>{view.companies.length}</b>
                    </span>
                  </div>
                </div>
              </div>

              <Funnel
                stats={view.stats}
                active={activeStage}
                onSelect={(k) => {
                  setActiveStage(k);
                  setShowTrace(true);
                }}
              />

              {/* 池子被筛空时，原因必须顶在最前面。否则用户要先滚过几十行逐层明细
                  才能看到一句话解释，容易误读成页面坏了。 */}
              {!loading && view.items.length === 0 && (
                <EmptyState
                  view={view}
                  hasFilter={selectedCompanies.length > 0 || !!q}
                  onClearFilter={() => {
                    setSelectedCompanies([]);
                    setQ('');
                  }}
                  onRecompute={() => setMode('recompute')}
                />
              )}

              <div className="note-banner">
                <span>◈</span>
                <span>
                  <b>池内样本口径</b>：初始基金份额（同一只基金的 A/C/E 类不重复占位）、
                  成立满 {meta?.caliber.minTrackYears ?? 5} 年、最新规模 ≥ {meta?.caliber.minScaleYi ?? 2} 亿元（剔除迷你基金）。
                  <br />
                  <b>筛选管线</b>：可买入（开放申购 / 场内交易）→ 经理满 3 年 → 剔除近 3 年最大回撤排名池内后 50% → 剔除近 3 年年化收益排名后 50% → 按卡玛比率降序。
                  「同类」口径为<b>池内排名</b>，不是 Wind 二级分类同类。年化收益由近 3 年累计涨幅折算几何年化，卡玛比率 = 年化收益 ÷ |最大回撤|。
                  <br />
                  <b>收益口径</b>：近 3 年涨幅与最大回撤均由<b>复权净值</b>逐日重算（分红按再投资处理）。
                  抽样与 Wind 复权净值增长率对账：最大回撤误差 ≤ 0.03 个百分点，区间收益相对误差 &lt; 2%
                  （残差来自日增长率保留两位小数后的累乘）。
                  {(view.stats.managerUnknown ?? 0) > 0 && (
                    <>
                      <br />
                      <b style={{ color: '#a5601c' }}>数据缺口</b>：当前 {view.stats.managerUnknown} 只基金的基金经理任职起始日在东财口径下缺失，
                      「经理满 3 年」这一步暂按待核放行，页面不对其做剔除。该列由东财 F10 经理变动页逐只回填，回填后重新出榜。
                    </>
                  )}
                </span>
              </div>

              <div className="trace-section">
                <div className="trace-bar">
                  <span className="trace-bar-title">筛选过程逐层追溯</span>
                  <span className="card-hint">点上方漏斗任意一层，看该层完整名单</span>
                  <div className="spacer" />
                  <button className="btn ghost sm" onClick={() => setShowTrace((v) => !v)}>
                    {showTrace ? '收起明细' : '展开明细'}
                  </button>
                </div>
                {showTrace &&
                  (trace ? (
                    <StageTrace trace={trace} stageKey={activeStage} onSelectFund={setDrawerCode} />
                  ) : (
                    <div className="trace-empty">{traceErr ? `逐层明细加载失败：${traceErr}` : '逐层明细加载中…'}</div>
                  ))}
              </div>

              <div className="toolbar">
                <div className="search-box">
                  <span className="search-icon">
                    <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
                      <circle cx="7" cy="7" r="4.6" stroke="currentColor" strokeWidth="1.5" />
                      <path d="M10.6 10.6L14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                    </svg>
                  </span>
                  <input
                    placeholder="搜索基金名称、代码、公司或跟踪指数"
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                  />
                </div>

                <CompanyFilter
                  companies={view.companies}
                  selected={selectedCompanies}
                  onChange={setSelectedCompanies}
                />

                <button
                  className={`btn${mode === 'recompute' ? ' active' : ''}`}
                  onClick={() => setMode(mode === 'recompute' ? 'filter' : 'recompute')}
                  title="开启后，先用筛选条件缩小样本，再在这个范围内重跑整条筛选管线"
                >
                  {mode === 'recompute' ? '范围内重新优选' : '仅过滤视图'}
                </button>

                <button className={`btn${showScatter ? ' active' : ''}`} onClick={() => setShowScatter((v) => !v)}>
                  分布图
                </button>

                {(selectedCompanies.length > 0 || q) && (
                  <button
                    className="btn ghost"
                    onClick={() => {
                      setSelectedCompanies([]);
                      setQ('');
                    }}
                  >
                    重置
                  </button>
                )}

                <div className="spacer" />
                <span className="result-count">
                  当前 <b>{view.items.length}</b> / {view.stats.selected} 只
                </span>
              </div>

              {selectedCompanies.length > 0 && (
                <div className="selected-tags">
                  {selectedCompanies.map((c) => (
                    <span className="tag" key={c}>
                      {c}
                      <button onClick={() => setSelectedCompanies(selectedCompanies.filter((x) => x !== c))}>
                        ✕
                      </button>
                    </span>
                  ))}
                </div>
              )}

              {showScatter && view.items.length > 1 && (
                <Scatter items={view.items} onSelect={setDrawerCode} />
              )}

              {loading && !view ? (
                <div className="loading">
                  <div>
                    <div className="spinner" style={{ margin: '0 auto 10px' }} />
                    加载中
                  </div>
                </div>
              ) : view.items.length === 0 ? null : (
                <FundTable items={view.items} onSelect={setDrawerCode} />
              )}

              {view.rejects.length > 0 && (
                <div className="reject-card">
                  <div className="card-head">
                    <span className="card-title">本池剔除明细</span>
                    <span className="card-hint">
                      共剔除 {view.rejects.reduce((s, r) => s + r.count, 0)} 只（含重复份额）
                    </span>
                  </div>
                  <div className="reject-list">
                    {view.rejects.map((r) => (
                      <div className="reject-row" key={r.reason}>
                        <span className="reject-name">
                          {r.reason}
                          <div className="reject-samples">
                            {r.samples.map((s) => s.name).join('、')}
                            {r.count > r.samples.length ? ' 等' : ''}
                          </div>
                        </span>
                        <span className="reject-cnt">{r.count}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {meta && (
                <div className="card-hint" style={{ marginTop: 18, lineHeight: 1.8 }}>
                  全库 {meta.totalFunds} 只基金 · {meta.pools.length} 个池合计入榜 {totalSelected} 只 ·
                  回撤分位与收益分位均为池内百分位（越高越好）
                  {view.items[0]?.mddPercentile != null &&
                    ` · 榜首回撤分位 ${fmtPercentile(view.items[0].mddPercentile)}`}
                </div>
              )}
            </>
          )}

          {!view && loading && (
            <div className="loading">
              <div>
                <div className="spinner" style={{ margin: '0 auto 10px' }} />
                正在加载基金池
              </div>
            </div>
          )}
        </div>
      </main>

      {drawerCode && (
        <FundDrawer
          code={drawerCode}
          onClose={() => setDrawerCode(null)}
          onJumpPool={(id) => {
            selectPool(id);
            setDrawerCode(null);
          }}
        />
      )}
    </div>
  );
}
