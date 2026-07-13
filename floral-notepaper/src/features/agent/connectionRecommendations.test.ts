import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("./embeddingService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./embeddingService")>();
  return { ...actual, callEmbedding: vi.fn() };
});

import { findImplicitConnections } from "./connectionRecommendations";
import { callEmbedding } from "./embeddingService";
import type { ProviderConfig } from "../settings/types";

const providers: ProviderConfig[] = [];
const mockedEmbedding = vi.mocked(callEmbedding);

beforeEach(() => {
  mockedEmbedding.mockReset();
});

describe("findImplicitConnections", () => {
  it("节点不足 2 个时返回空", async () => {
    const r = await findImplicitConnections([{ id: "a", text: "x", x: 0, y: 0 }], [], providers);
    expect(r).toEqual([]);
  });

  it("Embedding 不可用（抛错）时降级返回空", async () => {
    mockedEmbedding.mockRejectedValue(new Error("no provider"));
    const r = await findImplicitConnections(
      [
        { id: "a", text: "实时同步需求", x: 0, y: 0 },
        { id: "b", text: "实时同步排期", x: 700, y: 0 },
      ],
      [],
      providers,
    );
    expect(r).toEqual([]);
  });

  it("语义相似且空间距离大时推荐连接", async () => {
    // a、b 向量相同（相似度 1），c 正交
    mockedEmbedding.mockResolvedValue([
      [1, 0],
      [1, 0],
      [0, 1],
    ]);
    const r = await findImplicitConnections(
      [
        { id: "a", text: "实时同步需求", x: 0, y: 0 },
        { id: "b", text: "实时同步排期", x: 700, y: 0 },
        { id: "c", text: "界面配色", x: 10, y: 10 },
      ],
      [],
      providers,
    );
    expect(r).toHaveLength(1);
    expect([r[0].sourceId, r[0].targetId].sort()).toEqual(["a", "b"]);
    expect(r[0].similarity).toBeCloseTo(1);
    expect(r[0].distance).toBe(700);
  });

  it("空间距离过近不推荐", async () => {
    mockedEmbedding.mockResolvedValue([
      [1, 0],
      [1, 0],
    ]);
    const r = await findImplicitConnections(
      [
        { id: "a", text: "同步", x: 0, y: 0 },
        { id: "b", text: "同步", x: 20, y: 0 },
      ],
      [],
      providers,
    );
    expect(r).toEqual([]);
  });

  it("已有显式连线时不重复推荐", async () => {
    mockedEmbedding.mockResolvedValue([
      [1, 0],
      [1, 0],
    ]);
    const r = await findImplicitConnections(
      [
        { id: "a", text: "同步", x: 0, y: 0 },
        { id: "b", text: "同步", x: 700, y: 0 },
      ],
      [{ fromNodeId: "b", toNodeId: "a" }],
      providers,
    );
    expect(r).toEqual([]);
  });
});
