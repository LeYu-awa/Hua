import type { AssistantToolName, AssistantToolRequest } from "./assistantTools";

export interface AssistantToolPlan extends AssistantToolRequest {
  title: string;
  description: string;
  destructive?: boolean;
  workflow?: "note.optimize";
  instruction?: string;
}

const SEARCH_PATTERNS = ["联网", "搜索", "查一下", "查找", "最新", "实时", "新闻", "资料"];
const NOTE_READ_PATTERNS = ["读取", "看看", "总结", "整理", "分类", "归类", "笔记", "文档"];
const NOTE_WRITE_PATTERNS = [
  "写入",
  "编辑",
  "修改",
  "追加",
  "创建",
  "新建",
  "归类到",
  "移动到",
  "改",
  "改写",
  "重写",
  "润色",
  "保存到",
];
const NOTE_OPTIMIZE_PATTERNS = ["优化", "润色", "改写", "重写"];
const NOTE_OPTIMIZE_TARGET_WORDS = ["笔记", "文档", "文章", "文本", "内容"];
const NOTE_CAPABILITY_PATTERNS = [
  "可以编辑",
  "能编辑",
  "能修改",
  "能改",
  "能整理",
  "能归类",
  "可以修改",
];
const OPEN_URL_PATTERNS = ["打开链接", "打开网址", "访问"];
const COPY_PATTERNS = ["复制", "复制到剪贴板"];
const URL_PATTERN = /https?:\/\/[^\s，。！？]+/i;

export function detectAssistantToolPlan(input: string): AssistantToolPlan | null {
  const text = input.trim();
  if (!text) return null;

  const explicit = parseExplicitToolCommand(text);
  if (explicit) return explicit;

  if (includesAny(text, NOTE_CAPABILITY_PATTERNS)) {
    return {
      tool: "note.search",
      params: { query: "", limit: 10 },
      title: "确认笔记工具能力",
      description: "读取最近笔记索引，准备在用户指定目标笔记后生成可确认的编辑计划。",
    };
  }

  const optimize = parseOptimizeIntent(text);
  if (optimize) {
    return {
      tool: "note.read",
      params: { query: optimize.query },
      title: "优化笔记内容",
      description: `读取标题为「${optimize.query}」的文档，生成优化稿后等待你确认写回。`,
      workflow: "note.optimize",
      instruction: text,
    };
  }

  if (includesAny(text, OPEN_URL_PATTERNS)) {
    const url = text.match(URL_PATTERN)?.[0];
    if (url) {
      return {
        tool: "external.openUrl",
        params: { url },
        title: "打开外部链接",
        description: `打开 ${url}`,
      };
    }
  }

  if (includesAny(text, COPY_PATTERNS)) {
    const value = stripLead(text, ["复制到剪贴板", "复制"]);
    if (value) {
      return {
        tool: "external.copyText",
        params: { text: value },
        title: "复制文本",
        description: `复制 ${value.length} 个字符到剪贴板。`,
      };
    }
  }

  if (includesAny(text, SEARCH_PATTERNS) && !includesAny(text, ["本地笔记", "我的笔记"])) {
    const stripped = stripLead(text, ["联网搜索", "搜索", "查一下", "查找", "最新", "实时"]);
    const query = cleanSearchQuery(stripped || text);
    return {
      tool: "web.search",
      params: { query: query || text, limit: 5 },
      title: "联网搜索",
      description: `搜索「${query || text}」并总结来源。`,
    };
  }

  if (includesAny(text, NOTE_WRITE_PATTERNS)) {
    const title = extractAfter(text, ["创建", "新建"]);
    if (title) {
      return {
        tool: "note.create",
        params: { title, content: `由 AI 助手根据指令创建：${text}`, category: "AI整理" },
        title: "创建笔记",
        description: `创建「${title}」，分类为「AI整理」。`,
      };
    }

    const append = parseAppendIntent(text);
    if (append) {
      return {
        tool: "note.update",
        params: { query: append.query, content: append.content, mode: "append" },
        title: "追加到笔记",
        description: `向匹配「${append.query}」的笔记追加内容。`,
      };
    }

    const move = parseMoveCategoryIntent(text);
    if (move) {
      return {
        tool: "note.moveCategory",
        params: { query: move.query, category: move.category },
        title: "移动笔记分类",
        description: `将匹配「${move.query}」的笔记归类到「${move.category || "未分类"}」。`,
      };
    }
  }

  if (includesAny(text, NOTE_READ_PATTERNS) && !includesAny(text, NOTE_OPTIMIZE_PATTERNS)) {
    const query =
      extractQuoted(text) ?? stripLead(text, ["读取", "看看", "总结", "整理", "分类", "归类"]);
    // 只解析出"这篇笔记/这篇文章/总结一下"这类无明确主题的指代时，不硬跑本地搜索，
    // 交给 LLM 对话处理（LLM 会追问目标笔记，而不是把整句话当搜索词返回 0 条）
    if (!query || isVagueNoteReference(query)) return null;
    return {
      tool: "note.search",
      params: { query, limit: 10 },
      title: query ? "读取相关笔记" : "读取最近笔记",
      description: query ? `读取与「${query}」相关的本地笔记索引。` : "读取最近笔记索引。",
    };
  }

  return null;
}

export function toolLabel(tool: AssistantToolName): string {
  switch (tool) {
    case "note.list":
      return "读取笔记列表";
    case "note.read":
      return "读取笔记";
    case "note.search":
      return "搜索笔记";
    case "note.create":
      return "创建笔记";
    case "note.update":
      return "编辑笔记";
    case "note.moveCategory":
      return "移动分类";
    case "web.search":
      return "联网搜索";
    case "external.openUrl":
      return "打开链接";
    case "external.copyText":
      return "复制文本";
  }
}

export function requiresConfirmation(tool: AssistantToolName): boolean {
  return (
    tool === "note.create" ||
    tool === "note.update" ||
    tool === "note.moveCategory" ||
    tool === "web.search" ||
    tool === "external.openUrl" ||
    tool === "external.copyText"
  );
}

export function parseExplicitToolCommand(text: string): AssistantToolPlan | null {
  const command = text.match(
    /^\/(搜索|search|读笔记|笔记|创建笔记|追加笔记|优化笔记|润色笔记|归类笔记|移动笔记|打开链接|复制)\s+([\s\S]+)$/i,
  );
  if (!command) return null;

  const [, rawCommand, rawPayload] = command;
  const payload = rawPayload.trim();
  const lowerCommand = rawCommand.toLowerCase();

  if (rawCommand === "搜索" || lowerCommand === "search") {
    return {
      tool: "web.search",
      params: { query: payload, limit: 5 },
      title: "联网搜索",
      description: `搜索「${payload}」并总结来源。`,
    };
  }

  if (rawCommand === "读笔记" || rawCommand === "笔记") {
    return {
      tool: "note.search",
      params: { query: payload, limit: 10 },
      title: "搜索笔记",
      description: `搜索本地笔记「${payload}」。`,
    };
  }

  if (rawCommand === "创建笔记") {
    const [title, ...content] = payload.split(/\s*[|｜]\s*/);
    return {
      tool: "note.create",
      params: { title, content: content.join("\n\n") || title, category: "AI整理" },
      title: "创建笔记",
      description: `创建「${title}」，分类为「AI整理」。`,
    };
  }

  if (rawCommand === "追加笔记") {
    const [query, ...content] = payload.split(/\s*[|｜]\s*/);
    return {
      tool: "note.update",
      params: { query, content: content.join("\n\n"), mode: "append" },
      title: "追加到笔记",
      description: `向匹配「${query}」的笔记追加内容。`,
    };
  }

  if (rawCommand === "优化笔记" || rawCommand === "润色笔记") {
    const query = payload.split(/\s*[|｜]\s*/)[0]?.trim() || payload;
    return {
      tool: "note.read",
      params: { query },
      title: "优化笔记内容",
      description: `读取标题为「${query}」的文档，生成优化稿后等待你确认写回。`,
      workflow: "note.optimize",
      instruction: text,
    };
  }

  if (rawCommand === "归类笔记" || rawCommand === "移动笔记") {
    const [query, category = ""] = payload.split(/\s*[|｜]\s*/);
    return {
      tool: "note.moveCategory",
      params: { query, category },
      title: "移动笔记分类",
      description: `将匹配「${query}」的笔记归类到「${category || "未分类"}」。`,
    };
  }

  if (rawCommand === "打开链接") {
    return {
      tool: "external.openUrl",
      params: { url: payload },
      title: "打开外部链接",
      description: `打开 ${payload}`,
    };
  }

  if (rawCommand === "复制") {
    return {
      tool: "external.copyText",
      params: { text: payload },
      title: "复制文本",
      description: `复制 ${payload.length} 个字符到剪贴板。`,
    };
  }

  return null;
}

function includesAny(text: string, words: string[]) {
  return words.some((word) => text.includes(word));
}

function stripLead(text: string, leads: string[]) {
  let result = text.trim();
  for (const lead of leads) {
    if (result.startsWith(lead)) {
      result = result.slice(lead.length).trim();
    }
  }
  return result.replace(/[？?。！!]+$/g, "").trim();
}

/**
 * 清洗联网搜索词：去掉"帮我/搜索/一张"等意图与语气废话，保留核心关键词。
 * 例：「帮我搜索一张樱花的图片」→「樱花的图片」。
 */
function cleanSearchQuery(text: string): string {
  let query = text.trim();
  // 1) 首部礼貌/语气前缀（可叠加，如"请帮我"）
  query = query.replace(/^(?:帮我|请你?|麻烦你?|你帮我|能否|可以|请|给我)+[，,、\s]*/i, "");
  // 2) 搜索动作词（可能带"联网/最新"前缀）
  query = query.replace(/^(?:联网|最新|实时)?(?:搜索|查找|查询|搜一下|搜一搜|查一下|找找|搜|找)\s*/i, "");
  // 3) 量词与语气词（"一张樱花图"→"樱花图"）
  query = query.replace(/(?:一张|一个|一幅|一只|一枚|一篇|一本|一份|一下|一些|一点|几?张|几?个)/g, " ");
  return query.replace(/\s+/g, " ").trim() || text.trim();
}

function extractQuoted(text: string) {
  return /[「“"]([^」”"]+)[」”"]/.exec(text)?.[1]?.trim() ?? null;
}

function extractAfter(text: string, markers: string[]) {
  for (const marker of markers) {
    const index = text.indexOf(marker);
    if (index >= 0) {
      return text
        .slice(index + marker.length)
        .replace(/^一[个篇条]?/, "")
        .trim();
    }
  }
  return null;
}

function parseOptimizeIntent(text: string): { query: string } | null {
  if (
    !includesAny(text, NOTE_OPTIMIZE_PATTERNS) ||
    !includesAny(text, NOTE_OPTIMIZE_TARGET_WORDS)
  ) {
    return null;
  }

  const titleMatch = text.match(
    /(?:标题(?:为|是)?|题目(?:为|是)?|叫做|名为)[「“"]?([^」”"，,。？！\s]+?)(?:[」”"]|的(?:文档|笔记|文章|内容)|[，,。？！\s]|$)/,
  );
  const quoted = extractQuoted(text);
  const query = titleMatch?.[1]?.trim() || quoted;
  // 只说"帮我优化这篇文章"但没有指明是哪一篇（无标题/引号）时，不猜测目标，
  // 返回 null 交给 LLM 对话处理，避免把整句话当笔记标题搜索
  if (!query) return null;

  return { query };
}

/** 是否为"这篇笔记/这篇文章/总结一下"这类没有明确主题的指代 */
function isVagueNoteReference(value: string) {
  const cleaned = value.replace(/^(帮我|请)/, "").trim();
  if (!cleaned) return true;
  return /^(一下)?(这|那|本|当前|正在编辑)?[篇个]?(笔记|文章|文档|文本|内容)?$/.test(cleaned);
}

function parseAppendIntent(text: string): { query: string; content: string } | null {
  const explicit = text.match(
    /(?:追加|写入|编辑|修改)(?:笔记)?[「“"]?([^」”"|｜，,]+)[」”"]?\s*[|｜，,]\s*([\s\S]+)/,
  );
  if (explicit?.[1] && explicit?.[2]) {
    return { query: explicit[1].trim(), content: explicit[2].trim() };
  }

  const suffix = text.match(
    /(?:把|将)([\s\S]+?)(?:追加|写入|添加)到(?:笔记)?[「“"]?([^」”"]+)[」”"]?/,
  );
  if (suffix?.[1] && suffix?.[2]) {
    return { query: suffix[2].trim(), content: suffix[1].trim() };
  }

  return null;
}

function parseMoveCategoryIntent(text: string) {
  const explicit = text.match(
    /(?:把|将)?(?:笔记)?[「“"]?([^」”"|｜，,]+)[」”"]?\s*(?:归类到|移动到|分类到)\s*[「“"]?([^」”"，,]+)[」”"]?/,
  );
  if (explicit?.[1] && explicit?.[2]) {
    return { query: explicit[1].trim(), category: explicit[2].trim() };
  }

  return null;
}

export interface InvokeTextCall {
  /** 归一化后的工具名（web_search → web.search） */
  name: string;
  params: Record<string, string>;
}

/**
 * 解析模型以 XML 文本形式模拟的工具调用，如
 * `<invoke name="web_search"><parameter name="query">樱花图片</parameter></invoke>`。
 * 网关不支持 function calling 时模型可能输出该格式；识别后按真实工具执行。
 */
export function parseInvokeText(text: string): InvokeTextCall | null {
  const invoke = text.match(/<invoke\s+name="([^"]+)"[^>]*>([\s\S]*?)<\/invoke>/i);
  if (!invoke) return null;
  const name = invoke[1].replace(/_/g, ".").trim();
  if (!name) return null;

  const params: Record<string, string> = {};
  const parameterRe = /<parameter\s+name="([^"]+)"[^>]*>([\s\S]*?)<\/parameter>/gi;
  let parameterMatch: RegExpExecArray | null;
  while ((parameterMatch = parameterRe.exec(invoke[2])) !== null) {
    const key = parameterMatch[1].trim();
    const value = parameterMatch[2].trim();
    if (key) params[key] = value;
  }

  return { name, params };
}
