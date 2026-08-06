import {
  executeAssistantTool,
  type AssistantToolResponse,
  type WebSearchResult,
} from "./assistantTools";
import { toolLabel, type AssistantToolPlan } from "./toolPlanner";

export type PendingToolPlan = AssistantToolPlan & {
  id: string;
  review?: AgentReviewPayload;
};

type RecordLike = Record<string, unknown>;

export interface CompletionOptions {
  onDelta?: (delta: string) => void;
}

export interface AgentRuntimeOptions {
  complete: (prompt: string, options?: CompletionOptions) => Promise<string>;
  createId?: () => string;
  onStatus?: (status: string) => void;
  onGeneratedDelta?: (delta: string) => void;
}

export interface AgentRuntimeResult {
  assistantMessage: string;
  pendingTool?: PendingToolPlan;
}

export interface AgentReviewStats {
  chars: number;
  words: number;
  lines: number;
  paragraphs: number;
}

export interface AgentReviewPayload {
  kind: "note.writeback";
  noteId: string;
  title: string;
  category: string;
  mode: "replace" | "append";
  instruction: string;
  originalContent: string;
  generatedContent: string;
  originalStats: AgentReviewStats;
  generatedStats: AgentReviewStats;
  changeSummary: string[];
  riskFlags: string[];
  workflowSteps: string[];
}

export async function runAssistantPlan(
  plan: AssistantToolPlan,
  confirmed: boolean,
  options: AgentRuntimeOptions,
): Promise<AgentRuntimeResult> {
  options.onStatus?.(`调用工具：${toolLabel(plan.tool)}`);
  const response = await executeAssistantTool({
    tool: plan.tool,
    params: plan.params,
    confirmed,
  });

  if (plan.workflow === "note.optimize") {
    return runNoteOptimizeWorkflow(plan, response, options);
  }

  options.onStatus?.("工具执行完成");
  return { assistantMessage: formatToolResponse(response) };
}

export function buildPendingToolMessage(plan: AssistantToolPlan) {
  return `我准备调用工具 **${toolLabel(plan.tool)}**。\n\n${plan.description}\n\n为保护你的笔记和外部操作安全，请确认后执行。`;
}

export function formatToolParams(params: Record<string, unknown>) {
  const pairs = Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== "")
    .map(([key, value]) => {
      const text = typeof value === "string" ? value : JSON.stringify(value);
      return `${key}: ${text.length > 80 ? `${text.slice(0, 80)}…` : text}`;
    });
  return pairs.length > 0 ? pairs.join("\n") : "无额外参数";
}

export function getErrorText(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (isRecord(error)) {
    if (typeof error.message === "string") return error.message;
    if (typeof error.error === "string") return error.error;
    if (typeof error.code === "string") return error.code;
    try {
      return JSON.stringify(error);
    } catch {
      return String(error);
    }
  }
  if (error == null) return "操作失败：没有收到错误详情";
  return String(error);
}

/**
 * 把工具执行结果转成回喂给模型（tool 消息）的纯文本。
 * 与 formatToolResponse 不同：这里面向模型理解，保留 id/分类等结构化信息。
 */
export function formatAgentToolOutput(tool: string, response: AssistantToolResponse): string {
  const data = isRecord(response.data) ? response.data : {};

  if (tool === "web.search") {
    const results = Array.isArray(data.results) ? data.results.filter(isRecord) : [];
    if (results.length === 0) return `联网搜索无结果。${response.summary}`;
    return results
      .slice(0, 10)
      .map((item, index) => {
        const title = getString(item.title, "无标题");
        const url = getString(item.url);
        const snippet = getString(item.snippet).replace(/\s+/g, " ").slice(0, 200);
        return `[${index + 1}] ${title}\n链接：${url}\n摘要：${snippet}`;
      })
      .join("\n\n");
  }

  if (tool === "note.list" || tool === "note.search") {
    const notes = Array.isArray(data.notes) ? data.notes.filter(isRecord) : [];
    if (notes.length === 0) return `未找到匹配笔记。${response.summary}`;
    return notes
      .slice(0, 20)
      .map((note) => {
        const id = getString(note.id);
        const title = getString(note.title, "无标题");
        const category = getString(note.category) || "未分类";
        const preview = getString(note.preview).replace(/\s+/g, " ").slice(0, 100);
        return `- id=${id || "未知"} 标题=「${title}」 分类=「${category}」${preview ? ` 摘要：${preview}` : ""}`;
      })
      .join("\n");
  }

  if (tool === "note.read") {
    const note = isRecord(data.note) ? data.note : null;
    if (!note) return `读取笔记未返回内容。${response.summary}`;
    const id = getString(note.id);
    const title = getString(note.title, "无标题");
    const content = getString(note.content);
    return `笔记「${title}」（id=${id || "未知"}）完整内容：\n${content}`;
  }

  if (tool === "note.update") {
    const mode = getString(data.mode, "replace");
    const note = isRecord(data.note) ? data.note : null;
    const title = getString(note?.title, "笔记");
    const wordCount = typeof note?.wordCount === "number" ? note.wordCount : 0;
    return `已${mode === "replace" ? "整篇覆盖" : "追加"}笔记「${title}」，正文现约 ${wordCount} 字。`;
  }

  return response.summary;
}

async function runNoteOptimizeWorkflow(
  plan: AssistantToolPlan,
  response: AssistantToolResponse,
  options: AgentRuntimeOptions,
): Promise<AgentRuntimeResult> {
  const note = getToolNote(response);
  if (!note) throw new Error("已读取工具返回，但没有拿到目标文档内容");

  const id = getString(note.id);
  const title = getString(note.title, "无标题");
  const category = getString(note.category);
  const originalContent = getString(note.content);
  if (!id) throw new Error("目标文档缺少 id，无法写回");
  if (!originalContent.trim()) throw new Error(`文档「${title}」内容为空，无法优化`);

  options.onStatus?.(`已读取文档「${title}」，开始生成优化稿`);
  const optimizedContent = await options.complete(buildOptimizePrompt(note, plan.instruction), {
    onDelta: options.onGeneratedDelta,
  });
  if (!optimizedContent.trim()) throw new Error("模型没有生成可写回的优化内容");

  const review: AgentReviewPayload = {
    kind: "note.writeback",
    noteId: id,
    title,
    category,
    mode: "replace",
    instruction: plan.instruction ?? "优化内容表达",
    originalContent,
    generatedContent: optimizedContent,
    originalStats: buildStats(originalContent),
    generatedStats: buildStats(optimizedContent),
    changeSummary: buildChangeSummary(originalContent, optimizedContent),
    riskFlags: buildRiskFlags(originalContent, optimizedContent),
    workflowSteps: ["读取上下文", "生成优化稿", "人工审阅", "确认后写回"],
  };

  const pendingTool: PendingToolPlan = {
    id: options.createId?.() ?? createRuntimeId(),
    tool: "note.update",
    params: {
      id,
      title,
      category,
      content: optimizedContent,
      mode: "replace",
    },
    title: `写回优化稿：${title}`,
    description: `将生成的优化稿替换写回文档「${title}」。`,
    destructive: true,
    review,
  };

  options.onStatus?.("优化稿已生成，已在对话中生成代码式变更预览，等待确认写回");
  return {
    assistantMessage: `已生成「${title}」的优化稿，代码式变更预览已显示在对话中。绿色为新增、红色为删减；确认后才会写回原文档。`,
    pendingTool,
  };
}

function formatToolResponse(response: AssistantToolResponse) {
  const data = isRecord(response.data) ? response.data : {};

  if (response.tool === "web.search") {
    const results = Array.isArray(data.results)
      ? data.results.filter((item): item is WebSearchResult =>
          isRecord(item) &&
          typeof item.title === "string" &&
          typeof item.url === "string" &&
          typeof item.snippet === "string",
        )
      : [];
    const sources = formatSearchSources(results);
    return sources
      ? `**联网搜索完成**\n\n${response.summary}\n\n**来源**\n${sources}`
      : `**联网搜索完成**\n\n${response.summary}`;
  }

  if (response.tool === "note.list" || response.tool === "note.search") {
    return `**${toolLabel(response.tool)}完成**\n\n${response.summary}\n\n${formatNotes(data.notes)}`;
  }

  if (
    response.tool === "note.read" ||
    response.tool === "note.create" ||
    response.tool === "note.update" ||
    response.tool === "note.moveCategory"
  ) {
    return `**${toolLabel(response.tool)}完成**\n\n${response.summary}${formatNote(data.note)}`;
  }

  return `**${toolLabel(response.tool)}完成**\n\n${response.summary}`;
}

function buildOptimizePrompt(note: RecordLike, instruction = "") {
  const title = getString(note.title, "无标题");
  const content = getString(note.content);
  return [
    "请优化下面这篇笔记/文档。",
    "要求：只输出优化后的完整正文，不要输出解释、标题、前后缀或 Markdown 代码块。",
    instruction ? `用户原始指令：${instruction}` : "用户原始指令：优化内容表达。",
    `标题：${title}`,
    "原文：",
    content,
  ].join("\n\n");
}

function buildStats(content: string): AgentReviewStats {
  const normalized = content.trim();
  return {
    chars: [...normalized].length,
    words: normalized ? normalized.split(/\s+/).filter(Boolean).length : 0,
    lines: normalized ? normalized.split(/\r?\n/).length : 0,
    paragraphs: normalized ? normalized.split(/\n\s*\n/).filter((item) => item.trim()).length : 0,
  };
}

function buildChangeSummary(originalContent: string, generatedContent: string) {
  const original = buildStats(originalContent);
  const generated = buildStats(generatedContent);
  const charDelta = generated.chars - original.chars;
  const paragraphDelta = generated.paragraphs - original.paragraphs;
  const summary = [
    `正文长度${formatDelta(charDelta)}个字符`,
    `段落数量${formatDelta(paragraphDelta)}段`,
  ];

  if (originalContent.trim() === generatedContent.trim()) {
    return ["优化稿与原文基本一致，写回前建议确认是否需要重新生成。"];
  }

  if (Math.abs(charDelta) > Math.max(120, original.chars * 0.25)) {
    summary.push(charDelta > 0 ? "内容扩写幅度较明显" : "内容压缩幅度较明显");
  }

  return summary;
}

function buildRiskFlags(originalContent: string, generatedContent: string) {
  const original = buildStats(originalContent);
  const generated = buildStats(generatedContent);
  const flags: string[] = [];

  if (generated.chars < original.chars * 0.55) {
    flags.push("优化稿明显短于原文，可能删减了细节");
  }
  if (generated.chars > original.chars * 1.8) {
    flags.push("优化稿明显长于原文，可能加入了较多扩写内容");
  }
  if (!generatedContent.trim()) {
    flags.push("优化稿为空，不能写回");
  }

  return flags.length > 0 ? flags : ["未发现明显写回风险，仍建议人工审阅后确认"];
}

function formatDelta(value: number) {
  if (value > 0) return `增加 ${value}`;
  if (value < 0) return `减少 ${Math.abs(value)}`;
  return "不变 0";
}

function getToolNote(response: AssistantToolResponse) {
  const data = isRecord(response.data) ? response.data : {};
  return isRecord(data.note) ? data.note : null;
}

function formatNotes(notes: unknown) {
  if (!Array.isArray(notes) || notes.length === 0) return "未找到匹配笔记。";

  return notes
    .slice(0, 8)
    .map((item) => {
      if (!isRecord(item)) return null;
      const title = getString(item.title, "无标题");
      const category = getString(item.category, "") || "未分类";
      const preview = getString(item.preview, "").replace(/\s+/g, " ").slice(0, 80);
      return `- **${title}**｜${category}${preview ? `｜${preview}` : ""}`;
    })
    .filter(Boolean)
    .join("\n");
}

function formatNote(note: unknown) {
  if (!isRecord(note)) return "";
  const title = getString(note.title, "无标题");
  const category = getString(note.category, "") || "未分类";
  const wordCount = typeof note.wordCount === "number" ? note.wordCount : 0;
  return `\n\n- 标题：${title}\n- 分类：${category}\n- 字数：${wordCount}`;
}

function formatSearchSources(results: WebSearchResult[]) {
  if (results.length === 0) return "";
  return results.map((item, index) => `- [${index + 1}] [${item.title}](${item.url})`).join("\n");
}

function isRecord(value: unknown): value is RecordLike {
  return typeof value === "object" && value !== null;
}

function getString(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function createRuntimeId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
