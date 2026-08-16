// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ProviderConfig } from "../features/settings/types";

vi.mock("../features/settings/stats", () => ({ logUsage: vi.fn() }));
const mockSave = vi.fn().mockResolvedValue(undefined);
vi.mock("../features/canvas/api", () => ({
  getCanvasDocument: () => Promise.reject(new Error("no ipc")),
  saveCanvasDocument: (doc: unknown) => mockSave(doc),
}));

import { DeepSeekChat } from "./DeepSeekChat";

const PROVIDERS: ProviderConfig[] = [
  {
    id: "p1",
    enabled: true,
    name: "deepseek",
    protocol: "openai",
    apiKey: "x",
    baseUrl: "http://x",
    apiPath: "/v1/chat/completions",
    models: [{ modelId: "chat-1", displayName: "chat" }],
  },
];

beforeEach(() => {
  mockSave.mockClear();
  // 模拟 AI 回复一条“决策”类内容
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: "我们决定先做实时同步 MVP 方案来推进" } }],
        usage: {},
      }),
      text: async () => "",
    })),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("DeepSeekChat — 场景九聊天沉淀", () => {
  it("决策类 AI 回复出现后，渲染“沉淀到画布”建议并可写入画布", async () => {
    render(
      <DeepSeekChat
        open
        onClose={() => {}}
        docTitle="演示"
        docContent="内容"
        providers={PROVIDERS}
        noteId="demo"
        agentEnabled
      />,
    );

    const textarea = await screen.findByPlaceholderText(/输入问题/);
    fireEvent.change(textarea, { target: { value: "这个功能怎么做？" } });
    fireEvent.keyDown(textarea, { key: "Enter" });

    // AI 回复决策类内容 → 沉淀建议条出现
    await waitFor(() => expect(screen.getByText("沉淀到画布")).toBeTruthy());
    expect(screen.getByText("决策")).toBeTruthy();

    // 点击沉淀 → 写入画布
    fireEvent.click(screen.getByText("沉淀到画布"));
    await waitFor(() => expect(mockSave).toHaveBeenCalledTimes(1));
    const savedDoc = mockSave.mock.calls[0][0] as {
      nodes: Array<{ text: string; source?: string }>;
    };
    expect(savedDoc.nodes.some((n) => n.source === "agent" && n.text.includes("来自聊天"))).toBe(
      true,
    );
  });

  it("agentEnabled=false 时不出现沉淀建议", async () => {
    render(
      <DeepSeekChat
        open
        onClose={() => {}}
        docTitle="演示"
        docContent="内容"
        providers={PROVIDERS}
        noteId="demo"
        agentEnabled={false}
      />,
    );
    const textarea = await screen.findByPlaceholderText(/输入问题/);
    fireEvent.change(textarea, { target: { value: "问题" } });
    fireEvent.keyDown(textarea, { key: "Enter" });
    await waitFor(() => expect(screen.getByText(/实时同步 MVP/)).toBeTruthy());
    expect(screen.queryByText("沉淀到画布")).toBeNull();
  });
});
