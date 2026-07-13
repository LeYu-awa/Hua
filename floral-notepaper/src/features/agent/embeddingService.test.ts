import { describe, expect, it } from "vitest";
import {
  cosineSimilarity,
  hasEmbeddingProvider,
  spatialDistance,
} from "./embeddingService";
import type { ProviderConfig } from "../settings/types";

describe("cosineSimilarity", () => {
  it("相同向量相似度为 1", () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1);
  });

  it("正交向量相似度为 0", () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
  });

  it("反向向量相似度为 -1", () => {
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1);
  });

  it("零向量或长度不一致返回 0", () => {
    expect(cosineSimilarity([0, 0], [1, 1])).toBe(0);
    expect(cosineSimilarity([1], [1, 2])).toBe(0);
  });
});

describe("spatialDistance", () => {
  it("勾股距离", () => {
    expect(spatialDistance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
  });
});

describe("hasEmbeddingProvider", () => {
  const base: ProviderConfig = {
    id: "p1",
    enabled: true,
    name: "test",
    protocol: "openai",
    apiKey: "k",
    baseUrl: "https://api.test.com/v1",
    apiPath: "/chat/completions",
    models: [],
  };

  it("无 embedding 模型时返回 false", () => {
    const providers = [{ ...base, models: [{ modelId: "chat", displayName: "Chat" }] }];
    expect(hasEmbeddingProvider(providers)).toBe(false);
  });

  it("存在 embedding 模型时返回 true", () => {
    const providers = [
      {
        ...base,
        models: [{ modelId: "emb", displayName: "Emb", modelTypes: ["embedding"] }],
      },
    ];
    expect(hasEmbeddingProvider(providers)).toBe(true);
  });

  it("provider 未启用时忽略", () => {
    const providers = [
      {
        ...base,
        enabled: false,
        models: [{ modelId: "emb", displayName: "Emb", modelTypes: ["embedding"] }],
      },
    ];
    expect(hasEmbeddingProvider(providers)).toBe(false);
  });
});
