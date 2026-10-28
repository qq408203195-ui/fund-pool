import type { MetaInfo, PoolView } from '../types';

interface Props {
  meta: MetaInfo | null;
  activePool: string;
  onSelect: (id: string) => void;
}


/** 数据源标识转中文，避免界面上直接出现 eastmoney 这种内部代号 */
function sourceLabel(src?: string | null): string {
  if (!src) return '—';
  const map: Record<string, string> = {
    eastmoney: '东方财富',
    wind: 'Wind',
    'Wind / search_funds': 'Wind',
  };
  return map[src] ?? src;
}

export default function Sidebar({ meta, activePool, onSelect }: Props) {
  if (!meta) {
    return (
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">
            <div className="brand-logo">池</div>
            <div className="brand-name">基金池</div>
          </div>
        </div>
      </aside>
    );
  }

  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark">
          <div className="brand-logo">池</div>
          <div>
            <div className="brand-name">基金池</div>
          </div>
        </div>
        <div className="brand-sub">WIND 数据 · 可视化优选</div>
      </div>

      <nav className="nav">
        {meta.groups.map((g) => (
          <div key={g.id}>
            <div className="nav-group-label">{g.name}</div>
            {meta.pools
              .filter((p) => p.group === g.id)
              .map((p) => (
                <button
                  key={p.id}
                  className={`nav-item${activePool === p.id ? ' active' : ''}`}
                  onClick={() => onSelect(p.id)}
                  title={p.desc}
                >
                  <span className="nav-badge">{p.badge}</span>
                  <span className="nav-name">{p.name}</span>
                  <span className="nav-count">{p.selected}</span>
                </button>
              ))}
          </div>
        ))}
      </nav>

      <div className="sidebar-foot">
        <div>
          数据日期 <strong>{meta.dataDate ?? '未同步'}</strong>
        </div>
        <div>
          全库 <strong>{meta.totalFunds}</strong> 只 · 来源 <strong>{sourceLabel(meta.source)}</strong>
        </div>
      </div>
    </aside>
  );
}
