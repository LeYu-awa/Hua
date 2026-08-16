import type { CanvasNodeType } from "./types";

/**
 * 画布命令桥（ai-3）
 *
 * AI 面板（SidebarChat）与画布（CanvasPage）是兄弟组件，通过全局 CustomEvent 通信：
 * - SidebarChat 调用 dispatchCanvasCommand() 触发画布操作（建卡/分区/规划标记/定位/缩放）
 * - CanvasPage 挂载 onCanvasCommand() 监听并执行，执行结果通过 canvas-snapshot 回传
 * - CanvasPage 调用 dispatchCanvasSnapshot() 广播画布内容，供 AI 上下文模块（④）使用
 *
 * 事件名与载荷是跨组件契约，改动作业需同步更新两侧与单测。
 */

export const CANVAS_COMMAND_EVENT = "floral:canvas-command";
export const CANVAS_SNAPSHOT_EVENT = "floral:canvas-snapshot";
export const CANVAS_SNAPSHOT_REQUEST_EVENT = "floral:canvas-snapshot-request";
export const AI_REQUEST_EVENT = "floral:ai-request";

export interface CreateCardsCommand {
  kind: "createCards";
  /** 新建卡片数量 */
  count: number;
  /** 卡片内容（可留空，使用默认占位文案） */
  label: string;
}

export interface CreateNodeCommand {
  kind: "createNode";
  type: CanvasNodeType;
  text: string;
}

export interface AddZoneCommand {
  kind: "addZone";
  /** 分区名称，如「灵感区」 */
  label: string;
}

export interface ApplyPlanCommand {
  kind: "applyPlan";
  /** 创作规划中的模块占位标记（自动在画布预留卡片摆放位置） */
  markers: { label: string; detail?: string }[];
}

export interface SelectNodeCommand {
  kind: "selectNode";
  nodeId: string;
}

export interface PanToCommand {
  kind: "panTo";
  x: number;
  y: number;
}

export interface ZoomToCommand {
  kind: "zoomTo";
  scale: number;
}

export interface RunTutorialCommand {
  kind: "runTutorial";
}

export type CanvasCommand =
  | CreateCardsCommand
  | CreateNodeCommand
  | AddZoneCommand
  | ApplyPlanCommand
  | SelectNodeCommand
  | PanToCommand
  | ZoomToCommand
  | RunTutorialCommand;

/** 画布内容快照（AI 上下文模块读取） */
export interface CanvasSnapshot {
  documentId: string;
  nodes: { id: string; type: CanvasNodeType; text: string }[];
  updatedAt: number;
}

/** AI 请求（引导完成/卡片按钮 → 唤醒 AI 面板） */
export interface AiRequestPayload {
  /** 预填输入框的文案；autoSend 为 true 时直接发送 */
  prompt: string;
  autoSend?: boolean;
}

/** 向画布广播一条可执行命令 */
export function dispatchCanvasCommand(command: CanvasCommand): void {
  window.dispatchEvent(new CustomEvent(CANVAS_COMMAND_EVENT, { detail: command }));
}

/** 订阅画布命令，返回取消订阅函数 */
export function onCanvasCommand(callback: (command: CanvasCommand) => void): () => void {
  const handler = (event: Event) => {
    callback((event as CustomEvent<CanvasCommand>).detail);
  };
  window.addEventListener(CANVAS_COMMAND_EVENT, handler);
  return () => window.removeEventListener(CANVAS_COMMAND_EVENT, handler);
}

/** 向 AI 面板广播最新画布快照 */
export function dispatchCanvasSnapshot(snapshot: CanvasSnapshot): void {
  window.dispatchEvent(new CustomEvent(CANVAS_SNAPSHOT_EVENT, { detail: snapshot }));
}

/** 订阅画布快照 */
export function onCanvasSnapshot(callback: (snapshot: CanvasSnapshot) => void): () => void {
  const handler = (event: Event) => {
    callback((event as CustomEvent<CanvasSnapshot>).detail);
  };
  window.addEventListener(CANVAS_SNAPSHOT_EVENT, handler);
  return () => window.removeEventListener(CANVAS_SNAPSHOT_EVENT, handler);
}

/** 请求画布立即回传当前快照（AI 打开上下文模块时调用） */
export function requestCanvasSnapshot(): void {
  window.dispatchEvent(new CustomEvent(CANVAS_SNAPSHOT_REQUEST_EVENT));
}

/** 订阅快照请求（CanvasPage 注册，收到后立即回传） */
export function onCanvasSnapshotRequest(callback: () => void): () => void {
  const handler = () => callback();
  window.addEventListener(CANVAS_SNAPSHOT_REQUEST_EVENT, handler);
  return () => window.removeEventListener(CANVAS_SNAPSHOT_REQUEST_EVENT, handler);
}

/** 唤醒 AI 面板（引导联动 ob-4 / 结构化步骤 re-ask） */
export function dispatchAiRequest(payload: AiRequestPayload): void {
  window.dispatchEvent(new CustomEvent(AI_REQUEST_EVENT, { detail: payload }));
}

/** 订阅 AI 请求 */
export function onAiRequest(callback: (payload: AiRequestPayload) => void): () => void {
  const handler = (event: Event) => {
    callback((event as CustomEvent<AiRequestPayload>).detail);
  };
  window.addEventListener(AI_REQUEST_EVENT, handler);
  return () => window.removeEventListener(AI_REQUEST_EVENT, handler);
}

/** 步骤 DSL 解析：`cards:10:内容卡片` / `zone:灵感区` / `node:task:待办任务` / `plan:模块名` */
export function parseCommandDsl(dsl: string): CanvasCommand | null {
  const parts = dsl.split(":").map((part) => part.trim());
  const [kind, ...rest] = parts;
  switch (kind) {
    case "cards": {
      const count = Number.parseInt(rest[0] ?? "1", 10);
      return {
        kind: "createCards",
        count: Number.isFinite(count) && count > 0 ? Math.min(count, 50) : 1,
        label: rest.slice(1).join(":") || "",
      };
    }
    case "zone":
      return { kind: "addZone", label: rest.join(":") || "新分区" };
    case "plan":
      return { kind: "addZone", label: rest.join(":") || "新模块" };
    case "node": {
      const type = (rest[0] ?? "text") as CanvasNodeType;
      const valid: CanvasNodeType[] = ["text", "card", "resource", "task"];
      return {
        kind: "createNode",
        type: valid.includes(type) ? type : "text",
        text: rest.slice(1).join(":"),
      };
    }
    case "select":
      return { kind: "selectNode", nodeId: rest.join(":") };
    case "panto": {
      const x = Number.parseFloat(rest[0] ?? "0");
      const y = Number.parseFloat(rest[1] ?? "0");
      return { kind: "panTo", x: Number.isFinite(x) ? x : 0, y: Number.isFinite(y) ? y : 0 };
    }
    case "zoomto": {
      const scale = Number.parseFloat(rest[0] ?? "1");
      return {
        kind: "zoomTo",
        scale: Number.isFinite(scale) && scale > 0 ? Math.min(scale, 3) : 1,
      };
    }
    case "tutorial":
      return { kind: "runTutorial" };
    default:
      return null;
  }
}

export interface ParsedStep {
  /** 步骤按钮文案 */
  label: string;
  /** 解析出的可执行命令（解析失败时无命令，按钮不渲染） */
  command?: CanvasCommand;
  /** 步骤说明（按钮之后的补充文字） */
  detail?: string;
}

const STEP_LINK_RE = /\[([^\]]+)\]\(([a-z_]+:[^)]+)\)/;
/** 兜底：形如 [按钮](xx) 但 DSL 非法时，仍提取按钮文案（不生成假命令） */
const BRACKET_LINK_RE = /\[([^\]]+)\]\(([^)]+)\)/;
/** 步骤行前缀：列表符号 / 序号（-、*、1.、1、1) 等） */
const STEP_PREFIX_RE = /^\s*(?:[-*]|\d+[.、)])\s*/;

/**
 * 解析单条步骤文本中的 `[按钮](dsl)` 快捷命令。
 * - 合法 DSL（含 `kind:`）→ 生成可执行命令，剩余文字作为 detail；
 * - 形如 `[按钮](非法)` → 提取按钮文案但不生成命令（避免渲染无法执行的假按钮）；
 * - 纯文本 → 普通文本步骤。
 */
export function parseStepLink(text: string): ParsedStep {
  const match = STEP_LINK_RE.exec(text);
  if (match) {
    const command = parseCommandDsl(match[2]);
    const remainder = text.replace(match[0], "").replace(STEP_PREFIX_RE, "").trim();
    const trailingDetail = remainder.replace(/^\s*[,，:：]\s*/, "").trim();
    return {
      label: match[1].trim(),
      command: command ?? undefined,
      detail: trailingDetail || undefined,
    };
  }
  const bracket = BRACKET_LINK_RE.exec(text);
  if (bracket) {
    const remainder = text.replace(bracket[0], "").replace(STEP_PREFIX_RE, "").trim();
    const trailingDetail = remainder.replace(/^\s*[,，:：]\s*/, "").trim();
    return {
      label: bracket[1].trim(),
      command: undefined,
      detail: trailingDetail || undefined,
    };
  }
  return { label: text.replace(STEP_PREFIX_RE, "").trim(), detail: undefined };
}
