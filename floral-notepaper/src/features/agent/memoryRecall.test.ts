import { afterEach, describe, expect, it, vi } from "vitest";
import { recallBaseline, recallMemory } from "./memoryRecall";
import { ragRetrieve } from "./api";
import { getBaseline } from "./profileApi";
import type { AgentRetrievedChunk } from "./types";

vi.mock("./api", () => ({
  ragRetrieve: vi.fn(),
}));

vi.mock("./profileApi", () => ({
  getBaseline: vi.fn(),
}));

const chunk = (overrides: Partial<AgentRetrievedChunk>): AgentRetrievedChunk => ({
  chunkId: "c1",
  sourceId: "note:n1",
  text: "角色动机是害怕被忘记",
  position: 0,
  score: 0.87,
  ...overrides,
});

describe("recallMemory（对话记忆召回）", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("formats retrieved chunks into a context block", async () => {
    vi.mocked(ragRetrieve).mockResolvedValue([
      chunk({}),
      chunk({ sourceId: "diary:d2", text: "上周聊过雨夜重逢" }),
    ]);

    const block = await recallMemory("角色动机");

    expect(block).toContain("相关记忆");
    expect(block).toContain("「角色动机是害怕被忘记」（记忆：note:n1）");
    expect(block).toContain("「上周聊过雨夜重逢」（记忆：diary:d2）");
  });

  it("returns empty when there are no hits", async () => {
    vi.mocked(ragRetrieve).mockResolvedValue([]);
    expect(await recallMemory("随便问问")).toBe("");
  });

  it("returns empty on retrieval failure", async () => {
    vi.mocked(ragRetrieve).mockRejectedValue(new Error("no embedding provider"));
    expect(await recallMemory("随便问问")).toBe("");
  });
});

describe("recallBaseline（用户画像注入）", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("formats baseline into a context block", async () => {
    vi.mocked(getBaseline).mockResolvedValue({
      deleteRatio: 0.61,
      cursorPerMin: 5,
      pausePerMin: 1.2,
    });

    const block = await recallBaseline();

    expect(block).toContain("用户写作画像");
    expect(block).toContain("删改比 61%");
  });

  it("returns empty when no baseline is stored", async () => {
    vi.mocked(getBaseline).mockResolvedValue(null);
    expect(await recallBaseline()).toBe("");
  });

  it("returns empty on failure", async () => {
    vi.mocked(getBaseline).mockRejectedValue(new Error("no profile"));
    expect(await recallBaseline()).toBe("");
  });
});
