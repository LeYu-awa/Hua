import { describe, expect, it } from "vitest";
import {
  clamp,
  CooldownTracker,
  dedupeByKey,
  meetsThreshold,
  pairKey,
  sortByPriorityDesc,
  weightedScore,
} from "./ruleEngine";

describe("CooldownTracker", () => {
  it("首次总是允许触发", () => {
    const c = new CooldownTracker();
    expect(c.canFire("a", 1000, 0)).toBe(true);
  });

  it("冷却窗口内拒绝，窗口外放行", () => {
    const c = new CooldownTracker();
    c.mark("a", 1000);
    expect(c.canFire("a", 1000, 1500)).toBe(false);
    expect(c.canFire("a", 1000, 2000)).toBe(true);
  });

  it("tryFire 在冷却外触发并记录", () => {
    const c = new CooldownTracker();
    expect(c.tryFire("a", 1000, 0)).toBe(true);
    expect(c.tryFire("a", 1000, 500)).toBe(false);
    expect(c.tryFire("a", 1000, 1000)).toBe(true);
  });

  it("不同 key 互不影响", () => {
    const c = new CooldownTracker();
    c.mark("a", 1000);
    expect(c.canFire("b", 1000, 1000)).toBe(true);
  });
});

describe("dedupeByKey / pairKey", () => {
  it("按 key 去重，保留首次出现", () => {
    const items = [
      { k: "x", v: 1 },
      { k: "y", v: 2 },
      { k: "x", v: 3 },
    ];
    expect(dedupeByKey(items, (i) => i.k)).toEqual([
      { k: "x", v: 1 },
      { k: "y", v: 2 },
    ]);
  });

  it("pairKey 顺序无关", () => {
    expect(pairKey("a", "b")).toBe(pairKey("b", "a"));
  });
});

describe("sortByPriorityDesc", () => {
  it("按优先级降序，相同优先级保持稳定", () => {
    const items = [
      { id: 1, priority: 10 },
      { id: 2, priority: 30 },
      { id: 3, priority: 30 },
    ];
    expect(sortByPriorityDesc(items).map((i) => i.id)).toEqual([2, 3, 1]);
  });
});

describe("helpers", () => {
  it("meetsThreshold", () => {
    expect(meetsThreshold(0.8, 0.7)).toBe(true);
    expect(meetsThreshold(0.6, 0.7)).toBe(false);
  });

  it("clamp", () => {
    expect(clamp(5, 0, 3)).toBe(3);
    expect(clamp(-1, 0, 3)).toBe(0);
    expect(clamp(2, 0, 3)).toBe(2);
  });

  it("weightedScore 加权求和，缺失键按 0", () => {
    const score = weightedScore({ a: 1, b: 2 }, { a: 0.5, b: 0.5, c: 1 });
    expect(score).toBeCloseTo(1.5);
  });
});
