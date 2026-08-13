// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DiaryPage } from "./DiaryPage";
import { deleteDiaryEntry, getDiaryEntry, listDiaryEntries, updateDiaryEntry } from "./api";
import type { DiaryEntry, DiaryEntrySummary } from "./api";
import { dispatchOpenChatTask } from "./diaryEvents";

vi.mock("./api", () => ({
  deleteDiaryEntry: vi.fn(),
  getDiaryEntry: vi.fn(),
  listDiaryEntries: vi.fn(),
  updateDiaryEntry: vi.fn(),
}));

vi.mock("./diaryEvents", () => ({
  dispatchOpenChatTask: vi.fn(),
  onDiaryCreated: vi.fn(() => () => {}),
}));

function dateKey(offsetDays: number): string {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

const summary = (overrides: Partial<DiaryEntrySummary>): DiaryEntrySummary => ({
  id: "d1",
  title: "今天的记录",
  preview: "今天聊了角色动机。",
  entryDate: dateKey(0),
  createdAt: "2026-08-14T10:00:00Z",
  updatedAt: "2026-08-14T10:00:00Z",
  conversationId: "t1",
  mood: "curious",
  tags: ["灵感"],
  wordCount: 12,
  ...overrides,
});

const fullEntry: DiaryEntry = {
  id: "d1",
  title: "今天的记录",
  content: "今天聊了角色动机。",
  entryDate: dateKey(0),
  createdAt: "2026-08-14T10:00:00Z",
  updatedAt: "2026-08-14T10:00:00Z",
  conversationId: "t1",
  sourceMessageIds: ["1", "2"],
  mood: "curious",
  tags: ["灵感"],
  noteId: null,
  canvasId: null,
  wordCount: 12,
};

describe("DiaryPage", () => {
  beforeEach(() => {
    vi.mocked(listDiaryEntries).mockResolvedValue([summary({})]);
    vi.mocked(getDiaryEntry).mockResolvedValue(fullEntry);
    vi.mocked(updateDiaryEntry).mockResolvedValue(fullEntry);
    vi.mocked(deleteDiaryEntry).mockResolvedValue(undefined);
    vi.mocked(dispatchOpenChatTask).mockClear();
    vi.spyOn(window, "confirm").mockReturnValue(true);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it("renders stats and groups entries by date", async () => {
    render(<DiaryPage />);

    expect(await screen.findByText("今天的记录")).toBeTruthy();
    expect(screen.getByText("今日")).toBeTruthy();
    expect(screen.getByText("今天")).toBeTruthy();
    expect(screen.getByText("#灵感")).toBeTruthy();
  });

  it("expands an entry and loads its detail", async () => {
    render(<DiaryPage />);

    fireEvent.click(await screen.findByText("今天的记录"));

    await waitFor(() => expect(getDiaryEntry).toHaveBeenCalledWith("d1"));
    expect(await screen.findByText("今天聊了角色动机。")).toBeTruthy();
  });

  it("saves edits through updateDiaryEntry", async () => {
    render(<DiaryPage />);

    fireEvent.click(await screen.findByText("今天的记录"));
    fireEvent.click(await screen.findByText("编辑"));

    const titleInput = screen.getByPlaceholderText("标题") as HTMLInputElement;
    fireEvent.change(titleInput, { target: { value: "新标题" } });

    fireEvent.click(screen.getByText("保存"));

    await waitFor(() =>
      expect(updateDiaryEntry).toHaveBeenCalledWith(
        "d1",
        expect.objectContaining({ title: "新标题" }),
      ),
    );
  });

  it("deletes an entry after confirmation", async () => {
    render(<DiaryPage />);

    fireEvent.click(await screen.findByText("今天的记录"));
    fireEvent.click(await screen.findByText("删除"));

    await waitFor(() => expect(deleteDiaryEntry).toHaveBeenCalledWith("d1"));
  });

  it("dispatches open-chat-task when clicking the source conversation button", async () => {
    render(<DiaryPage />);

    fireEvent.click(await screen.findByText("今天的记录"));
    fireEvent.click(await screen.findByText("查看来源对话"));

    expect(dispatchOpenChatTask).toHaveBeenCalledWith("t1");
  });

  it("renders the empty state when there are no entries", async () => {
    vi.mocked(listDiaryEntries).mockResolvedValue([]);

    render(<DiaryPage />);

    expect(await screen.findByText("今天还没记录，去和花灵聊聊今天的想法吧")).toBeTruthy();
    expect(screen.getByText("去对话")).toBeTruthy();
  });
});
