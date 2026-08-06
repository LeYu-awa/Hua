import { invoke } from "@tauri-apps/api/core";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { openUrl } from "@tauri-apps/plugin-opener";

export type AssistantToolName =
  | "note.list"
  | "note.read"
  | "note.search"
  | "note.create"
  | "note.update"
  | "note.moveCategory"
  | "web.search"
  | "external.openUrl"
  | "external.copyText";

export type AssistantAgentMode = "workflow" | "autonomous";

export interface AssistantToolRequest {
  tool: AssistantToolName;
  params: Record<string, unknown>;
  confirmed?: boolean;
}

export interface AssistantToolResponse<T = unknown> {
  tool: AssistantToolName;
  summary: string;
  data: T;
}

export interface AssistantToolLog {
  id: string;
  timestamp: string;
  tool: AssistantToolName;
  status: "pending" | "success" | "error" | "denied";
  summary: string;
  params: Record<string, unknown>;
}

/** 笔记变更记录：AI 写回 / 历史恢复时保存的前后内容快照 */
export interface NoteChangeRecord {
  id: string;
  timestamp: string;
  noteId: string;
  title: string;
  source: "ai" | "restore";
  mode: "replace" | "append";
  beforeContent: string;
  afterContent: string;
}

export interface RestoreNoteChangeResult {
  note: {
    id: string;
    title: string;
    category: string;
    content: string;
    wordCount: number;
  };
  change: NoteChangeRecord;
}

export interface AssistantAgentConfig {
  mode: AssistantAgentMode;
  contextPolicy: {
    recentMessages: number;
    allowLocalNoteContext: boolean;
    summarizeLongContext: boolean;
  };
  toolPolicy: {
    allowNoteRead: boolean;
    allowNoteWrite: boolean;
    allowWebSearch: boolean;
    allowExternalTools: boolean;
  };
  permissionPolicy: {
    readWithoutConfirmation: boolean;
    writeBeforeConfirm: boolean;
    webSearchBeforeConfirm: boolean;
    externalBeforeConfirm: boolean;
  };
  workflowPolicy: {
    noteOptimizeReviewRequired: boolean;
    writebackReviewSurface: "inlineDiff";
  };
}

export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
}

export async function executeAssistantTool<T = unknown>(
  request: AssistantToolRequest,
): Promise<AssistantToolResponse<T>> {
  const response = await invoke<AssistantToolResponse<T>>("assistant_tool_execute", {
    request: { ...request, confirmed: request.confirmed ?? false },
  });

  if (response.data && typeof response.data === "object" && "action" in response.data) {
    await executeValidatedExternalAction(response.data as { action?: unknown; url?: unknown; text?: unknown });
  }

  return response;
}

export function listAssistantToolLogs(limit = 50): Promise<AssistantToolLog[]> {
  return invoke("assistant_tool_logs", { limit });
}

/** 列出笔记变更历史（最新在前） */
export function listAssistantToolChanges(limit = 50): Promise<NoteChangeRecord[]> {
  return invoke("assistant_tool_changes", { limit });
}

/** 恢复某次变更：把笔记写回该变更发生前的内容 */
export function restoreAssistantToolChange(
  changeId: string,
): Promise<RestoreNoteChangeResult> {
  return invoke("note_change_restore", { changeId });
}

export function getAssistantAgentConfig(): Promise<AssistantAgentConfig> {
  return invoke("assistant_agent_config_get");
}

export function saveAssistantAgentConfig(config: AssistantAgentConfig): Promise<AssistantAgentConfig> {
  return invoke("assistant_agent_config_save", { config });
}

async function executeValidatedExternalAction(data: {
  action?: unknown;
  url?: unknown;
  text?: unknown;
}) {
  if (data.action === "openUrl" && typeof data.url === "string") {
    await openUrl(data.url);
    return;
  }

  if (data.action === "copyText" && typeof data.text === "string") {
    await writeText(data.text);
  }
}
