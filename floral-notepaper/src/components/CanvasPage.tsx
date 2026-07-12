import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { CanvasDocument, CanvasNode, CanvasNodeType } from "../features/canvas/types";
import { getCanvasDocument, saveCanvasDocument } from "../features/canvas/api";
import {
  generateArchiveSuggestions,
  type ArchiveSuggestion,
} from "../features/canvas/canvasArchive";
import type { ProviderConfig } from "../features/settings/types";

interface CanvasPageProps {
  documentId: string;
  noteId?: string;
  providers: ProviderConfig[];
  initialDocument?: CanvasDocument;
  onSave?: (doc: CanvasDocument) => void;
}

const NODE_DEFAULTS: Record<CanvasNodeType, { width: number; height: number }> = {
  text: { width: 200, height: 80 },
  card: { width: 240, height: 120 },
};

function generateId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function CanvasPage({
  documentId,
  noteId,
  providers,
  initialDocument,
  onSave,
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

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getCanvasDocument(documentId)
      .then((loaded) => {
        if (cancelled) return;
        setDoc(loaded);
      })
      .catch(() => {
        if (cancelled) return;
        setDoc({
          id: documentId,
          noteId,
          nodes: initialDocument?.nodes ?? [],
          edges: initialDocument?.edges ?? [],
        });
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
        text: text || (type === "text" ? t("canvas.newText", { defaultValue: "新节点" }) : ""),
      };
      setDoc((prev) => ({
        ...prev,
        nodes: [...prev.nodes, newNode],
      }));
      setEditingNodeId(newNode.id);
    },
    [t],
  );

  const updateNodeText = useCallback((nodeId: string, text: string) => {
    setDoc((prev) => ({
      ...prev,
      nodes: prev.nodes.map((n) => (n.id === nodeId ? { ...n, text } : n)),
    }));
  }, []);

  const updateNodePosition = useCallback((nodeId: string, x: number, y: number) => {
    setDoc((prev) => ({
      ...prev,
      nodes: prev.nodes.map((n) => (n.id === nodeId ? { ...n, x, y } : n)),
    }));
  }, []);

  const deleteNode = useCallback((nodeId: string) => {
    setDoc((prev) => ({
      ...prev,
      nodes: prev.nodes.filter((n) => n.id !== nodeId),
      edges: prev.edges.filter((e) => e.fromNodeId !== nodeId && e.toNodeId !== nodeId),
    }));
    setSelectedNodeId(null);
    setEditingNodeId(null);
  }, []);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent, nodeId: string) => {
      e.stopPropagation();
      if (editingNodeId === nodeId) return;
      setSelectedNodeId(nodeId);
      const node = doc.nodes.find((n) => n.id === nodeId);
      if (!node || !svgRef.current) return;
      const rect = svgRef.current.getBoundingClientRect();
      setDragState({
        nodeId,
        startX: node.x,
        startY: node.y,
        offsetX: e.clientX - rect.left - node.x,
        offsetY: e.clientY - rect.top - node.y,
      });
    },
    [doc.nodes, editingNodeId],
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!dragState || !svgRef.current) return;
      const rect = svgRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left - dragState.offsetX;
      const y = e.clientY - rect.top - dragState.offsetY;
      updateNodePosition(dragState.nodeId, x, y);
    },
    [dragState, updateNodePosition],
  );

  const handleMouseUp = useCallback(() => {
    setDragState(null);
  }, []);

  const handleSave = useCallback(() => {
    void saveCanvasDocument(doc);
    onSave?.(doc);
  }, [doc, onSave]);

  const handleArchiveSuggestions = useCallback(async () => {
    if (doc.nodes.length < 2 || providers.length === 0) return;
    setArchiveLoading(true);
    try {
      const suggestions = await generateArchiveSuggestions(doc.nodes, providers);
      setArchiveSuggestions(suggestions);
      setArchiveDismissed(false);
    } catch {
      setArchiveSuggestions([]);
    } finally {
      setArchiveLoading(false);
    }
  }, [doc.nodes, providers]);

  const applyArchiveTag = useCallback((nodeId: string, tag: string) => {
    setDoc((prev) => ({
      ...prev,
      nodes: prev.nodes.map((n) => (n.id === nodeId ? { ...n, text: `${tag}: ${n.text}` } : n)),
    }));
  }, []);

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
    <div className="flex-1 flex flex-col min-h-0 bg-paper relative overflow-hidden">
      {/* 工具栏 */}
      <div className="absolute top-4 left-4 z-10 flex items-center gap-2 px-3 py-2 rounded-xl bg-paper/90 backdrop-blur-sm border border-paper-deep/20 shadow-sm">
        <button
          type="button"
          onClick={() => addNode("text")}
          className="px-3 py-1.5 text-[12px] text-ink-soft bg-paper-warm/60 hover:bg-paper-warm rounded-lg transition-colors cursor-pointer"
        >
          {t("canvas.addText", { defaultValue: "+ 文本" })}
        </button>
        <button
          type="button"
          onClick={() => addNode("card")}
          className="px-3 py-1.5 text-[12px] text-ink-soft bg-paper-warm/60 hover:bg-paper-warm rounded-lg transition-colors cursor-pointer"
        >
          {t("canvas.addCard", { defaultValue: "+ 卡片" })}
        </button>
        <button
          type="button"
          onClick={handleSave}
          className="px-3 py-1.5 text-[12px] text-cloud bg-bamboo hover:bg-bamboo-light rounded-lg transition-colors cursor-pointer"
        >
          {t("common.save", { defaultValue: "保存" })}
        </button>
        <button
          type="button"
          onClick={() => void handleArchiveSuggestions()}
          disabled={archiveLoading || doc.nodes.length < 2}
          className="px-3 py-1.5 text-[12px] text-ink-soft bg-paper-warm/60 hover:bg-paper-warm disabled:opacity-50 rounded-lg transition-colors cursor-pointer"
        >
          {archiveLoading
            ? t("canvas.archiving", { defaultValue: "分析中…" })
            : t("canvas.archive", { defaultValue: "智能归档" })}
        </button>
      </div>

      {selectedNodeId && (
        <div className="absolute top-4 right-4 z-10">
          <button
            type="button"
            onClick={() => deleteNode(selectedNodeId)}
            className="px-3 py-1.5 text-[12px] text-red-400 bg-paper/90 backdrop-blur-sm border border-paper-deep/20 rounded-lg hover:bg-danger-bg transition-colors cursor-pointer"
          >
            {t("common.delete", { defaultValue: "删除" })}
          </button>
        </div>
      )}

      {!archiveDismissed && archiveSuggestions.length > 0 && (
        <div className="absolute top-16 left-4 z-10 w-[220px] rounded-xl bg-paper/95 backdrop-blur-sm border border-paper-deep/20 shadow-lg p-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] font-medium text-ink-faint">
              {t("canvas.archiveSuggestions", { defaultValue: "归档建议" })}
            </span>
            <button
              type="button"
              onClick={() => setArchiveDismissed(true)}
              className="text-ink-ghost/60 hover:text-ink-ghost text-[10px] cursor-pointer"
            >
              {t("common.ignore", { defaultValue: "忽略" })}
            </button>
          </div>
          <div className="space-y-2">
            {archiveSuggestions.map((suggestion, i) => (
              <div key={i} className="rounded-lg border border-paper-deep/20 bg-paper-warm/40 p-2">
                <div className="text-[11px] font-medium text-ink-soft">{suggestion.tag}</div>
                <div className="text-[10px] text-ink-ghost/80 leading-relaxed line-clamp-2 mt-0.5">
                  {suggestion.reason}
                </div>
                <div className="flex flex-wrap gap-1 mt-1.5">
                  {suggestion.nodeIds.map((nodeId) => (
                    <button
                      key={nodeId}
                      type="button"
                      onClick={() => applyArchiveTag(nodeId, suggestion.tag)}
                      className="text-[9px] px-1.5 py-0.5 rounded-full bg-bamboo-mist/60 text-bamboo hover:bg-bamboo-mist transition-colors cursor-pointer"
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

      <svg
        ref={svgRef}
        className="w-full h-full cursor-grab active:cursor-grabbing"
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onClick={() => {
          setSelectedNodeId(null);
          setEditingNodeId(null);
        }}
      >
        <rect width="100%" height="100%" fill="transparent" />

        {/* 网格背景 */}
        <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
          <path
            d="M 40 0 L 0 0 0 40"
            fill="none"
            stroke="var(--color-canvas-grid)"
            strokeWidth="0.5"
          />
        </pattern>
        <rect width="100%" height="100%" fill="url(#grid)" />

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
              className="text-ink-faint/50"
            />
          );
        })}

        {/* 节点 */}
        {doc.nodes.map((node) => (
          <g
            key={node.id}
            transform={`translate(${node.x}, ${node.y})`}
            onMouseDown={(e) => handleMouseDown(e, node.id)}
            onClick={(e) => e.stopPropagation()}
            className="cursor-move"
          >
            <rect
              width={node.width}
              height={node.height}
              rx={node.type === "card" ? 12 : 4}
              className={`transition-colors drop-shadow-sm ${
                selectedNodeId === node.id
                  ? "fill-canvas-card-hover stroke-bamboo"
                  : "fill-canvas-card stroke-canvas-border"
              }`}
              strokeWidth={selectedNodeId === node.id ? 2 : 1}
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
                    className="w-full h-full resize-none bg-transparent text-[13px] text-ink-soft leading-relaxed outline-none"
                  />
                ) : (
                  <div
                    onDoubleClick={() => setEditingNodeId(node.id)}
                    className="w-full h-full text-[13px] text-ink-soft leading-relaxed whitespace-pre-wrap overflow-hidden"
                  >
                    {node.text || (
                      <span className="text-ink-ghost/40">
                        {t("canvas.doubleClickToEdit", { defaultValue: "双击编辑" })}
                      </span>
                    )}
                  </div>
                )}
              </div>
            </foreignObject>
          </g>
        ))}
      </svg>
    </div>
  );
}
