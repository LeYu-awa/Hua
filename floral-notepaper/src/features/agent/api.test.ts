import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { generateAgentReviewReport } from "./api";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

const mockedInvoke = vi.mocked(invoke);

describe("agent api", () => {
  beforeEach(() => {
    mockedInvoke.mockReset();
  });

  test("generates a review report for a conversation", async () => {
    mockedInvoke.mockResolvedValue({
      conversationId: "conversation-1",
      title: "Agent 协作复盘报告",
      summary: "本次复盘聚合了 3 个关键帧。",
      healthScore: 88,
      markerCounts: { flow: 1, consensus: 1, conflict: 1 },
      highlights: ["形成 1 次明确共识。"],
      risks: ["存在 1 个分歧或风险节点。"],
      nextSteps: ["先回到分歧标记。"],
      generatedAt: "2026-07-06T00:00:00Z",
    });

    const report = await generateAgentReviewReport("conversation-1");

    expect(invoke).toHaveBeenCalledWith("agent_generate_review_report", {
      conversationId: "conversation-1",
    });
    expect(report.healthScore).toBe(88);
    expect(report.markerCounts.conflict).toBe(1);
  });
});
