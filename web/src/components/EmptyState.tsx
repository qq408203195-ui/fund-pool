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
  // 空态文案里的年数必须跟当前口径一致，否则用户按提示去调参会被误导
  const y = s.criteria?.years ?? 3;
  const mgr = s.criteria?.managerMinYears ?? 3;
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
    reason =
      mgr <= 0
        ? `通过申购筛选的 ${s.passPurchase} 只，经理年限这道筛选已关闭，按理不应清空——请检查公司或关键词筛选条件。`
        : `通过申购筛选的 ${s.passPurchase} 只，现任基金经理任职都不满 ${mgr} 年。`;
  } else if (s.passMdd === 0) {
    reason = `通过前置条件的 ${s.passManager} 只，近 ${y} 年最大回撤数据缺失，无法比较。可能是这部分产品成立不足 ${y} 年。`;
  } else if (s.passReturn === 0) {
    reason = `通过回撤筛选的 ${s.passMdd} 只，近 ${y} 年收益数据缺失，无法比较。`;
  } else if (s.passCalmar === 0) {
    reason = `通过收益筛选的 ${s.passReturn} 只，近 ${y} 年卡玛比率无法计算（回撤为零或收益数据不完整），做不了风险调整后的比较。`;
  } else {
    // 走到这里说明各层都有人通过、卡玛也算了，却没进榜——只剩「回撤太小」这一种可能。
    // 低波债基在 1 年窗口下最容易撞上，必须给出可操作的解释，否则看起来像页面坏了。
    reason =
      `通过卡玛筛选的 ${s.passCalmar} 只，近 ${y} 年最大回撤都不到 0.5 个百分点。` +
      `卡玛比率 = 年化收益 ÷ |最大回撤|，分母趋近于零时这个比值会被无限放大、失去比较意义，` +
      `所以引擎不把它们放进榜单。把业绩窗口切到 3 年或更久，回撤拉开差距后通常就能出榜。`;
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
