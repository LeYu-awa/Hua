// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { CanvasDocument } from "../features/canvas/types";
import type { ProviderConfig } from "../features/settings/types";

const mockSave = vi.fn().mockResolvedValue(undefined);
vi.mock("../features/canvas/api", () => ({
  getCanvasDocument: () => Promise.reject(new Error("no ipc")),
  saveCanvasDocument: (doc: unknown) => mockSave(doc),
}));

const { mockRecordEvent } = vi.hoisted(() => ({
  mockRecordEvent: vi.fn().mockResolvedValue({}),
}));
vi.mock("../features/agent/api", () => ({
  recordAgentEvent: (event: unknown) => mockRecordEvent(event),
  // P1-2/P1-3 新增订阅（CanvasPage effect 挂载即订阅；测试中直接返回空 unlisten）
  onAgentTask: () => Promise.resolve(() => undefined),
  onAgentExport: () => Promise.resolve(() => undefined),
}));

const { mockOpenNote } = vi.hoisted(() => ({
  mockOpenNote: vi.fn(),
}));
vi.mock("../features/notes/openNoteEvents", () => ({
  dispatchOpenNote: (noteId: string) => mockOpenNote(noteId),
}));

import { CanvasPage } from "./CanvasPage";
import {
  AI_REQUEST_EVENT,
  CANVAS_COMMAND_EVENT,
  onAiRequest,
} from "../features/canvas/canvasCommands";

const PROVIDERS: ProviderConfig[] = [
  {
    id: "p1",
    enabled: true,
    name: "mock",
    protocol: "openai",
    apiKey: "x",
    baseUrl: "http://x/api",
    apiPath: "/chat",
    models: [{ modelId: "emb", displayName: "emb", modelTypes: ["embedding"] }],
  },
];

const nd = (id: string, x: number, y: number, text: string) => ({
  id,
  type: "text" as const,
  x,
  y,
  width: 220,
  height: 80,
  text,
});

const DOC: CanvasDocument = {
  id: "canvas-demo",
  noteId: "demo",
  nodes: [
    nd("n1", 40, 150, "用户需要实时同步"),
    nd("n2", 780, 150, "实时同步排期 3 周"),
    nd("n3", 40, 360, "成本估算"),
    nd("n4", 780, 360, "排期计划"),
    nd("n5", 400, 540, "架构选型"),
  ],
  edges: [],
};

class MockResizeObserver {
  private readonly callback: ResizeObserverCallback;

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
  }

  observe(target: Element) {
    this.callback([{ target } as ResizeObserverEntry], this as unknown as ResizeObserver);
  }

  unobserve() {}

  disconnect() {}
}

function createCanvasContextMock(canvas: HTMLCanvasElement): Partial<CanvasRenderingContext2D> {
  return {
    canvas,
    arc: vi.fn(),
    beginPath: vi.fn(),
    clearRect: vi.fn(),
    closePath: vi.fn(),
    drawImage: vi.fn(),
    fill: vi.fn(),
    fillRect: vi.fn(),
    fillText: vi.fn(),
    lineTo: vi.fn(),
    measureText: vi.fn((text: string) => ({ width: text.length * 7 }) as TextMetrics),
    moveTo: vi.fn(),
    quadraticCurveTo: vi.fn(),
    rect: vi.fn(),
    restore: vi.fn(),
    rotate: vi.fn(),
    roundRect: vi.fn(),
    save: vi.fn(),
    scale: vi.fn(),
    setLineDash: vi.fn(),
    setTransform: vi.fn(),
    stroke: vi.fn(),
    strokeRect: vi.fn(),
    translate: vi.fn(),
  };
}

function renderCanvas() {
  return render(
    <CanvasPage
      documentId="canvas-demo"
      noteId="demo"
      providers={PROVIDERS}
      agentEnabled
      initialDocument={DOC}
      conversationId="demo"
      userId="u1"
    />,
  );
}

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, value: 960 });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, value: 640 });
  HTMLElement.prototype.getBoundingClientRect = vi.fn(() => ({
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: 960,
    bottom: 640,
    width: 960,
    height: 640,
    toJSON: () => ({}),
  }));
  HTMLCanvasElement.prototype.getContext = vi.fn(function getContext(this: HTMLCanvasElement) {
    return createCanvasContextMock(this) as CanvasRenderingContext2D;
  });
  globalThis.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;
});

beforeEach(() => {
  mockSave.mockClear();
  mockRecordEvent.mockClear();
});

afterEach(cleanup);

describe("CanvasPage — SVG 画布接线", () => {
  it("加载失败时回退 initialDocument 并渲染 SVG 画布", async () => {
    const { container } = renderCanvas();

    await waitFor(() => expect(screen.getByText("想法")).toBeTruthy());
    expect(container.querySelector("svg")).toBeTruthy();
    expect(screen.getByText("保存")).toBeTruthy();
    expect(screen.getByText("智能归档")).toBeTruthy();
    // Agent 按钮在 agentEnabled && providers 非空时出现
    expect(screen.getByText("发现连接")).toBeTruthy();
    expect(screen.getByText("补充视角")).toBeTruthy();
    expect(screen.getByText("分析共识")).toBeTruthy();
  });

  it("SVG 画布中显示 initialDocument 的节点且可触发保存", async () => {
    renderCanvas();

    await waitFor(() => expect(screen.getByText("想法")).toBeTruthy());
    // 初始节点文本应渲染
    expect(screen.getByText("用户需要实时同步")).toBeTruthy();
    expect(screen.getByText("架构选型")).toBeTruthy();

    const saveButtons = screen.getAllByText("保存");
    fireEvent.click(saveButtons[0]);

    await waitFor(() => expect(mockSave).toHaveBeenCalled());
    const savedDoc = mockSave.mock.calls.at(-1)?.[0] as CanvasDocument;
    expect(savedDoc.nodes.length).toBe(DOC.nodes.length);
  });

  describe("CanvasPage — P0 缩放平移 / 撤销重做 / 自动保存 / 埋点", () => {
    const nodeGroupCount = (container: HTMLElement) =>
      container.querySelectorAll('g[transform]:not([transform*="scale"])').length;

    it("缩放：放大/缩小/复位按钮更新百分比指示", async () => {
      const { container } = renderCanvas();
      await waitFor(() => expect(screen.getByText("100%")).toBeTruthy());

      fireEvent.click(screen.getByTitle("放大 (Ctrl+=)"));
      expect(screen.getByText("115%")).toBeTruthy();
      // 内容层应携带缩放变换
      expect(container.querySelector('g[transform*="scale"]')).toBeTruthy();

      fireEvent.click(screen.getByTitle("缩小 (Ctrl+-)"));
      expect(screen.getByText("100%")).toBeTruthy();

      fireEvent.click(screen.getByTitle("放大 (Ctrl+=)"));
      fireEvent.click(screen.getByTitle("复位到 100% (Ctrl+0)"));
      expect(screen.getByText("100%")).toBeTruthy();
    });

    it("撤销/重做：新增节点入栈后可撤销回退、重做恢复", async () => {
      const { container } = renderCanvas();
      await waitFor(() => expect(screen.getByText("想法")).toBeTruthy());
      const initial = nodeGroupCount(container);

      fireEvent.click(screen.getByText("想法")); // 新增节点
      expect(nodeGroupCount(container)).toBe(initial + 1);

      fireEvent.click(screen.getByTitle("撤销 (Ctrl+Z)"));
      expect(nodeGroupCount(container)).toBe(initial);

      fireEvent.click(screen.getByTitle("重做 (Ctrl+Shift+Z)"));
      expect(nodeGroupCount(container)).toBe(initial + 1);
    });

    it("撤销：删除节点可撤销恢复", async () => {
      const { container } = renderCanvas();
      await waitFor(() => expect(screen.getByText("想法")).toBeTruthy());
      const initial = nodeGroupCount(container);

      // 选中节点（selectedNodeId 在 pointerdown 阶段设置）
      fireEvent.pointerDown(screen.getByText("用户需要实时同步"), {
        clientX: 120,
        clientY: 160,
        button: 0,
        pointerId: 1,
        pointerType: "mouse",
      });
      fireEvent.pointerUp(window, { pointerId: 1, pointerType: "mouse" });
      fireEvent.click(screen.getByText("删除"));
      expect(nodeGroupCount(container)).toBe(initial - 1);

      fireEvent.click(screen.getByTitle("撤销 (Ctrl+Z)"));
      expect(nodeGroupCount(container)).toBe(initial);
    });

    it("自动保存：用户改动后 debounce 触发一次保存", async () => {
      renderCanvas();
      await waitFor(() => expect(screen.getByText("想法")).toBeTruthy());

      vi.useFakeTimers();
      try {
        fireEvent.click(screen.getByText("想法")); // 用户改动
        vi.advanceTimersByTime(900);
        await Promise.resolve();
        expect(mockSave).toHaveBeenCalled();
        const savedDoc = mockSave.mock.calls.at(-1)?.[0] as CanvasDocument;
        expect(savedDoc.nodes.length).toBe(DOC.nodes.length + 1);
      } finally {
        vi.useRealTimers();
      }
    });

    it("埋点：新增节点/连线/删除分别上报画布事件", async () => {
      renderCanvas();
      await waitFor(() => expect(screen.getByText("想法")).toBeTruthy());

      fireEvent.click(screen.getByText("想法")); // canvas_shape_added
      expect(mockRecordEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: "canvas_shape_added",
          conversationId: "demo",
          userId: "u1",
        }),
      );

      // 连线：先选中源节点、进入连线模式再点目标节点 → canvas_binding_added
      fireEvent.pointerDown(screen.getByText("用户需要实时同步"), {
        clientX: 120,
        clientY: 160,
        button: 0,
        pointerId: 1,
        pointerType: "mouse",
      });
      fireEvent.pointerUp(window, { pointerId: 1, pointerType: "mouse" });
      fireEvent.click(screen.getByText("连线"));
      fireEvent.click(screen.getByText("成本估算"));
      // 连线类型选择：选"相关"后才真正建边
      fireEvent.click(screen.getByText("相关"));
      expect(mockRecordEvent).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: "canvas_binding_added" }),
      );

      // 删除：选中节点再删除 → canvas_shape_removed
      fireEvent.pointerDown(screen.getByText("架构选型"), {
        clientX: 430,
        clientY: 570,
        button: 0,
        pointerId: 2,
        pointerType: "mouse",
      });
      fireEvent.pointerUp(window, { pointerId: 2, pointerType: "mouse" });
      fireEvent.click(screen.getByText("删除"));
      expect(mockRecordEvent).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: "canvas_shape_removed" }),
      );
    });

    it("缩放状态为内部视图状态：不污染文档（保存内容仍为节点快照）", async () => {
      renderCanvas();
      await waitFor(() => expect(screen.getByText("100%")).toBeTruthy());
      fireEvent.click(screen.getByTitle("放大 (Ctrl+=)"));
      expect(screen.getByText("115%")).toBeTruthy();

      fireEvent.click(screen.getByText("保存"));
      await waitFor(() => expect(mockSave).toHaveBeenCalled());
      const savedDoc = mockSave.mock.calls.at(-1)?.[0] as CanvasDocument;
      expect(savedDoc.nodes.length).toBe(DOC.nodes.length);
    });

    it("mini map：渲染全局预览并支持点击跳转视口", async () => {
      const { container } = renderCanvas();
      await waitFor(() => expect(screen.getByTestId("canvas-minimap")).toBeTruthy());
      const contentLayerBefore = container.querySelectorAll('g[transform*="scale"]')[1];
      const before = contentLayerBefore?.getAttribute("transform");

      fireEvent.pointerDown(screen.getByTestId("canvas-minimap-map"), {
        clientX: 120,
        clientY: 120,
        button: 0,
        pointerId: 1,
        pointerType: "mouse",
      });

      const contentLayerAfter = container.querySelectorAll('g[transform*="scale"]')[1];
      expect(contentLayerAfter?.getAttribute("transform")).not.toBe(before);
    });

    it("mini map：拖动视口框同步移动主画布", async () => {
      const { container } = renderCanvas();
      await waitFor(() => expect(screen.getByTestId("canvas-minimap-viewport")).toBeTruthy());
      const contentLayerBefore = container.querySelectorAll('g[transform*="scale"]')[1];
      const before = contentLayerBefore?.getAttribute("transform");

      fireEvent.pointerDown(screen.getByTestId("canvas-minimap-viewport"), {
        clientX: 150,
        clientY: 120,
        button: 0,
        pointerId: 2,
        pointerType: "mouse",
      });
      fireEvent.pointerMove(window, {
        clientX: 190,
        clientY: 155,
        pointerId: 2,
        pointerType: "mouse",
      });
      fireEvent.pointerUp(window, { pointerId: 2, pointerType: "mouse" });

      const contentLayerAfter = container.querySelectorAll('g[transform*="scale"]')[1];
      expect(contentLayerAfter?.getAttribute("transform")).not.toBe(before);
    });

    it("触摸：拖动画布与拖动 mini map 视口均能更新主画布", async () => {
      const { container } = renderCanvas();
      await waitFor(() => expect(screen.getByText("想法")).toBeTruthy());
      const bg = screen.getByTestId("canvas-bg");
      const beforePan = container
        .querySelectorAll('g[transform*="scale"]')[1]
        ?.getAttribute("transform");

      fireEvent.pointerDown(bg, {
        clientX: 120,
        clientY: 120,
        button: 0,
        pointerId: 7,
        pointerType: "touch",
      });
      fireEvent.pointerMove(window, {
        clientX: 180,
        clientY: 170,
        pointerId: 7,
        pointerType: "touch",
      });
      fireEvent.pointerUp(window, { pointerId: 7, pointerType: "touch" });
      const afterPan = container
        .querySelectorAll('g[transform*="scale"]')[1]
        ?.getAttribute("transform");
      expect(afterPan).not.toBe(beforePan);

      const beforeMiniMap = afterPan;
      fireEvent.pointerDown(screen.getByTestId("canvas-minimap-viewport"), {
        clientX: 150,
        clientY: 120,
        button: 0,
        pointerId: 8,
        pointerType: "touch",
      });
      fireEvent.pointerMove(window, {
        clientX: 175,
        clientY: 140,
        pointerId: 8,
        pointerType: "touch",
      });
      fireEvent.pointerUp(window, { pointerId: 8, pointerType: "touch" });
      const afterMiniMap = container
        .querySelectorAll('g[transform*="scale"]')[1]
        ?.getAttribute("transform");
      expect(afterMiniMap).not.toBe(beforeMiniMap);
    });

    it("节点拖动：按住卡片内容拖拽可移动元素", async () => {
      const { container } = renderCanvas();
      await waitFor(() => expect(screen.getByText("用户需要实时同步")).toBeTruthy());
      const nodeG = screen.getByText("用户需要实时同步").closest("g") as SVGGElement;
      const before = nodeG.getAttribute("transform");

      fireEvent.pointerDown(nodeG, {
        clientX: 120,
        clientY: 160,
        button: 0,
        pointerId: 3,
        pointerType: "mouse",
      });
      fireEvent.pointerMove(window, {
        clientX: 260,
        clientY: 260,
        pointerId: 3,
        pointerType: "mouse",
      });
      fireEvent.pointerUp(window, { pointerId: 3, pointerType: "mouse" });

      const movedNode = Array.from(container.querySelectorAll("g")).find((g) =>
        g.textContent?.includes("用户需要实时同步"),
      );
      expect(movedNode?.getAttribute("transform")).not.toBe(before);
    });

    it("平移：桌面端中键拖拽空白处稳定移动整个画布", async () => {
      const { container } = renderCanvas();
      await waitFor(() => expect(screen.getByText("想法")).toBeTruthy());
      const bg = screen.getByTestId("canvas-bg");
      const contentLayerBefore = container.querySelectorAll('g[transform*="scale"]')[1];
      const before = contentLayerBefore?.getAttribute("transform");

      fireEvent.pointerDown(bg, {
        clientX: 100,
        clientY: 100,
        button: 1,
        pointerId: 1,
        pointerType: "mouse",
      });
      fireEvent.pointerMove(window, {
        clientX: 180,
        clientY: 150,
        pointerId: 1,
        pointerType: "mouse",
      });
      fireEvent.pointerUp(window, { pointerId: 1, pointerType: "mouse" });

      const contentLayerAfter = container.querySelectorAll('g[transform*="scale"]')[1];
      expect(contentLayerAfter?.getAttribute("transform")).not.toBe(before);
    });

    it("Ctrl 框选：拖出绿色虚线框并选中相交卡片", async () => {
      renderCanvas();
      await waitFor(() => expect(screen.getByText("想法")).toBeTruthy());
      const bg = screen.getByTestId("canvas-bg");

      fireEvent.pointerDown(bg, {
        clientX: 20,
        clientY: 120,
        button: 0,
        ctrlKey: true,
        pointerId: 1,
        pointerType: "mouse",
      });
      fireEvent.pointerMove(window, {
        clientX: 330,
        clientY: 470,
        pointerId: 1,
        pointerType: "mouse",
      });
      expect(screen.getByTestId("canvas-marquee")).toBeTruthy();
      fireEvent.pointerUp(window, { pointerId: 1, pointerType: "mouse" });

      expect(screen.queryByTestId("canvas-marquee")).toBeNull();
      expect(screen.getByText("已选 2 张")).toBeTruthy();
      fireEvent.contextMenu(screen.getByText("成本估算"), { clientX: 240, clientY: 180 });
      expect(screen.getByText("批量删除")).toBeTruthy();
      expect(screen.getByText("2")).toBeTruthy();
    });

    it("多选与批量删除：Ctrl 选中多张卡片后右键批量删除", async () => {
      const { container } = renderCanvas();
      await waitFor(() => expect(screen.getByText("想法")).toBeTruthy());
      vi.spyOn(window, "confirm").mockReturnValueOnce(true);
      const initial = nodeGroupCount(container);

      fireEvent.pointerDown(screen.getByText("用户需要实时同步"), {
        ctrlKey: true,
        button: 0,
        pointerId: 1,
        pointerType: "mouse",
      });
      fireEvent.pointerDown(screen.getByText("成本估算"), {
        ctrlKey: true,
        button: 0,
        pointerId: 2,
        pointerType: "mouse",
      });
      fireEvent.contextMenu(screen.getByText("成本估算"), { clientX: 240, clientY: 180 });
      fireEvent.click(screen.getByText("批量删除"));

      expect(nodeGroupCount(container)).toBe(initial - 2);
    });

    it("Agent 联动：任务步骤拖拽到画布生成绑定任务卡片", async () => {
      renderCanvas();
      await waitFor(() => expect(screen.getByText("想法")).toBeTruthy());
      const bg = screen.getByTestId("canvas-bg");
      const data = {
        taskId: "task-1",
        goal: "整理需求",
        stepId: "step-1",
        kind: "Tool",
        tool: "canvas.create_card",
        status: "Running",
        input: { title: "需求卡片" },
      };
      const dataTransfer = {
        types: ["application/x-floral-agent-step"],
        getData: (type: string) =>
          type === "application/x-floral-agent-step" ? JSON.stringify(data) : "",
      };

      fireEvent.dragOver(bg, { dataTransfer });
      fireEvent.drop(bg, { dataTransfer, clientX: 320, clientY: 240 });

      await waitFor(() => expect(screen.getByText(/canvas.create_card/)).toBeTruthy());
      expect(screen.getByText("执行中")).toBeTruthy();
    });
  });

  describe("CanvasPage — AI 命令桥（ai-3）：一键执行画布操作", () => {
    it("createCards：新建 N 张内容卡片并渲染", async () => {
      renderCanvas();
      await waitFor(() => expect(screen.getByText("想法")).toBeTruthy());

      window.dispatchEvent(
        new CustomEvent(CANVAS_COMMAND_EVENT, {
          detail: { kind: "createCards", count: 3, label: "内容卡片" },
        }),
      );

      await waitFor(() => expect(screen.getAllByText("内容卡片").length).toBe(3));
    });

    it("addZone：生成画布分区标记", async () => {
      renderCanvas();
      await waitFor(() => expect(screen.getByText("想法")).toBeTruthy());

      window.dispatchEvent(
        new CustomEvent(CANVAS_COMMAND_EVENT, {
          detail: { kind: "addZone", label: "灵感区" },
        }),
      );

      await waitFor(() => expect(screen.getByText("◆ 灵感区")).toBeTruthy());
    });

    it("applyPlan：在画布预留规划模块的卡片摆放位置标记", async () => {
      renderCanvas();
      await waitFor(() => expect(screen.getByText("想法")).toBeTruthy());

      window.dispatchEvent(
        new CustomEvent(CANVAS_COMMAND_EVENT, {
          detail: { kind: "applyPlan", markers: [{ label: "灵感区", detail: "收集想法" }] },
        }),
      );

      await waitFor(() => expect(screen.getByText("▫ 灵感区")).toBeTruthy());
    });

    it("runTutorial：重新触发新手引导演示卡片", async () => {
      renderCanvas();
      await waitFor(() => expect(screen.getByText("想法")).toBeTruthy());

      window.dispatchEvent(
        new CustomEvent(CANVAS_COMMAND_EVENT, { detail: { kind: "runTutorial" } }),
      );

      await waitFor(() => expect(screen.getByText("拖拽画布")).toBeTruthy());
      expect(screen.getByText("快速入门模板")).toBeTruthy();
    });
  });

  describe("CanvasPage — 新手引导（ob-1）：四步演示逐步解锁", () => {
    it("完成拖拽/缩放/新建/移动四步后进入完成态，不再自动唤醒 AI", async () => {
      const aiWake = vi.fn();
      const unlisten = onAiRequest(aiWake);
      const { container } = renderCanvas();
      await waitFor(() => expect(screen.getByText("想法")).toBeTruthy());

      window.dispatchEvent(
        new CustomEvent(CANVAS_COMMAND_EVENT, { detail: { kind: "runTutorial" } }),
      );
      await waitFor(() => expect(screen.getByText("拖拽画布")).toBeTruthy());

      // 步骤一：中键拖拽画布（背景按下 → 移动 → 松开）
      const bg = container.querySelector('[data-testid="canvas-bg"]') as SVGRectElement;
      fireEvent.pointerDown(bg, {
        clientX: 100,
        clientY: 100,
        button: 1,
        pointerId: 1,
        pointerType: "mouse",
      });
      fireEvent.pointerMove(window, {
        clientX: 190,
        clientY: 150,
        pointerId: 1,
        pointerType: "mouse",
      });
      fireEvent.pointerUp(window, { pointerId: 1, pointerType: "mouse" });
      await waitFor(() => expect(screen.getByText("缩放视图")).toBeTruthy());

      // 步骤二：缩放视图（点击放大）
      fireEvent.click(screen.getByTitle("放大 (Ctrl+=)"));
      await waitFor(() => expect(screen.getByText("新建卡片")).toBeTruthy());

      // 步骤三：新建卡片（工具栏「卡片」）
      fireEvent.click(screen.getByText("知识"));
      await waitFor(() => expect(screen.getByText("移动卡片")).toBeTruthy());

      // 步骤四：移动卡片（按住节点拖动）
      // 注意：jsdom 对 svg 根元素直接派发 mousemove/mouseup 不触发 React 合成事件，
      // 三连事件均派发在节点 <g>（svg 子元素）上，经冒泡到 svg 的 onMouseMove/onMouseUp
      const nodeG = screen.getByText("用户需要实时同步").closest("g") as SVGGElement;
      fireEvent.pointerDown(nodeG, {
        clientX: 120,
        clientY: 160,
        button: 0,
        pointerId: 4,
        pointerType: "mouse",
      });
      fireEvent.pointerMove(window, {
        clientX: 260,
        clientY: 260,
        pointerId: 4,
        pointerType: "mouse",
      });
      fireEvent.pointerUp(window, { pointerId: 4, pointerType: "mouse" });

      // 四步完成：进入完成态，且不自动唤醒 AI（引导仅提供手动发起入口）
      await waitFor(() => expect(screen.getByText("四项基础操作已学会")).toBeTruthy(), {
        timeout: 3000,
      });
      expect(aiWake).not.toHaveBeenCalled();

      // 自动演示模式：完成态停留片刻后自动结束引导（演示卡片消失，可直接开始创作）
      await waitFor(() => expect(screen.queryByText("四项基础操作已学会")).toBeNull(), {
        timeout: 5000,
      });
      unlisten();
    });
  });
});

describe("CanvasPage — 卡片增强（P0-1：待办/资源/颜色标签/分组）", () => {
  const metaDoc: CanvasDocument = {
    id: "canvas-meta",
    noteId: "demo",
    nodes: [
      { ...nd("t1", 40, 150, "写第一章初稿"), type: "task" },
      { ...nd("r1", 400, 150, "人物设定资料"), type: "resource", noteId: "note-abc" },
      { ...nd("c1", 40, 360, "灵感：雨夜重逢"), type: "card", color: "#c28060", tags: ["灵感"] },
      { ...nd("n1", 400, 360, "普通文本"), type: "text" },
    ],
    edges: [],
  };

  function renderMeta() {
    return render(
      <CanvasPage
        documentId="canvas-meta"
        noteId="demo"
        providers={PROVIDERS}
        agentEnabled
        initialDocument={metaDoc}
        conversationId="demo"
        userId="u1"
      />,
    );
  }

  beforeEach(() => {
    mockOpenNote.mockClear();
  });

  it("task 待办卡：点击勾选切换完成态并落盘", async () => {
    renderMeta();
    await waitFor(() => expect(screen.getByText("写第一章初稿")).toBeTruthy());

    fireEvent.click(screen.getByTitle("标记完成"));

    await waitFor(() => expect(mockSave).toHaveBeenCalled());
    const saved = mockSave.mock.calls.at(-1)?.[0] as CanvasDocument;
    const task = saved.nodes.find((n) => n.id === "t1");
    expect(task?.done).toBe(true);
  });

  it("resource 资源卡：双击打开关联笔记", async () => {
    renderMeta();
    await waitFor(() => expect(screen.getByText("人物设定资料")).toBeTruthy());

    fireEvent.doubleClick(screen.getByText("人物设定资料"));

    expect(mockOpenNote).toHaveBeenCalledWith("note-abc");
  });

  it("card 灵感卡：属性面板可设颜色并落盘", async () => {
    renderMeta();
    await waitFor(() => expect(screen.getByText("灵感：雨夜重逢")).toBeTruthy());

    // pointerDown 选中卡片（选中发生在 pointerDown 而非 click）
    const cardG = screen.getByText("灵感：雨夜重逢").closest("g") as SVGGElement;
    fireEvent.pointerDown(cardG, {
      clientX: 60,
      clientY: 380,
      button: 0,
      pointerId: 11,
      pointerType: "mouse",
    });
    fireEvent.pointerUp(window, { pointerId: 11, pointerType: "mouse" });
    await waitFor(() => expect(screen.getByText("属性")).toBeTruthy());
    fireEvent.click(screen.getByText("属性"));

    // 点第二个色块（#7aa65c）
    const swatches = document.querySelectorAll("button[aria-label^='#']");
    expect(swatches.length).toBeGreaterThan(0);
    fireEvent.click(swatches[1]);

    await waitFor(() => expect(mockSave).toHaveBeenCalled());
    const saved = mockSave.mock.calls.at(-1)?.[0] as CanvasDocument;
    const card = saved.nodes.find((n) => n.id === "c1");
    expect(card?.color).toBe("#7aa65c");
  });

  it("新建分组：选中的节点归入新分组并落盘", async () => {
    renderMeta();
    await waitFor(() => expect(screen.getByText("写第一章初稿")).toBeTruthy());

    // ctrl+pointerDown 多选两个节点（画布用 ctrl/meta 作为多选修饰键）
    const tG = screen.getByText("写第一章初稿").closest("g") as SVGGElement;
    fireEvent.pointerDown(tG, {
      clientX: 60,
      clientY: 170,
      button: 0,
      pointerId: 21,
      pointerType: "mouse",
    });
    const nG = screen.getByText("普通文本").closest("g") as SVGGElement;
    fireEvent.pointerDown(nG, {
      clientX: 420,
      clientY: 380,
      button: 0,
      pointerId: 22,
      pointerType: "mouse",
      ctrlKey: true,
    });
    fireEvent.pointerUp(window, { pointerId: 21, pointerType: "mouse" });
    fireEvent.pointerUp(window, { pointerId: 22, pointerType: "mouse" });

    await waitFor(() => expect(screen.getByText("已选 2 张")).toBeTruthy());
    fireEvent.click(screen.getByText("分组"));

    await waitFor(() => expect(mockSave).toHaveBeenCalled());
    const saved = mockSave.mock.calls.at(-1)?.[0] as CanvasDocument;
    expect(saved.groups?.length).toBe(1);
    expect(saved.groups?.[0].title).toContain("分组");
    expect(saved.nodes.find((n) => n.id === "t1")?.group).toBe(saved.groups?.[0].id);
    expect(saved.nodes.find((n) => n.id === "n1")?.group).toBe(saved.groups?.[0].id);
  });

  it("右键菜单可把节点移到分组", async () => {
    renderMeta();
    await waitFor(() => expect(screen.getByText("写第一章初稿")).toBeTruthy());

    // 先建一个分组（pointerDown 选中普通文本）
    const nG = screen.getByText("普通文本").closest("g") as SVGGElement;
    fireEvent.pointerDown(nG, {
      clientX: 420,
      clientY: 380,
      button: 0,
      pointerId: 31,
      pointerType: "mouse",
    });
    fireEvent.pointerUp(window, { pointerId: 31, pointerType: "mouse" });
    fireEvent.click(screen.getByText("分组"));
    await waitFor(() => expect(mockSave).toHaveBeenCalled());

    // 右键任务节点 → 移到分组（右键会顺带选中该节点）
    const tG = screen.getByText("写第一章初稿").closest("g") as SVGGElement;
    fireEvent.contextMenu(tG, { clientX: 60, clientY: 170 });
    await waitFor(() => expect(screen.getByText("移到分组")).toBeTruthy());
    const groupTitle = screen.getByText(/^分组 \d+$/);
    fireEvent.click(groupTitle);

    await waitFor(() => expect(mockSave.mock.calls.length).toBeGreaterThan(1));
    const saved = mockSave.mock.calls.at(-1)?.[0] as CanvasDocument;
    expect(saved.nodes.find((n) => n.id === "t1")?.group).toBe(saved.groups?.[0].id);
  });
});
