import { describe, expect, it } from "vitest";
import type { InkEvent } from "./types";
import { analyzeInkSession, getContentAtTimeMs } from "./analyze";

function makeEvent(
  id: string,
  type: InkEvent["type"],
  timestamp: number,
  extras: Partial<InkEvent> = {},
): InkEvent {
  return {
    id,
    sessionId: "s1",
    noteId: "n1",
    source: "main",
    type,
    index: 0,
    timestamp,
    ...extras,
  };
}

describe("analyzeInkSession", () => {
  it("reconstructs content from snapshot and inserts", () => {
    const events: InkEvent[] = [
      makeEvent("e1", "snapshot", 0, { text: "hello" }),
      makeEvent("e2", "insert", 1000, { index: 5, text: " world" }),
    ];
    const result = analyzeInkSession(events);
    expect(result.snapshots).toHaveLength(2);
    expect(result.snapshots[1].content).toBe("hello world");
    expect(result.durationMs).toBe(1000);
  });

  it("detects a paste key point", () => {
    const events: InkEvent[] = [
      makeEvent("e1", "snapshot", 0, { text: "" }),
      makeEvent("e2", "paste", 1000, { index: 0, text: "pasted content" }),
    ];
    const result = analyzeInkSession(events);
    expect(result.keyPoints).toHaveLength(1);
    expect(result.keyPoints[0].type).toBe("paste");
  });

  it("detects a large delete key point", () => {
    const events: InkEvent[] = [
      makeEvent("e1", "snapshot", 0, { text: "123456789012345678901234567890" }),
      makeEvent("e2", "delete", 1000, { index: 0, length: 25 }),
    ];
    const result = analyzeInkSession(events);
    expect(result.keyPoints).toHaveLength(1);
    expect(result.keyPoints[0].type).toBe("delete");
  });

  it("detects pause key point after long gap", () => {
    const events: InkEvent[] = [
      makeEvent("e1", "snapshot", 0, { text: "" }),
      makeEvent("e2", "insert", 1000, { index: 0, text: "a" }),
      makeEvent("e3", "insert", 13000, { index: 1, text: "b" }),
    ];
    const result = analyzeInkSession(events);
    expect(result.keyPoints.some((k) => k.type === "pause")).toBe(true);
  });
});

describe("getContentAtTimeMs", () => {
  const snapshots = [
    { timeMs: 0, content: "a" },
    { timeMs: 1000, content: "ab" },
    { timeMs: 2000, content: "abc" },
  ];

  it("returns first content before first snapshot", () => {
    expect(getContentAtTimeMs(snapshots, -100)).toBe("a");
  });

  it("returns correct content between snapshots", () => {
    expect(getContentAtTimeMs(snapshots, 1500)).toBe("ab");
  });

  it("returns last content after last snapshot", () => {
    expect(getContentAtTimeMs(snapshots, 3000)).toBe("abc");
  });
});
