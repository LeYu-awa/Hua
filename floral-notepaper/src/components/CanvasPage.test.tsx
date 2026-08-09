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

import { CanvasPage } from "./CanvasPage";

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

    await waitFor(() => expect(screen.getByText("文本")).toBeTruthy());
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

    await waitFor(() => expect(screen.getByText("文本")).toBeTruthy());
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
      await waitFor(() => expect(screen.getByText("文本")).toBeTruthy());
      const initial = nodeGroupCount(container);

      fireEvent.click(screen.getByText("文本")); // 新增节点
      expect(nodeGroupCount(container)).toBe(initial + 1);

      fireEvent.click(screen.getByTitle("撤销 (Ctrl+Z)"));
      expect(nodeGroupCount(container)).toBe(initial);

      fireEvent.click(screen.getByTitle("重做 (Ctrl+Shift+Z)"));
      expect(nodeGroupCount(container)).toBe(initial + 1);
    });

    it("撤销：删除节点可撤销恢复", async () => {
      const { container } = renderCanvas();
      await waitFor(() => expect(screen.getByText("文本")).toBeTruthy());
      const initial = nodeGroupCount(container);

      // 选中节点（selectedNodeId 在 mousedown 阶段设置）
      fireEvent.mouseDown(screen.getByText("用户需要实时同步"));
      fireEvent.click(screen.getByText("删除"));
      expect(nodeGroupCount(container)).toBe(initial - 1);

      fireEvent.click(screen.getByTitle("撤销 (Ctrl+Z)"));
      expect(nodeGroupCount(container)).toBe(initial);
    });

    it("自动保存：用户改动后 debounce 触发一次保存", async () => {
      renderCanvas();
      await waitFor(() => expect(screen.getByText("文本")).toBeTruthy());

      vi.useFakeTimers();
      try {
        fireEvent.click(screen.getByText("文本")); // 用户改动
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
      await waitFor(() => expect(screen.getByText("文本")).toBeTruthy());

      fireEvent.click(screen.getByText("文本")); // canvas_shape_added
      expect(mockRecordEvent).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: "canvas_shape_added", conversationId: "demo", userId: "u1" }),
      );

      // 连线：先选中源节点、进入连线模式再点目标节点 → canvas_binding_added
      fireEvent.mouseDown(screen.getByText("用户需要实时同步"));
      fireEvent.click(screen.getByText("连线"));
      fireEvent.click(screen.getByText("成本估算"));
      expect(mockRecordEvent).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: "canvas_binding_added" }),
      );

      // 删除：选中节点再删除 → canvas_shape_removed
      fireEvent.mouseDown(screen.getByText("架构选型"));
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
  });
});

