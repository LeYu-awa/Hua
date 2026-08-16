import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { exportMarkdownNote, importMarkdownNote } from "./api";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
  save: vi.fn(),
}));

const mockedInvoke = vi.mocked(invoke);
const mockedOpen = vi.mocked(open);
const mockedSave = vi.mocked(save);

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

describe("importExport api", () => {
  beforeEach(() => {
    mockedInvoke.mockReset();
    mockedOpen.mockReset();
    mockedSave.mockReset();
  });

  test("imports the selected supported note file path through Rust", async () => {
    mockedOpen.mockResolvedValue("D:\\notes\\外部笔记.pdf");
    mockedInvoke.mockResolvedValue({
      id: "note-1",
      title: "外部笔记",
      fileName: "note-1.pdf",
      createdAt: "2026-04-28T00:00:00Z",
      updatedAt: "2026-04-28T00:00:00Z",
      wordCount: 0,
      content: "",
      preview: "PDF 文件",
      filePath: "D:\\managed\\note-1.pdf",
    });

    const note = await importMarkdownNote();

    expect(open).toHaveBeenCalledWith({
      multiple: false,
      directory: false,
      filters: noteFileFilters,
    });
    expect(invoke).toHaveBeenCalledWith("notes_import_markdown", {
      path: "D:\\notes\\外部笔记.pdf",
      category: "",
    });
    expect(note?.id).toBe("note-1");
  });

  test("returns null when the file picker is cancelled", async () => {
    mockedOpen.mockResolvedValue(null);

    await expect(importMarkdownNote()).resolves.toBeNull();
    expect(invoke).not.toHaveBeenCalled();
  });

  test("exports a note to the selected file path", async () => {
    mockedSave.mockResolvedValue("D:\\exports\\读书笔记.md");
    mockedInvoke.mockResolvedValue(undefined);

    await expect(
      exportMarkdownNote({ id: "note-1", title: "读书笔记", fileName: "note-1.md" }),
    ).resolves.toBe(true);

    expect(save).toHaveBeenCalledWith({
      defaultPath: "读书笔记.md",
      filters: exportFileFilters,
    });
    expect(invoke).toHaveBeenCalledWith("notes_export_markdown", {
      id: "note-1",
      path: "D:\\exports\\读书笔记.md",
    });
  });

  test("uses a safe file name and preserves the source extension for export", async () => {
    mockedSave.mockResolvedValue(null);

    await exportMarkdownNote({ id: "note-1", title: "A/B:Test", fileName: "note-1.md" });
    await exportMarkdownNote({ id: "note-2", title: "", fileName: "note-2.pdf" });
    await exportMarkdownNote({
      id: "note-3",
      title: `${"x".repeat(79)}😀`,
      fileName: "note-3.docx",
    });

    expect(save).toHaveBeenNthCalledWith(1, {
      defaultPath: "A_B_Test.md",
      filters: exportFileFilters,
    });
    expect(save).toHaveBeenNthCalledWith(2, {
      defaultPath: "无标题笔记.pdf",
      filters: exportFileFilters,
    });
    expect(save).toHaveBeenNthCalledWith(3, {
      defaultPath: `${"x".repeat(79)}😀.docx`,
      filters: exportFileFilters,
    });
    expect(invoke).not.toHaveBeenCalled();
  });
});
