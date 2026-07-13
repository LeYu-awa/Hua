// 聊天沉淀成画布节点（issue 补充场景九 / 场景十一）
// 对协作聊天消息做轻量分类，把"决策 / 待办 / 风险"类消息识别出来，
// 建议一键沉淀成画布节点，避免关键结论只留在聊天里。
// 纯规则分类（关键词），确定性、可测、不依赖 AI；产出 distill_chat_node 指令。

import type { AgentUICommand } from "./signalQueue";

/** 聊天消息类型 */
export type MessageCategory = "decision" | "todo" | "risk" | "question" | "chatter";

/** 待分类的聊天消息 */
export interface ChatMessage {
  id: string;
  docId: string;
  senderId: string;
  content: string;
  createdAt: number;
}

/** 一条沉淀建议 */
export interface DistillSuggestion {
  messageId: string;
  docId: string;
  category: MessageCategory;
  /** 压缩后的节点文案 */
  suggestedText: string;
  /** 温柔的提示语 */
  message: string;
}

// 各类别的关键词（命中即归类，优先级：风险 > 决策 > 待办 > 问题）
const RISK_KEYWORDS = ["风险", "隐患", "问题是", "担心", "可能会失败", "坑", "注意"];
const DECISION_KEYWORDS = ["决定", "就这么定", "确定", "拍板", "定下来", "选", "采用", "先做"];
const TODO_KEYWORDS = ["待办", "todo", "要做", "记得", "别忘", "需要", "安排", "负责"];
const QUESTION_KEYWORDS = ["吗", "呢", "如何", "怎么", "是否", "?", "？"];

const MIN_LENGTH = 6; // 过短的消息（如"好的""收到"）不沉淀

function hasKeyword(text: string, keywords: string[]): boolean {
  const lower = text.toLowerCase();
  return keywords.some((k) => lower.includes(k.toLowerCase()));
}

/** 对单条消息分类 */
export function classifyMessage(content: string): MessageCategory {
  if (hasKeyword(content, RISK_KEYWORDS)) return "risk";
  if (hasKeyword(content, DECISION_KEYWORDS)) return "decision";
  if (hasKeyword(content, TODO_KEYWORDS)) return "todo";
  if (hasKeyword(content, QUESTION_KEYWORDS)) return "question";
  return "chatter";
}

// 只对这些类别建议沉淀
const DISTILLABLE: MessageCategory[] = ["decision", "todo", "risk"];

/** 去掉常见语气词与口语前缀，得到更适合做节点的文案 */
function compressText(content: string): string {
  return content
    .replace(/^(那|嗯|啊|其实|我觉得|我们|大家|要不|然后)[，,、\s]*/g, "")
    .replace(/(吧|啦|呀|哈|嘛|呢)+$/g, "")
    .trim()
    .slice(0, 60);
}

const CATEGORY_LABEL: Record<MessageCategory, string> = {
  decision: "决策",
  todo: "待办",
  risk: "风险",
  question: "问题",
  chatter: "闲聊",
};

function buildMessage(category: MessageCategory, text: string): string {
  const label = CATEGORY_LABEL[category];
  return `刚才聊天里像是定了个「${label}」：“${text}”，要不要放到画布上？`;
}

export interface DistillOptions {
  /** 最多返回几条建议，默认 5 */
  maxSuggestions?: number;
}

/**
 * 从一批聊天消息中挑出值得沉淀的（决策/待办/风险），生成节点建议。
 * 过短或闲聊类消息被忽略。
 */
export function distillChatMessages(
  messages: ChatMessage[],
  options: DistillOptions = {},
): DistillSuggestion[] {
  const maxSuggestions = options.maxSuggestions ?? 5;
  const suggestions: DistillSuggestion[] = [];

  for (const msg of messages) {
    const content = msg.content.trim();
    if (content.length < MIN_LENGTH) continue;
    const category = classifyMessage(content);
    if (!DISTILLABLE.includes(category)) continue;

    const suggestedText = compressText(content);
    if (suggestedText.length === 0) continue;

    suggestions.push({
      messageId: msg.id,
      docId: msg.docId,
      category,
      suggestedText,
      message: buildMessage(category, suggestedText),
    });
    if (suggestions.length >= maxSuggestions) break;
  }

  return suggestions;
}

/** 把沉淀建议转成可分发的 UI 指令 */
export function toDistillCommand(s: DistillSuggestion): AgentUICommand {
  return {
    type: "distill_chat_node",
    messageId: s.messageId,
    docId: s.docId,
    suggestedText: s.suggestedText,
    message: s.message,
  };
}
