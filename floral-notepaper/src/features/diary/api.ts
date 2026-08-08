import { invoke } from "@tauri-apps/api/core";

export interface DiaryEntry {
  id: string;
  title: string;
  content: string;
  entryDate: string;
  createdAt: string;
  updatedAt: string;
  conversationId?: string | null;
  sourceMessageIds: string[];
  mood?: string | null;
  tags: string[];
  noteId?: string | null;
  canvasId?: string | null;
  wordCount: number;
}

export interface SaveDiaryEntryRequest {
  title: string;
  content: string;
  entryDate?: string;
  conversationId?: string | null;
  sourceMessageIds?: string[];
  mood?: string | null;
  tags?: string[];
  noteId?: string | null;
  canvasId?: string | null;
}

export interface DiaryEntrySummary {
  id: string;
  title: string;
  preview: string;
  entryDate: string;
  createdAt: string;
  updatedAt: string;
  conversationId?: string | null;
  mood?: string | null;
  tags: string[];
  wordCount: number;
}

export interface DiaryEntryQuery {
  startDate?: string;
  endDate?: string;
  conversationId?: string;
  limit?: number;
}

export function createDiaryEntry(request: SaveDiaryEntryRequest): Promise<DiaryEntry> {
  return invoke("diary_create", { request });
}

export function getDiaryEntry(id: string): Promise<DiaryEntry> {
  return invoke("diary_get", { id });
}

export function listDiaryEntries(query?: DiaryEntryQuery): Promise<DiaryEntrySummary[]> {
  return invoke("diary_list", { query });
}

export function updateDiaryEntry(id: string, request: SaveDiaryEntryRequest): Promise<DiaryEntry> {
  return invoke("diary_update", { id, request });
}

export function deleteDiaryEntry(id: string): Promise<void> {
  return invoke("diary_delete", { id });
}
