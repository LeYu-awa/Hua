import { describe, expect, it } from "vitest";
import { buildWriteupGoal, isWriteupGoal, WRITEUP_KINDS } from "./writeupGoal";

describe("buildWriteupGoal", () => {
  it("encodes kind, intent and card ids in the Rust-parsable format", () => {
    const goal = buildWriteupGoal(["n1", "n2"], "大纲", "突出主角成长线");
    expect(goal).toContain("整理成文：大纲");
    expect(goal).toContain("意图：突出主角成长线");
    expect(goal).toContain("卡片：n1,n2");
    expect(goal).toContain("画布");
  });

  it("omits the intent segment when empty", () => {
    const goal = buildWriteupGoal(["n1"], "初稿", "  ");
    expect(goal).not.toContain("意图");
    expect(goal).toContain("卡片：n1");
  });

  it("joins card ids without spaces for parsing robustness", () => {
    const goal = buildWriteupGoal(["a-1", "b-2", "c-3"], "总结", "");
    expect(goal).toContain("卡片：a-1,b-2,c-3");
  });
});

describe("isWriteupGoal", () => {
  it("detects writeup goals", () => {
    expect(isWriteupGoal("把画布上的 2 张卡片整理成文：大纲；卡片：n1,n2")).toBe(true);
  });

  it("rejects other agent goals", () => {
    expect(isWriteupGoal("扩写节点 n1 的内容：xx")).toBe(false);
    expect(isWriteupGoal("帮我找一下 RAG 的笔记")).toBe(false);
  });
});

describe("WRITEUP_KINDS", () => {
  it("covers the productive output types", () => {
    expect(WRITEUP_KINDS.map((option) => option.kind)).toEqual([
      "大纲",
      "初稿",
      "总结",
      "设定集",
      "图文贴",
      "主题总结",
      "要点清单",
    ]);
  });
});
