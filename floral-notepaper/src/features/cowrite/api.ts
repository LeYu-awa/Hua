import { invoke } from "@tauri-apps/api/core";
import { withCachedProviderApiKeys } from "../settings/apiKeyCache";
import type { ProviderConfig } from "../settings/types";
import type { CoWriteIdentity, CoWriteSession, CoWriteSessionSummary } from "./types";

export interface MergeToNoteResult {
  content: string;
  session: CoWriteSession;
}

export function createCoWriteSession(
  noteId: string,
  identity: CoWriteIdentity,
  customPrompt?: string,
): Promise<CoWriteSession> {
  return invoke("cowrite_create_session", { noteId, identity, customPrompt });
}

export function appendHumanText(sessionId: string, text: string): Promise<CoWriteSession> {
  return invoke("cowrite_append_human", { sessionId, text });
}

export function appendAIText(sessionId: string, text: string): Promise<CoWriteSession> {
  return invoke("cowrite_append_ai", { sessionId, text });
}

export function requestAITurn(
  sessionId: string,
  providers?: ProviderConfig[],
): Promise<CoWriteSession> {
  const runtimeConfig = providers ? withCachedProviderApiKeys({ providers }) : null;
  return invoke("cowrite_request_ai", { sessionId, runtimeConfig });
}

export function getCoWriteSession(sessionId: string): Promise<CoWriteSession> {
  return invoke("cowrite_get_session", { sessionId });
}

export function listCoWriteSessions(noteId: string): Promise<CoWriteSessionSummary[]> {
  return invoke("cowrite_list_sessions", { noteId });
}

export function mergeToNote(
  sessionId: string,
  selectedBlockIndices: number[],
): Promise<MergeToNoteResult> {
  return invoke("cowrite_merge_to_note", { sessionId, selectedBlockIndices });
}

export function deleteCoWriteSession(sessionId: string): Promise<void> {
  return invoke("cowrite_delete_session", { sessionId });
}

export function replaceLastAIText(sessionId: string, text: string): Promise<CoWriteSession> {
  return invoke("cowrite_replace_last_ai", { sessionId, text });
}

export function undoLastTurn(sessionId: string): Promise<CoWriteSession> {
  return invoke("cowrite_undo_last", { sessionId });
}
