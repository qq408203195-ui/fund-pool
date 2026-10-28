/**
 * 入池口径参数（单一来源）
 *
 * 这些数字决定了「什么基金有资格进入池内样本」，之前散落在
 * 采集脚本、导入器、筛选引擎和前端文案里各写一遍，改一次要追四个地方，
 * 很容易出现「文案说 3 年、逻辑算 5 年」这种对不上的情况。统一收到这里。
 *
 * 注意区分两个容易混淆的时间概念：
 *   minTrackYears —— 成立年限门槛，决定哪些基金有资格入池
 *   returnWindowYears —— 业绩统计窗口，决定回撤和收益算几年（改门槛不影响它）
 */

/** 入池门槛：成立满 N 年。原始需求为 3 年，2026-10-28 按要求改为 5 年。 */
export const MIN_TRACK_YEARS = 5;

/** 入池门槛：最新规模不低于 N 亿元，剔除迷你基金。 */
export const MIN_SCALE_YI = 2;

/** 业绩统计窗口：近 N 年。与成立门槛相互独立。 */
export const RETURN_WINDOW_YEARS = 3;

/** 回撤与收益分位各自保留的比例（剔除后 50%）。 */
export const KEEP_RATIO = 0.5;

/** 基金经理在本基金的最短任职年限。 */
export const MANAGER_MIN_YEARS = 3;

/** 由数据截止日回推成立门槛，得到「成立日不晚于此日」的分界。 */
export function cutoffEstab(dataDate, years = MIN_TRACK_YEARS) {
  if (!dataDate) return null;
  const d = new Date(`${dataDate}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  d.setUTCFullYear(d.getUTCFullYear() - years);
  return d.toISOString().slice(0, 10);
}
