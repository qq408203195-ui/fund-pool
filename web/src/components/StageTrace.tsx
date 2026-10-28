import { useMemo, useState } from 'react';
import type { PoolTrace, TraceRow, TraceStage } from '../types';
import { fmtNum, fmtPct, fmtScale, fmtYears, signClass } from '../utils/format';

type ResultFilter = 'all' | 'pass' | 'drop';

/**
 * 逐层追溯面板
 *
 * 每一层都给出「进入本层的完整名单 + 本层判定结果」，
 * 而不是只给一个剩余数量——这样「某只基金为什么没进榜」可以被逐条回答。
 * 第一层按投资类型分组呈现，其余层按本层指标（回撤排名 / 收益排名 / 卡玛）排列。
 */
export default function StageTrace({
  trace,
  stageKey,
  onSelectFund,
}: {
  trace: PoolTrace;
  stageKey: string;
  onSelectFund: (code: string) => void;
}) {
  const stage = trace.stages.find((s) => s.key === stageKey) ?? trace.stages[0];
  const [typeFilter, setTypeFilter] = useState<string>('全部');
  const [resultFilter, setResultFilter] = useState<ResultFilter>('all');

  const isUniverse = stage.key === 'universe';

  /**
   * 分组维度自适应。
   * 主动池里同一只产品的投资类型才有区分度（普通股票 / 偏股混合 / 灵活配置…），按类型分组。
   * 被动池的投资类型全都一样（被动指数型），真正的区分度在跟踪指数（沪深300 / 中证500 / 科创50…），
   * 所以按指数主题分组，否则整页只会有一个「被动指数型基金」的大分组。
   */
  const groupField: 'typeL2' | 'indexTheme' =
    stage.types.length <= 1 && stage.rows.some((r) => r.indexTheme) ? 'indexTheme' : 'typeL2';

  // 切换层时重置筛选，避免上一层选中的分组在下一层不存在导致空白
  const [lastStage, setLastStage] = useState(stage.key);
  if (lastStage !== stage.key) {
    setLastStage(stage.key);
    setTypeFilter('全部');
    setResultFilter('all');
  }

  const options = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of stage.rows) {
      const k = String(r[groupField] || '未分类');
      m.set(k, (m.get(k) || 0) + 1);
    }
    return [...m.entries()]
      .map(([key, count]) => ({ key, count }))
      .sort((a, b) => b.count - a.count);
  }, [stage, groupField]);

  /**
   * 分组是否值得展示。平均每组不足 2 只时，分组标题比内容还多，
   * 直接平铺反而更好读（这种情况通常意味着主题字段没归好类）。
   */
  const canGroup = options.length > 1 && stage.rows.length / options.length >= 2;

  const rows = useMemo(() => {
    let out = stage.rows;
    if (typeFilter !== '全部') out = out.filter((r) => String(r[groupField] || '未分类') === typeFilter);
    if (!isUniverse && resultFilter === 'pass') out = out.filter((r) => r.ok);
    if (!isUniverse && resultFilter === 'drop') out = out.filter((r) => !r.ok);
    return out;
  }, [stage, typeFilter, resultFilter, isUniverse, groupField]);

  // 第一层在「全部分组」下按分组维度分段，段序即后端排好的顺序
  const groups = useMemo(() => {
    if (!isUniverse || typeFilter !== '全部' || !canGroup) return null;
    const map = new Map<string, TraceRow[]>();
    for (const r of rows) {
      const k = String(r[groupField] || '未分类');
      const list = map.get(k) || [];
      list.push(r);
      map.set(k, list);
    }
    return [...map.entries()];
  }, [rows, isUniverse, typeFilter, groupField, canGroup]);

  return (
    <div className="trace-card">
      <div className="trace-head">
        <div>
          <div className="card-title">
            第 {trace.stages.indexOf(stage) + 1} 层 · {stage.label}
            {isUniverse ? (
              <span className="trace-flow">
                共 <b>{stage.input}</b> 只
              </span>
            ) : (
              <span className="trace-flow">
                进入 <b>{stage.input}</b> → 通过 <b className="pos-ok">{stage.passed}</b>
                {stage.dropped > 0 && (
                  <>
                    {' '}
                    → 剔除 <b className="pos-cut">{stage.dropped}</b>
                  </>
                )}
              </span>
            )}
          </div>
          <p className="trace-desc">{stage.desc}</p>
        </div>
      </div>

      <div className="trace-filters">
        {!isUniverse && (
          <div className="trace-chips">
            <Chip active={resultFilter === 'all'} onClick={() => setResultFilter('all')}>
              全部 {stage.input}
            </Chip>
            <Chip active={resultFilter === 'pass'} onClick={() => setResultFilter('pass')}>
              通过 {stage.passed}
            </Chip>
            <Chip active={resultFilter === 'drop'} onClick={() => setResultFilter('drop')} tone="cut">
              剔除 {stage.dropped}
            </Chip>
          </div>
        )}
        {canGroup && (
          <div className="trace-chips">
            <Chip active={typeFilter === '全部'} onClick={() => setTypeFilter('全部')}>
              {groupField === 'indexTheme' ? '全部指数' : '全部类型'}
            </Chip>
            {options.map((t) => (
              <Chip key={t.key} active={typeFilter === t.key} onClick={() => setTypeFilter(t.key)}>
                {shortType(t.key)} {t.count}
              </Chip>
            ))}
          </div>
        )}
      </div>

      <div className="trace-table-wrap">
        <table className="table trace-table">
          <thead>
            <tr>
              <th style={{ width: 44 }}>#</th>
              <th>基金</th>
              <th style={{ width: 96 }}>{groupField === 'indexTheme' ? '指数 / 主题' : '类型'}</th>
              <th style={{ width: 100 }}>公司</th>
              <th style={{ width: 116 }}>申购状态</th>
              <th style={{ width: 76 }}>经理年限</th>
              <th style={{ width: 84 }}>近3年年化</th>
              <th style={{ width: 88 }}>近3年回撤</th>
              <th style={{ width: 64 }}>卡玛</th>
              <th style={{ width: 128 }}>本层结论</th>
            </tr>
          </thead>
          <tbody>
            {groups
              ? groups.map(([type, list]) => (
                  <GroupRows
                    key={type}
                    type={type}
                    list={list}
                    onSelectFund={onSelectFund}
                    showTheme={groupField === 'indexTheme'}
                  />
                ))
              : rows.map((r, i) => (
                  <Row
                    key={r.code}
                    row={r}
                    index={i + 1}
                    onSelectFund={onSelectFund}
                    isUniverse={isUniverse}
                    showTheme={groupField === 'indexTheme'}
                  />
                ))}
          </tbody>
        </table>
        {rows.length === 0 && <div className="trace-empty">当前筛选条件下没有基金。</div>}
      </div>
    </div>
  );
}

function GroupRows({
  type,
  list,
  onSelectFund,
  showTheme,
}: {
  type: string;
  list: TraceRow[];
  onSelectFund: (code: string) => void;
  showTheme: boolean;
}) {
  return (
    <>
      <tr className="trace-group-row">
        <td colSpan={10}>
          <span className="trace-group-name">{type}</span>
          <span className="trace-group-count">{list.length} 只</span>
        </td>
      </tr>
      {list.map((r, i) => (
        <Row key={r.code} row={r} index={i + 1} onSelectFund={onSelectFund} isUniverse showTheme={showTheme} />
      ))}
    </>
  );
}

function Row({
  row,
  index,
  onSelectFund,
  isUniverse,
  showTheme,
}: {
  row: TraceRow;
  index: number;
  onSelectFund: (code: string) => void;
  isUniverse?: boolean;
  showTheme?: boolean;
}) {
  return (
    <tr onClick={() => onSelectFund(row.code)} className={row.ok ? '' : 'trace-row-dropped'}>
      <td className="cell-rank">
        {row.layerRank != null ? (
          <span className="rank-mini">{row.layerRank}</span>
        ) : (
          <span className="rank-mini muted">{index}</span>
        )}
      </td>
      <td>
        <div className="fund-name">{row.name}</div>
        <div className="fund-sub">
          {row.code}
          {row.scale != null && <span className="dot-sep">·</span>}
          {row.scale != null && fmtScale(row.scale)}
          {row.trackIndex && <span className="dot-sep">·</span>}
          {row.trackIndex && (row.indexTheme || row.trackIndex)}
        </div>
      </td>
      <td>
        <span className="type-pill">
          {showTheme ? row.indexTheme || shortType(row.typeL2) : shortType(row.typeL2)}
        </span>
      </td>
      <td className="cell-company">{row.company}</td>
      <td>
        <span className={`status-pill${row.purchaseStatus === '开放申购' ? ' ok' : ''}`}>
          {row.purchaseStatus || '—'}
        </span>
      </td>
      <td className="num">{fmtYears(row.managerTenure)}</td>
      <td className={`num ${signClass(row.ann3y)}`}>{fmtPct(row.ann3y)}</td>
      <td className="num">{fmtPct(row.mdd3y)}</td>
      <td className="num strong">{fmtNum(row.calmar)}</td>
      <td>
        {row.ok ? (
          isUniverse ? (
            <span className="verdict neutral">在池</span>
          ) : row.layerRank != null ? (
            <span className="verdict pass">
              通过 · 排 {row.layerRank}/{row.layerTotal}
            </span>
          ) : (
            <span className="verdict pass">通过</span>
          )
        ) : (
          <span className="verdict cut" title={row.reason || ''}>
            {row.reason}
          </span>
        )}
      </td>
    </tr>
  );
}

function Chip({
  active,
  onClick,
  children,
  tone,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  tone?: 'cut';
}) {
  return (
    <button
      type="button"
      className={`trace-chip${active ? ' active' : ''}${tone === 'cut' ? ' cut' : ''}`}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

/** 「普通股票型基金」→「普通股票」，表格里只为省宽度，不改变语义 */
export function shortType(t: string): string {
  return String(t || '')
    .replace(/型基金$/, '')
    .replace(/基金$/, '')
    .replace(/^国际\(QDII\)/, 'QDII')
    .trim();
}
