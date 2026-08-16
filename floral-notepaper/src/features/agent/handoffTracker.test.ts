import { describe, expect, it } from "vitest";
import { trackHandoffs, type CollabEditEvent } from "./handoffTracker";

function ev(
  userId: string,
  area: string,
  timestamp: number,
  kind: "create" | "edit" = "edit",
): CollabEditEvent {
  return { userId, area, nodeId: `${userId}-${timestamp}`, timestamp, kind };
}

describe("trackHandoffs", () => {
  it("同区域内不同用户先后编辑且在窗口内 => 接力点", () => {
    const events = [ev("A", "方案", 1000), ev("B", "方案", 2000)];
    const { handoffs } = trackHandoffs(events);
    expect(handoffs).toHaveLength(1);
    expect(handoffs[0]).toMatchObject({ area: "方案", fromUserId: "A", toUserId: "B" });
  });

  it("超过 maxGapMs 的切换不算接力", () => {
    const events = [
      ev("A", "方案", 0),
      ev("B", "方案", 60 * 60_000), // 60 分钟后
    ];
    const { handoffs } = trackHandoffs(events, { maxGapMs: 30 * 60_000 });
    expect(handoffs).toEqual([]);
  });

  it("同一用户连续编辑不算接力", () => {
    const events = [ev("A", "方案", 1000), ev("A", "方案", 2000)];
    const { handoffs } = trackHandoffs(events);
    expect(handoffs).toEqual([]);
  });

  it("不同区域的编辑相互独立，不产生跨区接力", () => {
    const events = [ev("A", "背景", 1000), ev("B", "方案", 2000)];
    const { handoffs } = trackHandoffs(events);
    expect(handoffs).toEqual([]);
  });

  it("新建最多且最早者标记为框架设计者", () => {
    const events = [
      ev("C", "背景", 100, "create"),
      ev("C", "问题", 200, "create"),
      ev("A", "方案", 300, "create"),
    ];
    const { roles } = trackHandoffs(events);
    const c = roles.find((r) => r.userId === "C");
    expect(c?.role).toBe("框架设计者");
  });

  it("接手他人区域的用户标记为深化者", () => {
    const events = [
      ev("C", "背景", 100, "create"),
      ev("C", "方案", 200, "create"),
      ev("A", "方案", 300, "edit"), // A 接力 C 的方案区
    ];
    const { roles } = trackHandoffs(events);
    const a = roles.find((r) => r.userId === "A");
    expect(a?.role).toBe("深化者");
  });

  it("为每个用户生成按时间升序的时间线", () => {
    const events = [ev("A", "方案", 3000), ev("A", "方案", 1000), ev("B", "背景", 2000)];
    const { timelines } = trackHandoffs(events);
    expect(timelines["A"].map((e) => e.timestamp)).toEqual([1000, 3000]);
    expect(timelines["B"]).toHaveLength(1);
  });
});
