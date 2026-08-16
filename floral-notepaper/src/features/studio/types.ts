import type { GardenArticle } from "../garden/types";

/** 文章编辑状态 */
export type ArticleStatus = "draft" | "editing" | "reviewing" | "published";

/** 编辑器块类型 */
export type BlockType =
  | "text"
  | "heading1"
  | "heading2"
  | "heading3"
  | "image"
  | "video"
  | "todo"
  | "divider"
  | "blockquote"
  | "codeBlock"
  | "callout"
  | "topicTag"
  | "emoji"
  | "coverCrop"
  | "database";

/** 创作轨迹活动类型 */
export type ActivityAction =
  | "edit"
  | "create_draft"
  | "collect_material"
  | "add_note"
  | "export_segment"
  | "publish";

/** 创作轨迹条目 */
export interface ActivityEntry {
  id: string;
  userId: string;
  articleId?: string;
  actionType: ActivityAction;
  content?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

/** 灵感草稿 */
export interface InspirationDraft {
  id: string;
  userId: string;
  articleId?: string;
  content: string;
  source: "quick_note" | "clipboard" | "wechat" | "browser";
  sourceUrl?: string;
  isTask: boolean;
  createdAt: string;
}

/** 收集素材 */
export interface CollectedMaterial {
  id: string;
  userId: string;
  articleId?: string;
  title?: string;
  summary?: string;
  coverUrl?: string;
  sourceUrl: string;
  sourceType: "wechat" | "web" | "manual";
  createdAt: string;
}

/** 创作批注 */
export interface CreationNote {
  id: string;
  userId: string;
  articleId?: string;
  blockId?: string;
  content: string;
  isPromoted: boolean;
  createdAt: string;
}

/** 看板列 */
export interface KanbanColumn {
  id: ArticleStatus;
  title: string;
  icon: string;
  articles: GardenArticle[];
}

/** 小红书合规预检结果 */
export interface ComplianceResult {
  passed: boolean;
  issues: ComplianceIssue[];
}

export interface ComplianceIssue {
  type: "sensitive_word" | "cover_size" | "text_length" | "tag_count" | "image_count";
  message: string;
  severity: "error" | "warning";
}

/** 导出格式 */
export type ExportFormat = "xiaohongshu" | "notion_markdown";

/** 编辑器文章元信息 */
export interface EditorMeta {
  id?: string;
  title: string;
  summary?: string;
  coverUrl?: string;
  tags: string[];
  status: ArticleStatus;
  createdAt?: string;
  updatedAt?: string;
}
