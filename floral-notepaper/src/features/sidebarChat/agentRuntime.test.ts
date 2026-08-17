import { describe, expect, test, vi } from "vitest";
import { executeAssistantTool, type AssistantToolResponse } from "./assistantTools";
import { runAssistantPlan } from "./agentRuntime";
import type { AssistantToolPlan } from "./toolPlanner";

const mockNoteReadResponse = {
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
} satisfies AssistantToolResponse;

vi.mock("./assistantTools", () => ({
  executeAssistantTool: vi.fn(async () => mockNoteReadResponse),
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

describe("web.search 图片预览渲染", () => {
  const searchPlan = (): AssistantToolPlan => ({
    tool: "web.search",
    params: { query: "樱花图片" },
    title: "联网搜索",
    description: "搜索樱花图片",
  });

  test("仅 http(s) 绝对缩略图渲染为图片预览；相对路径与非法 scheme 被过滤", async () => {
    vi.mocked(executeAssistantTool).mockImplementation(async (request) => {
      if (request.tool !== "web.search") return mockNoteReadResponse;
      return {
        tool: "web.search",
        summary: "找到 5 条结果。",
        data: {
          results: [
            {
              title: "樱花壁纸",
              url: "https://example.com/a",
              snippet: "高清",
              thumbnail: "https://cdn.example.com/a.jpg",
            },
            {
              title: "协议相对图",
              url: "https://example.com/b",
              snippet: "x",
              thumbnail: "//cdn.example.com/b.jpg",
            },
            {
              title: "相对路径图",
              url: "https://example.com/c",
              snippet: "x",
              thumbnail: "/image_proxy?url=encoded",
            },
            {
              title: "危险 scheme",
              url: "https://example.com/d",
              snippet: "x",
              thumbnail: "javascript:alert(1)",
            },
            { title: "无图结果", url: "https://example.com/e", snippet: "x" },
          ],
        },
      } satisfies AssistantToolResponse;
    });

    const { assistantMessage } = await runAssistantPlan(searchPlan(), true, {
      complete: async () => "",
    });

    expect(assistantMessage).toContain("**图片预览**");
    expect(assistantMessage).toContain("![樱花壁纸](https://cdn.example.com/a.jpg)");
    // 协议相对/相对路径/危险 scheme/空 thumbnail 均不进入预览
    expect(assistantMessage).not.toContain("cdn.example.com/b.jpg");
    expect(assistantMessage).not.toContain("/image_proxy");
    expect(assistantMessage).not.toContain("javascript:");
    // 来源列表不受影响
    expect(assistantMessage).toContain("[樱花壁纸](https://example.com/a)");
  });

  test("无有效缩略图时不渲染图片预览块", async () => {
    vi.mocked(executeAssistantTool).mockImplementation(async (request) => {
      if (request.tool !== "web.search") return mockNoteReadResponse;
      return {
        tool: "web.search",
        summary: "找到 1 条结果。",
        data: {
          results: [{ title: "纯文本结果", url: "https://example.com/f", snippet: "x" }],
        },
      } satisfies AssistantToolResponse;
    });

    const { assistantMessage } = await runAssistantPlan(searchPlan(), true, {
      complete: async () => "",
    });

    expect(assistantMessage).not.toContain("**图片预览**");
    expect(assistantMessage).toContain("**联网搜索完成**");
  });
});
