import { supabase } from "../auth/supabase";
import type { AppConfig } from "../settings/types";

export interface NoteSyncData {
  id: string;
  title: string | null;
  content: string | null;
  file_name: string | null;
  word_count: number;
  updated_at: string;
}

// ─── 配置同步 ───

export async function uploadConfig(userId: string, config: AppConfig): Promise<void> {
  const { error } = await supabase.from("config_sync").upsert(
    {
      user_id: userId,
      config: config as unknown as Record<string, unknown>,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );
  if (error) throw error;
}

export async function downloadConfig(userId: string): Promise<AppConfig | null> {
  const { data, error } = await supabase
    .from("config_sync")
    .select("config")
    .eq("user_id", userId)
    .single();
  if (error || !data) return null;
  return (data.config as unknown as AppConfig) ?? null;
}

// ─── 笔记同步 ───

export async function uploadNote(
  userId: string,
  note: {
    id: string;
    title?: string;
    content?: string;
    file_name?: string;
    word_count?: number;
  },
): Promise<void> {
  const { error } = await supabase.from("notes_sync").upsert(
    {
      id: note.id,
      user_id: userId,
      title: note.title ?? null,
      content: note.content ?? null,
      file_name: note.file_name ?? null,
      word_count: note.word_count ?? 0,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "id,user_id" },
  );
  if (error) throw error;
}

export async function downloadNotes(userId: string): Promise<NoteSyncData[]> {
  const { data, error } = await supabase
    .from("notes_sync")
    .select("*")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return (data as NoteSyncData[]) ?? [];
}

export async function deleteNote(userId: string, noteId: string): Promise<void> {
  const { error } = await supabase
    .from("notes_sync")
    .delete()
    .eq("id", noteId)
    .eq("user_id", userId);
  if (error) throw error;
}
