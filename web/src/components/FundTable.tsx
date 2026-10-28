import { useMemo, useState } from 'react';
import type { FundItem } from '../types';
import { fmtPct, fmtNum, fmtScale, fmtYears, fmtPercentile, pctWidth, signClass } from '../utils/format';

type SortKey = 'rank' | 'ann3y' | 'mdd3y' | 'calmar' | 'mddPercentile' | 'returnPercentile' | 'scale' | 'managerTenure';

const COLS: { key: SortKey; label: string; align?: 'r'; hide?: string; title?: string }[] = [
  { key: 'rank', label: '#', hide: '' },
  { key: 'ann3y', label: '年化收益', align: 'r', title: '近 3 年累计收益折算几何年化' },
  { key: 'mdd3y', label: '最大回撤', align: 'r' },
  { key: 'calmar', label: '卡玛', align: 'r', title: '年化收益 ÷ 最大回撤' },
  { key: 'mddPercentile', label: '回撤分位', align: 'r', hide: 'col-hide-md', title: '池内分位，越高代表回撤控制越好' },
  { key: 'returnPercentile', label: '收益分位', align: 'r', hide: 'col-hide-md' },
  { key: 'scale', label: '规模', align: 'r', hide: 'col-hide-sm' },
  { key: 'managerTenure', label: '经理年限', align: 'r', hide: 'col-hide-md' },
];

interface Props {
  items: FundItem[];
  onSelect: (code: string) => void;
}

export default function FundTable({ items, onSelect }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>('rank');
  const [asc, setAsc] = useState(true);

  const sorted = useMemo(() => {
    const arr = [...items];
    arr.sort((a, b) => {
      const av = (a as any)[sortKey];
      const bv = (b as any)[sortKey];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      return asc ? (av > bv ? 1 : av < bv ? -1 : 0) : av < bv ? 1 : av > bv ? -1 : 0;
    });
    return arr;
  }, [items, sortKey, asc]);

  const clickSort = (k: SortKey) => {
    if (k === sortKey) setAsc((v) => !v);
    else {
      setSortKey(k);
      setAsc(k === 'rank');
    }
  };

  if (!items.length) {
    return (
      <div className="table-card">
        <div className="empty">
          <div className="empty-title">当前筛选条件下没有基金</div>
          <div className="empty-hint">
            试试减少基金公司筛选，或切换到「在此范围内重新优选」模式
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="table-card">
      <div className="table-wrap">
        <table className="fund-table">
          <thead>
            <tr>
              <th style={{ width: 46 }} className="sortable" onClick={() => clickSort('rank')}>
                #
                {sortKey === 'rank' && <span className="arrow">{asc ? '▲' : '▼'}</span>}
              </th>
              <th>基金</th>
              <th className="col-hide-sm">公司</th>
              <th className="col-hide-md">基金经理</th>
              {COLS.filter((c) => c.key !== 'rank').map((c) => (
                <th
                  key={c.key}
                  className={`sortable ${c.align === 'r' ? 'r' : ''} ${c.hide ?? ''}`}
                  onClick={() => clickSort(c.key)}
                  title={c.title}
                >
                  {c.label}
                  {sortKey === c.key && <span className="arrow">{asc ? '▲' : '▼'}</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((f) => (
              <tr key={f.code} onClick={() => onSelect(f.code)}>
                <td>
                  <span className={`rank${f.rank <= 3 ? ` top${f.rank}` : ''}`}>{f.rank}</span>
                </td>
                <td>
                  <div className="fund-cell">
                    <div className="fund-name">{f.name}</div>
                    <div className="fund-sub">
                      <span className="num">{f.code}</span>
                      <span className="type-pill">{f.typeL2?.replace('基金', '') ?? '—'}</span>
                      {f.purchaseStatus && f.purchaseStatus !== '开放申购' && (
                        <span className="type-pill" style={{ background: '#fdf1e7', color: '#a9651b' }}>
                          {f.purchaseStatus}
                        </span>
                      )}
                    </div>
                  </div>
                </td>
                <td className="col-hide-sm" style={{ color: 'var(--ink-2)' }}>
                  {f.company ?? '—'}
                </td>
                <td className="col-hide-md cell-manager" title={f.managerNames || ''}>
                  {f.managerNames || '—'}
                </td>
                <td className={`r num ${signClass(f.ann3y)}`}>{fmtPct(f.ann3y)}</td>
                <td className="r num">{fmtPct(f.mdd3y)}</td>
                <td className="r num calmar-cell">{fmtNum(f.calmar, 2)}</td>
                <td className="r col-hide-md">
                  <div className="pct">
                    <span className="pct-bar">
                      <span className="pct-fill" style={{ width: `${pctWidth(f.mddPercentile)}%` }} />
                    </span>
                    <span className="pct-text">{fmtPercentile(f.mddPercentile)}</span>
                  </div>
                </td>
                <td className="r col-hide-md">
                  <div className="pct">
                    <span className="pct-bar">
                      <span className="pct-fill" style={{ width: `${pctWidth(f.returnPercentile)}%` }} />
                    </span>
                    <span className="pct-text">{fmtPercentile(f.returnPercentile)}</span>
                  </div>
                </td>
                <td className="r num col-hide-sm">{fmtScale(f.scale)}</td>
                <td className="r num col-hide-md">{fmtYears(f.managerTenure)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
