// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  applyPlanMarkersToCanvas,
  buildContextGraph,
  parseStructuredReply,
  STRUCTURED_OUTPUT_GUIDE,
} from "./structuredReply";

const FOUR_MODULE_REPLY = `## ① 操作步骤
1. [新建 10 张内容卡片](cards:10:内容卡片) 用于收集初始想法
2. [生成画布分区标记](zone:灵感区) 划分头脑风暴区域

## ② 创作规划
- 灵感区：放置收集到的想法卡片
- 整理区：将相似想法归并为主题

## ③ 思考过程
用户想要快速开始头脑风暴，因此先生成空卡片用于收集想法，再通过分区标记组织空间。

## ④ 上下文管理
- 用户目标：完成一次头脑风暴
- 画布现状：2 张卡片`;

describe("parseStructuredReply（ai-2 四大模块解析）", () => {
  it("完整解析四大模块：操作步骤/创作规划/思考过程/上下文", () => {
    const reply = parseStructuredReply(FOUR_MODULE_REPLY);
    expect(reply).not.toBeNull();
    expect(reply!.steps.length).toBe(2);
    // ① 步骤：按钮文案 + 可执行命令
    expect(reply!.steps[0].label).toBe("新建 10 张内容卡片");
    expect(reply!.steps[0].command).toEqual({ kind: "createCards", count: 10, label: "内容卡片" });
    expect(reply!.steps[1].command).toEqual({ kind: "addZone", label: "灵感区" });
    // ② 规划
    expect(reply!.plan.map((item) => item.label)).toEqual(["灵感区", "整理区"]);
    // ③ 思考过程
    expect(reply!.reasoning).toContain("先生成空卡片");
    // ④ 上下文
    expect(reply!.context.length).toBeGreaterThan(0);
    const allItems = reply!.context.flatMap((section) => section.items);
    expect(allItems.some((item) => item.label === "用户目标")).toBe(true);
  });

  it("支持不带编号的纯中文标题", () => {
    const reply = parseStructuredReply(
      `## 操作步骤\n- [新建卡片](cards:3)\n\n## 创作规划\n- 模块A：说明\n\n## 思考过程\n推理内容\n\n## 上下文\n- 关键：值`,
    );
    expect(reply).not.toBeNull();
    expect(reply!.steps).toHaveLength(1);
    expect(reply!.plan).toHaveLength(1);
    expect(reply!.reasoning).toBe("推理内容");
  });

  it("四大模块按顺序且不缺失：缺失的模块由渲染层兜底（解析仍成功）", () => {
    const reply = parseStructuredReply(
      `## ① 操作步骤\n1. [新建卡片](cards:1)\n\n## ② 创作规划\n- 目标：说明`,
    );
    expect(reply).not.toBeNull();
    expect(reply!.steps).toHaveLength(1);
    expect(reply!.plan).toHaveLength(1);
    expect(reply!.reasoning).toBe(""); // 空，渲染层展示占位文案
    expect(reply!.context).toHaveLength(0);
  });

  it("纯文本回复（无章节）解析失败 → 回退普通气泡", () => {
    expect(parseStructuredReply("你好，我是花笺 AI 助手")).toBeNull();
  });

  it("模型未输出步骤时给出 fallbackNote", () => {
    const reply = parseStructuredReply(`## ③ 思考过程\n只分析了思路，没给步骤`);
    expect(reply).not.toBeNull();
    expect(reply!.steps).toHaveLength(0);
    expect(reply!.fallbackNote).toBeDefined();
  });

  it("输出规范提示包含四大模块", () => {
    expect(STRUCTURED_OUTPUT_GUIDE).toContain("① 操作步骤");
    expect(STRUCTURED_OUTPUT_GUIDE).toContain("② 创作规划");
    expect(STRUCTURED_OUTPUT_GUIDE).toContain("③ 思考过程");
    expect(STRUCTURED_OUTPUT_GUIDE).toContain("④ 上下文管理");
    expect(STRUCTURED_OUTPUT_GUIDE).toContain("cards:");
  });
});

describe("buildContextGraph（④ 上下文关联图谱）", () => {
  it("汇总用户输入与 AI 输出，并提供 reask 回溯文案", () => {
    const messages = [
      { role: "user" as const, content: "我想规划一个项目", createdAt: 1 },
      { role: "assistant" as const, content: "好的，我帮你拆分步骤", createdAt: 2 },
    ];
    const sections = buildContextGraph(messages);
    const items = sections.flatMap((section) => section.items);
    expect(items.length).toBe(2);
    expect(items[0].label).toBe("用户提问");
    expect(items[0].reask).toContain("我想规划一个项目");
  });

  it("结合画布快照生成画布内容条目", () => {
    const sections = buildContextGraph([], {
      documentId: "d1",
      nodes: [{ id: "n1", type: "card", text: "待办任务" }],
      updatedAt: 1,
    });
    const canvasSection = sections.find((section) => section.category === "画布内容");
    expect(canvasSection).toBeDefined();
    expect(canvasSection!.items[0].id).toBe("node-n1");
    expect(canvasSection!.items[0].reask).toContain("待办任务");
  });
});

describe("applyPlanMarkersToCanvas", () => {
  it("把创作规划转换成画布预留位置命令", () => {
    const command = applyPlanMarkersToCanvas([{ label: "灵感区", detail: "收集想法" }]);
    expect(command).toEqual({
      kind: "applyPlan",
      markers: [{ label: "灵感区", detail: "收集想法" }],
    });
  });
});
