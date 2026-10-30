import { useEffect, useState } from 'react';
import { api } from '../api';
import type { Criteria, FundDetail } from '../types';
import { fmtNum, fmtPct, fmtScale, fmtYears, fmtPercentile, signClass } from '../utils/format';

interface Props {
  code: string;
  criteria: Criteria;
  onClose: () => void;
  onJumpPool: (poolId: string) => void;
}

export default function FundDrawer({ code, criteria, onClose, onJumpPool }: Props) {
  const [data, setData] = useState<FundDetail | null>(null);
  const [err, setErr] = useState('');
  const { mddYears, returnYears, calmarYears } = criteria;

  useEffect(() => {
    let alive = true;
    setData(null);
    setErr('');
    api
      .fund(code, criteria)
      .then((d) => alive && setData(d))
      .catch((e) => alive && setErr(String(e.message || e)));
    return () => {
      alive = false;
    };
  }, [code, criteria]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <>
      <div className="drawer-mask" onClick={onClose} />
      <div className="drawer">
        <button className="drawer-close" onClick={onClose} aria-label="关闭">
          ✕
        </button>

        {err && (
          <div className="drawer-body">
            <div className="empty">
              <div className="empty-title">加载失败</div>
              <div className="empty-hint">{err}</div>
            </div>
          </div>
        )}

        {!data && !err && (
          <div className="drawer-body">
            <div style={{ display: 'grid', placeItems: 'center', height: 200 }}>
              <div className="spinner" />
            </div>
          </div>
        )}

        {data && (
          <>
            <div className="drawer-head">
              <h2 className="drawer-title">{data.fund.name}</h2>
              <div className="drawer-sub">
                <span className="num">{data.fund.code}</span>
                <span className="type-pill">{data.fund.type_l2?.replace('基金', '')}</span>
                <span>{data.fund.company}</span>
              </div>
            </div>

            <div className="drawer-body">
              <div className="metric-grid">
                <div className="metric-box">
                  <div className="metric-label">近 {returnYears} 年年化收益</div>
                  <div className={`metric-value ${signClass(data.fund.ann3y)}`}>
                    {fmtPct(data.fund.ann3y)}
                  </div>
                  <div className="metric-note">累计 {fmtPct(data.fund.cum3y)}</div>
                </div>
                <div className="metric-box">
                  <div className="metric-label">近 {mddYears} 年最大回撤</div>
                  <div className="metric-value">{fmtPct(data.fund.mdd3y)}</div>
                  <div className="metric-note">区间内峰值到谷底</div>
                </div>
                <div className="metric-box">
                  <div className="metric-label">卡玛比率 · 近 {calmarYears} 年</div>
                  <div className="metric-value">{fmtNum(data.fund.calmar, 3)}</div>
                  <div className="metric-note">Wind 原始值 {fmtNum(data.fund.calmar_wind, 3)}</div>
                </div>
                <div className="metric-box">
                  <div className="metric-label">最新规模</div>
                  <div className="metric-value">{fmtScale(data.fund.scale)}</div>
                  <div className="metric-note">数据日期 {data.fund.data_date ?? '—'}</div>
                </div>
              </div>

              {data.pools.length > 0 && (
                <>
                  <div className="section-label">入榜情况</div>
                  {data.pools.map((p) => (
                    <div className="kv" key={p.poolId}>
                      <span className="kv-k">{p.poolName}</span>
                      <span className="kv-v">
                        第 {p.rank} 位 · 卡玛 {fmtNum(p.calmar, 2)}
                        <button
                          className="btn ghost"
                          style={{ marginLeft: 8, height: 22, padding: '0 6px', fontSize: 11 }}
                          onClick={() => onJumpPool(p.poolId)}
                        >
                          查看 →
                        </button>
                      </span>
                    </div>
                  ))}
                </>
              )}

              <div className="section-label">档案</div>
              <div className="kv">
                <span className="kv-k">申购状态</span>
                <span className="kv-v">{data.fund.purchase_status ?? '—'}</span>
              </div>
              <div className="kv">
                <span className="kv-k">现任基金经理</span>
                <span className="kv-v">{data.fund.manager_names ?? '—'}</span>
              </div>
              <div className="kv">
                <span className="kv-k">最早任职日起算</span>
                <span className="kv-v">
                  {data.fund.manager_start ?? '—'}（{fmtYears(data.fund.manager_tenure)}）
                </span>
              </div>
              <div className="kv">
                <span className="kv-k">是否初始份额</span>
                <span className="kv-v">{data.fund.is_initial ? '是' : '否'}</span>
              </div>
              {data.fund.track_index && (
                <>
                  <div className="kv">
                    <span className="kv-k">跟踪指数</span>
                    <span className="kv-v">
                      {data.fund.track_index} {data.fund.track_index_code ? `(${data.fund.track_index_code})` : ''}
                    </span>
                  </div>
                  <div className="kv">
                    <span className="kv-k">指数分类</span>
                    <span className="kv-v">{data.fund.index_category ?? '—'}</span>
                  </div>
                  <div className="kv">
                    <span className="kv-k">近 1 年跟踪误差</span>
                    <span className="kv-v">{fmtPct(data.fund.tracking_error)}</span>
                  </div>
                </>
              )}

              <div className="section-label">口径说明</div>
              <div className="kv">
                <span className="kv-k">业绩窗口</span>
                <span className="kv-v">
                  收益 {returnYears} 年 · 回撤 {mddYears} 年 · 卡玛 {calmarYears} 年（跟随页面筛选口径）
                </span>
              </div>
              <div className="kv">
                <span className="kv-k">年化收益</span>
                <span className="kv-v">近 {returnYears} 年累计涨幅折几何年化</span>
              </div>
              <div className="kv">
                <span className="kv-k">卡玛比率</span>
                <span className="kv-v">年化收益 ÷ |最大回撤|</span>
              </div>
              <div className="kv">
                <span className="kv-k">分位口径</span>
                <span className="kv-v">池内排名，非 Wind 同类</span>
              </div>
            </div>
          </>
        )}
      </div>
    </>
  );
}
