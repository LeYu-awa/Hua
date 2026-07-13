import { describe, expect, it } from "vitest";
import { assessAnxiety, DEFAULT_BASELINE } from "./moodDetector";
import type { InkEvent } from "../ink/types";

function ev(type: InkEvent["type"], timestamp: number, extra: Partial<InkEvent> = {}): InkEvent {
  return {
    id: `${type}-${timestamp}`,
    sessionId: "s",
    noteId: "n",
    source: "main",
    type,
    index: 0,
    timestamp,
    ...extra,
  };
}

describe("assessAnxiety", () => {
  it("无事件时指数为 0，不干预", () => {
    const r = assessAnxiety([], DEFAULT_BASELINE, 1_000_000);
    expect(r.index).toBe(0);
    expect(r.shouldIntervene).toBe(false);
  });

  it("平稳输出（低删改）指数接近基线，不干预", () => {
    const now = 1_000_000;
    const events: InkEvent[] = [];
    for (let i = 0; i < 30; i++) {
      events.push(ev("insert", now - 300_000 + i * 8_000));
    }
    const r = assessAnxiety(events, DEFAULT_BASELINE, now);
    expect(r.shouldIntervene).toBe(false);
  });

  it("高删改 + 频繁光标 + 多停顿触发干预", () => {
    const now = 1_000_000;
    const events: InkEvent[] = [];
    // 大量删除
    for (let i = 0; i < 20; i++) {
      events.push(ev("delete", now - 280_000 + i * 1_000, { length: 5 }));
    }
    // 少量插入
    for (let i = 0; i < 5; i++) {
      events.push(ev("insert", now - 250_000 + i * 1_000));
    }
    // 频繁光标移动，每次间隔 > 5s 制造停顿
    for (let i = 0; i < 20; i++) {
      events.push(ev("cursor", now - 200_000 + i * 7_000));
    }
    const r = assessAnxiety(events, DEFAULT_BASELINE, now);
    expect(r.metrics.deleteRatio).toBeGreaterThan(0.5);
    expect(r.index).toBeGreaterThan(2);
    expect(r.shouldIntervene).toBe(true);
  });

  it("只统计滑动窗口内的事件", () => {
    const now = 1_000_000;
    // 窗口外的大量删除不应计入
    const old = Array.from({ length: 50 }, (_, i) => ev("delete", now - 600_000 + i * 100, { length: 9 }));
    const r = assessAnxiety(old, DEFAULT_BASELINE, now);
    expect(r.index).toBe(0);
  });
});
