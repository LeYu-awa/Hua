import { describe, expect, test } from "vitest";
import {
  detectAssistantToolPlan,
  parseInvokeText,
  requiresConfirmation,
} from "./toolPlanner";

function expectPlan(input: string) {
  const plan = detectAssistantToolPlan(input);
  expect(plan).not.toBeNull();
  return plan!;
}

describe("sidebar chat tool planner", () => {
  test("detects realtime web search requests", () => {
    const plan = expectPlan("联网搜索 Tauri 2 权限配置");
    expect(plan.tool).toBe("web.search");
    expect(plan.params.query).toBe("Tauri 2 权限配置");
    expect(requiresConfirmation(plan.tool)).toBe(true);
  });

  test("cleans intent noise from web search queries", () => {
    const plan = expectPlan("帮我搜索一张樱花的图片");
    expect(plan.tool).toBe("web.search");
    expect(plan.params.query).toBe("樱花的图片");
    expect(requiresConfirmation(plan.tool)).toBe(true);
  });

  test("cleans polite prefixes before action words", () => {
    const plan = expectPlan("请帮我查一下最新的天气");
    expect(plan.tool).toBe("web.search");
    expect(plan.params.query).toBe("最新的天气");
    expect(requiresConfirmation(plan.tool)).toBe(true);
  });

  test("detects local note read requests without confirmation", () => {
    const plan = expectPlan("读取我的笔记 灵感");
    expect(plan.tool).toBe("note.search");
    expect(plan.params.query).toBe("我的笔记 灵感");
    expect(requiresConfirmation(plan.tool)).toBe(false);
  });

  test("detects note capability questions as local note access", () => {
    const plan = expectPlan("现在可以编辑我的文档了吗");
    expect(plan.tool).toBe("note.search");
    expect(plan.params.query).toBe("");
    expect(requiresConfirmation(plan.tool)).toBe(false);
  });

  test("detects note optimize requests by title", () => {
    const plan = expectPlan("帮我把我的标题为ts的文档的内容优化一下");
    expect(plan.tool).toBe("note.read");
    expect(plan.params.query).toBe("ts");
    expect(plan.workflow).toBe("note.optimize");
    expect(requiresConfirmation(plan.tool)).toBe(false);
  });

  test("does not guess a note target when optimize intent has no concrete title", () => {
    // 只说"优化这篇文章"但没指明哪一篇 → 不硬跑本地搜索，交给 LLM 对话
    expect(detectAssistantToolPlan("帮我优化这篇文章 并帮我总结")).toBeNull();
    expect(detectAssistantToolPlan("帮我把这篇文章优化一下")).toBeNull();
  });

  test("does not run note search on vague references without a topic", () => {
    // "总结一下这篇笔记"没有具体主题 → 交给 LLM，而不是整句搜索
    expect(detectAssistantToolPlan("总结一下这篇笔记")).toBeNull();
  });

  test("still searches local notes when a real topic is present", () => {
    const plan = expectPlan("总结 项目复盘 这篇笔记");
    expect(plan.tool).toBe("note.search");
    expect(plan.params.query).toBe("项目复盘 这篇笔记");
  });

  test("detects note create and append commands", () => {
    const create = expectPlan("/创建笔记 项目复盘｜今天完成了联网搜索");
    expect(create.tool).toBe("note.create");
    expect(create.params.title).toBe("项目复盘");
    expect(create.params.content).toBe("今天完成了联网搜索");
    expect(requiresConfirmation(create.tool)).toBe(true);

    const append = expectPlan("/追加笔记 项目复盘｜补充测试记录");
    expect(append.tool).toBe("note.update");
    expect(append.params.query).toBe("项目复盘");
    expect(append.params.mode).toBe("append");
  });

  test("detects note category moves and external tools", () => {
    const move = expectPlan("/归类笔记 项目复盘｜工作");
    expect(move.tool).toBe("note.moveCategory");
    expect(move.params.category).toBe("工作");

    const open = expectPlan("打开链接 https://example.com/docs");
    expect(open.tool).toBe("external.openUrl");
    expect(open.params.url).toBe("https://example.com/docs");

    const copy = expectPlan("复制到剪贴板 会议摘要");
    expect(copy.tool).toBe("external.copyText");
    expect(copy.params.text).toBe("会议摘要");
  });
});

describe("parseInvokeText (方案 B：模型以 <invoke> 文本模拟工具调用)", () => {
  test("parses web_search with parameters", () => {
    const call = parseInvokeText(
      '<invoke name="web_search"><parameter name="query">樱花图片 壁纸</parameter><parameter name="limit">5</parameter></invoke>',
    );
    expect(call).toEqual({ name: "web.search", params: { query: "樱花图片 壁纸", limit: "5" } });
  });

  test("normalizes underscore tool names to dot notation", () => {
    const call = parseInvokeText('<invoke name="note_search"><parameter name="query">复盘</parameter></invoke>');
    expect(call?.name).toBe("note.search");
  });

  test("returns null for plain text without an invoke tag", () => {
    expect(parseInvokeText("这是普通的回答文本")).toBeNull();
    expect(parseInvokeText("")).toBeNull();
  });

  test("matches invoke tags embedded in surrounding prose", () => {
    const call = parseInvokeText(
      '好的，我来帮你搜索。<invoke name="web_search"><parameter name="query">樱花 图片</parameter></invoke>',
    );
    expect(call).toEqual({ name: "web.search", params: { query: "樱花 图片" } });
  });
});
