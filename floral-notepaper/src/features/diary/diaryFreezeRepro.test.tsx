// @vitest-environment jsdom
// 诊断：进入日记页卡死复现（真实组合 DiaryPage + SidebarChat + 真实事件总线）
import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DiaryPage } from "./DiaryPage";
import { SidebarChat } from "../sidebarChat/SidebarChat";
import type { ProviderConfig } from "../settings/types";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  executeAssistantTool: vi.fn(),
  getAssistantAgentConfig: vi.fn(),
  listAssistantToolChanges: vi.fn(),
  restoreAssistantToolChange: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mocks.invoke(...args),
}));

vi.mock("../sidebarChat/assistantTools", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../sidebarChat/assistantTools")>();
  return {
    ...actual,
    executeAssistantTool: (...args: unknown[]) => mocks.executeAssistantTool(...args),
    getAssistantAgentConfig: (...args: unknown[]) => mocks.getAssistantAgentConfig(...args),
    listAssistantToolChanges: (...args: unknown[]) => mocks.listAssistantToolChanges(...args),
    restoreAssistantToolChange: (...args: unknown[]) => mocks.restoreAssistantToolChange(...args),
  };
});

vi.mock("../sidebarChat/MentionComposer", () => ({
  MentionComposer: () => <div data-testid="composer" />,
}));

vi.mock("../sidebarChat/ChatWritebackReview", () => ({
  ChatWritebackReview: () => null,
}));

const provider: ProviderConfig = {
  id: "p1",
  enabled: true,
  name: "Test",
  protocol: "openai",
  apiKey: "k",
  baseUrl: "http://localhost:9999",
  apiPath: "/v1/chat/completions",
  models: [{ modelId: "m1", displayName: "M1" }],
};

function diarySummary(id: string) {
  return {
    id,
    title: `日记 ${id}`,
    preview: "今天聊了角色动机。",
    entryDate: "2026-08-14",
    createdAt: "2026-08-14T10:00:00Z",
    updatedAt: "2026-08-14T10:00:00Z",
    conversationId: "task-x",
    mood: null,
    tags: [],
    wordCount: 12,
  };
}

describe("diary page freeze reproduction", () => {
  beforeEach(() => {
    mocks.invoke.mockImplementation((cmd: string) => {
      if (cmd === "diary_list") {
        return Promise.resolve(
          Array.from({ length: 20 }, (_, i) => diarySummary(`d${i}`)),
        );
      }
      if (cmd === "diary_get") {
        return Promise.resolve({
          id: "d0",
          title: "日记",
          content: "内容",
          entryDate: "2026-08-14",
          createdAt: "2026-08-14T10:00:00Z",
          updatedAt: "2026-08-14T10:00:00Z",
          conversationId: "task-x",
          sourceMessageIds: [],
          mood: null,
          tags: [],
          noteId: null,
          canvasId: null,
          wordCount: 1,
        });
      }
      return Promise.reject(new Error(`unhandled ${cmd}`));
    });
    mocks.executeAssistantTool.mockResolvedValue({ data: { notes: [] } });
    mocks.getAssistantAgentConfig.mockResolvedValue(null);
    mocks.listAssistantToolChanges.mockResolvedValue([]);
    mocks.restoreAssistantToolChange.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("mounts DiaryPage together with SidebarChat without hanging or render-looping", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    render(
      <>
        <SidebarChat open={false} onClose={() => {}} providers={[provider]} onRequestOpen={() => {}} />
        <DiaryPage />
      </>,
    );

    // 若存在渲染循环，React 会抛 "Maximum update depth exceeded"；这里只需确认渲染不抛错且不超时
    const maxDepthErrors = errorSpy.mock.calls.filter((call) =>
      String(call[0]).includes("Maximum update depth"),
    );
    expect(maxDepthErrors).toHaveLength(0);

    errorSpy.mockRestore();
    warnSpy.mockRestore();
  });
});
