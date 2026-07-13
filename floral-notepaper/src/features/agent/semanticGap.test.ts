import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("./embeddingService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./embeddingService")>();
  return { ...actual, callEmbedding: vi.fn() };
});

import { detectSemanticGaps, type Perspective } from "./semanticGap";
import { callEmbedding } from "./embeddingService";
import type { ProviderConfig } from "../settings/types";

const providers: ProviderConfig[] = [];
const mockedEmbedding = vi.mocked(callEmbedding);

beforeEach(() => {
  mockedEmbedding.mockReset();
});

const perspectives: Perspective[] = [
  { label: "技术", description: "技术实现" },
  { label: "用户体验", description: "用户体验感受" },
];

function nodes(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    id: `n${i}`,
    text: `节点${i}`,
    x: i * 10,
    y: 0,
  }));
}

describe("detectSemanticGaps", () => {
  it("节点数不足时返回 null", async () => {
    const r = await detectSemanticGaps(nodes(2), providers, { minNodes: 5, perspectives });
    expect(r).toBeNull();
  });

  it("Embedding 不可用时返回 null", async () => {
    mockedEmbedding.mockRejectedValue(new Error("no provider"));
    const r = await detectSemanticGaps(nodes(5), providers, { minNodes: 5, perspectives });
    expect(r).toBeNull();
  });

  it("某视角无节点覆盖时标记为缺失", async () => {
    // 第一次调用：节点向量，全部指向"技术"方向 [1,0]
    // 第二次调用：视角向量，[技术=[1,0], 用户体验=[0,1]]
    mockedEmbedding
      .mockResolvedValueOnce(nodes(5).map(() => [1, 0]))
      .mockResolvedValueOnce([
        [1, 0],
        [0, 1],
      ]);
    const r = await detectSemanticGaps(nodes(5), providers, {
      minNodes: 5,
      perspectives,
      coverageThreshold: 0.35,
    });
    expect(r).not.toBeNull();
    expect(r!.missingPerspectives).toContain("用户体验");
    expect(r!.missingPerspectives).not.toContain("技术");
    expect(r!.message).toContain("用户体验");
  });

  it("所有视角均被覆盖时无缺失", async () => {
    mockedEmbedding
      .mockResolvedValueOnce(nodes(5).map(() => [1, 1]))
      .mockResolvedValueOnce([
        [1, 1],
        [1, 1],
      ]);
    const r = await detectSemanticGaps(nodes(5), providers, {
      minNodes: 5,
      perspectives,
      coverageThreshold: 0.35,
    });
    expect(r!.missingPerspectives).toEqual([]);
    expect(r!.message).toBe("");
  });
});
