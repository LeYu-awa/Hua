import { invoke } from "@tauri-apps/api/core";
import type { AppendInkEventsRequest, InkSession, InkSessionSummary } from "./types";

export function appendInkEvents(request: AppendInkEventsRequest): Promise<void> {
  return invoke("ink_append_events", { request });
}

export function listInkSessions(noteId: string): Promise<InkSessionSummary[]> {
  return invoke("ink_list_sessions", { noteId });
}

export function getInkSession(noteId: string, sessionId: string): Promise<InkSession> {
  return invoke("ink_get_session", { noteId, sessionId });
}

export function clearInkData(noteId?: string): Promise<void> {
  return invoke("ink_clear", { noteId });
}
