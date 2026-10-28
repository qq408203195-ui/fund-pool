import type { PoolView } from '../types';

export type StageKey =
  | 'universe'
  | 'passPurchase'
  | 'passManager'
  | 'passMdd'
  | 'passReturn'
  | 'selected';

/**
 * 漏斗按筛选管线的真实顺序展示，每一格的落差都对应一条具体规则。
 *
 * 「份额去重」不单独占一格：只保留初始基金份额的要求在池内样本生成时就已执行，
 * 它属于池子的定义，不是一道筛选。这样每一格的缺口都严格等于一条筛选规则。
 */
export const STEPS: { key: StageKey; label: string; title: string }[] = [
  { key: 'universe', label: '池内样本', title: '该池投资类型范围内的全部初始基金份额' },
  { key: 'passPurchase', label: '可买入', title: '保留开放申购与场内交易，剔除暂停申购、限大额、封闭期' },
  { key: 'passManager', label: '经理满 3 年', title: '现任基金经理中至少一位管理本基金满 3 年' },
  { key: 'passMdd', label: '回撤前 50%', title: '剔除近 3 年最大回撤排名池内后 50%' },
  { key: 'passReturn', label: '收益前 50%', title: '剔除近 3 年年化收益排名池内后 50%' },
  { key: 'selected', label: '入榜', title: '按卡玛比率降序' },
];

export default function Funnel({
  stats,
  active,
  onSelect,
}: {
  stats: PoolView['stats'];
  active: StageKey;
  onSelect: (key: StageKey) => void;
}) {
  return (
    <div className="funnel">
      {STEPS.map((s, i) => {
        const value = stats[s.key];
        const prev = i === 0 ? null : stats[STEPS[i - 1].key];
        const cut = prev != null ? prev - value : 0;
        const isFinal = i === STEPS.length - 1;
        return (
          <button
            key={s.key}
            type="button"
            className={`funnel-step${isFinal ? ' final' : ''}${active === s.key ? ' active' : ''}`}
            title={`${s.title}（点击查看本层名单）`}
            onClick={() => onSelect(s.key)}
          >
            <div className="funnel-label">{s.label}</div>
            <div className="funnel-value">
              {value}
              {cut > 0 && <span className="funnel-delta">-{cut}</span>}
              {cut === 0 && i > 0 && <span className="funnel-delta muted">持平</span>}
            </div>
          </button>
        );
      })}
    </div>
  );
}
