import type { Criteria } from '../types';

/** 业务原始口径 —— 「重置」回到这里 */
export const DEFAULT_CRITERIA: Criteria = {
  managerMinYears: 3,
  mddKeepRatio: 0.5,
  returnKeepRatio: 0.5,
  calmarKeepRatio: 1, // 卡玛默认只做排序，不做筛选
  purchaseMode: 'strict',
  years: 3,
};

export function isDefaultCriteria(c: Criteria): boolean {
  return (
    c.managerMinYears === DEFAULT_CRITERIA.managerMinYears &&
    c.mddKeepRatio === DEFAULT_CRITERIA.mddKeepRatio &&
    c.returnKeepRatio === DEFAULT_CRITERIA.returnKeepRatio &&
    c.calmarKeepRatio === DEFAULT_CRITERIA.calmarKeepRatio &&
    c.purchaseMode === DEFAULT_CRITERIA.purchaseMode &&
    c.years === DEFAULT_CRITERIA.years
  );
}

interface Props {
  value: Criteria;
  onChange: (next: Criteria) => void;
  /** 当前口径下的入榜数，拖动时给即时反馈 */
  selected: number;
  universe: number;
  disabled?: boolean;
}

/**
 * 筛选口径调节器
 *
 * 四道条件原来写死在引擎里，这里把参数暴露给用户：
 * 滑块改完立刻重跑管线，漏斗与榜单同步刷新，不需要点「应用」。
 * 经理年限拖到 0、任一比例拖到 100% 即等于关闭该条件（后端按「不限」处理）。
 *
 * 「业绩窗口」放在最前面单独一行：回撤、收益、卡玛三个指标都按这个窗口取值，
 * 它一变，后三个滑块的语义全变，必须先让用户看清楚在哪个窗口上筛。
 */
export default function FilterControls({ value, onChange, selected, universe, disabled }: Props) {
  const set = (patch: Partial<Criteria>) => onChange({ ...value, ...patch });
  const dirty = !isDefaultCriteria(value);

  return (
    <div className="criteria-bar">
      <div className="criteria-row">
        <div className="criteria-lead">
          <span className="criteria-title">筛选口径</span>
          <span className="criteria-sub">改动即时生效</span>
        </div>

        <div className="criteria-item window">
          <label>
            业绩窗口
            <span className="criteria-value">近 {value.years} 年</span>
          </label>
          <div className="seg">
            {[1, 2, 3, 4, 5].map((y) => (
              <button
                key={y}
                type="button"
                className={`seg-btn${value.years === y ? ' active' : ''}`}
                onClick={() => set({ years: y })}
                title={`回撤、收益、卡玛三个指标都按近 ${y} 年窗口计算`}
              >
                {y}年
              </button>
            ))}
          </div>
          <div className="slider-scale">
            <span>短窗口偏近期表现</span>
            <span>长窗口偏完整周期</span>
          </div>
        </div>

        <div className="spacer" />

        <span className="criteria-result">
          入榜 <b>{selected}</b> / 样本 {universe}
        </span>

        <button
          type="button"
          className="btn ghost sm"
          disabled={!dirty || disabled}
          onClick={() => onChange({ ...DEFAULT_CRITERIA })}
          title="恢复业务原始口径：近 3 年、严格申购、经理满 3 年、回撤与收益各保留前 50%、卡玛不限"
        >
          重置口径
        </button>
      </div>

      <div className="criteria-row secondary">
        <div className="criteria-item">
          <label>可买入</label>
          <div className="seg">
            <button
              type="button"
              className={`seg-btn${value.purchaseMode === 'strict' ? ' active' : ''}`}
              onClick={() => set({ purchaseMode: 'strict' })}
              title="只保留开放申购与场内交易，剔除暂停申购、暂停大额申购、限大额、限购、封闭"
            >
              严格
            </button>
            <button
              type="button"
              className={`seg-btn${value.purchaseMode === 'loose' ? ' active' : ''}`}
              onClick={() => set({ purchaseMode: 'loose' })}
              title="放宽：允许「暂停大额申购」「限大额」，仅剔除暂停申购、封闭、终止"
            >
              放宽
            </button>
          </div>
        </div>

        <Slider
          label="经理年限"
          hint={value.managerMinYears <= 0 ? '不限' : `≥ ${value.managerMinYears} 年`}
          min={0}
          max={10}
          step={1}
          raw={value.managerMinYears}
          onChange={(v) => set({ managerMinYears: v })}
          scale={(v) => (v <= 0 ? '不限' : `${v}年`)}
          title="现任基金经理中至少一位管理本基金满 N 年；拖到 0 表示不限"
        />

        <Slider
          label="回撤"
          hint={value.mddKeepRatio >= 1 ? '不限' : `保留前 ${Math.round(value.mddKeepRatio * 100)}%`}
          min={10}
          max={100}
          step={5}
          raw={Math.round(value.mddKeepRatio * 100)}
          onChange={(v) => set({ mddKeepRatio: v / 100 })}
          scale={(v) => (v >= 100 ? '不限' : `前${v}%`)}
          title={`按近 ${value.years} 年最大回撤池内排名，保留回撤最小的前 N%；100% 表示不限`}
        />

        <Slider
          label="收益"
          hint={value.returnKeepRatio >= 1 ? '不限' : `保留前 ${Math.round(value.returnKeepRatio * 100)}%`}
          min={10}
          max={100}
          step={5}
          raw={Math.round(value.returnKeepRatio * 100)}
          onChange={(v) => set({ returnKeepRatio: v / 100 })}
          scale={(v) => (v >= 100 ? '不限' : `前${v}%`)}
          title={`按近 ${value.years} 年年化收益池内排名，保留收益最高的前 N%；100% 表示不限`}
        />

        <Slider
          label="卡玛比率"
          hint={value.calmarKeepRatio >= 1 ? '不限' : `保留前 ${Math.round(value.calmarKeepRatio * 100)}%`}
          min={10}
          max={100}
          step={5}
          raw={Math.round(value.calmarKeepRatio * 100)}
          onChange={(v) => set({ calmarKeepRatio: v / 100 })}
          scale={(v) => (v >= 100 ? '不限' : `前${v}%`)}
          title={`按近 ${value.years} 年卡玛比率（年化收益 ÷ |最大回撤|）池内排名，保留前 N%；100% 表示不限`}
        />
      </div>
    </div>
  );
}

function Slider({
  label,
  hint,
  min,
  max,
  step,
  raw,
  onChange,
  scale,
  title,
}: {
  label: string;
  hint: string;
  min: number;
  max: number;
  step: number;
  raw: number;
  onChange: (v: number) => void;
  scale: (v: number) => string;
  title: string;
}) {
  const pct = ((raw - min) / (max - min)) * 100;
  return (
    <div className="criteria-item slider" title={title}>
      <label>
        {label}
        <span className={`criteria-value${hint === '不限' ? ' off' : ''}`}>{hint}</span>
      </label>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={raw}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ '--fill': `${pct}%` } as React.CSSProperties}
      />
      <div className="slider-scale">
        <span>{scale(min)}</span>
        <span>{scale(max)}</span>
      </div>
    </div>
  );
}
