import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  LGraph,
  LGraphCanvas,
  LGraphNode,
  LiteGraph,
  type SerialisableGraph,
} from "@comfyorg/litegraph";
import type { NodeProperty } from "@comfyorg/litegraph/dist/LGraphNode";
import "@comfyorg/litegraph/style.css";
import { createEmptyWorkflowDocument,
  WORKFLOW_NODE_DEFINITIONS,
  type WorkflowDocument,
  type WorkflowNodeDefinition,
  type WorkflowValidationResult,
} from "../../features/workflow/types";
import { runWorkflow, validateWorkflow } from "../../features/workflow/api";
import "./LiteGraphWorkflow.css";

interface LiteGraphWorkflowProps {
  workflow?: WorkflowDocument;
  documentId: string;
  noteId?: string;
  conversationId?: string | null;
  readonly?: boolean;
  showPanels?: boolean;
  onChange?: (workflow: WorkflowDocument) => void;
  onSave?: (workflow: WorkflowDocument) => void | Promise<void>;
  onAgentSync?: (workflow: WorkflowDocument) => void;
}

interface SelectedNodeState {
  id: string;
  title: string;
  type: string;
  properties: Record<string, unknown>;
}

interface DragNodePayload {
  type: string;
}

type LiteGraphNodeShape = "default" | "circle" | "round" | "card" | "box";

const NODE_DRAG_TYPE = "application/x-floral-workflow-node";
const DOC_DRAG_TYPE = "collab-doc";
const THEME_FALLBACK = {
  canvasBackground: "#050505",
  nodeBackground: "#121214",
  nodeText: "#e8e8ea",
  nodeBorder: "rgba(255, 255, 255, 0.12)",
  widgetMuted: "rgba(232, 232, 234, 0.58)",
};
const INITIAL_EMPTY_OFFSET: [number, number] = [84, 96];
const DESKTOP_MIN_INITIAL_SCALE = 1.08;
const DESKTOP_MAX_INITIAL_SCALE = 1.18;
const MOBILE_MIN_INITIAL_SCALE = 0.96;
const MOBILE_MAX_INITIAL_SCALE = 1.06;
const MOBILE_CANVAS_BREAKPOINT = 720;
const WORKFLOW_RENDER_SCALE = 0.82;
const MAX_CANVAS_DPR = 2.5;
const WORKFLOW_GRID_SIZE = 48;
const WORKFLOW_DOT_GRID_SIZE = 18;
const WORKFLOW_HOVER_MAX_WIDTH = 280;
const WORKFLOW_HOVER_LINE_HEIGHT = 16;

let registered = false;



export function LiteGraphWorkflow({
  workflow,
  documentId,
  noteId,
  conversationId,
  readonly = false,
  showPanels = true,
  onChange,
  onSave,
  onAgentSync,
}: LiteGraphWorkflowProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const graphRef = useRef<LGraph | null>(null);
  const graphCanvasRef = useRef<LGraphCanvas | null>(null);
  const workflowRef = useRef<WorkflowDocument>(workflow ?? createEmptyWorkflowDocument(documentId, noteId));
  const onChangeRef = useRef(onChange);
  const onAgentSyncRef = useRef(onAgentSync);
  const didFitInitialViewRef = useRef(false);
  const changeTimerRef = useRef<number | null>(null);
  const [selectedNode, setSelectedNode] = useState<SelectedNodeState | null>(null);
  const [validation, setValidation] = useState<WorkflowValidationResult | null>(null);
  const [status, setStatus] = useState<string>(conversationId ? "LiteGraph 工作流已就绪" : "选择对话后可同步 Agent 事件");

  const initialWorkflow = useMemo(
    () => workflow ?? createEmptyWorkflowDocument(documentId, noteId),
    [documentId, noteId, workflow],
  );

  useEffect(() => {
    onChangeRef.current = onChange;
    onAgentSyncRef.current = onAgentSync;
  }, [onAgentSync, onChange]);

  const emitChange = useCallback(() => {
    const graph = graphRef.current;
    if (!graph) return;
    const nextWorkflow = serializeWorkflow(graph, documentId, noteId, conversationId ?? undefined);
    workflowRef.current = nextWorkflow;
    onChangeRef.current?.(nextWorkflow);
    onAgentSyncRef.current?.(nextWorkflow);
  }, [conversationId, documentId, noteId]);

  const scheduleChange = useCallback(() => {
    if (changeTimerRef.current !== null) window.clearTimeout(changeTimerRef.current);
    changeTimerRef.current = window.setTimeout(() => {
      changeTimerRef.current = null;
      emitChange();
    }, 250);
  }, [emitChange]);

  useEffect(() => {
    registerWorkflowNodes();
    const canvas = canvasRef.current;
    if (!canvas) return;

    const graph = new LGraph();
    const graphCanvas = new LGraphCanvas(canvas, graph);
    didFitInitialViewRef.current = false;
    configureCanvasTheme(graphCanvas);
    const themeObserver = observeThemeChanges(graph, graphCanvas);
    graphCanvas.read_only = readonly;
    graphRef.current = graph;
    graphCanvasRef.current = graphCanvas;
    workflowRef.current = initialWorkflow;

    try {
      graph.configure(initialWorkflow.graph as SerialisableGraph);
      normaliseGraphNodes(graph);
    } catch {
    }

    graphCanvas.onNodeSelected = (node) => setSelectedNode(readSelectedNode(node));
    graphCanvas.onNodeDeselected = () => setSelectedNode(null);
    graphCanvas.onNodeMoved = () => scheduleChange();
    graphCanvas.onAfterChange = () => scheduleChange();
    graphCanvas.onMouse = () => {
      graphCanvas.setDirty(true, false);
      return false;
    };
    graphCanvas.startRendering();
    resizeCanvas(canvas, graphCanvas);
    fitInitialView(graph, graphCanvas, didFitInitialViewRef);

    const resizeObserver = new ResizeObserver(() => {
      resizeCanvas(canvas, graphCanvas);
      fitInitialView(graph, graphCanvas, didFitInitialViewRef);
    });
    resizeObserver.observe(canvas.parentElement ?? canvas);
    const uninstallDialogs = installLiteGraphDialogManager();

    return () => {
      uninstallDialogs();
      themeObserver.disconnect();
      resizeObserver.disconnect();
      if (changeTimerRef.current !== null) window.clearTimeout(changeTimerRef.current);
      graph.stop();
      graphCanvas.stopRendering();
      graphCanvas.unbindEvents();
      graph.clear();
      graphRef.current = null;
      graphCanvasRef.current = null;
      setSelectedNode(null);
    };
  }, [initialWorkflow, readonly, scheduleChange]);

  const addNode = useCallback(
    (definition: WorkflowNodeDefinition, x = 80, y = 80, overrides: Record<string, unknown> = {}) => {
      if (readonly) return;
      const graph = graphRef.current;
      if (!graph) return;
      const node = LiteGraph.createNode(definition.type);
      if (!node) return;
      node.pos = [x, y];
      node.size = [definition.width, definition.height];
      node.properties = toNodeProperties({ ...definition.defaults, ...overrides });
      applyNodeStyle(node, definition);
      graph.add(node);
      graph.setDirtyCanvas(true, true);
      scheduleChange();
    },
    [readonly, scheduleChange],
  );

  const handleDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      if (readonly) return;
      const graphCanvas = graphCanvasRef.current;
      if (!graphCanvas) return;
      const pos = screenToGraph(graphCanvas, event.clientX, event.clientY);
      const workflowNode = readWorkflowDragPayload(event);

      if (workflowNode) {
        const definition = WORKFLOW_NODE_DEFINITIONS.find((item) => item.type === workflowNode.type);
        if (definition) addNode(definition, pos[0], pos[1]);
        return;
      }

      const documentPayload = readDocumentDragPayload(event);
      if (documentPayload) {
        const definition = WORKFLOW_NODE_DEFINITIONS.find((item) => item.type === "floral/document");
        if (definition) {
          addNode(definition, pos[0], pos[1], {
            title: documentPayload.title,
            documentId: documentPayload.id ?? documentPayload.documentId ?? "",
          });
        }
      }
    },
    [addNode, readonly],
  );

  const handleSave = useCallback(async () => {
    emitChange();
    await onSave?.(workflowRef.current);
    setStatus("工作流已保存");
  }, [emitChange, onSave]);

  const handleValidate = useCallback(async () => {
    emitChange();
    try {
      const result = await validateWorkflow(workflowRef.current);
      setValidation(result);
      setStatus(result.valid ? "工作流校验通过" : `校验失败：${result.issues[0]?.message ?? "未知错误"}`);
    } catch (error) {
      setStatus(`校验失败：${String(error)}`);
    }
  }, [emitChange]);

  const handleRun = useCallback(async () => {
    emitChange();
    try {
      const result = await runWorkflow(workflowRef.current);
      setValidation(result);
      setStatus(result.valid ? "工作流已提交执行" : `运行拦截：${result.issues[0]?.message ?? "校验失败"}`);
    } catch (error) {
      setStatus(`运行失败：${String(error)}`);
    }
  }, [emitChange]);

  const updateSelectedProperty = useCallback(
    (key: string, value: string) => {
      const graph = graphRef.current;
      if (!selectedNode || !graph) return;
      const node = graph.getNodeById(selectedNode.id);
      if (!node) return;
      node.setProperty(key, value);
      setSelectedNode(readSelectedNode(node));
      graph.setDirtyCanvas(true, true);
      scheduleChange();
    },
    [scheduleChange, selectedNode],
  );

  return (
    <div
      className="litegraph-workflow h-full min-h-0 flex bg-paper relative overflow-hidden"
      onDrop={handleDrop}
      onDragOver={(event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
      }}
    >
      {showPanels && (
        <NodeLibraryPanel
          definitions={WORKFLOW_NODE_DEFINITIONS}
          onAdd={(definition) => addNode(definition, 120, 120)}
        />
      )}
      <div className="litegraph-workflow__main flex-1 min-w-0 min-h-0 relative">
        <WorkflowToolbar
          status={status}
          validation={validation}
          onValidate={handleValidate}
          onSave={handleSave}
          onRun={handleRun}
        />
        <canvas ref={canvasRef} className="litegraph-workflow__canvas" />
      </div>
      {showPanels && (
        <WorkflowInspectorPanel selectedNode={selectedNode} onChange={updateSelectedProperty} />
      )}
    </div>
  );
}

function NodeLibraryPanel({
  definitions,
  onAdd,
}: {
  definitions: WorkflowNodeDefinition[];
  onAdd: (definition: WorkflowNodeDefinition) => void;
}) {
  const [query, setQuery] = useState("");
  const filtered = definitions.filter((definition) => {
    const text = `${definition.title} ${definition.category} ${definition.type}`.toLowerCase();
    return text.includes(query.trim().toLowerCase());
  });

  return (
    <aside className="litegraph-workflow__library">
      <div className="litegraph-workflow__panel-title">节点库</div>
      <input
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        className="litegraph-workflow__search"
        placeholder="搜索节点"
      />
      <div className="litegraph-workflow__node-list">
        {filtered.map((definition) => (
          <button
            key={definition.type}
            type="button"
            draggable
            onClick={() => onAdd(definition)}
            onDragStart={(event) => {
              event.dataTransfer.setData(NODE_DRAG_TYPE, JSON.stringify({ type: definition.type }));
              event.dataTransfer.effectAllowed = "copy";
            }}
            className="litegraph-workflow__node-button"
          >
            <span>{definition.title}</span>
            <small>{definition.category}</small>
          </button>
        ))}
      </div>
    </aside>
  );
}

function WorkflowToolbar({
  status,
  validation,
  onValidate,
  onSave,
  onRun,
}: {
  status: string;
  validation: WorkflowValidationResult | null;
  onValidate: () => void;
  onSave: () => void;
  onRun: () => void;
}) {
  return (
    <div className="litegraph-workflow__toolbar">
      <button type="button" onClick={onValidate}>预览校验</button>
      <button type="button" onClick={onSave}>保存</button>
      <button type="button" onClick={onRun} className="litegraph-workflow__run">运行</button>
      <span className={validation?.valid === false ? "is-error" : ""}>{status}</span>
    </div>
  );
}

function WorkflowInspectorPanel({
  selectedNode,
  onChange,
}: {
  selectedNode: SelectedNodeState | null;
  onChange: (key: string, value: string) => void;
}) {
  return (
    <aside className="litegraph-workflow__inspector">
      <div className="litegraph-workflow__panel-title">属性</div>
      {!selectedNode ? (
        <div className="litegraph-workflow__empty">选择节点后编辑参数</div>
      ) : (
        <div className="litegraph-workflow__properties">
          <div>
            <label>名称</label>
            <strong>{selectedNode.title}</strong>
          </div>
          <div>
            <label>类型</label>
            <code>{selectedNode.type}</code>
          </div>
          {Object.entries(selectedNode.properties).map(([key, value]) => (
            <div key={key}>
              <label>{key}</label>
              <textarea value={String(value ?? "")} onChange={(event) => onChange(key, event.target.value)} />
            </div>
          ))}
        </div>
      )}
    </aside>
  );
}

function registerWorkflowNodes() {
  if (registered) return;
  registered = true;
  applyLiteGraphPalette(getWorkflowTheme());

  for (const definition of WORKFLOW_NODE_DEFINITIONS) {
    class FloralWorkflowNode extends LGraphNode {
      constructor(title = definition.title) {
        super(title, definition.type);
        this.title = definition.title;
        this.size = [definition.width, definition.height];
        this.properties = toNodeProperties(definition.defaults);
        for (const input of definition.inputs) this.addInput(input.name, input.type);
        for (const output of definition.outputs) this.addOutput(output.name, output.type);
        for (const [key, value] of Object.entries(definition.defaults)) {
          this.addWidget("text", key, String(value), (_value) => undefined, { property: key });
        }
        applyNodeStyle(this, definition);
      }
    }

    FloralWorkflowNode.title = definition.title;
    FloralWorkflowNode.type = definition.type;
    LiteGraph.registerNodeType(definition.type, FloralWorkflowNode);
  }
}

function configureCanvasTheme(graphCanvas: LGraphCanvas) {
  const theme = getWorkflowTheme();
  applyLiteGraphPalette(theme);
  graphCanvas.clear_background = true;
  graphCanvas.clear_background_color = theme.canvasBackground;
  graphCanvas.background_image = "";
  graphCanvas.always_render_background = true;
  graphCanvas.onDrawBackground = drawWorkflowBackground;
  graphCanvas.onDrawOverlay = () => drawWorkflowNodeHover(graphCanvas);
  graphCanvas.node_title_color = theme.nodeText;
  graphCanvas.default_link_color = theme.nodeBorder;
  graphCanvas.default_connection_color = {
    input_off: theme.nodeBorder,
    input_on: theme.nodeText,
    output_off: theme.nodeBorder,
    output_on: theme.nodeText,
  };
  graphCanvas.default_connection_color_byType.text = theme.nodeBorder;
  graphCanvas.default_connection_color_byType.document = theme.nodeBorder;
  graphCanvas.default_connection_color_byType.any = theme.nodeBorder;
  graphCanvas.default_connection_color_byTypeOff.text = theme.nodeBorder;
  graphCanvas.default_connection_color_byTypeOff.document = theme.nodeBorder;
  graphCanvas.default_connection_color_byTypeOff.any = theme.nodeBorder;
  graphCanvas.connections_width = 2;
  graphCanvas.maximumFps = 60;
  graphCanvas.highquality_render = true;
  graphCanvas.use_gradients = false;
  graphCanvas.render_shadows = false;
  graphCanvas.render_connections_shadows = false;
  graphCanvas.render_connections_border = false;
  graphCanvas.render_curved_connections = true;
  graphCanvas.render_connection_arrows = true;
  graphCanvas.render_canvas_border = false;
  graphCanvas.low_quality_zoom_threshold = 0.01;
}

interface WorkflowTheme {
  canvasBackground: string;
  nodeBackground: string;
  nodeText: string;
  nodeBorder: string;
  widgetMuted: string;
}

function getWorkflowTheme(): WorkflowTheme {
  if (typeof window === "undefined") return THEME_FALLBACK;
  const styles = window.getComputedStyle(document.documentElement);
  const read = (name: string, fallback: string) => styles.getPropertyValue(name).trim() || fallback;
  return {
    canvasBackground: read("--canvas-bg", THEME_FALLBACK.canvasBackground),
    nodeBackground: read("--canvas-panel-solid", THEME_FALLBACK.nodeBackground),
    nodeText: read("--canvas-control-text", THEME_FALLBACK.nodeText),
    nodeBorder: read("--canvas-border", THEME_FALLBACK.nodeBorder),
    widgetMuted: read("--canvas-panel-muted", THEME_FALLBACK.widgetMuted),
  };
}

function observeThemeChanges(graph: LGraph, graphCanvas: LGraphCanvas) {
  const apply = () => {
    configureCanvasTheme(graphCanvas);
    normaliseGraphNodes(graph);
    graphCanvas.setDirty(true, true);
  };
  const observer = new MutationObserver(apply);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "class"] });
  return observer;
}

function applyLiteGraphPalette(theme: WorkflowTheme) {
  LiteGraph.NODE_TITLE_COLOR = theme.nodeText;
  LiteGraph.NODE_SELECTED_TITLE_COLOR = theme.nodeText;
  LiteGraph.NODE_TEXT_COLOR = theme.nodeText;
  LiteGraph.NODE_TEXT_HIGHLIGHT_COLOR = theme.nodeText;
  LiteGraph.NODE_DEFAULT_COLOR = theme.nodeBackground;
  LiteGraph.NODE_DEFAULT_BGCOLOR = theme.nodeBackground;
  LiteGraph.NODE_DEFAULT_BOXCOLOR = theme.nodeBorder;
  LiteGraph.NODE_BOX_OUTLINE_COLOR = theme.nodeBorder;
  LiteGraph.NODE_TEXT_SIZE = 13;
  LiteGraph.NODE_SUBTEXT_SIZE = 11;
  LiteGraph.WIDGET_BGCOLOR = theme.nodeBackground;
  LiteGraph.WIDGET_OUTLINE_COLOR = theme.nodeBorder;
  LiteGraph.WIDGET_ADVANCED_OUTLINE_COLOR = theme.nodeBorder;
  LiteGraph.WIDGET_TEXT_COLOR = theme.nodeText;
  LiteGraph.WIDGET_SECONDARY_TEXT_COLOR = theme.widgetMuted;
  LiteGraph.WIDGET_DISABLED_TEXT_COLOR = theme.widgetMuted;
  LiteGraph.NODE_WIDGET_HEIGHT = 22;
  LiteGraph.ROUND_RADIUS = 8;
}

function normaliseGraphNodes(graph: LGraph) {
  for (const node of graph.nodes) {
    if (!(node instanceof LGraphNode)) continue;
    const definition = WORKFLOW_NODE_DEFINITIONS.find((item) => item.type === node.type);
    applyNodeStyle(node, definition);
  }
}

function applyNodeStyle(node: LGraphNode, definition?: WorkflowNodeDefinition) {
  const styledNode = node as LGraphNode & { shape?: string };
  styledNode.shape = toLiteGraphShape(definition?.shape);
  const theme = getWorkflowTheme();
  node.color = definition?.color ?? theme.nodeBackground;
  node.bgcolor = definition?.bgcolor ?? theme.nodeBackground;
  node.boxcolor = definition?.boxcolor ?? theme.nodeBorder;
  const defaultWidth = definition?.width ?? 220;
  const defaultHeight = definition?.height ?? 120;
  const width = Math.max(Number(node.size?.[0]) || 0, defaultWidth);
  const height = Math.max(Number(node.size?.[1]) || 0, defaultHeight);
  node.size = [
    Math.max(120, Math.round(width * WORKFLOW_RENDER_SCALE)),
    Math.max(76, Math.round(height * WORKFLOW_RENDER_SCALE)),
  ];
  node.serialize_widgets = true;
  node.redraw_on_mouse = false;
  node.onDrawForeground = drawReadableNodeText as LGraphNode["onDrawForeground"];
}

function toLiteGraphShape(shape?: string): LiteGraphNodeShape {
  return shape === "default" || shape === "circle" || shape === "round" || shape === "card" || shape === "box"
    ? shape
    : "round";
}

function drawReadableNodeText(this: LGraphNode, ctx: CanvasRenderingContext2D) {
  const value = getNodePreviewText(this);
  if (!value || this.collapsed) return;
  const x = 12;
  const y = 44;
  const maxWidth = Math.max(40, this.size[0] - 24);
  const maxLines = Math.max(1, Math.floor((this.size[1] - y - 12) / 17));
  const lines = wrapCanvasText(ctx, value, maxWidth, maxLines);

  const theme = getWorkflowTheme();
  ctx.save();
  ctx.globalAlpha = 1;
  ctx.fillStyle = theme.nodeBackground;
  ctx.fillRect(x - 4, y - 3, maxWidth + 8, Math.min(lines.length, maxLines) * 17 + 8);
  ctx.font = `12px ${LiteGraph.NODE_FONT || "HarmonyOS Sans SC"}`;
  ctx.textBaseline = "top";
  ctx.fillStyle = theme.nodeText;
  for (const [index, line] of lines.entries()) {
    ctx.fillText(line, x, y + index * 17, maxWidth);
  }
  ctx.restore();
}

function drawWorkflowBackground(ctx: CanvasRenderingContext2D, visibleArea?: [number, number, number, number]) {
  const theme = getWorkflowTheme();
  const [left, top, width, height] = normaliseVisibleArea(visibleArea, ctx.canvas);
  const right = left + width;
  const bottom = top + height;

  ctx.save();
  drawGridLines(ctx, left, top, right, bottom, WORKFLOW_GRID_SIZE, theme.nodeBorder, 0.24, 1);
  drawGridDots(ctx, left, top, right, bottom, WORKFLOW_DOT_GRID_SIZE, theme.widgetMuted, 0.22, 1.35);
  ctx.restore();
}

function normaliseVisibleArea(
  visibleArea: unknown,
  canvas: HTMLCanvasElement,
): [number, number, number, number] {
  if (Array.isArray(visibleArea) && visibleArea.length >= 4) {
    return [
      Number(visibleArea[0]) || 0,
      Number(visibleArea[1]) || 0,
      Math.max(1, Number(visibleArea[2]) || canvas.clientWidth || canvas.width || 1),
      Math.max(1, Number(visibleArea[3]) || canvas.clientHeight || canvas.height || 1),
    ];
  }

  const area = visibleArea as { 0?: unknown; 1?: unknown; 2?: unknown; 3?: unknown; x?: unknown; y?: unknown; width?: unknown; height?: unknown } | null;
  return [
    Number(area?.x ?? area?.[0]) || 0,
    Number(area?.y ?? area?.[1]) || 0,
    Math.max(1, Number(area?.width ?? area?.[2]) || canvas.clientWidth || canvas.width || 1),
    Math.max(1, Number(area?.height ?? area?.[3]) || canvas.clientHeight || canvas.height || 1),
  ];
}

function drawGridLines(
  ctx: CanvasRenderingContext2D,
  left: number,
  top: number,
  right: number,
  bottom: number,
  size: number,
  color: string,
  alpha: number,
  lineWidth: number,
) {
  const startX = Math.floor(left / size) * size;
  const startY = Math.floor(top / size) * size;

  ctx.beginPath();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  for (let x = startX; x <= right; x += size) {
    ctx.moveTo(x, top);
    ctx.lineTo(x, bottom);
  }
  for (let y = startY; y <= bottom; y += size) {
    ctx.moveTo(left, y);
    ctx.lineTo(right, y);
  }
  ctx.stroke();
}

function drawGridDots(
  ctx: CanvasRenderingContext2D,
  left: number,
  top: number,
  right: number,
  bottom: number,
  size: number,
  color: string,
  alpha: number,
  radius: number,
) {
  const startX = Math.floor(left / size) * size;
  const startY = Math.floor(top / size) * size;

  ctx.beginPath();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  for (let x = startX; x <= right; x += size) {
    for (let y = startY; y <= bottom; y += size) {
      ctx.moveTo(x + radius, y);
      ctx.arc(x, y, radius, 0, Math.PI * 2);
    }
  }
  ctx.fill();
}

function drawWorkflowNodeHover(graphCanvas: LGraphCanvas) {
  const node = graphCanvas.node_over;
  if (!(node instanceof LGraphNode)) return;
  const preview = getNodePreviewText(node);
  if (!preview) return;

  const ctx = graphCanvas.ctx;
  const theme = getWorkflowTheme();
  const lines = wrapCanvasText(ctx, preview, WORKFLOW_HOVER_MAX_WIDTH - 24, 4);
  if (lines.length === 0) return;

  const scale = graphCanvas.ds.scale || 1;
  const [graphX, graphY] = graphCanvas.graph_mouse ?? [node.pos[0] + node.size[0], node.pos[1]];
  const x = graphX * scale + graphCanvas.ds.offset[0] * scale + 14;
  const y = graphY * scale + graphCanvas.ds.offset[1] * scale + 14;
  const width = WORKFLOW_HOVER_MAX_WIDTH;
  const height = 20 + lines.length * WORKFLOW_HOVER_LINE_HEIGHT;
  const clampedX = Math.min(Math.max(12, x), Math.max(12, graphCanvas.canvas.clientWidth - width - 12));
  const clampedY = Math.min(Math.max(12, y), Math.max(12, graphCanvas.canvas.clientHeight - height - 12));

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 0.96;
  ctx.fillStyle = theme.nodeBackground;
  ctx.strokeStyle = theme.nodeBorder;
  ctx.lineWidth = 1;
  drawRoundedRect(ctx, clampedX, clampedY, width, height, 12);
  ctx.fill();
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.fillStyle = theme.nodeText;
  ctx.font = `12px ${LiteGraph.NODE_FONT || "HarmonyOS Sans SC"}`;
  ctx.textBaseline = "top";
  lines.forEach((line, index) => {
    ctx.fillText(line, clampedX + 12, clampedY + 10 + index * WORKFLOW_HOVER_LINE_HEIGHT, width - 24);
  });
  ctx.restore();
}

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  const safeRadius = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + safeRadius, y);
  ctx.lineTo(x + width - safeRadius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + safeRadius);
  ctx.lineTo(x + width, y + height - safeRadius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - safeRadius, y + height);
  ctx.lineTo(x + safeRadius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - safeRadius);
  ctx.lineTo(x, y + safeRadius);
  ctx.quadraticCurveTo(x, y, x + safeRadius, y);
  ctx.closePath();
}

function getNodePreviewText(node: LGraphNode): string {
  const properties = node.properties ?? {};
  return String(properties.text ?? properties.title ?? properties.prompt ?? node.title ?? "").trim();
}

function wrapCanvasText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number): string[] {
  const words = text.replace(/\s+/g, " ").split(" ").filter(Boolean);
  if (words.length === 0) return [];
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (ctx.measureText(next).width <= maxWidth || !current) {
      current = next;
    } else {
      lines.push(current);
      current = word;
    }
    if (lines.length >= maxLines) break;
  }

  if (current && lines.length < maxLines) lines.push(current);
  if (lines.length === maxLines && words.join(" ") !== lines.join(" ")) {
    lines[maxLines - 1] = `${lines[maxLines - 1].slice(0, Math.max(0, lines[maxLines - 1].length - 1))}…`;
  }
  return lines;
}

function fitInitialView(graph: LGraph, graphCanvas: LGraphCanvas, didFitRef: React.MutableRefObject<boolean>) {
  if (didFitRef.current) return;
  const width = graphCanvas.canvas.clientWidth || graphCanvas.canvas.width;
  const height = graphCanvas.canvas.clientHeight || graphCanvas.canvas.height;
  if (width <= 1 || height <= 1) {
    return;
  }

  const isMobileCanvas = width < MOBILE_CANVAS_BREAKPOINT;
  const minInitialScale = isMobileCanvas ? MOBILE_MIN_INITIAL_SCALE : DESKTOP_MIN_INITIAL_SCALE;
  const maxInitialScale = isMobileCanvas ? MOBILE_MAX_INITIAL_SCALE : DESKTOP_MAX_INITIAL_SCALE;
  const nodes = graph.nodes.filter((node): node is LGraphNode => node instanceof LGraphNode);
  if (nodes.length === 0) {
    graphCanvas.ds.scale = maxInitialScale;
    graphCanvas.ds.offset = INITIAL_EMPTY_OFFSET;
    didFitRef.current = true;
    graphCanvas.setDirty(true, true);
    return;
  }

  const bounds = getGraphBounds(nodes);
  const horizontalPadding = isMobileCanvas ? 48 : 128;
  const verticalPadding = isMobileCanvas ? 92 : 144;
  const availableWidth = Math.max(1, width - horizontalPadding);
  const availableHeight = Math.max(1, height - verticalPadding);
  const fitScale = Math.min(availableWidth / bounds.width, availableHeight / bounds.height, maxInitialScale);
  const scale = Math.min(maxInitialScale, Math.max(minInitialScale, fitScale));
  const targetX = horizontalPadding / 2 + Math.max(0, (availableWidth - bounds.width * scale) / 2);
  const targetY = (isMobileCanvas ? 72 : 92) + Math.max(0, (availableHeight - bounds.height * scale) / 2);

  graphCanvas.ds.scale = scale;
  graphCanvas.ds.offset = [targetX / scale - bounds.left, targetY / scale - bounds.top];
  didFitRef.current = true;
  graphCanvas.setDirty(true, true);
}

function getGraphBounds(nodes: LGraphNode[]) {
  let left = Number.POSITIVE_INFINITY;
  let top = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;

  for (const node of nodes) {
    const x = Number(node.pos?.[0]) || 0;
    const y = Number(node.pos?.[1]) || 0;
    const width = Math.max(Number(node.size?.[0]) || 220, 1);
    const height = Math.max(Number(node.size?.[1]) || 120, 1);
    left = Math.min(left, x);
    top = Math.min(top, y);
    right = Math.max(right, x + width);
    bottom = Math.max(bottom, y + height);
  }

  return {
    left,
    top,
    width: Math.max(1, right - left),
    height: Math.max(1, bottom - top),
  };
}

function installLiteGraphDialogManager() {
  const manageDialogs = () => {
    const dialogs = Array.from(document.querySelectorAll<HTMLElement>(".graphdialog, .litegraph .dialog"));
    for (const dialog of dialogs.slice(0, -1)) dialog.remove();
    const activeDialog = dialogs[dialogs.length - 1];
    if (!activeDialog) return;
    activeDialog.classList.add("litegraph-workflow__managed-dialog");
    if (activeDialog.querySelector(".litegraph-workflow__dialog-close")) return;
    const closeButton = document.createElement("button");
    closeButton.type = "button";
    closeButton.className = "litegraph-workflow__dialog-close";
    closeButton.setAttribute("aria-label", "关闭编辑弹窗");
    closeButton.textContent = "×";
    closeButton.addEventListener("click", () => activeDialog.remove());
    activeDialog.prepend(closeButton);
  };

  const observer = new MutationObserver(manageDialogs);
  observer.observe(document.body, { childList: true, subtree: true });
  manageDialogs();
  return () => {
    observer.disconnect();
    document.querySelectorAll<HTMLElement>(".litegraph-workflow__managed-dialog").forEach((dialog) => dialog.remove());
  };
}

function serializeWorkflow(
  graph: LGraph,
  id: string,
  noteId?: string,
  conversationId?: string,
): WorkflowDocument {
  return {
    id,
    noteId,
    conversationId,
    graph: graph.serialize() as unknown as SerialisableGraph,
  };
}

function toNodeProperties(properties: Record<string, unknown>): Record<string, NodeProperty | undefined> {
  return Object.fromEntries(
    Object.entries(properties).map(([key, value]) => [key, toNodeProperty(value)]),
  );
}

function toNodeProperty(value: unknown): NodeProperty | undefined {
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    (typeof value === "object" && value !== null)
  ) {
    return value;
  }
  return undefined;
}

function readSelectedNode(node: LGraphNode): SelectedNodeState {
  return {
    id: String(node.id),
    title: node.title,
    type: node.type,
    properties: { ...node.properties },
  };
}

function getCanvasPixelRatio() {
  if (typeof window === "undefined") return 1;
  return Math.min(MAX_CANVAS_DPR, Math.max(1, window.devicePixelRatio || 1));
}

function resizeCanvas(canvas: HTMLCanvasElement, graphCanvas: LGraphCanvas) {
  const parent = canvas.parentElement;
  if (!parent) return;
  const rect = parent.getBoundingClientRect();
  const cssWidth = Math.floor(rect.width || parent.clientWidth || 960);
  const cssHeight = Math.floor(rect.height || parent.clientHeight || 640);
  const pixelRatio = getCanvasPixelRatio();
  const physicalWidth = Math.max(1, Math.floor(cssWidth * pixelRatio));
  const physicalHeight = Math.max(1, Math.floor(cssHeight * pixelRatio));

  canvas.style.width = `${cssWidth}px`;
  canvas.style.height = `${cssHeight}px`;
  graphCanvas.resize(physicalWidth, physicalHeight);
  graphCanvas.setDirty(true, true);
}

function screenToGraph(graphCanvas: LGraphCanvas, clientX: number, clientY: number): [number, number] {
  const rect = graphCanvas.canvas.getBoundingClientRect();
  const ds = graphCanvas.ds;
  return [(clientX - rect.left) / ds.scale - ds.offset[0], (clientY - rect.top) / ds.scale - ds.offset[1]];
}

function readWorkflowDragPayload(event: React.DragEvent<HTMLDivElement>): DragNodePayload | null {
  const raw = event.dataTransfer.getData(NODE_DRAG_TYPE);
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<DragNodePayload>;
    return typeof value.type === "string" ? { type: value.type } : null;
  } catch {
    return null;
  }
}

function readDocumentDragPayload(event: React.DragEvent<HTMLDivElement>): Record<string, unknown> | null {
  const raw = event.dataTransfer.getData("text/plain");
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    return value.type === DOC_DRAG_TYPE ? value : null;
  } catch {
    return null;
  }
}
