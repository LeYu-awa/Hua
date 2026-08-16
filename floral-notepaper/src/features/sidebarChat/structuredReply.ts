import {
  parseStepLink,
  type CanvasSnapshot,
  type CanvasCommand,
  type ParsedStep,
} from "../canvas/canvasCommands";

/**
 * AI 结构化输出（ai-2）
 *
 * AI 回复固定为四大模块，按序输出：
 *   ① 操作步骤  ② 创作规划  ③ 思考过程  ④ 上下文管理
 *
 * 模型产出 Markdown，解析器按章节标题切分。步骤支持 `[按钮](dsl)` 快捷命令语法，
 * 解析结果由 StructuredReplyView 渲染成可一键执行的画布操作按钮。
 */

/** 上下文图谱构建所需的最小会话消息结构（与 SidebarChatMessage 结构兼容） */
export interface ContextMessageLike {
  role: "user" | "assistant";
  content: string;
  createdAt: number;
}

export interface StructuredStep extends ParsedStep {
  /** 步骤原始文本（含 DSL，供展示/回溯） */
  raw: string;
}

export interface PlanItem {
  /** 规划模块名（画布预留位置标记用） */
  label: string;
  /** 规划说明 */
  detail?: string;
}

export interface ContextGraphSection {
  category: string;
  items: ContextGraphItem[];
}

export interface ContextGraphItem {
  id: string;
  label: string;
  value?: string;
  /** 点击回溯时回填输入框的文案 */
  reask?: string;
}

export interface StructuredReply {
  steps: StructuredStep[];
  plan: PlanItem[];
  reasoning: string;
  context: ContextGraphSection[];
  /** 未解析出结构化内容的提示（模型没按格式输出时兜底） */
  fallbackNote?: string;
}

/** 章节标题识别：`## ① 操作步骤` / `## 1. 操作步骤` / `### 思考过程` 等 */
const SECTION_HEADER_RE =
  /^#{1,6}\s*(?:[①-⑩]|[1-9][.、:：]?|步骤|规划|思考|上下文|记忆)?\s*(操作步骤|落地步骤|执行步骤|步骤|创作规划|规划|创作框架|布局计划|思考过程|推理过程|为什么|上下文|上下文管理|历史记录|记忆)/;

function splitSections(markdown: string): {
  steps: string;
  plan: string;
  reasoning: string;
  context: string;
} {
  const sections: Record<string, string> = {};
  const lines = markdown.split(/\r?\n/);
  let current: keyof typeof sections | null = null;
  const buffer: string[] = [];

  const flush = () => {
    if (current) sections[current] = buffer.join("\n").trim();
    buffer.length = 0;
  };

  for (const line of lines) {
    const match = SECTION_HEADER_RE.exec(line);
    if (match) {
      flush();
      const heading = match[1];
      if (/(操作步骤|落地步骤|执行步骤|步骤)/.test(heading)) current = "steps";
      else if (/(创作规划|规划|创作框架|布局计划)/.test(heading)) current = "plan";
      else if (/(思考过程|推理过程|为什么)/.test(heading)) current = "reasoning";
      else if (/(上下文|历史记录|记忆)/.test(heading)) current = "context";
      else current = null;
      continue;
    }
    buffer.push(line);
  }
  flush();
  return {
    steps: sections.steps ?? "",
    plan: sections.plan ?? "",
    reasoning: sections.reasoning ?? "",
    context: sections.context ?? "",
  };
}

function isListLine(line: string): boolean {
  return /^\s*(?:[-*+]|\d+[.、)])\s+/.test(line.trim());
}

/** 解析步骤区块：每行一条，提取 [按钮](dsl) 命令 */
function parseSteps(text: string): StructuredStep[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && isListLine(line))
    .map((line) => {
      const parsed = parseStepLink(line);
      return { ...parsed, raw: line.replace(/^\s*(?:[-*]|\d+[.、)])\s*/, "") };
    })
    .filter((step) => step.label.length > 0);
}

/** 解析创作规划区块：`- 模块名：说明` / `- [标记](zone:灵感区)` */
function parsePlan(text: string): PlanItem[] {
  const items: PlanItem[] = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || !isListLine(trimmed)) continue;
    const content = trimmed.replace(/^\s*(?:[-*+]|\d+[.、)])\s+/, "").trim();
    if (!content) continue;
    const colon = content.search(/[：:]/);
    if (colon > 0) {
      items.push({
        label: content.slice(0, colon).trim(),
        detail: content.slice(colon + 1).trim(),
      });
    } else {
      items.push({ label: content });
    }
  }
  return items;
}

/** 解析上下文区块：`- 标签：内容` */
function parseContext(text: string): ContextGraphSection[] {
  const items: ContextGraphItem[] = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const content = trimmed.replace(/^\s*(?:[-*+]|\d+[.、)])\s+/, "").trim();
    if (!content) continue;
    const colon = content.search(/[：:]/);
    if (colon > 0) {
      items.push({
        id: `ctx-${items.length}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        label: content.slice(0, colon).trim(),
        value: content.slice(colon + 1).trim(),
      });
    } else {
      items.push({
        id: `ctx-${items.length}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        label: content,
      });
    }
  }
  return items.length > 0 ? [{ category: "AI 记录", items }] : [];
}

/**
 * 解析 AI 回复为四大模块结构化数据。
 * 至少识别出操作步骤/创作规划/思考过程任一模块才算结构化（否则回退为普通气泡）。
 * 四大模块渲染层始终展示，缺失的模块用占位文案兜底。
 */
export function parseStructuredReply(markdown: string): StructuredReply | null {
  const { steps, plan, reasoning, context } = splitSections(markdown);
  const parsedSteps = parseSteps(steps);
  const parsedPlan = parsePlan(plan);
  const reasoningText = reasoning.trim();
  const contextSections = parseContext(context);

  if (parsedSteps.length === 0 && parsedPlan.length === 0 && !reasoningText) {
    return null;
  }

  return {
    steps: parsedSteps,
    plan: parsedPlan,
    reasoning: reasoningText,
    context: contextSections,
    fallbackNote:
      parsedSteps.length === 0
        ? "AI 未按规范输出操作步骤，点击下方问题可继续追问细化。"
        : undefined,
  };
}

/** 拼接四大模块的结构化输出系统指令（追加到 Agent 系统提示末尾） */
export const STRUCTURED_OUTPUT_GUIDE =
  "\n\n=== 输出格式要求（必须严格遵守）===\n" +
  "当你完成分析时，必须按以下四个 Markdown 章节输出，顺序不可调换、章节不可缺失（可保留空章节）：\n" +
  "## ① 操作步骤\n" +
  "把当前创作要执行的具体落地步骤列成编号列表。每条步骤若对应画布操作，必须在行内附带可执行命令，格式为「[按钮文案](命令语法)」。命令语法见下：\n" +
  "- cards:数量:占位文案 —— 新建 N 张内容卡片（例：[新建 10 张内容卡片](cards:10:内容卡片)）\n" +
  "- zone:分区名 —— 生成画布分区标记（例：[生成画布分区标记](zone:灵感区)）\n" +
  "- node:类型:内容 —— 新建单个节点，类型取 text/card/resource/task（例：[新建待办卡片](node:task:待办任务)）\n" +
  "如果某步骤不涉及画布操作，则只写文字说明，不要生成按钮。\n" +
  "## ② 创作规划\n" +
  "基于用户需求生成整体创作框架，用「- 模块名：说明」列出每个模块及用途，AI 会自动在画布预留这些模块的卡片摆放位置。\n" +
  "## ③ 思考过程\n" +
  "透明化说明你的推理逻辑：为什么拆解出上述步骤与规划、依据用户哪些诉求做出决策，让用户理解分析路径。\n" +
  "## ④ 上下文管理\n" +
  "用「- 标签：内容」记录本次涉及的关键上下文（用户目标、画布现状、已生成内容），便于后续回溯。";

/**
 * 由当前会话历史 + 画布快照构建上下文关联图谱（④ 模块）。
 * 用于展示与回溯：对话条目可回填输入框，画布卡片可跳转定位。
 */
export function buildContextGraph(
  messages: ContextMessageLike[],
  snapshot?: CanvasSnapshot | null,
): ContextGraphSection[] {
  const sections: ContextGraphSection[] = [];
  const recent = messages.slice(-14);
  if (recent.length > 0) {
    const items = recent
      .filter((m) => m.content && m.content.trim().length > 0)
      .map((m, index) => ({
        id: `msg-${m.createdAt}-${index}`,
        label: m.role === "user" ? "用户提问" : "AI 回复",
        value: m.content.replace(/\s+/g, " ").slice(0, 60) + (m.content.length > 60 ? "…" : ""),
        reask: m.role === "user" ? m.content.slice(0, 400) : undefined,
      }));
    sections.push({ category: "对话历史", items });
  }
  if (snapshot && snapshot.nodes.length > 0) {
    sections.push({
      category: "画布内容",
      items: snapshot.nodes.slice(-12).map((node) => ({
        id: `node-${node.id}`,
        label: `${node.type === "card" ? "卡片" : "节点"} · ${node.text.replace(/\s+/g, " ").slice(0, 40)}`,
        value: undefined,
        reask: `画布中的「${node.text.slice(0, 60)}」内容是什么？请结合它继续我的创作`,
      })),
    });
  }
  return sections;
}

export function applyPlanMarkersToCanvas(markers: PlanItem[]): CanvasCommand {
  return { kind: "applyPlan", markers };
}
