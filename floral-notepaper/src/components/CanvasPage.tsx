import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { CanvasDocument, CanvasNode, CanvasNodeType } from "../features/canvas/types";
import { getCanvasDocument, saveCanvasDocument } from "../features/canvas/api";
import {
  generateArchiveSuggestions,
  type ArchiveSuggestion,
} from "../features/canvas/canvasArchive";
import { useCanvasAgent } from "../features/agent/useCanvasAgent";
import type { ImplicitConnection } from "../features/agent/connectionRecommendations";
import type { ProviderConfig } from "../features/settings/types";
import { onAgentExport, onAgentTask, recordAgentEvent } from "../features/agent/api";
import type { AgentEventType } from "../features/agent/types";
import { TaskProgressPanel } from "../features/agent/TaskProgressPanel";
import {
  buildCanvasSvg,
  downloadBlob,
  renderNoteToPngBlob,
  svgToPngBlob,
} from "../features/canvas/canvasExport";

interface CanvasPageProps {
  documentId: string;
  noteId?: string;
  providers: ProviderConfig[];
  /** Agent 总开关：关闭时不显示任何 AI 建议 */
  agentEnabled?: boolean;
  initialDocument?: CanvasDocument;
  onSave?: (doc: CanvasDocument) => void;
  /** 操作埋点上下文（可选）：缺省时画布操作不产生 agent 事件（可降级） */
  conversationId?: string;
  userId?: string;
}

const NODE_DEFAULTS: Record<CanvasNodeType, { width: number; height: number; label: string }> = {
  text: { width: 200, height: 80, label: "新节点" },
  card: { width: 240, height: 120, label: "新卡片" },
  resource: { width: 260, height: 110, label: "资料节点" },
  task: { width: 220, height: 96, label: "待办任务" },
};

function CanvasActionIcon({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

function PlusTextIcon() {
  return (
    <CanvasActionIcon>
      <path d="M8 3.5v9" />
      <path d="M3.5 8h9" />
      <path d="M11.5 3.2h1.3v1.3" opacity="0.45" />
    </CanvasActionIcon>
  );
}

function CardIcon() {
  return (
    <CanvasActionIcon>
      <rect x="2.4" y="3.2" width="11.2" height="9.6" rx="2" />
      <path d="M4.7 6.2h6.6" />
      <path d="M4.7 9h4.8" opacity="0.62" />
    </CanvasActionIcon>
  );
}

function ResourceIcon() {
  return (
    <CanvasActionIcon>
      <path d="M3.2 3.5h6.2l3.4 3.3v5.7H3.2z" />
      <path d="M9.2 3.7v3.4h3.3" opacity="0.62" />
      <path d="M5.1 9h5.8" />
    </CanvasActionIcon>
  );
}

function TaskIcon() {
  return (
    <CanvasActionIcon>
      <rect x="2.8" y="3" width="10.4" height="10" rx="2" />
      <path d="m5.2 8 1.5 1.5 3.9-4" />
      <path d="M5.2 11.2h5.4" opacity="0.62" />
    </CanvasActionIcon>
  );
}

function SaveIcon() {
  return (
    <CanvasActionIcon>
      <path d="M3 2.8h8.2L13 4.6v8.6H3z" />
      <path d="M5.1 2.9v3.4h5.4" opacity="0.65" />
      <path d="M5.5 10.5h5" />
    </CanvasActionIcon>
  );
}

function UndoIcon() {
  return (
    <CanvasActionIcon>
      <path d="M5.5 4.2 3.2 6.5l2.3 2.3" />
      <path d="M3.4 6.5h6.6a3 3 0 0 1 0 6H6.8" />
    </CanvasActionIcon>
  );
}

function RedoIcon() {
  return (
    <CanvasActionIcon>
      <path d="m10.5 4.2 2.3 2.3-2.3 2.3" />
      <path d="M12.6 6.5H6a3 3 0 0 0 0 6h2.2" />
    </CanvasActionIcon>
  );
}

function ZoomInIcon() {
  return (
    <CanvasActionIcon>
      <circle cx="6.8" cy="6.8" r="3.8" />
      <path d="M9.6 9.6 13 13" />
      <path d="M6.8 5.2v3.2" />
      <path d="M5.2 6.8h3.2" />
    </CanvasActionIcon>
  );
}

function ZoomOutIcon() {
  return (
    <CanvasActionIcon>
      <circle cx="6.8" cy="6.8" r="3.8" />
      <path d="M9.6 9.6 13 13" />
      <path d="M5.2 6.8h3.2" />
    </CanvasActionIcon>
  );
}

function SparkIcon() {
  return (
    <CanvasActionIcon>
      <path d="M8 1.9 9.2 5.6 13 6.8 9.2 8 8 11.8 6.8 8 3 6.8l3.8-1.2Z" />
      <path d="M12.4 10.8v2.4" opacity="0.55" />
      <path d="M11.2 12h2.4" opacity="0.55" />
    </CanvasActionIcon>
  );
}

function LinkIcon() {
  return (
    <CanvasActionIcon>
      <path d="M6.8 5.2 5.7 4.1a2.4 2.4 0 0 0-3.4 3.4l1.3 1.3a2.4 2.4 0 0 0 3.4 0" />
      <path d="M9.2 10.8 10.3 12a2.4 2.4 0 0 0 3.4-3.4l-1.3-1.3a2.4 2.4 0 0 0-3.4 0" />
      <path d="M6.5 9.5 9.5 6.5" />
    </CanvasActionIcon>
  );
}

function GapIcon() {
  return (
    <CanvasActionIcon>
      <path d="M3 5.2h4.2v5.6H3z" />
      <path d="M8.8 5.2H13" />
      <path d="M8.8 8H13" opacity="0.65" />
      <path d="M8.8 10.8h2.8" opacity="0.45" />
    </CanvasActionIcon>
  );
}

function DiscussionIcon() {
  return (
    <CanvasActionIcon>
      <path d="M4.4 11.2a4.5 4.5 0 1 1 2.1 1.1L3.4 13.5Z" />
      <path d="M7.1 7.8h.1" />
      <path d="M9.2 7.8h.1" />
      <path d="M11.3 7.8h.1" />
    </CanvasActionIcon>
  );
}

function DownloadIcon() {
  return (
    <CanvasActionIcon>
      <path d="M8 2.8v6.4" />
      <path d="m5.6 6.6 2.4 2.4 2.4-2.4" />
      <path d="M3.4 11.6v.6a1 1 0 0 0 1 1h7.2a1 1 0 0 0 1-1v-.6" />
    </CanvasActionIcon>
  );
}

function CloseIcon() {
  return (
    <CanvasActionIcon>
      <path d="m4.5 4.5 7 7" />
      <path d="m11.5 4.5-7 7" />
    </CanvasActionIcon>
  );
}

function generateId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function CanvasPage({
  documentId,
  noteId,
  providers,
  agentEnabled = false,
  initialDocument,
  onSave,
  conversationId,
  userId,
}: CanvasPageProps) {
  const { t } = useTranslation();
  const svgRef = useRef<SVGSVGElement>(null);
  const [doc, setDoc] = useState<CanvasDocument>(() => ({
    id: documentId,
    noteId,
    nodes: initialDocument?.nodes ?? [],
    edges: initialDocument?.edges ?? [],
  }));
  const [loading, setLoading] = useState(true);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
  const [dragState, setDragState] = useState<{
    nodeId: string;
    startX: number;
    startY: number;
    offsetX: number;
    offsetY: number;
  } | null>(null);
  const [archiveSuggestions, setArchiveSuggestions] = useState<ArchiveSuggestion[]>([]);
  const [archiveLoading, setArchiveLoading] = useState(false);
  const [archiveDismissed, setArchiveDismissed] = useState(false);
  const [linkSourceNodeId, setLinkSourceNodeId] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");

  // ── P1-2/P1-3 前端入口：节点扩写任务 + PNG 导出 ───────────────────────────
  const [exportingPng, setExportingPng] = useState(false);
  const [enhanceGoal, setEnhanceGoal] = useState<string | null>(null);
  const [enhanceVersion, setEnhanceVersion] = useState(0);

  // ── P0 画布导航：缩放/平移（世界坐标 = (屏幕坐标 - pan) / scale） ──────────
  const MIN_SCALE = 0.25;
  const MAX_SCALE = 3;
  const [viewState, setViewState] = useState({ scale: 1, panX: 0, panY: 0 });
  const [panState, setPanState] = useState<{
    startClientX: number;
    startClientY: number;
    startPanX: number;
    startPanY: number;
  } | null>(null);

  const toScreen = useCallback(
    (x: number, y: number) => ({
      x: x * viewState.scale + viewState.panX,
      y: y * viewState.scale + viewState.panY,
    }),
    [viewState],
  );
  const toWorld = useCallback(
    (clientX: number, clientY: number) => {
      const rect = svgRef.current?.getBoundingClientRect();
      if (!rect) return { x: 0, y: 0 };
      return {
        x: (clientX - rect.left - viewState.panX) / viewState.scale,
        y: (clientY - rect.top - viewState.panY) / viewState.scale,
      };
    },
    [viewState],
  );

  // ── P0 撤销/重做（≥50 步快照栈；ref 持有数据，state 只渲染可用态） ────────
  const MAX_HISTORY = 50;
  const undoStackRef = useRef<CanvasDocument[]>([]);
  const redoStackRef = useRef<CanvasDocument[]>([]);
  const [historyState, setHistoryState] = useState({ canUndo: false, canRedo: false });
  /** 拖拽开始时画布快照：拖拽过程不入栈，松手后整段拖拽合并为一步 */
  const dragStartSnapshotRef = useRef<CanvasDocument | null>(null);

  // ── P0 自动保存：脏标记，仅用户改动后才 debounce 保存 ─────────────────────
  const dirtyRef = useRef(false);
  const docRef = useRef(doc);
  docRef.current = doc;

  // Agent 智能覆盖层（场景一：隐含连接 / 场景二：语义空白区 / 场景三：共识分歧）
  const agent = useCanvasAgent(providers, agentEnabled);
  const nodeById = useCallback(
    (id: string) => doc.nodes.find((n) => n.id === id) ?? null,
    [doc.nodes],
  );
  const providersRef = useRef(providers);
  providersRef.current = providers;

  // 统一文档提交入口：入撤销栈、清重做栈、打脏标记（自动保存依据）
  const commitDoc = useCallback((updater: (prev: CanvasDocument) => CanvasDocument) => {
    const prev = docRef.current;
    const next = updater(prev);
    if (next === prev) return;
    undoStackRef.current = [...undoStackRef.current.slice(-(MAX_HISTORY - 1)), prev];
    redoStackRef.current = [];
    docRef.current = next;
    dirtyRef.current = true;
    setDoc(next);
    setHistoryState({ canUndo: true, canRedo: false });
    setSaveStatus("idle");
  }, []);

  const undo = useCallback(() => {
    const prev = undoStackRef.current[undoStackRef.current.length - 1];
    if (!prev) return;
    undoStackRef.current = undoStackRef.current.slice(0, -1);
    redoStackRef.current = [...redoStackRef.current, docRef.current];
    docRef.current = prev;
    dirtyRef.current = true;
    setDoc(prev);
    setSaveStatus("idle");
    setHistoryState({ canUndo: undoStackRef.current.length > 0, canRedo: true });
  }, []);

  const redo = useCallback(() => {
    const next = redoStackRef.current[redoStackRef.current.length - 1];
    if (!next) return;
    redoStackRef.current = redoStackRef.current.slice(0, -1);
    undoStackRef.current = [...undoStackRef.current, docRef.current];
    docRef.current = next;
    dirtyRef.current = true;
    setDoc(next);
    setSaveStatus("idle");
    setHistoryState({ canUndo: true, canRedo: redoStackRef.current.length > 0 });
  }, []);

  // 缩放：以锚点（屏幕坐标，默认画布左上角）为不动点
  const zoomBy = useCallback((factor: number, anchor?: { x: number; y: number }) => {
    setViewState((vs) => {
      const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, vs.scale * factor));
      const ratio = scale / vs.scale;
      const a = anchor ?? { x: 0, y: 0 };
      return {
        scale,
        panX: a.x - (a.x - vs.panX) * ratio,
        panY: a.y - (a.y - vs.panY) * ratio,
      };
    });
  }, []);
  const zoomReset = useCallback(() => {
    setViewState({ scale: 1, panX: 0, panY: 0 });
  }, []);

  // ── P1-2：AI 扩写入口（goal 编码节点 id + 原文，Rust enhance 链路写回） ────
  const handleEnhance = useCallback(() => {
    if (!selectedNodeId) return;
    const node = docRef.current.nodes.find((n) => n.id === selectedNodeId);
    if (!node) return;
    setEnhanceGoal(`扩写节点 ${node.id} 的内容：${node.text}`);
    setEnhanceVersion((v) => v + 1);
  }, [selectedNodeId]);

  // ── P1-3：画布导出 PNG（自包含 SVG → 2x 光栅化 → 下载） ───────────────────
  const handleExportPng = useCallback(async () => {
    if (exportingPng) return;
    setExportingPng(true);
    try {
      const svg = buildCanvasSvg(docRef.current);
      const blob = await svgToPngBlob(svg);
      downloadBlob(blob, `canvas-${documentId}.png`);
    } catch (error) {
      console.error("Canvas PNG export failed", error);
    } finally {
      setExportingPng(false);
    }
  }, [documentId, exportingPng]);

  // 扩写任务写回完成（agent.task → Done）后重载画布，同步磁盘上的新内容
  useEffect(() => {
    if (!enhanceGoal) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    onAgentTask((task) => {
      if (disposed || task.goal !== enhanceGoal || task.status !== "Done") return;
      getCanvasDocument(documentId)
        .then((loaded) => {
          if (disposed) return;
          undoStackRef.current = [];
          redoStackRef.current = [];
          dragStartSnapshotRef.current = null;
          dirtyRef.current = false;
          docRef.current = loaded;
          setDoc(loaded);
          setHistoryState({ canUndo: false, canRedo: false });
        })
        .catch(() => {});
    }).then((fn) => {
      unlisten = fn;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [enhanceGoal, documentId]);

  // note.export 的 png/pdf 分支由前端接管渲染（agent.export 事件 → PNG 下载）
  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    onAgentExport((event) => {
      if (disposed || event.kind !== "note") return;
      if (event.format !== "png" && event.format !== "pdf") return;
      renderNoteToPngBlob(event.title ?? "", event.content ?? "")
        .then((blob) => downloadBlob(blob, `${event.title ?? "note"}.png`))
        .catch((error) => console.error("Note PNG export failed", error));
    }).then((fn) => {
      unlisten = fn;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  // ── P0 操作埋点（可降级：缺 conversationId/userId 时静默跳过） ─────────────
  const trackCanvasEvent = useCallback(
    (eventType: AgentEventType, payload: Record<string, unknown>) => {
      if (!conversationId || !userId) return;
      recordAgentEvent({ conversationId, userId, eventType, payload }).catch((error) => {
        console.warn("Canvas event tracking failed", error);
      });
    },
    [conversationId, userId],
  );

  // 接受一条隐含连接建议：写入一条 dashed 连线（可追溯到来源两节点），并从建议列表移除
  const acceptConnection = useCallback(
    (c: ImplicitConnection) => {
      commitDoc((prev) => {
        const exists = prev.edges.some(
          (e) =>
            (e.fromNodeId === c.sourceId && e.toNodeId === c.targetId) ||
            (e.fromNodeId === c.targetId && e.toNodeId === c.sourceId),
        );
        if (exists) return prev;
        return {
          ...prev,
          edges: [
            ...prev.edges,
            { id: generateId(), fromNodeId: c.sourceId, toNodeId: c.targetId, style: "dashed" },
          ],
        };
      });
      agent.dismissConnection(c.sourceId, c.targetId);
      trackCanvasEvent("canvas_binding_added", {
        fromNodeId: c.sourceId,
        toNodeId: c.targetId,
        style: "dashed",
        source: "agent",
      });
    },
    [agent, commitDoc, trackCanvasEvent],
  );

  // 语义空白区：为某个缺失视角生成半透明占位节点（source=agent）
  const createPerspectiveNode = useCallback(
    (perspective: string, area: { x: number; y: number }, index: number) => {
      const newNode: CanvasNode = {
        id: generateId(),
        type: "text",
        x: area.x,
        y: area.y + index * 96,
        width: NODE_DEFAULTS.text.width,
        height: NODE_DEFAULTS.text.height,
        text: perspective,
        source: "agent",
      };
      commitDoc((prev) => ({ ...prev, nodes: [...prev.nodes, newNode] }));
      trackCanvasEvent("canvas_shape_added", {
        nodeId: newNode.id,
        type: newNode.type,
        source: "agent",
      });
    },
    [commitDoc, trackCanvasEvent],
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getCanvasDocument(documentId)
      .then((loaded) => {
        if (cancelled) return;
        undoStackRef.current = [];
        redoStackRef.current = [];
        dragStartSnapshotRef.current = null;
        dirtyRef.current = false;
        docRef.current = loaded;
        setDoc(loaded);
        setHistoryState({ canUndo: false, canRedo: false });
        setSaveStatus("idle");
      })
      .catch(() => {
        if (cancelled) return;
        const fallback: CanvasDocument = {
          id: documentId,
          noteId,
          nodes: initialDocument?.nodes ?? [],
          edges: initialDocument?.edges ?? [],
        };
        undoStackRef.current = [];
        redoStackRef.current = [];
        dragStartSnapshotRef.current = null;
        dirtyRef.current = false;
        docRef.current = fallback;
        setDoc(fallback);
        setHistoryState({ canUndo: false, canRedo: false });
        setSaveStatus("idle");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [documentId, noteId, initialDocument]);

  const addNode = useCallback(
    (type: CanvasNodeType, text = "") => {
      const defaults = NODE_DEFAULTS[type];
      const newNode: CanvasNode = {
        id: generateId(),
        type,
        x: 100 + Math.random() * 40,
        y: 100 + Math.random() * 40,
        width: defaults.width,
        height: defaults.height,
        text: text || defaults.label,
      };
      commitDoc((prev) => ({
        ...prev,
        nodes: [...prev.nodes, newNode],
      }));
      setEditingNodeId(newNode.id);
      trackCanvasEvent("canvas_shape_added", { nodeId: newNode.id, type });
    },
    [commitDoc, trackCanvasEvent],
  );

  const updateNodeText = useCallback(
    (nodeId: string, text: string) => {
      commitDoc((prev) => ({
        ...prev,
        nodes: prev.nodes.map((n) => (n.id === nodeId ? { ...n, text } : n)),
      }));
    },
    [commitDoc],
  );

  // 拖拽期间的节点位置更新：直接更新不入撤销栈（松手时整体合并为一步）
  const updateNodePosition = useCallback((nodeId: string, x: number, y: number) => {
    const next = {
      ...docRef.current,
      nodes: docRef.current.nodes.map((n) => (n.id === nodeId ? { ...n, x, y } : n)),
    };
    docRef.current = next;
    dirtyRef.current = true;
    setDoc(next);
    setSaveStatus("idle");
  }, []);

  const createEdge = useCallback(
    (fromNodeId: string, toNodeId: string, style: "solid" | "dashed" = "solid") => {
      if (fromNodeId === toNodeId) return;
      commitDoc((prev) => {
        const exists = prev.edges.some(
          (e) =>
            (e.fromNodeId === fromNodeId && e.toNodeId === toNodeId) ||
            (e.fromNodeId === toNodeId && e.toNodeId === fromNodeId),
        );
        if (exists) return prev;
        return {
          ...prev,
          edges: [...prev.edges, { id: generateId(), fromNodeId, toNodeId, style }],
        };
      });
      trackCanvasEvent("canvas_binding_added", { fromNodeId, toNodeId, style });
    },
    [commitDoc, trackCanvasEvent],
  );

  const handleNodeClick = useCallback(
    (nodeId: string) => {
      if (!linkSourceNodeId) return;
      createEdge(linkSourceNodeId, nodeId);
      setLinkSourceNodeId(null);
    },
    [createEdge, linkSourceNodeId],
  );

  const deleteNode = useCallback(
    (nodeId: string) => {
      commitDoc((prev) => ({
        ...prev,
        nodes: prev.nodes.filter((n) => n.id !== nodeId),
        edges: prev.edges.filter((e) => e.fromNodeId !== nodeId && e.toNodeId !== nodeId),
      }));
      setSelectedNodeId(null);
      setEditingNodeId(null);
      setLinkSourceNodeId((current) => (current === nodeId ? null : current));
      trackCanvasEvent("canvas_shape_removed", { nodeId });
    },
    [commitDoc, trackCanvasEvent],
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent, nodeId: string) => {
      e.stopPropagation();
      if (editingNodeId === nodeId) return;
      // 阻止浏览器默认行为：拖拽节点时禁止触发文本选区（消除选中蓝）
      e.preventDefault();
      setSelectedNodeId(nodeId);
      const node = docRef.current.nodes.find((n) => n.id === nodeId);
      if (!node) return;
      const world = toWorld(e.clientX, e.clientY);
      // 拖拽起点快照：整段拖拽在松手时合并为一步撤销
      dragStartSnapshotRef.current = docRef.current;
      // 拖拽期全局禁止选中（覆盖 foreignObject 内的 HTML 文本节点）
      document.body.style.userSelect = "none";
      setDragState({
        nodeId,
        startX: node.x,
        startY: node.y,
        offsetX: world.x - node.x,
        offsetY: world.y - node.y,
      });
    },
    [editingNodeId, toWorld],
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (dragState) {
        const world = toWorld(e.clientX, e.clientY);
        updateNodePosition(dragState.nodeId, world.x - dragState.offsetX, world.y - dragState.offsetY);
      } else if (panState) {
        // 空白处拖拽 → 平移画布
        setViewState((vs) => ({
          ...vs,
          panX: panState.startPanX + (e.clientX - panState.startClientX),
          panY: panState.startPanY + (e.clientY - panState.startClientY),
        }));
      }
    },
    [dragState, panState, toWorld, updateNodePosition],
  );

  const handleMouseUp = useCallback(() => {
    // 拖拽结束：把起点快照压入撤销栈（若确有移动）
    if (dragState && dragStartSnapshotRef.current) {
      const start = dragStartSnapshotRef.current;
      dragStartSnapshotRef.current = null;
      if (start !== docRef.current) {
        undoStackRef.current = [...undoStackRef.current.slice(-(MAX_HISTORY - 1)), start];
        redoStackRef.current = [];
        setHistoryState({ canUndo: true, canRedo: false });
      }
    }
    document.body.style.userSelect = "";
    setDragState(null);
    setPanState(null);
  }, [dragState]);

  // 空白背景按下：开始平移
  const handleBackgroundMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return;
      e.preventDefault();
      setSelectedNodeId(null);
      setEditingNodeId(null);
      setLinkSourceNodeId(null);
      document.body.style.userSelect = "none";
      setPanState({
        startClientX: e.clientX,
        startClientY: e.clientY,
        startPanX: viewState.panX,
        startPanY: viewState.panY,
      });
    },
    [viewState.panX, viewState.panY],
  );

  // 滚轮：Ctrl/Cmd+滚轮以鼠标为锚点缩放；普通滚轮平移画布（对齐主流白板习惯）
  // 注意依赖 loading：组件首帧渲染 loading 态（无 SVG），SVG 挂载后才 attach 监听
  useEffect(() => {
    const svg = svgRef.current;
    if (loading || !svg) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = svg.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) {
        const anchor = { x: e.clientX - rect.left, y: e.clientY - rect.top };
        zoomBy(e.deltaY < 0 ? 1.15 : 1 / 1.15, anchor);
      } else {
        setViewState((vs) => ({
          ...vs,
          panX: vs.panX - e.deltaX,
          panY: vs.panY - e.deltaY,
        }));
      }
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, [zoomBy, loading]);

  // 快捷键：Ctrl/Cmd+Z 撤销、+Shift 或 Ctrl/Cmd+Y 重做；Ctrl+=/-/0 缩放
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault();
        redo();
      } else if (mod && (e.key === "=" || e.key === "+")) {
        e.preventDefault();
        zoomBy(1.15);
      } else if (mod && e.key === "-") {
        e.preventDefault();
        zoomBy(1 / 1.15);
      } else if (mod && e.key === "0") {
        e.preventDefault();
        zoomReset();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [undo, redo, zoomBy, zoomReset]);

  const handleSave = useCallback(async () => {
    setSaveStatus("saving");
    try {
      const saved = await saveCanvasDocument(docRef.current);
      onSave?.(saved);
      dirtyRef.current = false;
      setSaveStatus("saved");
      window.setTimeout(() => setSaveStatus("idle"), 1800);
      trackCanvasEvent("canvas_shape_updated", { action: "save" });
    } catch {
      setSaveStatus("error");
    }
  }, [onSave, trackCanvasEvent]);

  // P0 自动保存：用户改动后 debounce 800ms 触发一次保存
  useEffect(() => {
    if (loading || !dirtyRef.current) return;
    const timer = window.setTimeout(() => {
      void handleSave();
    }, 800);
    return () => window.clearTimeout(timer);
  }, [doc, loading, handleSave]);

  const handleArchiveSuggestions = useCallback(async () => {
    if (doc.nodes.length < 2 || providersRef.current.length === 0) return;
    setArchiveLoading(true);
    try {
      const suggestions = await generateArchiveSuggestions(doc.nodes, providersRef.current);
      setArchiveSuggestions(suggestions);
      setArchiveDismissed(false);
    } catch {
      setArchiveSuggestions([]);
    } finally {
      setArchiveLoading(false);
    }
  }, [doc.nodes]);

  const applyArchiveTag = useCallback(
    (nodeId: string, tag: string) => {
      commitDoc((prev) => ({
        ...prev,
        nodes: prev.nodes.map((n) => (n.id === nodeId ? { ...n, text: `${tag}: ${n.text}` } : n)),
      }));
      trackCanvasEvent("canvas_shape_updated", { nodeId, action: "archive_tag", tag });
    },
    [commitDoc, trackCanvasEvent],
  );

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center bg-paper">
        <div className="text-[13px] text-ink-ghost">
          {t("canvas.loading", { defaultValue: "加载画布…" })}
        </div>
      </div>
    );
  }

  return (
    <div className="canvas-home-surface flex-1 flex flex-col min-h-0 relative overflow-hidden select-none">
      {/* 工具栏 */}
      <div className="canvas-toolbar-pro absolute top-4 left-4 z-10 flex items-center gap-2">
        <button
          type="button"
          onClick={() => addNode("text")}
          className="canvas-control-button canvas-button-secondary"
        >
          <PlusTextIcon />
          {t("canvas.addText", { defaultValue: "文本" })}
        </button>
        <button
          type="button"
          onClick={() => addNode("card")}
          className="canvas-control-button canvas-button-secondary"
        >
          <CardIcon />
          {t("canvas.addCard", { defaultValue: "卡片" })}
        </button>
        <button
          type="button"
          onClick={() => addNode("resource")}
          className="canvas-control-button canvas-button-secondary"
        >
          <ResourceIcon />
          {t("canvas.addResource", { defaultValue: "资料" })}
        </button>
        <button
          type="button"
          onClick={() => addNode("task")}
          className="canvas-control-button canvas-button-secondary"
        >
          <TaskIcon />
          {t("canvas.addTask", { defaultValue: "任务" })}
        </button>
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={saveStatus === "saving"}
          className="canvas-control-button canvas-button-primary"
        >
          <SaveIcon />
          {saveStatus === "saving"
            ? t("common.saving", { defaultValue: "保存中…" })
            : t("common.save", { defaultValue: "保存" })}
        </button>
        <div className="canvas-toolbar-divider" />
        <button
          type="button"
          onClick={undo}
          disabled={!historyState.canUndo}
          className="canvas-control-button canvas-button-secondary"
          title={t("canvas.undo", { defaultValue: "撤销 (Ctrl+Z)" })}
        >
          <UndoIcon />
        </button>
        <button
          type="button"
          onClick={redo}
          disabled={!historyState.canRedo}
          className="canvas-control-button canvas-button-secondary"
          title={t("canvas.redo", { defaultValue: "重做 (Ctrl+Shift+Z)" })}
        >
          <RedoIcon />
        </button>
        <div className="canvas-toolbar-divider" />
        <button
          type="button"
          onClick={() => zoomBy(1 / 1.15)}
          className="canvas-control-button canvas-button-secondary"
          title={t("canvas.zoomOut", { defaultValue: "缩小 (Ctrl+-)" })}
        >
          <ZoomOutIcon />
        </button>
        <button
          type="button"
          onClick={() => void handleExportPng()}
          disabled={exportingPng || doc.nodes.length === 0}
          className="canvas-control-button canvas-button-secondary"
          title={t("canvas.exportPng", { defaultValue: "导出画布为 PNG 图片" })}
        >
          <DownloadIcon />
          {exportingPng
            ? t("canvas.exporting", { defaultValue: "导出中…" })
            : t("canvas.exportPng", { defaultValue: "导出 PNG" })}
        </button>
        <button
          type="button"
          onClick={zoomReset}
          className="canvas-zoom-indicator"
          title={t("canvas.zoomReset", { defaultValue: "复位到 100% (Ctrl+0)" })}
        >
          {Math.round(viewState.scale * 100)}%
        </button>
        <button
          type="button"
          onClick={() => zoomBy(1.15)}
          className="canvas-control-button canvas-button-secondary"
          title={t("canvas.zoomIn", { defaultValue: "放大 (Ctrl+=)" })}
        >
          <ZoomInIcon />
        </button>
        <button
          type="button"
          onClick={() => void handleArchiveSuggestions()}
          disabled={archiveLoading || doc.nodes.length < 2}
          className="canvas-control-button canvas-button-secondary"
        >
          <SparkIcon />
          {archiveLoading
            ? t("canvas.archiving", { defaultValue: "分析中…" })
            : t("canvas.archive", { defaultValue: "智能归档" })}
        </button>
        {agentEnabled && providers.length > 0 && (
          <>
            <div className="canvas-toolbar-divider" />
            <button
              type="button"
              onClick={() => void agent.runConnections(doc.nodes, doc.edges)}
              disabled={agent.loading.connection || doc.nodes.length < 2}
              className="canvas-control-button canvas-button-ai"
            >
              <LinkIcon />
              {agent.loading.connection
                ? t("canvas.agentThinking", { defaultValue: "分析中…" })
                : t("canvas.findConnections", { defaultValue: "发现连接" })}
            </button>
            <button
              type="button"
              onClick={() => void agent.runGap(doc.nodes)}
              disabled={agent.loading.gap || doc.nodes.length < 5}
              className="canvas-control-button canvas-button-ai"
              title={
                doc.nodes.length < 5
                  ? t("canvas.gapNeedsNodes", { defaultValue: "至少 5 个节点才能分析视角" })
                  : undefined
              }
            >
              <GapIcon />
              {agent.loading.gap
                ? t("canvas.agentThinking", { defaultValue: "分析中…" })
                : t("canvas.findGaps", { defaultValue: "补充视角" })}
            </button>
            <button
              type="button"
              onClick={() =>
                void agent.runDiscussion(
                  t("canvas.discussionTopic", { defaultValue: "画布讨论" }),
                  doc.nodes,
                )
              }
              disabled={agent.loading.discussion || doc.nodes.length < 3}
              className="canvas-control-button canvas-button-ai"
            >
              <DiscussionIcon />
              {agent.loading.discussion
                ? t("canvas.agentThinking", { defaultValue: "分析中…" })
                : t("canvas.analyzeDiscussion", { defaultValue: "分析共识" })}
            </button>
          </>
        )}
      </div>

      {selectedNodeId && (
        <div className="absolute top-4 right-4 z-10 flex items-center gap-2">
          {agentEnabled && providers.length > 0 && (
            <button
              type="button"
              onClick={handleEnhance}
              className="canvas-control-button canvas-button-ai"
              title={t("canvas.enhanceNodeTip", { defaultValue: "让 AI 扩写该节点内容并写回画布" })}
            >
              <SparkIcon />
              {t("canvas.enhanceNode", { defaultValue: "AI 扩写" })}
            </button>
          )}
          <button
            type="button"
            onClick={() => setLinkSourceNodeId(selectedNodeId)}
            className="canvas-control-button canvas-button-secondary"
          >
            <LinkIcon />
            {linkSourceNodeId === selectedNodeId
              ? t("canvas.pickTarget", { defaultValue: "选择目标" })
              : t("canvas.connectFrom", { defaultValue: "连线" })}
          </button>
          <button
            type="button"
            onClick={() => deleteNode(selectedNodeId)}
            className="canvas-control-button canvas-button-danger"
          >
            {t("common.delete", { defaultValue: "删除" })}
          </button>
        </div>
      )}

      {enhanceGoal && (
        <div className="absolute bottom-4 left-4 z-30 w-[320px]">
          <div className="flex items-center justify-between mb-1.5">
            <span className="canvas-panel-title">
              {t("canvas.enhancePanel", { defaultValue: "节点扩写" })}
            </span>
            <button
              type="button"
              onClick={() => setEnhanceGoal(null)}
              className="canvas-icon-button canvas-button-ghost"
              aria-label={t("common.close", { defaultValue: "关闭" })}
            >
              <CloseIcon />
            </button>
          </div>
          <TaskProgressPanel key={enhanceVersion} goal={enhanceGoal} />
        </div>
      )}

      {saveStatus !== "idle" && saveStatus !== "saving" && (
        <div className="absolute bottom-4 right-4 z-20 px-3 py-1.5 rounded-full bg-paper/90 border border-paper-deep/30 text-[10px] text-ink-faint shadow-sm">
          {saveStatus === "saved"
            ? t("canvas.saveDone", { defaultValue: "画布已保存" })
            : t("canvas.saveFailed", { defaultValue: "保存失败，请稍后重试" })}
        </div>
      )}

      {!archiveDismissed && archiveSuggestions.length > 0 && (
        <div className="canvas-floating-panel absolute top-16 left-4 z-10 w-[220px] p-3">
          <div className="flex items-center justify-between mb-2">
            <span className="canvas-panel-title">
              {t("canvas.archiveSuggestions", { defaultValue: "归档建议" })}
            </span>
            <button
              type="button"
              onClick={() => setArchiveDismissed(true)}
              className="canvas-icon-button canvas-button-ghost"
            >
              <CloseIcon />
            </button>
          </div>
          <div className="space-y-2">
            {archiveSuggestions.map((suggestion, i) => (
              <div key={i} className="canvas-suggestion-card p-2">
                <div className="canvas-panel-text font-medium">{suggestion.tag}</div>
                <div className="canvas-panel-muted line-clamp-2 mt-0.5">
                  {suggestion.reason}
                </div>
                <div className="flex flex-wrap gap-1 mt-1.5">
                  {suggestion.nodeIds.map((nodeId) => (
                    <button
                      key={nodeId}
                      type="button"
                      onClick={() => applyArchiveTag(nodeId, suggestion.tag)}
                      className="canvas-chip-button canvas-button-ai"
                    >
                      {t("canvas.applyTag", { defaultValue: "应用" })}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 场景一：隐含连接建议气泡（定位在两节点连线中点，可接受/忽略）*/}
      {agent.connections.map((c) => {
        const from = nodeById(c.sourceId);
        const to = nodeById(c.targetId);
        if (!from || !to) return null;
        const mid = toScreen(
          (from.x + from.width / 2 + to.x + to.width / 2) / 2,
          (from.y + from.height / 2 + to.y + to.height / 2) / 2,
        );
        return (
          <div
            key={`bubble-${c.sourceId}-${c.targetId}`}
            className="absolute z-20 w-[210px] -translate-x-1/2 -translate-y-1/2 rounded-xl bg-paper/95 backdrop-blur-sm border border-bamboo/30 shadow-lg p-2.5 animate-fade-in"
            style={{ left: mid.x, top: mid.y }}
          >
            <div className="text-[11px] text-ink-soft leading-relaxed">{c.message}</div>
            <div className="mt-1 text-[9px] text-ink-ghost/70">
              {t("canvas.similarity", { defaultValue: "相似度" })} {(c.similarity * 100).toFixed(0)}%
            </div>
            <div className="flex items-center gap-1.5 mt-1.5">
              <button
                type="button"
                onClick={() => acceptConnection(c)}
                className="canvas-control-button canvas-button-primary flex-1"
              >
                {t("canvas.connect", { defaultValue: "轻轻连起来" })}
              </button>
              <button
                type="button"
                onClick={() => agent.dismissConnection(c.sourceId, c.targetId)}
                className="canvas-control-button canvas-button-ghost"
              >
                {t("common.ignore", { defaultValue: "忽略" })}
              </button>
            </div>
          </div>
        );
      })}

      {/* 场景二：语义空白区提示（浮框 + 待补充视角，可生成占位节点）*/}
      {agent.gap && (() => {
        const gapScreen = toScreen(agent.gap.areaHint.x, agent.gap.areaHint.y);
        return (
          <div
            className="absolute z-20 w-[240px] rounded-xl bg-paper/95 backdrop-blur-sm border border-bamboo/30 shadow-lg p-3 animate-fade-in"
            style={{
              left: Math.max(16, Math.min(gapScreen.x, 640)),
              top: Math.max(72, Math.min(gapScreen.y, 420)),
            }}
          >
          <div className="flex items-start justify-between gap-2 mb-1.5">
            <span className="canvas-panel-text">{agent.gap.message}</span>
            <button
              type="button"
              onClick={agent.dismissGap}
              className="canvas-icon-button canvas-button-ghost shrink-0"
              aria-label={t("common.ignore", { defaultValue: "忽略" })}
            >
              <CloseIcon />
            </button>
          </div>
          <div className="space-y-1">
            {agent.gap.missingPerspectives.map((p, i) => (
              <button
                key={p}
                type="button"
                onClick={() => agent.gap && createPerspectiveNode(p, agent.gap.areaHint, i)}
                className="canvas-control-button canvas-button-ai w-full justify-start"
              >
                {p}
              </button>
            ))}
          </div>
          </div>
        );
      })()}

      {/* 场景三：共识/分歧面板（分组标识 + 桥梁方案）*/}
      {agent.discussion && (
        <div className="canvas-floating-panel absolute top-16 right-4 z-20 w-[240px] p-3 animate-fade-in">
          <div className="flex items-center justify-between mb-2">
            <span className="canvas-panel-title">
              {t("canvas.discussionPanel", { defaultValue: "讨论结构" })}
              {agent.discussion.status === "consensus"
                ? " · " + t("canvas.consensus", { defaultValue: "趋于共识" })
                : agent.discussion.status === "diverging"
                  ? " · " + t("canvas.diverging", { defaultValue: "分歧加大" })
                  : " · " + t("canvas.mixed", { defaultValue: "存在折中" })}
            </span>
            <button
              type="button"
              onClick={agent.dismissDiscussion}
              className="text-ink-ghost/60 hover:text-ink-ghost text-[10px] cursor-pointer"
              aria-label={t("common.ignore", { defaultValue: "忽略" })}
            >
              ✕
            </button>
          </div>
          <div className="space-y-1.5">
            {agent.discussion.groups.map((g, i) => (
              <div key={i} className="flex items-center gap-2">
                <span
                  className="w-2.5 h-2.5 rounded-full shrink-0"
                  style={{ backgroundColor: g.color }}
                />
                <span className="canvas-panel-text">{g.label}</span>
                <span className="canvas-panel-muted ml-auto">
                  {g.userIds.length} {t("canvas.people", { defaultValue: "人" })}
                </span>
              </div>
            ))}
          </div>
          {agent.discussion.bridgeNodeIds.length > 0 && (
            <div className="canvas-panel-muted mt-2 pt-2 border-t border-paper-deep/20">
              {t("canvas.bridgeHint", {
                defaultValue: "有折中方案，或许能作为共识桥梁再聊聊。",
              })}
            </div>
          )}
        </div>
      )}

      {/* 空结果轻提示（不静默，让用户知道分析已运行）*/}
      {(agent.emptyHint.connection || agent.emptyHint.gap || agent.emptyHint.discussion) && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 px-3 py-1.5 rounded-full bg-ink/75 text-cloud text-[10px] animate-fade-in pointer-events-none">
          {providers.length === 0
            ? t("canvas.agentNoProvider", { defaultValue: "未配置 AI，暂用规则分析（无结果）" })
            : t("canvas.agentNoResult", { defaultValue: "这次没发现明显的可提示内容" })}
        </div>
      )}

      <svg
        ref={svgRef}
        className="w-full h-full cursor-grab active:cursor-grabbing"
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onClick={() => {
          setSelectedNodeId(null);
          setEditingNodeId(null);
          setLinkSourceNodeId(null);
        }}
      >
        {/* 固定事件层：整屏透明，点击空白开始平移 */}
        <rect
          width="100%"
          height="100%"
          fill="transparent"
          onMouseDown={handleBackgroundMouseDown}
        />

        {/* 网格背景（定义保留在变换外；引用它的 rect 置于变换组内，格子随平移/缩放） */}
        <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
          <path
            d="M 40 0 L 0 0 0 40"
            fill="none"
            stroke="var(--color-canvas-grid)"
            strokeWidth="0.5"
          />
        </pattern>

        <g transform={`translate(${viewState.panX}, ${viewState.panY}) scale(${viewState.scale})`}>
          {/* 超大网格矩形：锚定在远点，覆盖任意平移/缩放后的可见区域 */}
          <rect x={-5000} y={-5000} width={10000} height={10000} fill="url(#grid)" />
        </g>

        {/* 内容层：连线/建议/节点随缩放平移变换 */}
        <g transform={`translate(${viewState.panX}, ${viewState.panY}) scale(${viewState.scale})`}>
        {/* 连线 */}
        {doc.edges.map((edge) => {
          const from = doc.nodes.find((n) => n.id === edge.fromNodeId);
          const to = doc.nodes.find((n) => n.id === edge.toNodeId);
          if (!from || !to) return null;
          return (
            <line
              key={edge.id}
              x1={from.x + from.width / 2}
              y1={from.y + from.height / 2}
              x2={to.x + to.width / 2}
              y2={to.y + to.height / 2}
              stroke="currentColor"
              strokeWidth="1.5"
              strokeDasharray={edge.style === "dashed" ? "6 4" : undefined}
              className="canvas-edge-line"
            />
          );
        })}

        {/* Agent 隐含连接建议：淡色动态虚线（区别于用户连线，可忽略）*/}
        {agent.connections.map((c) => {
          const from = nodeById(c.sourceId);
          const to = nodeById(c.targetId);
          if (!from || !to) return null;
          return (
            <line
              key={`sugg-${c.sourceId}-${c.targetId}`}
              x1={from.x + from.width / 2}
              y1={from.y + from.height / 2}
              x2={to.x + to.width / 2}
              y2={to.y + to.height / 2}
              stroke="currentColor"
              strokeWidth="1.5"
              strokeDasharray="4 5"
              strokeLinecap="round"
              opacity={0.55}
              className="canvas-suggestion-edge canvas-suggestion-line pointer-events-none"
            />
          );
        })}

        {/* 节点（按 zIndex 升序渲染，越靠后越在上层） */}
        {[...doc.nodes].sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0)).map((node) => (
          <g
            key={node.id}
            transform={`translate(${node.x}, ${node.y})`}
            onMouseDown={(e) => handleMouseDown(e, node.id)}
            onClick={(e) => {
              e.stopPropagation();
              handleNodeClick(node.id);
            }}
            className="cursor-move"
          >
            <rect
              width={node.width}
              height={node.height}
              rx={node.type === "card" ? 12 : 4}
              className={`canvas-node-rect ${
                selectedNodeId === node.id
                  ? "fill-canvas-card-hover stroke-bamboo"
                  : node.source === "agent"
                    ? "fill-bamboo-mist/40 stroke-bamboo/50"
                    : "fill-canvas-card stroke-canvas-border"
              }`}
              strokeWidth={selectedNodeId === node.id ? 2 : 1}
              strokeDasharray={node.source === "agent" && selectedNodeId !== node.id ? "5 4" : undefined}
            />
            <foreignObject width={node.width} height={node.height}>
              <div className="w-full h-full p-2">
                {editingNodeId === node.id ? (
                  <textarea
                    autoFocus
                    value={node.text}
                    onChange={(e) => updateNodeText(node.id, e.target.value)}
                    onBlur={() => setEditingNodeId(null)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        setEditingNodeId(null);
                      }
                    }}
                    className="w-full h-full resize-none bg-transparent text-[13px] text-ink-soft leading-relaxed outline-none select-text"
                  />
                ) : (
                  <div
                    onDoubleClick={() => setEditingNodeId(node.id)}
                    className="w-full h-full text-[13px] text-ink-soft leading-relaxed whitespace-pre-wrap overflow-hidden"
                  >
                    {node.text || (
                      <span className="canvas-empty-text">
                        {t("canvas.doubleClickToEdit", { defaultValue: "双击编辑" })}
                      </span>
                    )}
                  </div>
                )}
              </div>
            </foreignObject>
          </g>
        ))}
        </g>
      </svg>
    </div>
  );
}
