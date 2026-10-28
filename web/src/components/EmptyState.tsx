import type { PoolView } from '../types';

/**
 * 空态：不只是说「没有结果」，而是指出是哪一步把池子清空的。
 * 这样使用者能判断是数据问题、口径问题，还是真的没有合格产品。
 */
export default function EmptyState({
  view,
  hasFilter,
  onClearFilter,
  onRecompute,
}: {
  view: PoolView;
  hasFilter: boolean;
  onClearFilter: () => void;
  onRecompute: () => void;
}) {
  const s = view.stats;
  const notOpen = view.rejects.find((r) => r.reason === '非开放申购')?.count ?? 0;
  const isCrossBorder = (view.pool.indexCategories ?? []).some((c) => c.startsWith('QDII'));

  let title = '本池暂无产品通过筛选';
  let reason = '';
  let action: { label: string; onClick: () => void } | null = null;

  if (hasFilter) {
    title = '当前筛选条件下没有基金';
    reason = `全池共 ${s.selected} 只入榜产品，但都不在你选定的公司或关键词范围内。`;
    action = { label: '清空筛选条件', onClick: onClearFilter };
  } else if (s.universe === 0) {
    reason = '该池的筛选范围里还没有入库产品，需要补充数据快照。';
  } else if (s.passPurchase === 0) {
    reason = isCrossBorder
      ? `${s.universe} 只候选全部卡在申购状态。跨境产品受外汇额度约束，长期处于「暂停申购」或「限大额」，按「必须可买入（开放申购或场内交易）」的口径确实一只都不合格——这是真实情况，不是数据缺失。`
      : `${s.universe} 只候选全部卡在申购状态，其中 ${notOpen} 只不是「开放申购」（含暂停大额申购、暂停申购）。`;
  } else if (s.passManager === 0) {
    reason = `通过申购筛选的 ${s.passPurchase} 只，现任基金经理任职都不满 3 年。`;
  } else if (s.passMdd === 0) {
    reason = `通过前置条件的 ${s.passManager} 只，近 3 年最大回撤数据缺失，无法比较。`;
  } else if (s.passReturn === 0) {
    reason = `通过回撤筛选的 ${s.passMdd} 只，近 3 年收益数据缺失，无法比较。`;
  } else {
    reason = '入榜数量为 0，可能是卡玛比率计算所需的数据不完整。';
    action = { label: '在此范围内重新优选', onClick: onRecompute };
  }

  return (
    <div className="table-card">
      <div className="empty">
        <div className="empty-title">{title}</div>
        <div className="empty-hint">{reason}</div>
        {action && (
          <button className="btn" style={{ marginTop: 14 }} onClick={action.onClick}>
            {action.label}
          </button>
        )}
      </div>
    </div>
  );
}
