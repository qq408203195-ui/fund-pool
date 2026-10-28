import { useMemo } from 'react';
import type { Criteria, PoolView } from '../types';

export type StageKey =
  | 'universe'
  | 'passPurchase'
  | 'passManager'
  | 'passMdd'
  | 'passReturn'
  | 'passCalmar'
  | 'selected';

interface Step {
  key: StageKey;
  label: string;
  title: string;
}

/**
 * 漏斗按筛选管线的真实顺序展示，每一格的落差都对应一条具体规则。
 *
 * 「份额去重」不单独占一格：只保留初始基金份额的要求在池内样本生成时就已执行，
 * 它属于池子的定义，不是一道筛选。这样每一格的缺口都严格等于一条筛选规则。
 *
 * 后四格的标签跟着用户设定的口径走：滑块拖到 5 年、业绩窗口选 2 年，
 * 这里必须如实写「近 2 年回撤前 30%」，否则漏斗和调节器会互相矛盾。
 */
export function buildSteps(c?: Criteria): Step[] {
  const y = c?.years ?? 3;
  const purchase = c?.purchaseMode === 'loose' ? '可买入（放宽）' : '可买入';
  const mgr = c && c.managerMinYears > 0 ? `经理满 ${c.managerMinYears} 年` : '经理年限不限';
  const mdd = c && c.mddKeepRatio < 1 ? `近${y}年回撤前 ${Math.round(c.mddKeepRatio * 100)}%` : '回撤不限';
  const ret = c && c.returnKeepRatio < 1 ? `近${y}年收益前 ${Math.round(c.returnKeepRatio * 100)}%` : '收益不限';
  const cal =
    c && c.calmarKeepRatio < 1 ? `近${y}年卡玛前 ${Math.round(c.calmarKeepRatio * 100)}%` : '卡玛不限';

  return [
    { key: 'universe', label: '池内样本', title: '该池投资类型范围内的全部初始基金份额' },
    {
      key: 'passPurchase',
      label: purchase,
      title:
        c?.purchaseMode === 'loose'
          ? '放宽口径：允许「限大额」「暂停大额申购」，仅剔除暂停申购、封闭、终止'
          : '保留开放申购与场内交易，剔除暂停申购、暂停大额申购、限大额、封闭期',
    },
    {
      key: 'passManager',
      label: mgr,
      title: c && c.managerMinYears > 0 ? `现任基金经理中至少一位管理本基金满 ${c.managerMinYears} 年` : '经理任职年限这道筛选已关闭',
    },
    {
      key: 'passMdd',
      label: mdd,
      title: c && c.mddKeepRatio < 1 ? `剔除近 ${y} 年最大回撤排名池内后 ${Math.round((1 - c.mddKeepRatio) * 100)}%` : '回撤这道筛选已关闭',
    },
    {
      key: 'passReturn',
      label: ret,
      title: c && c.returnKeepRatio < 1 ? `剔除近 ${y} 年年化收益排名池内后 ${Math.round((1 - c.returnKeepRatio) * 100)}%` : '收益这道筛选已关闭',
    },
    {
      key: 'passCalmar',
      label: cal,
      title:
        c && c.calmarKeepRatio < 1
          ? `剔除近 ${y} 年卡玛比率（年化收益 ÷ |最大回撤|）排名池内后 ${Math.round((1 - c.calmarKeepRatio) * 100)}%`
          : '卡玛这道筛选已关闭，仍作为最终排序键',
    },
    { key: 'selected', label: '入榜', title: '按卡玛比率降序' },
  ];
}

/** 兼容旧调用：不带 criteria 时用默认口径的标签 */
export const STEPS: Step[] = buildSteps();

export default function Funnel({
  stats,
  active,
  onSelect,
  criteria,
}: {
  stats: PoolView['stats'];
  active: StageKey;
  onSelect: (key: StageKey) => void;
  criteria?: Criteria;
}) {
  const steps = useMemo(() => buildSteps(criteria ?? stats.criteria), [criteria, stats.criteria]);

  return (
    <div className="funnel">
      {steps.map((s, i) => {
        const value = stats[s.key];
        const prev = i === 0 ? null : stats[steps[i - 1].key];
        const cut = prev != null && value != null ? prev - value : 0;
        const isFinal = i === steps.length - 1;
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
              {value ?? '—'}
              {cut > 0 && <span className="funnel-delta">-{cut}</span>}
              {cut === 0 && i > 0 && <span className="funnel-delta muted">持平</span>}
            </div>
          </button>
        );
      })}
    </div>
  );
}
