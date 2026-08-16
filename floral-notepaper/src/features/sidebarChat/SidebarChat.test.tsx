// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProviderConfig } from "../settings/types";
import { dispatchOpenChatTask } from "../diary/diaryEvents";

const TASKS_STORAGE_KEY = "sidebar_ai_chat_tasks";

const mocks = vi.hoisted(() => ({
  executeAssistantTool: vi.fn(),
  getAssistantAgentConfig: vi.fn(),
  listAssistantToolChanges: vi.fn(),
  restoreAssistantToolChange: vi.fn(),
  fetch: vi.fn(),
}));

vi.mock("./assistantTools", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./assistantTools")>();
  return {
    ...actual,
    executeAssistantTool: (...args: unknown[]) => mocks.executeAssistantTool(...args),
    getAssistantAgentConfig: (...args: unknown[]) => mocks.getAssistantAgentConfig(...args),
    listAssistantToolChanges: (...args: unknown[]) => mocks.listAssistantToolChanges(...args),
    restoreAssistantToolChange: (...args: unknown[]) => mocks.restoreAssistantToolChange(...args),
  };
});

vi.mock("../tts", () => ({
  shouldAutoSpeak: () => false,
  speakText: vi.fn(async () => {}),
  stopSpeech: vi.fn(),
  isSpeechPlaying: vi.fn(() => false),
  subscribeSpeechState: vi.fn(() => () => {}),
  subscribeMouthValue: vi.fn(() => () => {}),
  unlockSpeechPlayback: vi.fn(async () => {}),
}));

vi.mock("../settings/stats", () => ({
  logUsage: vi.fn(),
}));

vi.mock("../notes/api", () => ({
  getNote: vi.fn(async () => ({
    id: "n1",
    title: "note",
    content: "",
    category: "",
    wordCount: 0,
  })),
}));

vi.mock("./ChatWritebackReview", () => ({
  ChatWritebackReview: () => null,
}));

/** 简化输入区：直接暴露受控输入框与发送按钮 */
vi.mock("./MentionComposer", () => ({
  MentionComposer: (props: {
    input: string;
    onChange: (value: string) => void;
    onSend: () => void;
  }) => (
    <div data-testid="composer">
      <input
        data-testid="chat-input"
        value={props.input}
        onChange={(event) => props.onChange(event.target.value)}
      />
      <button type="button" data-testid="chat-send" onClick={() => props.onSend()}>
        发送
      </button>
    </div>
  ),
}));

function sseStream(chunks: string[]) {
  const encoder = new TextEncoder();
  const delta = (content: string) =>
    `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`;
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(delta(chunk)));
      }
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });
}

function makeProvider(): ProviderConfig {
  return {
    id: "provider-1",
    enabled: true,
    name: "Test",
    protocol: "openai",
    apiKey: "key",
    baseUrl: "http://localhost:9999",
    apiPath: "/v1/chat/completions",
    models: [{ modelId: "model-1", displayName: "M1" }],
  };
}

function makeAgentConfig() {
  return {
    mode: "autonomous",
    contextPolicy: { recentMessages: 16, allowLocalNoteContext: true, summarizeLongContext: true },
    toolPolicy: {
      allowNoteRead: true,
      allowNoteWrite: true,
      allowWebSearch: true,
      allowExternalTools: true,
    },
    permissionPolicy: {
      readWithoutConfirmation: true,
      writeBeforeConfirm: true,
      webSearchBeforeConfirm: true,
      externalBeforeConfirm: true,
    },
    workflowPolicy: { noteOptimizeReviewRequired: false, writebackReviewSurface: "chat" },
  };
}

beforeEach(() => {
  cleanup();
  localStorage.clear();
  vi.stubGlobal("fetch", mocks.fetch);
  mocks.executeAssistantTool.mockReset();
  mocks.executeAssistantTool.mockResolvedValue({ data: { notes: [] } });
  mocks.getAssistantAgentConfig.mockReset();
  mocks.getAssistantAgentConfig.mockResolvedValue(makeAgentConfig());
  mocks.listAssistantToolChanges.mockReset();
  mocks.listAssistantToolChanges.mockResolvedValue([]);
  mocks.restoreAssistantToolChange.mockReset();
  mocks.fetch.mockReset();
  mocks.fetch.mockResolvedValue({
    ok: true,
    status: 200,
    body: sseStream(["你好，", "我是", "AI"]),
    text: async () => "",
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("SidebarChat 任务隔离", () => {
  it("新建任务后发送消息，AI 回复应写入新任务，而不是上一个任务", async () => {
    // 预置旧任务 T1，带一条历史消息
    localStorage.setItem(
      TASKS_STORAGE_KEY,
      JSON.stringify([
        {
          id: "task-1",
          title: "旧任务",
          messages: [{ role: "user", content: "旧任务的第一条消息", createdAt: 1000 }],
          createdAt: 1000,
          updatedAt: 1000,
        },
      ]),
    );

    const { unmount } = render(<SidebarChatFixture />);

    // 打开任务面板 → 新建任务（切换到 T2）
    fireEvent.click(screen.getByTitle("展开任务栏"));
    fireEvent.click(screen.getByTitle("新建任务"));

    // 在新任务里输入"你好"并发送
    fireEvent.change(screen.getByTestId("chat-input"), { target: { value: "你好" } });
    fireEvent.click(screen.getByTestId("chat-send"));

    // 等待 AI 回复渲染在消息区（新任务 T2）
    await waitFor(() => {
      expect(screen.getAllByText("你好，我是AI").length).toBeGreaterThan(0);
    });

    // 切回旧任务 T1，收起任务面板后确认回复没有出现在 T1 消息区
    fireEvent.click(screen.getByText("旧任务"));
    fireEvent.click(screen.getByTitle("收起任务栏"));
    expect(screen.getByText("旧任务的第一条消息")).toBeTruthy();
    expect(screen.queryByText("你好，我是AI")).toBeNull();
    expect(screen.queryByText("你好")).toBeNull();

    unmount();
  });
});

/** 复用真实组件的最小渲染壳 */
import { SidebarChat } from "./SidebarChat";
function SidebarChatFixture() {
  return <SidebarChat open onClose={() => {}} providers={[makeProvider()]} />;
}

describe("SidebarChat 日记接线（diary S1）", () => {
  it("open-chat-task 事件激活对应对话任务", async () => {
    localStorage.setItem(
      TASKS_STORAGE_KEY,
      JSON.stringify([
        {
          id: "task-a",
          title: "任务A",
          messages: [{ role: "user", content: "A的第一条", createdAt: 1000 }],
          createdAt: 1000,
          updatedAt: 1000,
        },
        {
          id: "task-b",
          title: "任务B",
          messages: [{ role: "user", content: "B的第一条", createdAt: 2000 }],
          createdAt: 2000,
          updatedAt: 2000,
        },
      ]),
    );

    render(<SidebarChatFixture />);

    // 默认激活第一个任务
    expect(screen.getByText("A的第一条")).toBeTruthy();

    dispatchOpenChatTask("task-b");
    await waitFor(() => expect(screen.getByText("B的第一条")).toBeTruthy());
  });

  it("任务内用户消息≥2条且今日未沉淀时显示日记提议卡", async () => {
    localStorage.setItem(
      TASKS_STORAGE_KEY,
      JSON.stringify([
        {
          id: "task-d",
          title: "日记任务",
          messages: [
            { role: "user", content: "第一条", createdAt: 1000 },
            { role: "assistant", content: "回复一", createdAt: 2000 },
            { role: "user", content: "第二条", createdAt: 3000 },
          ],
          createdAt: 1000,
          updatedAt: 3000,
        },
      ]),
    );

    render(<SidebarChatFixture />);

    await waitFor(() => expect(screen.getByText(/要不要把今天的想法记成日记/)).toBeTruthy());
    expect(screen.getByText("存入日记")).toBeTruthy();
    expect(screen.getByText("稍后再说")).toBeTruthy();
    expect(screen.getByText("今天不提醒")).toBeTruthy();
  });
});
