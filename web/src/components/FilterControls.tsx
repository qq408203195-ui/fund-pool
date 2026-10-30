import type { Criteria } from '../types';

/** 业务原始口径 —— 「重置」回到这里 */
export const DEFAULT_CRITERIA: Criteria = {
  managerMinYears: 3,
  mddKeepRatio: 0.5,
  returnKeepRatio: 0.5,
  calmarKeepRatio: 1, // 卡玛默认只做排序，不做筛选
  purchaseMode: 'strict',
  mddYears: 3,
  returnYears: 3,
  calmarYears: 3,
};

/** 与服务端 SUPPORTED_YEARS 对应，快照里预算是这几档 */
export const YEAR_OPTIONS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

export function isDefaultCriteria(c: Criteria): boolean {
  return (
    c.managerMinYears === DEFAULT_CRITERIA.managerMinYears &&
    c.mddKeepRatio === DEFAULT_CRITERIA.mddKeepRatio &&
    c.returnKeepRatio === DEFAULT_CRITERIA.returnKeepRatio &&
    c.calmarKeepRatio === DEFAULT_CRITERIA.calmarKeepRatio &&
    c.purchaseMode === DEFAULT_CRITERIA.purchaseMode &&
    c.mddYears === DEFAULT_CRITERIA.mddYears &&
    c.returnYears === DEFAULT_CRITERIA.returnYears &&
    c.calmarYears === DEFAULT_CRITERIA.calmarYears
  );
}

interface Props {
  value: Criteria;
  onChange: (next: Criteria) => void;
  /** 当前口径下的入榜数，拖动时给即时反馈 */
  selected: number;
  universe: number;
  /** 快照里实际预算了哪些窗口，由 meta 下发；缺省用本地常量 */
  supportedYears?: number[];
  disabled?: boolean;
}

/**
 * 筛选口径调节器
 *
 * 五道条件原来写死在引擎里，这里把参数暴露给用户：
 * 改完立刻重跑管线，漏斗与榜单同步刷新，不需要点「应用」。
 * 经理年限拖到 0、任一比例拖到 100% 即等于关闭该条件（后端按「不限」处理）。
 *
 * 回撤、收益、卡玛三条各带一个窗口选择器：可以「近 3 年回撤前 50% +
 * 近 5 年收益前 30% + 近 7 年卡玛前 10%」。卡玛按它自己的窗口单独计算，
 * 不混用另外两个窗口的数字，所以三个年数必须各自可见、各自可调。
 */
export default function FilterControls({
  value,
  onChange,
  selected,
  universe,
  supportedYears,
  disabled,
}: Props) {
  const set = (patch: Partial<Criteria>) => onChange({ ...value, ...patch });
  const dirty = !isDefaultCriteria(value);
  const years = supportedYears?.length ? supportedYears : YEAR_OPTIONS;

  return (
    <div className="criteria-bar">
      <div className="criteria-row head">
        <div className="criteria-lead">
          <span className="criteria-title">筛选口径</span>
          <span className="criteria-sub">改动即时生效</span>
        </div>

        <div className="criteria-hint">
          回撤、收益、卡玛三条的业绩窗口<b>各自独立</b>，可以分别设为不同的年数
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
          title="恢复业务原始口径：三条都按近 3 年、严格申购、经理满 3 年、回撤与收益各保留前 50%、卡玛不限"
        >
          重置口径
        </button>
      </div>

      <div className="criteria-row">
        <div className="criteria-item">
          <label>申购状态</label>
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
          <div className="slider-scale">
            <span>仅开放申购</span>
            <span>含限大额</span>
          </div>
        </div>

        <Measure
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

        <Measure
          label="回撤"
          yearValue={value.mddYears}
          yearOptions={years}
          onYearChange={(v) => set({ mddYears: v })}
          hint={value.mddKeepRatio >= 1 ? '不限' : `保留前 ${Math.round(value.mddKeepRatio * 100)}%`}
          min={10}
          max={100}
          step={5}
          raw={Math.round(value.mddKeepRatio * 100)}
          onChange={(v) => set({ mddKeepRatio: v / 100 })}
          scale={(v) => (v >= 100 ? '不限' : `前${v}%`)}
          title={`按近 ${value.mddYears} 年最大回撤池内排名，保留回撤最小的前 N%；100% 表示不限`}
        />

        <Measure
          label="收益"
          yearValue={value.returnYears}
          yearOptions={years}
          onYearChange={(v) => set({ returnYears: v })}
          hint={value.returnKeepRatio >= 1 ? '不限' : `保留前 ${Math.round(value.returnKeepRatio * 100)}%`}
          min={10}
          max={100}
          step={5}
          raw={Math.round(value.returnKeepRatio * 100)}
          onChange={(v) => set({ returnKeepRatio: v / 100 })}
          scale={(v) => (v >= 100 ? '不限' : `前${v}%`)}
          title={`按近 ${value.returnYears} 年年化收益池内排名，保留收益最高的前 N%；100% 表示不限`}
        />

        <Measure
          label="卡玛"
          yearValue={value.calmarYears}
          yearOptions={years}
          onYearChange={(v) => set({ calmarYears: v })}
          hint={value.calmarKeepRatio >= 1 ? '不限' : `保留前 ${Math.round(value.calmarKeepRatio * 100)}%`}
          min={10}
          max={100}
          step={5}
          raw={Math.round(value.calmarKeepRatio * 100)}
          onChange={(v) => set({ calmarKeepRatio: v / 100 })}
          scale={(v) => (v >= 100 ? '不限' : `前${v}%`)}
          title={`按近 ${value.calmarYears} 年卡玛比率（该窗口年化收益 ÷ 该窗口 |最大回撤|）池内排名，保留前 N%；100% 表示不限`}
        />
      </div>
    </div>
  );
}

/** 带独立业绩窗口的滑块。窗口选择器是可选参数，经理年限那一项不需要 */
function Measure({
  label,
  yearValue,
  yearOptions,
  onYearChange,
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
  yearValue?: number;
  yearOptions?: number[];
  onYearChange?: (v: number) => void;
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
        <span className="label-left">
          {label}
          {yearValue != null && yearOptions && onYearChange && (
            <select
              className={`year-pick${yearValue !== 3 ? ' custom' : ''}`}
              value={yearValue}
              onChange={(e) => onYearChange(Number(e.target.value))}
              title={`${label}按近 ${yearValue} 年窗口计算`}
            >
              {yearOptions.map((y) => (
                <option key={y} value={y}>
                  近{y}年
                </option>
              ))}
            </select>
          )}
        </span>
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
