import { describe, expect, test, vi } from "vitest";
import type { AssistantToolResponse } from "./assistantTools";
import { runAssistantPlan } from "./agentRuntime";
import type { AssistantToolPlan } from "./toolPlanner";

vi.mock("./assistantTools", () => ({
  executeAssistantTool: vi.fn(async () => ({
    tool: "note.read",
    summary: "已读取笔记「ts」。",
    data: {
      note: {
        id: "note-1",
        title: "ts",
        category: "学习",
        content: "ts 是 js 的类型超集。",
        wordCount: 11,
      },
    },
  } satisfies AssistantToolResponse)),
}));

describe("sidebar chat agent runtime", () => {
  test("runs note optimize workflow and creates a write-back confirmation plan", async () => {
    const plan: AssistantToolPlan = {
      tool: "note.read",
      params: { query: "ts" },
      title: "优化笔记内容",
      description: "读取标题为「ts」的文档，生成优化稿后等待你确认写回。",
      workflow: "note.optimize",
      instruction: "帮我把我的标题为ts的文档的内容优化一下",
    };

    const complete = vi.fn(async (prompt: string) => {
      expect(prompt).toContain("标题：ts");
      expect(prompt).toContain("ts 是 js 的类型超集。");
      return "TypeScript 是 JavaScript 的类型化超集，可以提升大型项目的可维护性。";
    });

    const result = await runAssistantPlan(plan, false, {
      complete,
      createId: () => "pending-1",
    });

    expect(result.assistantMessage).toContain("代码式变更预览已显示在对话中");
    expect(result.pendingTool?.review).toMatchObject({
      kind: "note.writeback",
      title: "ts",
      originalContent: "ts 是 js 的类型超集。",
      generatedContent: "TypeScript 是 JavaScript 的类型化超集，可以提升大型项目的可维护性。",
      workflowSteps: ["读取上下文", "生成优化稿", "人工审阅", "确认后写回"],
    });
    expect(result.pendingTool).toMatchObject({
      id: "pending-1",
      tool: "note.update",
      title: "写回优化稿：ts",
      params: {
        id: "note-1",
        title: "ts",
        category: "学习",
        mode: "replace",
        content: "TypeScript 是 JavaScript 的类型化超集，可以提升大型项目的可维护性。",
      },
    });
  });
});
