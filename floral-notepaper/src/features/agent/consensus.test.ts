import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("./embeddingService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./embeddingService")>();
  return { ...actual, callEmbedding: vi.fn() };
});

import { detectConsensus, toDiscussionCommand, type OpinionNode } from "./consensus";
import { callEmbedding } from "./embeddingService";
import type { ProviderConfig } from "../settings/types";

const providers: ProviderConfig[] = [];
const mockedEmbedding = vi.mocked(callEmbedding);

beforeEach(() => {
  mockedEmbedding.mockReset();
});

function op(id: string, authorId: string): OpinionNode {
  return { id, authorId, text: `观点${id}` };
}

describe("detectConsensus", () => {
  it("观点不足 minOpinions 时返回 null", async () => {
    const r = await detectConsensus("上云", [op("a", "u1"), op("b", "u2")], providers, {
      minOpinions: 3,
    });
    expect(r).toBeNull();
  });

  it("Embedding 不可用时降级返回 null", async () => {
    mockedEmbedding.mockRejectedValue(new Error("no provider"));
    const r = await detectConsensus(
      "上云",
      [op("a", "u1"), op("b", "u2"), op("c", "u3")],
      providers,
    );
    expect(r).toBeNull();
  });

  it("全部观点相同时判定为共识（单组）", async () => {
    mockedEmbedding.mockResolvedValue([
      [1, 0],
      [1, 0],
      [1, 0],
    ]);
    const r = await detectConsensus(
      "上云",
      [op("a", "u1"), op("b", "u2"), op("c", "u3")],
      providers,
    );
    expect(r).not.toBeNull();
    expect(r!.status).toBe("consensus");
    expect(r!.groups).toHaveLength(1);
    expect(r!.groups[0].userIds.sort()).toEqual(["u1", "u2", "u3"]);
  });

  it("两组对立且无桥梁时判定为分歧", async () => {
    // 两组正交，组内完全一致；无中间派
    mockedEmbedding.mockResolvedValue([
      [1, 0],
      [1, 0],
      [0, 1],
      [0, 1],
    ]);
    const r = await detectConsensus(
      "上云",
      [op("a", "u1"), op("b", "u2"), op("c", "u3"), op("d", "u4")],
      providers,
    );
    expect(r!.groups.length).toBeGreaterThanOrEqual(2);
    expect(r!.status).toBe("diverging");
    expect(r!.bridgeNodeIds).toEqual([]);
  });

  it("存在中间派观点时识别桥梁并判定 mixed", async () => {
    // a,b 一组[1,0]；c 一组[0,1]；d 是折中，与两组都中等相似
    mockedEmbedding.mockResolvedValue([
      [1, 0],
      [1, 0],
      [0, 1],
      [0.7, 0.7],
    ]);
    const r = await detectConsensus(
      "上云",
      [op("a", "u1"), op("b", "u2"), op("c", "u3"), op("d", "u4")],
      providers,
      { consensusThreshold: 0.85, divergeThreshold: 0.55 },
    );
    expect(r!.bridgeNodeIds).toContain("d");
    expect(r!.status).toBe("mixed");
  });
});

describe("toDiscussionCommand", () => {
  it("转成 show_discussion_panel 指令", () => {
    const cmd = toDiscussionCommand({
      topic: "上云",
      status: "mixed",
      groups: [{ label: "主流观点", color: "#000", userIds: ["u1"], nodeIds: ["a"] }],
      bridgeNodeIds: ["d"],
    });
    expect(cmd.type).toBe("show_discussion_panel");
    if (cmd.type === "show_discussion_panel") {
      expect(cmd.topic).toBe("上云");
      expect(cmd.groups[0].userIds).toEqual(["u1"]);
      expect(cmd.bridgeNodeIds).toEqual(["d"]);
    }
  });
});
