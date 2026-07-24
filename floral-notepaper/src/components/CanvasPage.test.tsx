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
    <CanvasPage documentId="canvas-demo" noteId="demo" providers={PROVIDERS} agentEnabled initialDocument={DOC} />,
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
});

afterEach(cleanup);

describe("CanvasPage — SVG 画布接线", () => {
  it("加载失败时回退 initialDocument 并渲染 SVG 画布", async () => {
    const { container } = renderCanvas();

    await waitFor(() => expect(screen.getByText("+ 文本")).toBeTruthy());
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

    await waitFor(() => expect(screen.getByText("+ 文本")).toBeTruthy());
    // 初始节点文本应渲染
    expect(screen.getByText("用户需要实时同步")).toBeTruthy();
    expect(screen.getByText("架构选型")).toBeTruthy();

    const saveButtons = screen.getAllByText("保存");
    fireEvent.click(saveButtons[0]);

    await waitFor(() => expect(mockSave).toHaveBeenCalled());
    const savedDoc = mockSave.mock.calls.at(-1)?.[0] as CanvasDocument;
    expect(savedDoc.nodes.length).toBe(DOC.nodes.length);
  });
});

