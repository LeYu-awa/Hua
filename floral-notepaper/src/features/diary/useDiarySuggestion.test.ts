// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDiaryEntry, listDiaryEntries } from "./api";
import type { DiaryEntry } from "./api";
import { dispatchDiaryCreated } from "./diaryEvents";
import { useDiarySuggestion } from "./useDiarySuggestion";
import type { DiarySourceMessage } from "./composeDiaryContent";

vi.mock("./api", () => ({
  createDiaryEntry: vi.fn(),
  listDiaryEntries: vi.fn(),
}));

vi.mock("./diaryEvents", () => ({
  dispatchDiaryCreated: vi.fn(),
}));

const STORAGE_KEY = "diary_suggestion_state";

function messages(count: number): DiarySourceMessage[] {
  return Array.from({ length: count }, (_, index) => ({
    role: "user" as const,
    content: `消息 ${index}`,
    createdAt: index,
  }));
}

function todayKey(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

describe("useDiarySuggestion", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.mocked(listDiaryEntries).mockResolvedValue([]);
    vi.mocked(createDiaryEntry).mockResolvedValue({ id: "d1" } as DiaryEntry);
    vi.mocked(dispatchDiaryCreated).mockClear();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("shows the suggestion when the task has enough user messages", async () => {
    const { result } = renderHook(() =>
      useDiarySuggestion({ taskId: "t1", messages: messages(2), providers: [] }),
    );

    await waitFor(() => expect(result.current.status).toBe("visible"));
  });

  it("stays idle with fewer than two user messages", async () => {
    const { result } = renderHook(() =>
      useDiarySuggestion({ taskId: "t1", messages: messages(1), providers: [] }),
    );

    await waitFor(() => expect(listDiaryEntries).toHaveBeenCalled());
    expect(result.current.status).toBe("idle");
  });

  it("stays idle when the task already has a diary entry today", async () => {
    vi.mocked(listDiaryEntries).mockResolvedValue([{ id: "x" } as DiaryEntry]);

    const { result } = renderHook(() =>
      useDiarySuggestion({ taskId: "t1", messages: messages(2), providers: [] }),
    );

    await waitFor(() => expect(result.current.recordedToday).toBe(true));
    expect(result.current.status).toBe("idle");
  });

  it("respects the 30-minute cooldown", async () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ lastPromptAt: Date.now(), ignoredToday: "" }),
    );

    const { result } = renderHook(() =>
      useDiarySuggestion({ taskId: "t1", messages: messages(2), providers: [] }),
    );

    await waitFor(() => expect(listDiaryEntries).toHaveBeenCalled());
    expect(result.current.status).toBe("idle");
  });

  it("respects the ignored-today flag", async () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ lastPromptAt: 0, ignoredToday: todayKey() }),
    );

    const { result } = renderHook(() =>
      useDiarySuggestion({ taskId: "t1", messages: messages(2), providers: [] }),
    );

    await waitFor(() => expect(listDiaryEntries).toHaveBeenCalled());
    expect(result.current.status).toBe("idle");
  });

  it("confirm creates a diary entry and broadcasts the created event", async () => {
    const { result } = renderHook(() =>
      useDiarySuggestion({ taskId: "t1", messages: messages(2), providers: [] }),
    );
    await waitFor(() => expect(result.current.status).toBe("visible"));

    await act(async () => {
      await result.current.confirm();
    });

    expect(createDiaryEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: "t1",
        sourceMessageIds: ["0", "1"],
        entryDate: todayKey(),
      }),
    );
    expect(dispatchDiaryCreated).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe("done");
    expect(result.current.recordedToday).toBe(true);
  });

  it("marks the status as error when saving fails", async () => {
    vi.mocked(createDiaryEntry).mockRejectedValue(new Error("boom"));

    const { result } = renderHook(() =>
      useDiarySuggestion({ taskId: "t1", messages: messages(2), providers: [] }),
    );
    await waitFor(() => expect(result.current.status).toBe("visible"));

    await act(async () => {
      await result.current.confirm();
    });

    expect(result.current.status).toBe("error");
    expect(dispatchDiaryCreated).not.toHaveBeenCalled();
  });

  it("dismissLater writes the cooldown timestamp", async () => {
    const { result } = renderHook(() =>
      useDiarySuggestion({ taskId: "t1", messages: messages(2), providers: [] }),
    );
    await waitFor(() => expect(result.current.status).toBe("visible"));

    act(() => result.current.dismissLater());

    expect(result.current.status).toBe("idle");
    const persisted = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "{}");
    expect(persisted.lastPromptAt).toBeGreaterThan(0);
    expect(persisted.ignoredToday).toBe("");
  });

  it("dismissToday marks the day as ignored", async () => {
    const { result } = renderHook(() =>
      useDiarySuggestion({ taskId: "t1", messages: messages(2), providers: [] }),
    );
    await waitFor(() => expect(result.current.status).toBe("visible"));

    act(() => result.current.dismissToday());

    expect(result.current.status).toBe("idle");
    const persisted = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "{}");
    expect(persisted.ignoredToday).toBe(todayKey());
  });

  it("resets the done state when the task switches (new task can be suggested again)", async () => {
    const { result, rerender } = renderHook(
      ({ taskId }) => useDiarySuggestion({ taskId, messages: messages(2), providers: [] }),
      { initialProps: { taskId: "t1" } },
    );
    await waitFor(() => expect(result.current.status).toBe("visible"));

    await act(async () => {
      await result.current.confirm();
    });
    expect(result.current.status).toBe("done");

    // 切换到新任务：状态不再继承 done（confirm 写入的冷却会阻止立即重提议）
    rerender({ taskId: "t2" });
    await waitFor(() => expect(result.current.status).not.toBe("done"));

    // 模拟冷却结束后，新任务可重新提议
    window.localStorage.removeItem(STORAGE_KEY);
    rerender({ taskId: "t2" });
    await waitFor(() => expect(result.current.status).toBe("visible"));
  });
});
