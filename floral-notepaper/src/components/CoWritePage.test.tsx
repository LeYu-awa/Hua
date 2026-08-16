// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

// 画布返回若干节点 → buildCanvasContext（真实）→ 头部“已参考画布”chip
vi.mock("../features/canvas/api", () => ({
  getCanvasDocument: () =>
    Promise.resolve({
      id: "canvas-demo",
      noteId: "demo",
      nodes: [
        {
          id: "1",
          type: "text",
          x: 0,
          y: 0,
          width: 200,
          height: 80,
          text: "人物关系：A 与 B 的冲突",
        },
        { id: "2", type: "text", x: 0, y: 0, width: 200, height: 80, text: "场景设定：雨夜车站" },
      ],
      edges: [],
    }),
}));
vi.mock("../features/notes/api", () => ({
  getNote: () => Promise.resolve({ id: "demo", title: "演示笔记", content: "" }),
}));
vi.mock("../features/cowrite/api", () => ({
  createCoWriteSession: vi.fn(),
  appendHumanText: vi.fn(),
  appendAIText: vi.fn(),
  getCoWriteSession: vi.fn(),
  listCoWriteSessions: () => Promise.resolve([]),
  mergeToNote: vi.fn(),
  deleteCoWriteSession: vi.fn(),
  replaceLastAIText: vi.fn(),
  undoLastTurn: vi.fn(),
}));
vi.mock("../features/cowrite/coWriteAI", () => ({
  requestCoWriteAITurn: vi.fn(),
  regenerateCoWriteAITurn: vi.fn(),
  generateInspirations: vi.fn(),
}));
vi.mock("../features/cowrite/coWriteUtils", () => ({
  computeCoWriteStats: () => ({}),
}));
vi.mock("../features/cowrite/prompts", () => ({
  SCENARIO_PRESETS: [],
  getScenario: () => null,
}));

import { CoWritePage } from "./CoWritePage";

afterEach(cleanup);

describe("CoWritePage — 共笔页面挂载", () => {
  it("渲染左侧会话面板主框架", async () => {
    render(<CoWritePage />);
    await waitFor(() => expect(screen.getByText("对话")).toBeTruthy());
  });
});
