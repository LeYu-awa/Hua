// Agent 规则引擎共用工具
// 提供确定性的阈值判断、冷却控制、优先级排序与去重。
// 目标：所有 Agent 场景在 Embedding / LLM 不可用时，仍能靠规则工作（可降级），
// 并保证"不打扰"（冷却 + 优先级 + 去重）。

/**
 * 冷却追踪器：按 key 记录上次触发时间，避免同类提示反复打扰。
 * 纯内存，进程级；不同 key 相互独立。
 */
export class CooldownTracker {
  private readonly lastFired = new Map<string, number>();

  /** 距上次触发是否已超过冷却时间（首次总是允许） */
  canFire(key: string, cooldownMs: number, now: number): boolean {
    const last = this.lastFired.get(key);
    if (last === undefined) return true;
    return now - last >= cooldownMs;
  }

  /** 记录一次触发 */
  mark(key: string, now: number): void {
    this.lastFired.set(key, now);
  }

  /** 若在冷却外则触发并记录，返回是否触发 */
  tryFire(key: string, cooldownMs: number, now: number): boolean {
    if (!this.canFire(key, cooldownMs, now)) return false;
    this.mark(key, now);
    return true;
  }

  /** 清空全部冷却记录 */
  reset(): void {
    this.lastFired.clear();
  }
}

/** 值是否达到（>=）阈值 */
export function meetsThreshold(value: number, threshold: number): boolean {
  return value >= threshold;
}

/**
 * 按 keyFn 去重，保留首次出现的元素，保持原顺序。
 * 用于避免同一组节点/同一条洞察重复提示。
 */
export function dedupeByKey<T>(items: T[], keyFn: (item: T) => string): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const item of items) {
    const key = keyFn(item);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

/**
 * 把无向节点对归一成稳定 key（顺序无关），用于连接去重。
 * (a, b) 与 (b, a) 得到同一 key。
 */
export function pairKey(a: string, b: string): string {
  return a < b ? `${a}::${b}` : `${b}::${a}`;
}

/** 按 priority 降序排序（大者优先），保持稳定性 */
export function sortByPriorityDesc<T extends { priority: number }>(items: T[]): T[] {
  return items
    .map((item, i) => ({ item, i }))
    .sort((x, y) => y.item.priority - x.item.priority || x.i - y.i)
    .map(({ item }) => item);
}

/** 把数值夹到 [min, max] 区间 */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * 加权求和，返回加权后的分数。
 * weights 的键对应 metrics 的键；缺失的键按 0 计。
 * 用于焦虑指数等多指标合成。
 */
export function weightedScore(
  metrics: Record<string, number>,
  weights: Record<string, number>,
): number {
  let sum = 0;
  for (const key of Object.keys(weights)) {
    sum += (metrics[key] ?? 0) * weights[key];
  }
  return sum;
}
