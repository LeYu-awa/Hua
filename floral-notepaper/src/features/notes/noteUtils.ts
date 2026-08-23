import { t, type TFunction } from "i18next";
import type { Note, NoteMetadata } from "./types";

export function getFileExtension(fileName: string): string {
  const match = fileName.match(/\.([^.\\/]+)$/);
  return match ? `.${match[1]}` : "";
}

export function withFileExtension(name: string, fileName: string): string {
  const extension = getFileExtension(fileName);
  if (!extension) return name;
  return name.toLowerCase().endsWith(extension.toLowerCase()) ? name : `${name}${extension}`;
}

export function getDisplayTitle(
  note: Pick<NoteMetadata, "title" | "fileName"> & { preview?: string },
  translate: TFunction = t,
): string {
  const title = note.title.trim();
  if (title) return withFileExtension(title, note.fileName);

  const preview = note.preview?.trim() ?? "";
  if (preview) return withFileExtension(preview.slice(0, 20), note.fileName);

  return withFileExtension(
    translate("common.untitledNote", { defaultValue: "无标题笔记" }),
    note.fileName,
  );
}

export function buildPreview(content: string): string {
  return content.split(/\s+/).filter(Boolean).join(" ").slice(0, 80);
}

export function countNoteChars(content: string): number {
  let count = 0;
  for (const ch of content) {
    if (!/\s/.test(ch)) count++;
  }
  return count;
}

export function metadataFromNote(note: Note): NoteMetadata {
  return {
    id: note.id,
    title: note.title,
    fileName: note.fileName,
    category: note.category,
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
    wordCount: note.wordCount,
    preview: note.preview ?? buildPreview(note.content),
    filePath: note.filePath,
  };
}

export interface CategoryGroup {
  category: string;
  notes: NoteMetadata[];
  latestUpdatedAt: string;
}

export function groupNotesByCategory(
  notes: NoteMetadata[],
  allCategories: string[] = [],
): CategoryGroup[] {
  const groups = new Map<string, NoteMetadata[]>();

  for (const cat of allCategories) {
    groups.set(cat, []);
  }

  for (const note of notes) {
    const key = note.category || "";
    const list = groups.get(key);
    if (list) {
      list.push(note);
    } else {
      groups.set(key, [note]);
    }
  }

  const result: CategoryGroup[] = [];
  for (const [category, categoryNotes] of groups) {
    const latestUpdatedAt = categoryNotes.reduce(
      (latest, note) => (note.updatedAt > latest ? note.updatedAt : latest),
      "",
    );
    result.push({
      category,
      notes: categoryNotes,
      latestUpdatedAt,
    });
  }

  result.sort((a, b) => {
    if (!a.category) return 1;
    if (!b.category) return -1;
    const aEmpty = a.notes.length === 0;
    const bEmpty = b.notes.length === 0;
    if (aEmpty && !bEmpty) return -1;
    if (!aEmpty && bEmpty) return 1;
    return a.category.localeCompare(b.category);
  });
  return result;
}

export function filterNotes(notes: NoteMetadata[], query: string): NoteMetadata[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return notes;

  return notes.filter((note) => {
    const haystack = [note.title, note.preview, note.fileName, getDisplayTitle(note)]
      .join(" ")
      .toLowerCase();
    return haystack.includes(normalized);
  });
}

export function formatShortDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--";
  return `${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function formatTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--:--";
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}
