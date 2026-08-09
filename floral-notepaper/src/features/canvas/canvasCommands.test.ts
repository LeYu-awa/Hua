// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CANVAS_COMMAND_EVENT,
  CANVAS_SNAPSHOT_EVENT,
  AI_REQUEST_EVENT,
  dispatchCanvasCommand,
  dispatchCanvasSnapshot,
  dispatchAiRequest,
  onCanvasCommand,
  onCanvasSnapshot,
  onAiRequest,
  parseCommandDsl,
  parseStepLink,
} from "./canvasCommands";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("parseCommandDsl（步骤命令 DSL → 画布命令）", () => {
  it("cards:N:label → createCards", () => {
    const command = parseCommandDsl("cards:10:内容卡片");
    expect(command).toEqual({ kind: "createCards", count: 10, label: "内容卡片" });
  });

  it("cards 数量非法时兜底为 1，超量截断到 50", () => {
    expect(parseCommandDsl("cards:abc")).toEqual({ kind: "createCards", count: 1, label: "" });
    expect(parseCommandDsl("cards:999")).toEqual({ kind: "createCards", count: 50, label: "" });
  });

  it("zone:xxx → addZone", () => {
    expect(parseCommandDsl("zone:灵感区")).toEqual({ kind: "addZone", label: "灵感区" });
  });

  it("plan:xxx → addZone（规划标记复用分区命令）", () => {
    expect(parseCommandDsl("plan:目标区")).toEqual({ kind: "addZone", label: "目标区" });
  });

  it("node:type:text → createNode，非法类型兜底 text", () => {
    expect(parseCommandDsl("node:task:待办任务")).toEqual({ kind: "createNode", type: "task", text: "待办任务" });
    expect(parseCommandDsl("node:bogus:x")).toEqual({ kind: "createNode", type: "text", text: "x" });
  });

  it("select:panto:zoomto 各命令可解析", () => {
    expect(parseCommandDsl("select:n1")).toEqual({ kind: "selectNode", nodeId: "n1" });
    expect(parseCommandDsl("panto:120:80")).toEqual({ kind: "panTo", x: 120, y: 80 });
    expect(parseCommandDsl("zoomto:1.5")).toEqual({ kind: "zoomTo", scale: 1.5 });
  });

  it("未知 DSL 返回 null", () => {
    expect(parseCommandDsl("nonsense")).toBeNull();
  });
});

describe("parseStepLink（步骤行 [按钮](dsl) 提取）", () => {
  it("提取按钮文案与命令，剩余文字作为 detail", () => {
    const parsed = parseStepLink("- [新建 10 张内容卡片](cards:10:内容卡片) 用于收集初始想法");
    expect(parsed.label).toBe("新建 10 张内容卡片");
    expect(parsed.command).toEqual({ kind: "createCards", count: 10, label: "内容卡片" });
    expect(parsed.detail).toBe("用于收集初始想法");
  });

  it("无命令的普通步骤不生成按钮（command 为 undefined）", () => {
    const parsed = parseStepLink("1. 双击卡片补充内容");
    expect(parsed.command).toBeUndefined();
    expect(parsed.label).toBe("双击卡片补充内容");
  });

  it("DSL 解析失败时 command 为 undefined（不渲染假按钮）", () => {
    const parsed = parseStepLink("- [奇怪按钮](not-a-command)");
    expect(parsed.label).toBe("奇怪按钮");
    expect(parsed.command).toBeUndefined();
  });
});

describe("画布命令桥事件", () => {
  it("dispatchCanvasCommand → onCanvasCommand 收到同一命令载荷", () => {
    const listener = vi.fn();
    const unlisten = onCanvasCommand(listener);
    const command = { kind: "createCards", count: 3, label: "想法" };
    dispatchCanvasCommand(command);
    expect(listener).toHaveBeenCalledWith(command);
    unlisten();
  });

  it("取消订阅后不再收到命令", () => {
    const listener = vi.fn();
    const unlisten = onCanvasCommand(listener);
    unlisten();
    window.dispatchEvent(new CustomEvent(CANVAS_COMMAND_EVENT, { detail: { kind: "addZone", label: "x" } }));
    expect(listener).not.toHaveBeenCalled();
  });

  it("dispatchCanvasSnapshot → onCanvasSnapshot 收到快照", () => {
    const listener = vi.fn();
    const unlisten = onCanvasSnapshot(listener);
    const snapshot = { documentId: "d1", nodes: [{ id: "n1", type: "card", text: "hi" }], updatedAt: 1 };
    dispatchCanvasSnapshot(snapshot);
    expect(listener).toHaveBeenCalledWith(snapshot);
    unlisten();
  });

  it("dispatchAiRequest → onAiRequest 收到载荷（含 autoSend）", () => {
    const listener = vi.fn();
    const unlisten = onAiRequest(listener);
    dispatchAiRequest({ prompt: "帮我规划", autoSend: true });
    expect(listener).toHaveBeenCalledWith({ prompt: "帮我规划", autoSend: true });
    unlisten();
  });
});
