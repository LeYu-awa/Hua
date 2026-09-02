import type { AssistantToolName } from "./assistantTools";

/**
 * 标准 Agent（function calling）的工具定义层。
 * 把前端可用的工具以 OpenAI function calling 格式暴露给模型，
 * 由模型自主决定调用哪个工具、传什么参数。
 */

export interface AgentToolCall {
  /** 模型返回的调用 id，回喂 tool 消息时需一一对应 */
  id: string;
  name: string;
  /** 参数 JSON 字符串，由调用方 parse 后执行 */
  arguments: string;
}

export interface AgentToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

/** 需要整轮人工确认的"危险"工具：写笔记、联网、外部副作用 */
export const DANGEROUS_TOOLS: ReadonlySet<string> = new Set([
  "note.create",
  "note.update",
  "note.moveCategory",
  "web.search",
  "external.openUrl",
  "external.copyText",
]);

export function isDangerousTool(name: string): boolean {
  return DANGEROUS_TOOLS.has(name);
}

/** 只读工具：模型可直接调用，无需确认 */
export function isReadOnlyTool(name: string): boolean {
  return name === "note.list" || name === "note.read" || name === "note.search";
}

/** 与后端 permissionPolicy 对应的权限配置（前端侧同步副本） */
export interface AgentPermissionPolicy {
  readWithoutConfirmation: boolean;
  writeBeforeConfirm: boolean;
  webSearchBeforeConfirm: boolean;
  externalBeforeConfirm: boolean;
}

/** 默认权限：写/联网/外部需确认，读取不确认（与后端 default_agent_config 一致） */
export const DEFAULT_AGENT_PERMISSION_POLICY: AgentPermissionPolicy = {
  readWithoutConfirmation: true,
  writeBeforeConfirm: true,
  webSearchBeforeConfirm: true,
  externalBeforeConfirm: true,
};

/** 单个工具在当前权限策略下是否需要人工确认 */
export function requiresConfirmForTool(name: string, policy: AgentPermissionPolicy): boolean {
  if (name === "note.update" || name === "note.create" || name === "note.moveCategory") {
    return policy.writeBeforeConfirm;
  }
  if (name === "web.search") {
    return policy.webSearchBeforeConfirm;
  }
  if (name === "external.openUrl" || name === "external.copyText") {
    return policy.externalBeforeConfirm;
  }
  if (isReadOnlyTool(name)) {
    return !policy.readWithoutConfirmation;
  }
  return false;
}

/** 单帧 SSE 中 tool_calls 的增量（同一 index 跨帧追加 arguments） */
export interface ToolCallStreamDelta {
  index: number;
  id?: string;
  name?: string;
  arguments?: string;
}

/** 从一帧流式响应中提取 tool_calls 增量 */
export function getStreamToolCallDelta(data: unknown): ToolCallStreamDelta[] | null {
  if (!data || typeof data !== "object") return null;
  const choices = Array.isArray((data as { choices?: unknown }).choices)
    ? (data as { choices: unknown[] }).choices
    : [];
  const first = choices[0];
  if (!first || typeof first !== "object") return null;
  const delta = (first as { delta?: unknown }).delta;
  if (!delta || typeof delta !== "object") return null;
  const toolCalls = (delta as { tool_calls?: unknown }).tool_calls;
  if (!Array.isArray(toolCalls) || toolCalls.length === 0) return null;

  const deltas: ToolCallStreamDelta[] = [];
  for (const chunk of toolCalls) {
    if (!chunk || typeof chunk !== "object") continue;
    const index = (chunk as { index?: number }).index;
    if (typeof index !== "number") continue;
    const fn = (chunk as { function?: unknown }).function;
    const fnName = fn && typeof fn === "object" ? (fn as { name?: unknown }).name : undefined;
    const fnArgs =
      fn && typeof fn === "object" ? (fn as { arguments?: unknown }).arguments : undefined;
    const id = (chunk as { id?: unknown }).id;
    deltas.push({
      index,
      id: typeof id === "string" && id ? id : undefined,
      name: typeof fnName === "string" && fnName ? fnName : undefined,
      arguments: typeof fnArgs === "string" && fnArgs ? fnArgs : undefined,
    });
  }
  return deltas.length > 0 ? deltas : null;
}

/** 把增量合并进已有 tool_calls（按 index 定位，arguments 追加） */
export function mergeToolCallDelta(
  current: AgentToolCall[],
  deltas: ToolCallStreamDelta[],
): AgentToolCall[] {
  const next = [...current];
  for (const delta of deltas) {
    let slot = next[delta.index];
    if (!slot) {
      slot = { id: "", name: "", arguments: "" };
      next[delta.index] = slot;
    }
    if (delta.id) slot.id = delta.id;
    if (delta.name) slot.name = delta.name;
    if (delta.arguments) slot.arguments += delta.arguments;
  }
  return next.filter((call) => call && (call.name || call.id));
}

/** 把模型返回的工具列表构造成 assistant 轮次消息（用于回喂） */
export function buildAssistantToolCallMessage(calls: AgentToolCall[]) {
  return {
    role: "assistant" as const,
    content: null,
    tool_calls: calls.map((call) => ({
      id: call.id,
      type: "function",
      function: {
        name: call.name,
        arguments: call.arguments || "{}",
      },
    })),
  };
}

/** 工具参数 JSON 安全解析，失败时返回空对象 */
export function parseToolArguments(raw: string): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export function buildAgentTools(): AgentToolDefinition[] {
  return [
    {
      type: "function",
      function: {
        name: "note.search",
        description:
          "在本地笔记库中按关键词搜索笔记，返回匹配的标题/分类/摘要列表。当用户提到某篇笔记但未给出确切标题时，先用它定位。",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string", description: "搜索关键词，可用空格分隔多个词" },
            limit: { type: "number", description: "返回条数上限，默认 10" },
          },
          required: ["query"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "note.read",
        description:
          "读取单篇本地笔记的完整内容。可通过 id（最精准）或标题关键词 query 定位。读取后你才能基于内容回答或改写。",
        parameters: {
          type: "object",
          properties: {
            id: { type: "string", description: "笔记的唯一 id（优先级高于 query）" },
            query: { type: "string", description: "按标题/关键词定位笔记" },
          },
        },
      },
    },
    {
      type: "function",
      function: {
        name: "note.list",
        description: "列出最近访问过的本地笔记（默认 20 篇），不带参数时返回最近笔记。",
        parameters: {
          type: "object",
          properties: {
            limit: { type: "number", description: "返回条数上限，默认 20" },
          },
        },
      },
    },
    {
      type: "function",
      function: {
        name: "note.create",
        description: "新建一篇本地笔记（默认分类为「AI整理」）。",
        parameters: {
          type: "object",
          properties: {
            title: { type: "string", description: "笔记标题" },
            content: { type: "string", description: "笔记正文（Markdown）" },
            category: { type: "string", description: "分类名，默认 AI整理" },
          },
          required: ["title"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "note.update",
        description:
          "向本地笔记写入内容。mode 为 replace（用 content 整篇覆盖）或 append（把 content 追加到末尾）。改写/优化笔记后调用它写回，此时需用户确认。",
        parameters: {
          type: "object",
          properties: {
            id: { type: "string", description: "笔记 id（推荐）" },
            query: { type: "string", description: "按标题/关键词定位笔记" },
            content: { type: "string", description: "要写入/追加的完整内容" },
            mode: {
              type: "string",
              enum: ["replace", "append"],
              description: "replace=整篇覆盖，append=追加到末尾，默认 replace",
            },
          },
          required: ["content"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "note.moveCategory",
        description: "移动笔记到新分类。",
        parameters: {
          type: "object",
          properties: {
            id: { type: "string", description: "笔记 id（推荐）" },
            query: { type: "string", description: "按标题/关键词定位笔记" },
            category: { type: "string", description: "目标分类名" },
          },
          required: ["category"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "canvas.architecture.generate",
        description:
          "在打开的知识画布上生成图（架构图 / 数据流图 / 生命周期图）：会基于用户当前选中的卡片（没有选中则整张画布）解析成卡片、连线和分组，随后在画布内弹出预览供用户确认。当用户说「把这些整理成架构图 / 生成架构图 / 画出系统架构」，或「整理成数据流图 / 生命周期图 / 状态机」这类意图时调用。图型由意图关键词自动推断（intent 含数据流/流程图→dataflow，含生命周期/状态机→lifecycle），也可直接在图型选择弹窗里切换。注意：真正落图需要用户在画布预览中点击确认。",
        parameters: {
          type: "object",
          properties: {
            intent: { type: "string", description: "用户想要的图型与强调重点，例如「把下单到发货整理成数据流图」或「画出订单状态生命周期」，可留空" },
          },
        },
      },
    },
    {
      type: "function",
      function: {
        name: "web.search",
        description: "联网搜索并返回结果摘要（标题/链接/片段），用于回答需要实时信息的问题。",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string", description: "搜索词" },
            limit: { type: "number", description: "返回条数上限，默认 5" },
          },
          required: ["query"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "external.openUrl",
        description: "在系统浏览器打开外部链接。",
        parameters: {
          type: "object",
          properties: {
            url: { type: "string", description: "完整 URL" },
          },
          required: ["url"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "external.copyText",
        description: "把文本复制到系统剪贴板。",
        parameters: {
          type: "object",
          properties: {
            text: { type: "string", description: "要复制的文本" },
          },
          required: ["text"],
        },
      },
    },
  ];
}

/** 由工具名得到中文展示名（用于执行流程状态行） */
export function toolDisplayName(name: string): string {
  const map: Record<string, string> = {
    "note.search": "搜索笔记",
    "note.read": "读取笔记",
    "note.list": "列出最近笔记",
    "note.create": "新建笔记",
    "note.update": "写回笔记",
    "note.moveCategory": "移动分类",
    "web.search": "联网搜索",
    "canvas.architecture.generate": "在画布生成架构图",
    "external.openUrl": "打开链接",
    "external.copyText": "复制文本",
  };
  return map[name] ?? name;
}

export function isKnownAgentTool(name: string): name is AssistantToolName {
  const names: readonly string[] = [
    "note.list",
    "note.read",
    "note.search",
    "note.create",
    "note.update",
    "note.moveCategory",
    "web.search",
    "external.openUrl",
    "external.copyText",
  ];
  return (names as readonly string[]).includes(name);
}
