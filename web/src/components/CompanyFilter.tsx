import { useEffect, useMemo, useRef, useState } from 'react';

interface Props {
  companies: { company: string; count: number }[];
  selected: string[];
  onChange: (v: string[]) => void;
}

export default function CompanyFilter({ companies, selected, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [kw, setKw] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const filtered = useMemo(() => {
    const k = kw.trim();
    if (!k) return companies;
    return companies.filter((c) => c.company.includes(k));
  }, [companies, kw]);

  const toggle = (name: string) => {
    onChange(selected.includes(name) ? selected.filter((x) => x !== name) : [...selected, name]);
  };

  return (
    <div className="dropdown" ref={ref}>
      <button className={`btn${selected.length ? ' active' : ''}`} onClick={() => setOpen((v) => !v)}>
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
          <path
            d="M2 3.5h12M4.5 8h7M6.5 12.5h3"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
          />
        </svg>
        基金公司
        {selected.length > 0 && <span className="num">· {selected.length}</span>}
        <span style={{ fontSize: 9, opacity: 0.6 }}>▼</span>
      </button>

      {open && (
        <div className="dropdown-panel">
          <div className="dropdown-search">
            <input
              autoFocus
              placeholder="搜索基金公司"
              value={kw}
              onChange={(e) => setKw(e.target.value)}
            />
          </div>
          <div className="dropdown-list">
            {filtered.length === 0 && (
              <div style={{ padding: '18px 10px', textAlign: 'center', color: 'var(--ink-3)', fontSize: 12 }}>
                没有匹配的公司
              </div>
            )}
            {filtered.map((c) => {
              const on = selected.includes(c.company);
              return (
                <button
                  key={c.company}
                  className={`dropdown-item${on ? ' selected' : ''}`}
                  onClick={() => toggle(c.company)}
                >
                  <span className="check">
                    <svg width="9" height="7" viewBox="0 0 10 8" fill="none">
                      <path d="M1 4l2.5 2.5L9 1" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </span>
                  <span>{c.company}</span>
                  <span className="cnt">{c.count}</span>
                </button>
              );
            })}
          </div>
          <div className="dropdown-foot">
            <button className="btn ghost" onClick={() => onChange([])}>
              清空
            </button>
            <button
              className="btn"
              onClick={() => onChange(companies.filter((c) => c.company.includes(kw.trim())).map((c) => c.company))}
            >
              全选{kw.trim() ? '匹配' : ''}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
