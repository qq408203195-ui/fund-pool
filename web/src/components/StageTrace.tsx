import { useMemo, useState } from 'react';
import type { PoolTrace, TraceRow, TraceStage } from '../types';
import { fmtNum, fmtPct, fmtScale, fmtYears, signClass } from '../utils/format';

type ResultFilter = 'all' | 'pass' | 'drop';
type SortKey = 'managerTenure' | 'ann3y' | 'mdd3y' | 'calmar';

/**
 * 逐层追溯面板
 *
 * 每一层都给出「进入本层的完整名单」，而不是只给一个剩余数量——
 * 这样「某只基金为什么没进榜」可以被逐条回答。
 * 第一层按投资类型分组呈现，其余层按本层指标排列。
 *
 * 通过/剔除不再单占一列（那是整列最宽却信息最少的一列），
 * 改为行首状态点 + 行淡出 + 悬停提示，把宽度让给基金经理与可排序指标。
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
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [asc, setAsc] = useState(false);

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
    setSortKey(null);
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

  const clickSort = (k: SortKey) => {
    if (k === sortKey) setAsc((v) => !v);
    else {
      setSortKey(k);
      setAsc(false); // 首点一律「最优在前」：年限长的、收益高的、回撤小的、卡玛高的
    }
  };

  const rows = useMemo(() => {
    let out = stage.rows;
    if (typeFilter !== '全部') out = out.filter((r) => String(r[groupField] || '未分类') === typeFilter);
    if (!isUniverse && resultFilter === 'pass') out = out.filter((r) => r.ok);
    if (!isUniverse && resultFilter === 'drop') out = out.filter((r) => !r.ok);
    if (sortKey) {
      const arr = [...out];
      arr.sort((a, b) => {
        const av = a[sortKey];
        const bv = b[sortKey];
        if (av == null && bv == null) return 0;
        if (av == null) return 1; // 缺失值永远垫底，不参与升/降序翻转
        if (bv == null) return -1;
        return asc ? (av > bv ? 1 : av < bv ? -1 : 0) : av < bv ? 1 : av > bv ? -1 : 0;
      });
      return arr;
    }
    return out;
  }, [stage, typeFilter, resultFilter, isUniverse, groupField, sortKey, asc]);

  // 第一层在「全部分组」下按分组维度分段，段序即后端排好的顺序；
  // 一旦用户点了排序，就平铺展示——跨组比较才有意义，组内各排各的会让人读不明白
  const groups = useMemo(() => {
    if (!isUniverse || typeFilter !== '全部' || !canGroup || sortKey) return null;
    const map = new Map<string, TraceRow[]>();
    for (const r of rows) {
      const k = String(r[groupField] || '未分类');
      const list = map.get(k) || [];
      list.push(r);
      map.set(k, list);
    }
    return [...map.entries()];
  }, [rows, isUniverse, typeFilter, groupField, canGroup, sortKey]);

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
        {sortKey && (
          <div className="trace-chips">
            <Chip active onClick={() => setSortKey(null)}>
              已按{sortLabel(sortKey)}排序 · 点此还原
            </Chip>
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
              <th style={{ width: 108 }}>申购状态</th>
              <th style={{ width: 116 }}>基金经理</th>
              <SortTh k="managerTenure" label="经理年限" w={84} sortKey={sortKey} asc={asc} onClick={clickSort} />
              <SortTh k="ann3y" label="近3年年化" w={92} sortKey={sortKey} asc={asc} onClick={clickSort} />
              <SortTh k="mdd3y" label="近3年回撤" w={96} sortKey={sortKey} asc={asc} onClick={clickSort} />
              <SortTh k="calmar" label="卡玛" w={72} sortKey={sortKey} asc={asc} onClick={clickSort} />
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

function sortLabel(k: SortKey): string {
  return { managerTenure: '经理年限', ann3y: '年化收益', mdd3y: '最大回撤', calmar: '卡玛比率' }[k];
}

function SortTh({
  k,
  label,
  w,
  sortKey,
  asc,
  onClick,
}: {
  k: SortKey;
  label: string;
  w: number;
  sortKey: SortKey | null;
  asc: boolean;
  onClick: (k: SortKey) => void;
}) {
  const active = sortKey === k;
  return (
    <th
      style={{ width: w }}
      className={`sortable${active ? ' sorted' : ''}`}
      onClick={() => onClick(k)}
      title={`点击按${label}排序`}
    >
      {label}
      <span className={`sort-arrow${active ? ' on' : ''}`}>{active ? (asc ? '▲' : '▼') : '⇅'}</span>
    </th>
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
  const dropped = !row.ok;
  return (
    <tr
      onClick={() => onSelectFund(row.code)}
      className={dropped ? 'trace-row-dropped' : ''}
      title={dropped ? `本层剔除：${row.reason || '未通过'}` : undefined}
    >
      <td className="cell-rank">
        <span className="rank-cell">
          {row.layerRank != null ? (
            <span className="rank-mini">{row.layerRank}</span>
          ) : (
            <span className="rank-mini muted">{index}</span>
          )}
          {!isUniverse && <span className={`dot-state ${dropped ? 'cut' : 'ok'}`} />}
        </span>
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
      <td className="cell-manager" title={row.managerNames || ''}>
        {row.managerNames || '—'}
      </td>
      <td className="num">{fmtYears(row.managerTenure)}</td>
      <td className={`num ${signClass(row.ann3y)}`}>{fmtPct(row.ann3y)}</td>
      <td className="num">{fmtPct(row.mdd3y)}</td>
      <td className="num strong">{fmtNum(row.calmar)}</td>
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
