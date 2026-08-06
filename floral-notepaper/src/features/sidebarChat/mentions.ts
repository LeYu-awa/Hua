import type { AssistantToolPlan } from "./toolPlanner";

/**
 * ChatGPT 式提及输入的支持模块：
 * - @ 唤起工具联想（@搜索笔记、@优化笔记……）
 * - # 唤起本地笔记联想（#周报……），自动解析为真实笔记标题
 * - # 提及可携带 @note:<id>，用后端 Note.id 精准定位，避免同名标题冲突
 * 发送时通过 buildToolPlanFromMentions 将提及转成与斜杠命令等价的工具计划。
 */

/** @ 工具联想注册表 */
export interface ToolMentionDef {
  token: string;
  desc: string;
}

export const TOOL_MENTIONS: ToolMentionDef[] = [
  { token: "搜索笔记", desc: "搜索 / 读取本地笔记" },
  { token: "联网搜索", desc: "联网搜索并总结来源" },
  { token: "优化笔记", desc: "生成优化稿，确认后写回" },
  { token: "归类笔记", desc: "移动分类，用 ｜ 分隔目标分类" },
  { token: "创建笔记", desc: "新建笔记（AI整理 分类）" },
  { token: "追加笔记", desc: "向笔记追加内容" },
  { token: "打开链接", desc: "打开外部链接" },
  { token: "复制", desc: "复制文本到剪贴板" },
];

/** # 笔记联想的条目（来自 note.search 返回的 notes） */
export interface NoteMention {
  /** 后端 Note.id，创建时由 UUID 生成，全局唯一 */
  id: string;
  title: string;
  category?: string;
  preview?: string;
}

interface NoteReferenceTarget {
  id?: string;
  title: string;
}

const MENTION_RE = /([@#])([^\s]+)/g;
const NOTE_REF_MARKER = "@note:";

export function normalizeToken(value: string): string {
  return value.replace(/\s+/g, "").toLowerCase();
}

/** 插入 # 引用时使用的标题：去掉空白，保证是单个 token */
export function normalizeTokenForInsert(title: string): string {
  return title.replace(/\s+/g, "") || "笔记";
}

/** 将标题 + 全局唯一 Note.id 编码进单个 # token */
export function formatNoteReferenceToken(title: string, id?: string): string {
  const visible = normalizeTokenForInsert(title);
  return id ? `${visible}${NOTE_REF_MARKER}${id}` : visible;
}

/** 高亮展示时只展示可读标题，不展示内部定位 ID */
export function getNoteReferenceDisplayTitle(token: string): string {
  const markerIndex = token.lastIndexOf(NOTE_REF_MARKER);
  return markerIndex >= 0 ? token.slice(0, markerIndex) || "笔记" : token || "笔记";
}

function parseNoteReferenceToken(token: string): NoteReferenceTarget {
  const markerIndex = token.lastIndexOf(NOTE_REF_MARKER);
  if (markerIndex < 0) return { title: token };
  return {
    title: token.slice(0, markerIndex) || "笔记",
    id: token.slice(markerIndex + NOTE_REF_MARKER.length) || undefined,
  };
}

/** 把 # 引用 token 解析为真实笔记目标；优先按 id 精准定位，兼容旧的 #标题 */
export function resolveNoteReference(token: string, notes: NoteMention[]): NoteReferenceTarget | null {
  const parsed = parseNoteReferenceToken(token);
  if (parsed.id) {
    const exactId = notes.find((note) => note.id === parsed.id);
    return { id: parsed.id, title: exactId?.title ?? parsed.title };
  }

  const key = normalizeToken(parsed.title);
  if (!key) return null;
  const exact = notes.find((note) => normalizeToken(note.title) === key);
  if (exact) return { id: exact.id, title: exact.title };
  const partial = notes.find((note) => normalizeToken(note.title).includes(key));
  return partial ? { id: partial.id, title: partial.title } : { title: parsed.title };
}

/** 把 # 引用 token 解析为真实笔记标题；解析不到时返回 null */
export function resolveNoteTitle(token: string, notes: NoteMention[]): string | null {
  return resolveNoteReference(token, notes)?.title ?? null;
}

/**
 * 将带 @/# 提及的输入转成工具执行计划。
 * 无任何提及时返回 null（交由自然语言检测 / 直接对话处理）。
 */
export function buildToolPlanFromMentions(text: string, notes: NoteMention[]): AssistantToolPlan | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  const matches = Array.from(trimmed.matchAll(MENTION_RE));
  if (matches.length === 0) return null;

  const atTokens = matches.filter((m) => m[1] === "@").map((m) => m[2]);
  const hashTokens = matches.filter((m) => m[1] === "#").map((m) => m[2]);
  const toolToken = atTokens[atTokens.length - 1];
  const hashToken = hashTokens[hashTokens.length - 1];
  const noteRef = hashToken ? resolveNoteReference(hashToken, notes) : null;

  // 主要负载 = 最后一个提及之后的文本（@工具 通常写在最前面）
  const last = matches[matches.length - 1];
  const payload = trimmed.slice((last.index ?? 0) + last[0].length).trim();
  // 去掉全部提及后的纯文本，作为无 @ 工具时的兜底参数
  const bare = trimmed.replace(/[@#][^\s]+/g, "").replace(/\s+/g, " ").trim();
  const noteTitle = noteRef?.title ?? null;

  if (toolToken === "搜索笔记" || toolToken === "读笔记") {
    return noteRef?.id ? noteReadPlan(noteRef) : noteSearchPlan(noteTitle ?? payload);
  }

  if (toolToken === "联网搜索" || toolToken === "搜索") {
    const query = noteTitle ?? (payload || bare);
    return {
      tool: "web.search",
      params: { query, limit: 5 },
      title: "联网搜索",
      description: `搜索「${query}」并总结来源。`,
    };
  }

  if (toolToken === "优化笔记" || toolToken === "润色笔记") {
    const query = noteTitle ?? payload;
    if (!query && !noteRef?.id) return null;
    return {
      tool: "note.read",
      params: noteRef?.id ? { id: noteRef.id } : { query },
      title: "优化笔记内容",
      description: `读取${noteRef?.id ? "已引用" : `标题为「${query}」的`}文档，生成优化稿后等待你确认写回。`,
      workflow: "note.optimize",
      instruction: trimmed,
    };
  }

  if (toolToken === "归类笔记" || toolToken === "移动笔记") {
    const [query, category = ""] = splitPipe(payload);
    const target = noteRef ?? (query ? { title: query } : null);
    if (!target?.title && !target?.id) return null;
    return {
      tool: "note.moveCategory",
      params: target.id
        ? { id: target.id, category: category.trim() }
        : { query: target.title, category: category.trim() },
      title: "移动笔记分类",
      description: `将匹配「${target.title}」的笔记归类到「${category.trim() || "未分类"}」。`,
    };
  }

  if (toolToken === "创建笔记") {
    const [title, ...content] = splitPipe(payload);
    const target = noteTitle ?? title;
    return {
      tool: "note.create",
      params: { title: target, content: content.join("\n\n") || target, category: "AI整理" },
      title: "创建笔记",
      description: `创建「${target}」，分类为「AI整理」。`,
    };
  }

  if (toolToken === "追加笔记") {
    const [query, ...content] = splitPipe(payload);
    const target = noteRef ?? (query ? { title: query } : null);
    if (!target?.title && !target?.id) return null;
    return {
      tool: "note.update",
      params: target.id
        ? { id: target.id, content: content.join("\n\n"), mode: "append" }
        : { query: target.title, content: content.join("\n\n"), mode: "append" },
      title: "追加到笔记",
      description: `向匹配「${target.title}」的笔记追加内容。`,
    };
  }

  if (toolToken === "打开链接") {
    if (!payload) return null;
    return {
      tool: "external.openUrl",
      params: { url: payload },
      title: "打开外部链接",
      description: `打开 ${payload}`,
    };
  }

  if (toolToken === "复制") {
    if (!payload) return null;
    return {
      tool: "external.copyText",
      params: { text: payload },
      title: "复制文本",
      description: `复制 ${payload.length} 个字符到剪贴板。`,
    };
  }

  // 只有 # 引用（或提及存在但工具未识别）→ 有 id 时精准读取该笔记，否则兼容旧搜索
  if (noteRef) {
    return noteRef.id ? noteReadPlan(noteRef) : noteSearchPlan(noteRef.title || payload);
  }

  return null;
}

function noteReadPlan(target: NoteReferenceTarget): AssistantToolPlan {
  return {
    tool: "note.read",
    params: target.id ? { id: target.id } : { query: target.title },
    title: "读取引用笔记",
    description: `读取已引用笔记「${target.title || "笔记"}」。`,
  };
}

function noteSearchPlan(query: string): AssistantToolPlan {
  const q = query || "";
  return {
    tool: "note.search",
    params: { query: q, limit: 10 },
    title: q ? "搜索笔记" : "读取最近笔记",
    description: q ? `搜索本地笔记「${q}」。` : "读取最近笔记索引。",
  };
}

/** 按 ｜ 分隔参数（与斜杠命令保持一致），保留首段以支持「｜内容」写法 */
function splitPipe(value: string): string[] {
  const parts = value.split(/[|｜]/).map((part) => part.trim());
  if (parts.length === 1) return parts;
  return [parts[0] ?? "", parts.slice(1).join(" ｜ ")].filter((part, i) => i === 0 || part);
}
