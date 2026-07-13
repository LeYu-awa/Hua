import { describe, expect, it } from "vitest";
import { ruleBasedMarkers, generateReplayMarkers, toReplayCommand } from "./replayMarkers";
import type { AnalyzedSession } from "../ink/analyze";

function session(intervals: AnalyzedSession["intervals"]): AnalyzedSession {
  return { durationMs: 0, intervals, keyPoints: [], snapshots: [] };
}

describe("ruleBasedMarkers", () => {
  it("标记较长的流畅期为 flow", () => {
    const markers = ruleBasedMarkers(
      session([{ startMs: 0, endMs: 4 * 60_000, type: "流畅创作" }]),
    );
    expect(markers).toHaveLength(1);
    expect(markers[0].markerType).toBe("flow");
  });

  it("标记较长的停顿为 stuck", () => {
    const markers = ruleBasedMarkers(
      session([{ startMs: 0, endMs: 40_000, type: "停顿思考" }]),
    );
    expect(markers).toHaveLength(1);
    expect(markers[0].markerType).toBe("stuck");
  });

  it("过短的区间不标记", () => {
    const markers = ruleBasedMarkers(
      session([
        { startMs: 0, endMs: 60_000, type: "流畅创作" }, // < 3min
        { startMs: 60_000, endMs: 70_000, type: "停顿思考" }, // < 30s
      ]),
    );
    expect(markers).toEqual([]);
  });
});

describe("generateReplayMarkers", () => {
  it("不启用 LLM 时只返回规则标记", async () => {
    const markers = await generateReplayMarkers(
      session([{ startMs: 0, endMs: 5 * 60_000, type: "流畅创作" }]),
      [],
      { useLLM: false },
    );
    expect(markers).toHaveLength(1);
    expect(markers[0].markerType).toBe("flow");
  });
});

describe("toReplayCommand", () => {
  it("转成 replay_marker 指令", () => {
    const cmd = toReplayCommand({ time: 100, markerType: "flow", title: "t", summary: "s" });
    expect(cmd.type).toBe("replay_marker");
    if (cmd.type === "replay_marker") {
      expect(cmd.time).toBe(100);
      expect(cmd.title).toBe("t");
    }
  });
});
