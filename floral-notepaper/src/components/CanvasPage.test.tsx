// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { CanvasDocument } from "../features/canvas/types";
import type { ProviderConfig } from "../features/settings/types";

// ── mock 三个分析器（隔离网络/Embedding，专注验证 UI 接线）──
const mockFindConnections = vi.fn();
const mockDetectGaps = vi.fn();
const mockDetectConsensus = vi.fn();

vi.mock("../features/agent/connectionRecommendations", () => ({
  findImplicitConnections: (...a: unknown[]) => mockFindConnections(...a),
}));
vi.mock("../features/agent/semanticGap", () => ({
  detectSemanticGaps: (...a: unknown[]) => mockDetectGaps(...a),
}));
vi.mock("../features/agent/consensus", () => ({
  detectConsensus: (...a: unknown[]) => mockDetectConsensus(...a),
}));

// mock 画布持久化：加载失败 → 回退 initialDocument；保存成功
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

function renderCanvas() {
  return render(
    <CanvasPage documentId="canvas-demo" noteId="demo" providers={PROVIDERS} agentEnabled initialDocument={DOC} />,
  );
}

beforeEach(() => {
  mockFindConnections.mockReset();
  mockDetectGaps.mockReset();
  mockDetectConsensus.mockReset();
  mockSave.mockClear();
});
afterEach(cleanup);

describe("CanvasPage — Agent 覆盖层接线", () => {
  it("Agent 开启后工具栏出现三个分析按钮", async () => {
    mockFindConnections.mockResolvedValue([]);
    const { container } = renderCanvas();
    await waitFor(() => expect(container.querySelector("svg")).toBeTruthy());
    expect(screen.getByText("发现连接")).toBeTruthy();
    expect(screen.getByText("补充视角")).toBeTruthy();
    expect(screen.getByText("分析共识")).toBeTruthy();
  });

  it("Agent 关闭时不显示分析按钮（可降级/不打扰）", async () => {
    const { container } = render(
      <CanvasPage documentId="c" noteId="demo" providers={PROVIDERS} agentEnabled={false} initialDocument={DOC} />,
    );
    await waitFor(() => expect(container.querySelector("svg")).toBeTruthy());
    expect(screen.queryByText("发现连接")).toBeNull();
  });

  it("场景1：发现连接 → 渲染虚线+气泡；接受 → 写入 dashed 连线", async () => {
    mockFindConnections.mockResolvedValue([
      { sourceId: "n1", targetId: "n2", similarity: 0.71, distance: 720, message: "这两块好像都在聊同一件事" },
    ]);
    const { container } = renderCanvas();
    await waitFor(() => expect(container.querySelector("svg")).toBeTruthy());

    fireEvent.click(screen.getByText("发现连接"));

    // 虚线建议 + 气泡出现
    await waitFor(() =>
      expect(container.querySelector("line.canvas-suggestion-line")).toBeTruthy(),
    );
    expect(screen.getByText("这两块好像都在聊同一件事")).toBeTruthy();
    const acceptBtn = screen.getByText("轻轻连起来");

    // 接受前：没有实体连线（edge）
    const edgesBefore = container.querySelectorAll("line:not(.canvas-suggestion-line)").length;
    fireEvent.click(acceptBtn);

    // 接受后：新增一条 edge，气泡消失
    await waitFor(() => {
      const edgesAfter = container.querySelectorAll("line:not(.canvas-suggestion-line)").length;
      expect(edgesAfter).toBe(edgesBefore + 1);
    });
    expect(screen.queryByText("轻轻连起来")).toBeNull();
  });

  it("场景2：补充视角 → 渲染缺失视角，点击生成占位节点", async () => {
    mockDetectGaps.mockResolvedValue({
      missingPerspectives: ["用户体验反馈", "风险"],
      coverages: [],
      message: "好像还可以补一小块用户视角",
      areaHint: { x: 300, y: 200 },
    });
    const { container } = renderCanvas();
    await waitFor(() => expect(container.querySelector("svg")).toBeTruthy());

    fireEvent.click(screen.getByText("补充视角"));
    await waitFor(() => expect(screen.getByText("+ 用户体验反馈")).toBeTruthy());
    expect(screen.getByText("+ 风险")).toBeTruthy();

    const nodesBefore = container.querySelectorAll("foreignObject").length;
    fireEvent.click(screen.getByText("+ 用户体验反馈"));
    // 生成一个新占位节点
    await waitFor(() =>
      expect(container.querySelectorAll("foreignObject").length).toBe(nodesBefore + 1),
    );
  });

  it("场景3：分析共识 → 渲染讨论结构面板与分组", async () => {
    mockDetectConsensus.mockResolvedValue({
      topic: "上云",
      status: "mixed",
      groups: [
        { label: "支持上云", color: "#3a7", userIds: ["a", "d"], nodeIds: ["n1"] },
        { label: "反对上云", color: "#c44", userIds: ["b"], nodeIds: ["n3"] },
      ],
      bridgeNodeIds: ["n5"],
    });
    const { container } = renderCanvas();
    await waitFor(() => expect(container.querySelector("svg")).toBeTruthy());

    fireEvent.click(screen.getByText("分析共识"));
    await waitFor(() => expect(screen.getByText(/讨论结构/)).toBeTruthy());
    expect(screen.getByText("支持上云")).toBeTruthy();
    expect(screen.getByText("反对上云")).toBeTruthy();
  });
});
