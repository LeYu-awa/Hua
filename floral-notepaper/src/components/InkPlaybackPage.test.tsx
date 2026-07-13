// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

// 提供一个含 intervals 的 analyzed，使时间轴渲染；ruleBasedMarkers 返回关键帧
vi.mock("../features/ink/api", () => ({
  listInkSessions: () =>
    Promise.resolve([
      { id: "s1", noteId: "demo", source: "main", startedAt: 1000, endedAt: 601000, eventCount: 3 },
    ]),
  getInkSession: () =>
    Promise.resolve({
      id: "s1",
      noteId: "demo",
      source: "main",
      startedAt: 1000,
      endedAt: 601000,
      eventCount: 3,
      events: [],
    }),
}));
vi.mock("../features/notes/api", () => ({
  getNote: () => Promise.resolve({ id: "demo", title: "演示笔记", content: "内容" }),
}));
vi.mock("../features/ink/analyze", () => ({
  analyzeInkSession: () => ({
    durationMs: 600_000,
    intervals: [{ type: "流畅创作", startMs: 0, endMs: 600_000 }],
    keyPoints: [],
    snapshots: [{ timeMs: 0, content: "内容" }],
  }),
  getContentAtTimeMs: () => "内容",
}));
vi.mock("../features/agent/replayMarkers", () => ({
  ruleBasedMarkers: () => [
    { time: 0, markerType: "flow", title: "进入状态", summary: "连续流畅写作约 10 分钟" },
    { time: 300_000, markerType: "stuck", title: "停顿点", summary: "停顿约 40 秒" },
  ],
}));

import { InkPlaybackPage } from "./InkPlaybackPage";

afterEach(cleanup);

describe("InkPlaybackPage — 场景十一回放关键帧", () => {
  it("时间轴渲染 Agent 关键帧标记（进入状态 / 停顿点）", async () => {
    render(<InkPlaybackPage noteId="demo" />);
    // 标记以 title 呈现：`${label} · ${summary}`
    await waitFor(() => expect(screen.getByTitle(/进入状态/)).toBeTruthy());
    expect(screen.getByTitle(/停顿点/)).toBeTruthy();
  });

  it("关键帧标记是可点击按钮（可跳转）", async () => {
    render(<InkPlaybackPage noteId="demo" />);
    await waitFor(() => expect(screen.getByLabelText(/进入状态/)).toBeTruthy());
    const marker = screen.getByLabelText(/进入状态/);
    expect(marker.tagName.toLowerCase()).toBe("button");
  });
});
