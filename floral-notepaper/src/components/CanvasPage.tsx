import { useCallback, useEffect, useRef, useState } from "react";
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

interface CanvasPageProps {
  documentId: string;
  noteId?: string;
  providers: ProviderConfig[];
  /** Agent 总开关：关闭时不显示任何 AI 建议 */
  agentEnabled?: boolean;
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
  agentEnabled = false,
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

  // Agent 智能覆盖层（场景一：隐含连接 / 场景二：语义空白区 / 场景三：共识分歧）
  const agent = useCanvasAgent(providers, agentEnabled);
  const nodeById = useCallback(
    (id: string) => doc.nodes.find((n) => n.id === id) ?? null,
    [doc.nodes],
  );
  const providersRef = useRef(providers);
  providersRef.current = providers;

  // 接受一条隐含连接建议：写入一条 dashed 连线（可追溯到来源两节点），并从建议列表移除
  const acceptConnection = useCallback(
    (c: ImplicitConnection) => {
      setDoc((prev) => {
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
    },
    [agent],
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
      setDoc((prev) => ({ ...prev, nodes: [...prev.nodes, newNode] }));
    },
    [],
  );

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
        {agentEnabled && providers.length > 0 && (
          <>
            <div className="w-px h-5 bg-paper-deep/20" />
            <button
              type="button"
              onClick={() => void agent.runConnections(doc.nodes, doc.edges)}
              disabled={agent.loading.connection || doc.nodes.length < 2}
              className="px-3 py-1.5 text-[12px] text-bamboo bg-bamboo-mist/50 hover:bg-bamboo-mist disabled:opacity-50 rounded-lg transition-colors cursor-pointer"
            >
              {agent.loading.connection
                ? t("canvas.agentThinking", { defaultValue: "分析中…" })
                : t("canvas.findConnections", { defaultValue: "发现连接" })}
            </button>
            <button
              type="button"
              onClick={() => void agent.runGap(doc.nodes)}
              disabled={agent.loading.gap || doc.nodes.length < 5}
              className="px-3 py-1.5 text-[12px] text-bamboo bg-bamboo-mist/50 hover:bg-bamboo-mist disabled:opacity-50 rounded-lg transition-colors cursor-pointer"
              title={
                doc.nodes.length < 5
                  ? t("canvas.gapNeedsNodes", { defaultValue: "至少 5 个节点才能分析视角" })
                  : undefined
              }
            >
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
              className="px-3 py-1.5 text-[12px] text-bamboo bg-bamboo-mist/50 hover:bg-bamboo-mist disabled:opacity-50 rounded-lg transition-colors cursor-pointer"
            >
              {agent.loading.discussion
                ? t("canvas.agentThinking", { defaultValue: "分析中…" })
                : t("canvas.analyzeDiscussion", { defaultValue: "分析共识" })}
            </button>
          </>
        )}
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

      {/* 场景一：隐含连接建议气泡（定位在两节点连线中点，可接受/忽略）*/}
      {agent.connections.map((c) => {
        const from = nodeById(c.sourceId);
        const to = nodeById(c.targetId);
        if (!from || !to) return null;
        const midX = (from.x + from.width / 2 + to.x + to.width / 2) / 2;
        const midY = (from.y + from.height / 2 + to.y + to.height / 2) / 2;
        return (
          <div
            key={`bubble-${c.sourceId}-${c.targetId}`}
            className="absolute z-20 w-[210px] -translate-x-1/2 -translate-y-1/2 rounded-xl bg-paper/95 backdrop-blur-sm border border-bamboo/30 shadow-lg p-2.5 animate-fade-in"
            style={{ left: midX, top: midY }}
          >
            <div className="text-[11px] text-ink-soft leading-relaxed">{c.message}</div>
            <div className="mt-1 text-[9px] text-ink-ghost/70">
              {t("canvas.similarity", { defaultValue: "相似度" })} {(c.similarity * 100).toFixed(0)}%
            </div>
            <div className="flex items-center gap-1.5 mt-1.5">
              <button
                type="button"
                onClick={() => acceptConnection(c)}
                className="flex-1 text-[10px] px-2 py-1 rounded-lg bg-bamboo text-cloud hover:bg-bamboo-light transition-colors cursor-pointer"
              >
                {t("canvas.connect", { defaultValue: "轻轻连起来" })}
              </button>
              <button
                type="button"
                onClick={() => agent.dismissConnection(c.sourceId, c.targetId)}
                className="text-[10px] px-2 py-1 rounded-lg text-ink-ghost hover:bg-paper-deep/20 transition-colors cursor-pointer"
              >
                {t("common.ignore", { defaultValue: "忽略" })}
              </button>
            </div>
          </div>
        );
      })}

      {/* 场景二：语义空白区提示（浮框 + 待补充视角，可生成占位节点）*/}
      {agent.gap && (
        <div
          className="absolute z-20 w-[240px] rounded-xl bg-paper/95 backdrop-blur-sm border border-bamboo/30 shadow-lg p-3 animate-fade-in"
          style={{
            left: Math.max(16, Math.min(agent.gap.areaHint.x, 640)),
            top: Math.max(72, Math.min(agent.gap.areaHint.y, 420)),
          }}
        >
          <div className="flex items-start justify-between gap-2 mb-1.5">
            <span className="text-[11px] text-ink-soft leading-relaxed">{agent.gap.message}</span>
            <button
              type="button"
              onClick={agent.dismissGap}
              className="shrink-0 text-ink-ghost/60 hover:text-ink-ghost text-[10px] cursor-pointer"
              aria-label={t("common.ignore", { defaultValue: "忽略" })}
            >
              ✕
            </button>
          </div>
          <div className="space-y-1">
            {agent.gap.missingPerspectives.map((p, i) => (
              <button
                key={p}
                type="button"
                onClick={() => agent.gap && createPerspectiveNode(p, agent.gap.areaHint, i)}
                className="w-full text-left text-[10px] px-2 py-1 rounded-lg bg-bamboo-mist/50 text-bamboo hover:bg-bamboo-mist transition-colors cursor-pointer"
              >
                + {p}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 场景三：共识/分歧面板（分组光环 + 桥梁方案）*/}
      {agent.discussion && (
        <div className="absolute top-16 right-4 z-20 w-[240px] rounded-xl bg-paper/95 backdrop-blur-sm border border-paper-deep/20 shadow-lg p-3 animate-fade-in">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] font-medium text-ink-faint">
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
                <span className="text-[10px] text-ink-soft">{g.label}</span>
                <span className="text-[9px] text-ink-ghost/70 ml-auto">
                  {g.userIds.length} {t("canvas.people", { defaultValue: "人" })}
                </span>
              </div>
            ))}
          </div>
          {agent.discussion.bridgeNodeIds.length > 0 && (
            <div className="mt-2 pt-2 border-t border-paper-deep/20 text-[10px] text-ink-ghost/80 leading-relaxed">
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
              stroke="var(--color-bamboo, #6a9a5b)"
              strokeWidth="1.5"
              strokeDasharray="4 5"
              strokeLinecap="round"
              opacity={0.55}
              className="canvas-suggestion-line pointer-events-none"
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
