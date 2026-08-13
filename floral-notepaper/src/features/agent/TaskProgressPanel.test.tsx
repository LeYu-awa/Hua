// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TaskProgressPanel } from "./TaskProgressPanel";
import type { AgentTask } from "./types";
import { confirmAgentTask } from "./api";
import { dispatchOpenNote } from "../notes/openNoteEvents";

const mocks = vi.hoisted(() => ({
  createAndRunAgentTask: vi.fn(),
  getAgentTask: vi.fn(),
  confirmAgentTask: vi.fn(),
  onAgentStep: vi.fn(() => Promise.resolve(() => {})),
  onAgentTask: vi.fn(() => Promise.resolve(() => {})),
  dispatchOpenNote: vi.fn(),
}));

vi.mock("./api", () => ({
  createAndRunAgentTask: mocks.createAndRunAgentTask,
  getAgentTask: mocks.getAgentTask,
  confirmAgentTask: mocks.confirmAgentTask,
  onAgentStep: mocks.onAgentStep,
  onAgentTask: mocks.onAgentTask,
}));

vi.mock("../notes/openNoteEvents", () => ({
  dispatchOpenNote: mocks.dispatchOpenNote,
}));

const WRITEUP_GOAL = "把画布上的 2 张卡片整理成文：初稿；卡片：n1,n2";

function taskWith(overrides: Partial<AgentTask> & { plan?: AgentTask["plan"] }): AgentTask {
  return {
    taskId: "t1",
    goal: WRITEUP_GOAL,
    status: "Running",
    plan: [
      {
        stepId: "w1",
        kind: "Tool",
        tool: "canvas.read",
        input: { canvasId: "first", nodeIds: ["n1", "n2"] },
        output: null,
        status: "Done",
        requiredConfirm: false,
        confirmed: true,
      },
      {
        stepId: "w2",
        kind: "Llm",
        tool: null,
        input: {},
        output: { text: "这是生成的成文内容" },
        status: "Done",
        requiredConfirm: false,
        confirmed: true,
      },
      {
        stepId: "w3",
        kind: "Tool",
        tool: "note.create",
        input: { title: "画布整理成文", content: "{previousOutput}" },
        output: null,
        status: "Pending",
        requiredConfirm: true,
        confirmed: false,
      },
    ],
    context: null,
    createdAt: "2026-08-14T00:00:00Z",
    updatedAt: "2026-08-14T00:00:00Z",
    logs: [],
    ...overrides,
  };
}

describe("TaskProgressPanel 组卡成文预览（可产出 Agent）", () => {
  beforeEach(() => {
    mocks.createAndRunAgentTask.mockReset();
    mocks.confirmAgentTask.mockReset();
    mocks.dispatchOpenNote.mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("note.create 确认时渲染可编辑成文预览，确认携带编辑后的内容", async () => {
    mocks.createAndRunAgentTask.mockResolvedValue(taskWith({ status: "AwaitingConfirm" }));
    vi.mocked(confirmAgentTask).mockResolvedValue(taskWith({ status: "Done" }));

    render(<TaskProgressPanel goal={WRITEUP_GOAL} />);

    // 预览展示 LLM 生成内容
    expect(await screen.findByDisplayValue("这是生成的成文内容")).toBeTruthy();

    // 编辑正文与标题
    const contentArea = screen.getByDisplayValue("这是生成的成文内容") as HTMLTextAreaElement;
    fireEvent.change(contentArea, { target: { value: "编辑后的成文" } });
    const titleInput = screen.getByDisplayValue("画布整理成文") as HTMLInputElement;
    fireEvent.change(titleInput, { target: { value: "新标题" } });

    fireEvent.click(screen.getByText("确认落盘"));

    await waitFor(() => expect(confirmAgentTask).toHaveBeenCalled());
    expect(confirmAgentTask).toHaveBeenCalledWith("t1", "w3", true, {
      title: "新标题",
      content: "编辑后的成文",
    });
  });

  it("落盘成功后显示横幅并可打开笔记", async () => {
    mocks.createAndRunAgentTask.mockResolvedValue(
      taskWith({
        status: "Done",
        plan: [
          ...taskWith({}).plan.slice(0, 2),
          {
            stepId: "w3",
            kind: "Tool",
            tool: "note.create",
            input: {},
            output: { id: "note-1", title: "成文标题" },
            status: "Done",
            requiredConfirm: true,
            confirmed: true,
          },
        ],
      }),
    );

    render(<TaskProgressPanel goal={WRITEUP_GOAL} />);

    expect(await screen.findByText("已生成笔记《成文标题》")).toBeTruthy();

    fireEvent.click(screen.getByText("打开笔记"));
    expect(dispatchOpenNote).toHaveBeenCalledWith("note-1");
  });

  it("非组卡成文任务不显示产出横幅", async () => {
    mocks.createAndRunAgentTask.mockResolvedValue(
      taskWith({ status: "Done", goal: "帮我找一下 RAG 的笔记" }),
    );

    render(<TaskProgressPanel goal="帮我找一下 RAG 的笔记" />);

    await waitFor(() => expect(mocks.createAndRunAgentTask).toHaveBeenCalled());
    expect(screen.queryByText(/已生成笔记/)).toBeNull();
  });
});
