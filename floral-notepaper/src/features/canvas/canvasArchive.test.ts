import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../agent/embeddingService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../agent/embeddingService")>();
  return { ...actual, callEmbedding: vi.fn() };
});

import { classifyNodesByEmbedding } from "./canvasArchive";
import { callEmbedding } from "../agent/embeddingService";
import type { ProviderConfig } from "../settings/types";
import type { CanvasNode } from "./types";

const providers: ProviderConfig[] = [];
const mockedEmbedding = vi.mocked(callEmbedding);

beforeEach(() => {
  mockedEmbedding.mockReset();
});

function node(id: string, text: string): CanvasNode {
  return { id, type: "card", x: 0, y: 0, width: 100, height: 100, text };
}

describe("classifyNodesByEmbedding", () => {
  it("Embedding 不可用时返回空", async () => {
    mockedEmbedding.mockRejectedValue(new Error("no provider"));
    const r = await classifyNodesByEmbedding([node("a", "x"), node("b", "y")], providers);
    expect(r).toEqual([]);
  });

  it("同标签的节点聚成一组", async () => {
    // 3 个节点，前两个指向标签 0 [1,0]，第三个指向标签 1 [0,1]
    mockedEmbedding
      .mockResolvedValueOnce([
        [1, 0],
        [1, 0],
        [0, 1],
      ]) // 节点
      .mockResolvedValueOnce([
        [1, 0],
        [0, 1],
      ]); // 标签
    const r = await classifyNodesByEmbedding(
      [node("a", "资料1"), node("b", "资料2"), node("c", "待办1")],
      providers,
      { tags: ["资料", "待办"], minGroupSize: 2 },
    );
    expect(r).toHaveLength(1);
    expect(r[0].tag).toBe("资料");
    expect(r[0].nodeIds.sort()).toEqual(["a", "b"]);
  });

  it("不足 minGroupSize 的组不建议", async () => {
    mockedEmbedding
      .mockResolvedValueOnce([
        [1, 0],
        [0, 1],
      ])
      .mockResolvedValueOnce([
        [1, 0],
        [0, 1],
      ]);
    const r = await classifyNodesByEmbedding(
      [node("a", "资料"), node("b", "待办")],
      providers,
      { tags: ["资料", "待办"], minGroupSize: 2 },
    );
    expect(r).toEqual([]);
  });
});
