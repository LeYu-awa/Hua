import { t, type TFunction } from "i18next";
import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import type { Note } from "../notes/types";

const noteFileFilters = [
  { name: "笔记文件", extensions: ["md", "pdf", "doc", "docx"] },
  { name: "Markdown", extensions: ["md"] },
  { name: "PDF", extensions: ["pdf"] },
  { name: "Word", extensions: ["doc", "docx"] },
];

const exportFileFilters = [
  { name: "Markdown", extensions: ["md"] },
  { name: "PDF", extensions: ["pdf"] },
  { name: "Word", extensions: ["doc", "docx"] },
];

interface ExportableNote {
  id: string;
  title: string;
  fileName: string;
}

export async function importMarkdownNote(category = ""): Promise<Note | null> {
  const path = await open({
    multiple: false,
    directory: false,
    filters: noteFileFilters,
  });

  if (typeof path !== "string") {
    return null;
  }

  return invoke("notes_import_markdown", { path, category });
}

export async function exportMarkdownNote(note: ExportableNote): Promise<boolean> {
  const path = await save({
    defaultPath: noteFileName(note.title, note.fileName),
    filters: exportFileFilters,
  });

  if (typeof path !== "string") {
    return false;
  }

  await invoke("notes_export_markdown", { id: note.id, path });
  return true;
}

function noteFileName(title: string, fileName: string, translate: TFunction = t): string {
  const safeTitle =
    safeFileStem(title) || translate("common.untitledNote", { defaultValue: "无标题笔记" });
  const extension = fileName.match(/\.([^.\\/]+)$/)?.[0] ?? ".md";
  return `${safeTitle}${extension}`;
}

function safeFileStem(value: string): string {
  const sanitized = Array.from(value.trim(), (char) => {
    const code = char.codePointAt(0) ?? 0;

    if ('<>:"/\\|?*'.includes(char) || code < 0x20) {
      return "_";
    }

    return char;
  }).join("");

  const normalized = sanitized
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");

  return Array.from(normalized).slice(0, 80).join("");
}
