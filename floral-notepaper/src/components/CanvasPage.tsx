import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { CanvasDocument, CanvasNode, CanvasNodeType, CanvasRelationType } from "../features/canvas/types";
import { CANVAS_RELATION_TYPES } from "../features/canvas/types";
import { getCanvasDocument, saveCanvasDocument } from "../features/canvas/api";
import {
  generateArchiveSuggestions,
  type ArchiveSuggestion,
} from "../features/canvas/canvasArchive";
import { useCanvasAgent } from "../features/agent/useCanvasAgent";
import type { ImplicitConnection } from "../features/agent/connectionRecommendations";
import type { ProviderConfig } from "../features/settings/types";
import { generateArchitecture, onAgentExport, onAgentTask, recordAgentEvent } from "../features/agent/api";
import type { AgentEventType, AgentStepStatus } from "../features/agent/types";
import { TaskProgressPanel } from "../features/agent/TaskProgressPanel";
import { WriteupDialog } from "../features/agent/WriteupDialog";
import {
  buildCanvasSvg,
  downloadBlob,
  renderNoteToPngBlob,
  svgToPngBlob,
} from "../features/canvas/canvasExport";
import {
  dispatchAiRequest,
  dispatchCanvasSnapshot,
  onCanvasCommand,
  onCanvasSnapshotRequest,
} from "../features/canvas/canvasCommands";
import { CanvasOnboarding } from "../features/canvas/onboarding/CanvasOnboarding";
import { CanvasQuickHelp } from "../features/canvas/onboarding/CanvasQuickHelp";
import {
  DEMO_STEPS,
  loadOnboardingPhase,
  markOnboardingDone,
  markOnboardingSeen,
  type DemoStepId,
  type OnboardingPhase,
} from "../features/canvas/onboarding/types";
import { getTemplateById } from "../features/canvas/onboarding/templates";
import { dispatchOpenNote } from "../features/notes/openNoteEvents";
import { openUrl } from "@tauri-apps/plugin-opener";
import { listNotes } from "../features/notes/api";
import { getNote } from "../features/notes/api";
import { NoteTreePanel } from "../features/canvas/components/NoteTreePanel";
import { SocialComposerPanel } from "../features/canvas/components/SocialComposerPanel";
import { buildContentVisual } from "../features/canvas/contentVisualizer";
import { agentSignalQueue } from "../features/agent/signalQueue";
import { buildArchitecturePatch, applyCanvasPatch } from "../features/canvas/archifyAdapter";

/** 卡片颜色标记可选值（card 灵感卡） */
const NODE_COLORS = ["#c28060", "#7aa65c", "#8aa2c2", "#c2a45c", "#a67aa8", "#6f9aa8"];

/** 统一 node.group 与 groups[].nodeIds，并移除不存在的节点/分组引用。 */
function normalizeGroupMembership(doc: CanvasDocument): CanvasDocument {
  const groups = doc.groups ?? [];
  const validNodeIds = new Set(doc.nodes.map((node) => node.id));
  const validGroupIds = new Set(groups.map((group) => group.id));
  const listedGroupByNode = new Map<string, string>();
  for (const group of groups) {
    for (const nodeId of group.nodeIds) {
      if (validNodeIds.has(nodeId) && !listedGroupByNode.has(nodeId)) {
        listedGroupByNode.set(nodeId, group.id);
      }
    }
  }
  const nodes = doc.nodes.map((node) => {
    const group = node.group && validGroupIds.has(node.group) ? node.group : listedGroupByNode.get(node.id) ?? null;
    return node.group === group ? node : { ...node, group };
  });
  const membersByGroup = new Map(groups.map((group) => [group.id, [] as string[]]));
  for (const node of nodes) {
    if (node.group) membersByGroup.get(node.group)?.push(node.id);
  }
  return {
    ...doc,
    nodes,
    groups: groups.map((group) => ({ ...group, nodeIds: membersByGroup.get(group.id) ?? [] })),
  };
}

/** 归一化画布文档：兼容 Rust serde 省略空数组/None 字段（旧数据 & 新数据） */
function normalizeDoc(doc: CanvasDocument): CanvasDocument {
  // 旧类型迁移：text→idea（自由想法）、card→knowledge（知识卡）；resource/task 保留
  const migrateType = (type: string): CanvasNodeType => {
    if (type === "text") return "idea";
    if (type === "card") return "knowledge";
    if (type === "resource" || type === "task" || type === "knowledge" || type === "idea" || type === "opinion" || type === "question") {
      return type as CanvasNodeType;
    }
    return "idea";
  };
  return normalizeGroupMembership({
    ...doc,
    groups: doc.groups ?? [],
    nodes: (doc.nodes ?? []).map((node) => ({
      ...node,
      type: migrateType(node.type),
      tags: node.tags ?? [],
      color: node.color ?? null,
      done: node.done ?? false,
      dueDate: node.dueDate ?? null,
      group: node.group ?? null,
      noteId: node.noteId ?? null,
      draftedBy: node.draftedBy ?? null,
      fields: node.fields ?? {},
    })),
    edges: (doc.edges ?? []).map((edge) => ({
      ...edge,
      relationType: edge.relationType || "related",
      label: edge.label ?? "",
    })),
  });
}

/** 域名首字母（网页卡 favicon 占位） */
function domainInitial(url?: string | null): string {
  if (!url) return "网";
  try {
    const host = new URL(url).hostname;
    return host.replace(/^www\./, "").charAt(0).toUpperCase() || "网";
  } catch {
    return url.trim().charAt(0).toUpperCase() || "网";
  }
}

interface CanvasPageProps {
  documentId: string;
  noteId?: string;
  /** 画布标题（多画布工作台）；旧数据为空串，回退路径写入文档 */
  title?: string;
  /** 单画布多文件关联：挂载到本画布的全部笔记 id */
  noteIds?: string[];
  providers: ProviderConfig[];
  /** Agent 总开关：关闭时不显示任何 AI 建议 */
  agentEnabled?: boolean;
  initialDocument?: CanvasDocument;
  onSave?: (doc: CanvasDocument) => void;
  flushRef?: MutableRefObject<(() => Promise<void>) | null>;
  toolbarLeading?: ReactNode;
  /** 操作埋点上下文（可选）：缺省时画布操作不产生 agent 事件（可降级） */
  conversationId?: string;
  userId?: string;
}

const NODE_DEFAULTS: Record<CanvasNodeType, { width: number; height: number; label: string }> = {
  knowledge: { width: 260, height: 120, label: "新知识" },
  idea: { width: 220, height: 96, label: "新想法" },
  opinion: { width: 240, height: 110, label: "新观点" },
  resource: { width: 260, height: 110, label: "资料节点" },
  task: { width: 220, height: 96, label: "待办任务" },
  question: { width: 230, height: 90, label: "新问题" },
  text: { width: 220, height: 96, label: "新想法" },
  card: { width: 260, height: 120, label: "新知识" },
};

const NODE_TYPE_LABELS: { value: CanvasNodeType; label: string }[] = [
  { value: "knowledge", label: "知识" },
  { value: "idea", label: "想法" },
  { value: "opinion", label: "观点" },
  { value: "resource", label: "来源" },
  { value: "task", label: "任务" },
  { value: "question", label: "问题" },
];

/** 类型化卡片字段定义（双击打开表单，解决"空白不知打什么"） */
const NODE_FIELD_DEFS: Record<
  CanvasNodeType,
  { key: string; label: string; options?: string[] }[]
> = {
  knowledge: [
    { key: "url", label: "来源链接" },
    { key: "title", label: "来源标题" },
    { key: "confidence", label: "可信度" },
  ],
  idea: [],
  opinion: [
    { key: "source", label: "观点方" },
    { key: "stance", label: "立场" },
  ],
  resource: [
    { key: "link", label: "链接" },
    { key: "kind", label: "类型", options: ["网页", "图片", "视频", "文档"] },
  ],
  task: [],
  question: [{ key: "status", label: "状态", options: ["待答", "已答"] }],
  text: [],
  card: [],
};

const AGENT_STEP_DRAG_TYPE = "application/x-floral-agent-step";
const MINI_MAP_MIN = { width: 180, height: 120 };
const MINI_MAP_MAX = { width: 360, height: 260 };

type MiniMapDragState =
  | { kind: "move"; startX: number; startY: number; startLeft: number; startTop: number }
  | { kind: "resize"; startX: number; startY: number; startWidth: number; startHeight: number }
  | {
      kind: "viewport";
      startClientX: number;
      startClientY: number;
      startPanX: number;
      startPanY: number;
      mapScale: number;
    };

type CanvasPointEvent = React.MouseEvent | React.PointerEvent | MouseEvent | PointerEvent;

type MarqueeState = {
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
};

interface NodeContextMenuState {
  x: number;
  y: number;
  nodeId: string;
}

interface AgentStepDropPayload {
  taskId: string;
  goal: string;
  stepId: string;
  kind: string;
  tool?: string | null;
  status?: AgentStepStatus;
  input?: Record<string, unknown>;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function getCanvasBounds(nodes: CanvasNode[]) {
  if (nodes.length === 0) {
    return { minX: -500, minY: -360, maxX: 500, maxY: 360, width: 1000, height: 720 };
  }
  const minX = Math.min(...nodes.map((node) => node.x));
  const minY = Math.min(...nodes.map((node) => node.y));
  const maxX = Math.max(...nodes.map((node) => node.x + node.width));
  const maxY = Math.max(...nodes.map((node) => node.y + node.height));
  const padding = 180;
  const left = minX - padding;
  const top = minY - padding;
  const right = maxX + padding;
  const bottom = maxY + padding;
  return {
    minX: left,
    minY: top,
    maxX: right,
    maxY: bottom,
    width: right - left,
    height: bottom - top,
  };
}

function getNodeStatusClass(node: CanvasNode) {
  switch (node.agentStepStatus) {
    case "Running":
      return "fill-bamboo-mist/55 stroke-bamboo";
    case "Done":
      return "fill-bamboo-mist/35 stroke-bamboo/70";
    case "Failed":
      return "fill-coral/10 stroke-coral/80";
    case "Cancelled":
      return "fill-paper-deep/20 stroke-ink-ghost/45";
    case "Pending":
      return "fill-paper-warm/70 stroke-amber-500/60";
    default:
      return "";
  }
}

function getNodeStatusLabel(status?: AgentStepStatus) {
  switch (status) {
    case "Pending":
      return "待执行";
    case "Running":
      return "执行中";
    case "Done":
      return "已完成";
    case "Failed":
      return "失败";
    case "Cancelled":
      return "已取消";
    default:
      return "";
  }
}

function parseAgentStepPayload(dataTransfer: DataTransfer): AgentStepDropPayload | null {
  const raw = dataTransfer.getData(AGENT_STEP_DRAG_TYPE);
  if (!raw) return null;
  try {
    const payload = JSON.parse(raw) as AgentStepDropPayload;
    if (!payload.taskId || !payload.stepId) return null;
    return payload;
  } catch {
    return null;
  }
}

function normalizeScreenRect(rect: MarqueeState) {
  const left = Math.min(rect.startX, rect.currentX);
  const top = Math.min(rect.startY, rect.currentY);
  const right = Math.max(rect.startX, rect.currentX);
  const bottom = Math.max(rect.startY, rect.currentY);
  return { left, top, right, bottom, width: right - left, height: bottom - top };
}

function rectsIntersect(
  a: { left: number; top: number; right: number; bottom: number },
  b: { left: number; top: number; right: number; bottom: number },
) {
  return a.left <= b.right && a.right >= b.left && a.top <= b.bottom && a.bottom >= b.top;
}

function isPrimaryPoint(event: CanvasPointEvent) {
  if ("button" in event && typeof event.button === "number") return event.button === 0;
  return true;
}

function isCanvasPanPoint(event: CanvasPointEvent) {
  const pointerType = "pointerType" in event ? event.pointerType : "mouse";
  if (pointerType === "touch" || pointerType === "pen") return isPrimaryPoint(event);
  return "button" in event && event.button === 1;
}

function isCanvasMarqueePoint(event: CanvasPointEvent) {
  return isPrimaryPoint(event) && isModifierPoint(event);
}

function isModifierPoint(event: CanvasPointEvent) {
  return Boolean(event.ctrlKey || event.metaKey);
}

function stopCanvasEvent(event: { preventDefault: () => void; stopPropagation: () => void }) {
  event.preventDefault();
  event.stopPropagation();
}

function getMiniMapMetrics(
  state: { left: number; top: number; width: number; height: number },
  bounds: ReturnType<typeof getCanvasBounds>,
) {
  const inset = 10;
  const headerH = 28;
  const mapW = state.width - inset * 2;
  const mapH = state.height - headerH - inset;
  const scale = Math.min(mapW / bounds.width, mapH / bounds.height);
  return {
    inset,
    headerH,
    mapW,
    mapH,
    scale,
    ox: inset,
    oy: headerH,
  };
}

function CanvasActionIcon({ children }: { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
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

function GroupIcon() {
  return (
    <CanvasActionIcon>
      <rect x="2.8" y="2.8" width="10.6" height="6.2" rx="1.6" />
      <rect x="2.8" y="11" width="10.6" height="6.2" rx="1.6" opacity="0.55" />
      <path d="M6.8 5.9h3" opacity="0.7" />
      <path d="M6.8 14.1h3" opacity="0.4" />
    </CanvasActionIcon>
  );
}

function SlidersIcon() {
  return (
    <CanvasActionIcon>
      <path d="M4 6.5h9" />
      <circle cx="15.5" cy="6.5" r="1.6" />
      <path d="M4 12h4" />
      <circle cx="10.5" cy="12" r="1.6" />
      <path d="M14 12h5" />
      <circle cx="7.5" cy="17.5" r="1.6" />
      <path d="M11 17.5h8" />
    </CanvasActionIcon>
  );
}

function OpinionIcon() {
  return (
    <CanvasActionIcon>
      <path d="M6 3.5h8.4a1.8 1.8 0 0 1 1.8 1.8v6.8a1.8 1.8 0 0 1-1.8 1.8H9.2L5.6 17v-3.1H4.6A1.8 1.8 0 0 1 2.8 12V5.3a1.8 1.8 0 0 1 1.8-1.8Z" opacity="0.5" />
      <path d="m5.4 7 1.2 1.2 2.6-2.7" />
    </CanvasActionIcon>
  );
}

function QuestionIcon() {
  return (
    <CanvasActionIcon>
      <circle cx="8" cy="8.2" r="5.4" />
      <path d="M8 10.8v.01" />
      <path d="M8 9.2c0-1 .8-1.3 1.3-1.6.5-.3.9-.7.9-1.2a2.2 2.2 0 1 0-4.4 0" />
    </CanvasActionIcon>
  );
}

function NoteTreeIcon() {
  return (
    <CanvasActionIcon>
      <path d="M2.8 5.2h7.9L12.8 7v10H2.8z" />
      <path d="M2.8 9.4h10" />
      <path d="M6 12.8h3" opacity="0.65" />
      <path d="M14.6 7.2h2.6v8.2H10.4" opacity="0.55" />
      <path d="M10.4 3.4v3.8" opacity="0.45" />
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
  title,
  noteIds,
  providers,
  agentEnabled = false,
  initialDocument,
  onSave,
  flushRef,
  toolbarLeading,
  conversationId,
  userId,
}: CanvasPageProps) {
  const { t } = useTranslation();
  const svgRef = useRef<SVGSVGElement>(null);
  const [doc, setDoc] = useState<CanvasDocument>(() => ({
    id: documentId,
    title: initialDocument?.title ?? title ?? "",
    noteId: noteId ?? initialDocument?.noteId,
    noteIds: initialDocument?.noteIds ?? noteIds ?? [],
    nodes: initialDocument?.nodes ?? [],
    edges: initialDocument?.edges ?? [],
    groups: initialDocument?.groups ?? [],
  }));
  const [loading, setLoading] = useState(true);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([]);
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
  const [nodeContextMenu, setNodeContextMenu] = useState<NodeContextMenuState | null>(null);
  const [marqueeState, setMarqueeState] = useState<MarqueeState | null>(null);
  const ignoreNextCanvasClickRef = useRef(false);
  const [miniMapState, setMiniMapState] = useState({ left: 0, top: 84, width: 220, height: 150 });
  const [miniMapDrag, setMiniMapDrag] = useState<MiniMapDragState | null>(null);

  // ── P1-2/P1-3 前端入口：节点扩写任务 + PNG 导出 ───────────────────────────
  const [exportingPng, setExportingPng] = useState(false);
  const [enhanceGoal, setEnhanceGoal] = useState<string | null>(null);
  const [enhanceVersion, setEnhanceVersion] = useState(0);
  // ── 组卡成文（可产出 Agent）：类型选择弹窗 + 任务面板 ─────────────────────
  const [writeupOpen, setWriteupOpen] = useState(false);
  const [writeupGoal, setWriteupGoal] = useState<string | null>(null);
  const [writeupVersion, setWriteupVersion] = useState(0);
  // ── 章节续写：成文落盘后可接着写下一章 ────────────────────────────────────
  const [chapterGoal, setChapterGoal] = useState<string | null>(null);
  const [chapterVersion, setChapterVersion] = useState(0);
  // ── AI 自动分组：一键按语义把画布卡片分成泳道 ─────────────────────────────
  const [groupTaskGoal, setGroupTaskGoal] = useState<string | null>(null);
  const [groupTaskVersion, setGroupTaskVersion] = useState(0);
  // ── 卡片增强（P0-1）：分组/泳道折叠 + resource 笔记列表 ────────────────────
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [noteOptions, setNoteOptions] = useState<{ id: string; title: string; preview: string }[]>([]);
  const [noteTreeOpen, setNoteTreeOpen] = useState(false);
  const [composerOpen, setComposerOpen] = useState(false);
  /** 节点属性面板：编辑 task 截止日期 / card 颜色标签 / resource 绑定笔记 */
  const [nodeMetaPanelId, setNodeMetaPanelId] = useState<string | null>(null);
  const [tagDraft, setTagDraft] = useState("");
  /** P0-3：Live2D 成文提议（选中 ≥3 张卡片时花灵提议整理成文） */
  const [writeupProposalDismissed, setWriteupProposalDismissed] = useState(false);
  const [architectureOpen, setArchitectureOpen] = useState(false);
  const [architectureIntent, setArchitectureIntent] = useState("");
  const [architecturePatch, setArchitecturePatch] = useState<ReturnType<typeof buildArchitecturePatch> | null>(null);
  const [architectureLoading, setArchitectureLoading] = useState(false);
  const [architectureError, setArchitectureError] = useState<string | null>(null);

  // ── 新手引导（ob-1 ~ ob-4）：3s 预告动画 → 四步演示 → 模板坞 → AI 唤醒 ──
  const [onboardingPhase, setOnboardingPhase] = useState<OnboardingPhase>(() => {
    const phase = loadOnboardingPhase();
    return phase === "done" ? "done" : "intro";
  });
  const [demoStep, setDemoStep] = useState<DemoStepId>("pan");
  const [completedSteps, setCompletedSteps] = useState<DemoStepId[]>([]);
  const [templatesDismissed, setTemplatesDismissed] = useState(false);
  const [moveCommittedTick, setMoveCommittedTick] = useState(0);
  /** 演示阶段的基线（pan/zoom/新建的检测参照） */
  const demoBaselineRef = useRef<{
    panX: number;
    panY: number;
    scale: number;
    nodeCount: number;
  } | null>(null);

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
  /** 命令桥（ai-3）读取最新视图状态用（避免 effect 反复重订阅） */
  const viewStateRef = useRef(viewState);
  viewStateRef.current = viewState;

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

  /** 视口坐标 → 画布容器坐标（右键菜单/连线菜单定位用；容器相对原点在标题栏与侧栏之后） */
  const toContainerPoint = useCallback((clientX: number, clientY: number) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return { x: clientX, y: clientY };
    return { x: clientX - rect.left, y: clientY - rect.top };
  }, []);

  const selectedIdSet = useMemo(() => new Set(selectedNodeIds), [selectedNodeIds]);
  const marqueeRect = useMemo(
    () => (marqueeState ? normalizeScreenRect(marqueeState) : null),
    [marqueeState],
  );
  const canvasBounds = useMemo(() => getCanvasBounds(doc.nodes), [doc.nodes]);
  /** 当前选中卡片的文本集合（发布编排「素材整理」的输入源） */
  const selectedTexts = useMemo(
    () =>
      selectedNodeIds
        .map((id) => doc.nodes.find((n) => n.id === id)?.text ?? "")
        .filter((text) => text.trim().length > 0),
    [selectedNodeIds, doc.nodes],
  );
  const viewportWorld = useMemo(() => {
    const rect = svgRef.current?.getBoundingClientRect();
    const width = rect?.width ?? 960;
    const height = rect?.height ?? 640;
    return {
      x: -viewState.panX / viewState.scale,
      y: -viewState.panY / viewState.scale,
      width: width / viewState.scale,
      height: height / viewState.scale,
    };
  }, [viewState]);

  useEffect(() => {
    const update = () => {
      const rect = svgRef.current?.getBoundingClientRect();
      if (!rect) return;
      setMiniMapState((current) => {
        if (current.left !== 0) return current;
        return { ...current, left: Math.max(16, rect.width - current.width - 18) };
      });
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  useEffect(() => {
    if (!miniMapDrag) return;
    const onMove = (event: PointerEvent) => {
      const rect = svgRef.current?.getBoundingClientRect();
      if (miniMapDrag.kind === "viewport") {
        if (!rect) return;
        const dxWorld = (event.clientX - miniMapDrag.startClientX) / miniMapDrag.mapScale;
        const dyWorld = (event.clientY - miniMapDrag.startClientY) / miniMapDrag.mapScale;
        setViewState((vs) => ({
          ...vs,
          panX: miniMapDrag.startPanX - dxWorld * vs.scale,
          panY: miniMapDrag.startPanY - dyWorld * vs.scale,
        }));
        return;
      }
      const maxLeft = Math.max(12, (rect?.width ?? 960) - 12);
      const maxTop = Math.max(12, (rect?.height ?? 640) - 12);
      setMiniMapState((current) => {
        if (miniMapDrag.kind === "move") {
          const left = clamp(
            miniMapDrag.startLeft + event.clientX - miniMapDrag.startX,
            12,
            maxLeft - current.width,
          );
          const top = clamp(
            miniMapDrag.startTop + event.clientY - miniMapDrag.startY,
            64,
            maxTop - current.height,
          );
          return { ...current, left, top };
        }
        const width = clamp(
          miniMapDrag.startWidth + event.clientX - miniMapDrag.startX,
          MINI_MAP_MIN.width,
          MINI_MAP_MAX.width,
        );
        const height = clamp(
          miniMapDrag.startHeight + event.clientY - miniMapDrag.startY,
          MINI_MAP_MIN.height,
          MINI_MAP_MAX.height,
        );
        return {
          ...current,
          width,
          height,
          left: clamp(current.left, 12, maxLeft - width),
          top: clamp(current.top, 64, maxTop - height),
        };
      });
    };
    const onUp = () => setMiniMapDrag(null);
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      document.body.style.userSelect = "";
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [miniMapDrag]);

  // ── P0 撤销/重做（≥50 步快照栈；ref 持有数据，state 只渲染可用态） ────────
  const MAX_HISTORY = 50;
  const undoStackRef = useRef<CanvasDocument[]>([]);
  const redoStackRef = useRef<CanvasDocument[]>([]);
  const [historyState, setHistoryState] = useState({ canUndo: false, canRedo: false });
  /** 拖拽开始时画布快照：拖拽过程不入栈，松手后整段拖拽合并为一步 */
  const dragStartSnapshotRef = useRef<CanvasDocument | null>(null);

  // ── P0 自动保存：脏标记，仅用户改动后才 debounce 保存 ─────────────────────
  const dirtyRef = useRef(false);
  const revisionRef = useRef(0);
  const savePromiseRef = useRef<Promise<void> | null>(null);
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
    revisionRef.current += 1;
    docRef.current = next;
    dirtyRef.current = true;
    setDoc(next);
    setHistoryState({ canUndo: true, canRedo: false });
    setSaveStatus("idle");
  }, []);

  // ── 卡片增强（P0-1）：分组/泳道 + task 待办 + resource 打开笔记 + card 颜色标签 ──
  useEffect(() => {
    let cancelled = false;
    listNotes()
      .then((notes) => {
        if (!cancelled) {
          setNoteOptions(
            notes.map((note) => ({ id: note.id, title: note.title, preview: note.preview })),
          );
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  /** 局部更新单个节点（颜色/标签/待办/分组/笔记绑定等） */
  const patchNode = useCallback(
    (nodeId: string, patch: Partial<CanvasNode>) => {
      commitDoc((prev) => ({
        ...prev,
        nodes: prev.nodes.map((node) => (node.id === nodeId ? { ...node, ...patch } : node)),
      }));
    },
    [commitDoc],
  );

  /** task 待办卡：切换完成态 */
  const toggleTaskDone = useCallback(
    (nodeId: string) => {
      const node = docRef.current.nodes.find((n) => n.id === nodeId);
      if (!node) return;
      patchNode(nodeId, { done: !node.done });
    },
    [patchNode],
  );

  /** 单画布多文件关联：勾选/取消某篇笔记的挂载状态（写回 noteIds 并触发自动保存） */
  const toggleNoteMount = useCallback((noteId: string, checked: boolean) => {
    const current = docRef.current.noteIds ?? [];
    const nextIds = checked
      ? current.includes(noteId)
        ? current
        : [...current, noteId]
      : current.filter((id) => id !== noteId);
    if (nextIds === current || nextIds.length === current.length && nextIds.every((id, index) => id === current[index])) return;
    const next = { ...docRef.current, noteIds: nextIds };
    undoStackRef.current = [...undoStackRef.current.slice(-(MAX_HISTORY - 1)), docRef.current];
    redoStackRef.current = [];
    revisionRef.current += 1;
    dirtyRef.current = true;
    setSaveStatus("idle");
    setDoc(next);
  }, []);

  /** 新建分组：把当前选中节点归入新组 */
  const createGroupFromSelection = useCallback(() => {
    const selected = selectedNodeIds;
    const id = `group-${Date.now()}`;
    commitDoc((prev) => ({
      ...prev,
      groups: [
        ...(prev.groups ?? []),
        { id, title: `分组 ${(prev.groups?.length ?? 0) + 1}`, nodeIds: selected },
      ],
      nodes: prev.nodes.map((node) => (selected.includes(node.id) ? { ...node, group: id } : node)),
    }));
  }, [selectedNodeIds, commitDoc]);

  /** 把选中的节点移到指定分组（groupId 为空则移出分组） */
  const moveNodesToGroup = useCallback(
    (groupId: string | null) => {
      const targets = selectedNodeIds.length > 0 ? selectedNodeIds : [selectedNodeId ?? ""];
      const ids = new Set(targets.filter(Boolean));
      if (ids.size === 0) return;
      commitDoc((prev) => {
        const groups = (prev.groups ?? []).map((group) => ({
          ...group,
          nodeIds: group.nodeIds.filter((id) => !ids.has(id)),
        }));
        if (groupId) {
          const group = groups.find((item) => item.id === groupId);
          if (group) group.nodeIds = [...new Set([...group.nodeIds, ...ids])];
        }
        return {
          ...prev,
          groups,
          nodes: prev.nodes.map((node) => (ids.has(node.id) ? { ...node, group: groupId } : node)),
        };
      });
    },
    [selectedNodeIds, selectedNodeId, commitDoc],
  );

  /** 分组折叠/展开 */
  const toggleGroupCollapsed = useCallback((groupId: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) {
        next.delete(groupId);
      } else {
        next.add(groupId);
      }
      return next;
    });
  }, []);

  /** resource 资源卡：打开关联笔记 */
  const openResourceNote = useCallback((nodeId: string) => {
    const node = docRef.current.nodes.find((n) => n.id === nodeId);
    if (!node?.noteId) return;
    dispatchOpenNote(node.noteId);
  }, []);

  /** P0-3：选中 ≥3 张卡片时，花灵提议整理成文（信号队列自带冷却/去重，不刷屏） */
  const showWriteupProposal =
    agentEnabled && providers.length > 0 && selectedNodeIds.length >= 3 && !writeupProposalDismissed;

  useEffect(() => {
    if (!showWriteupProposal) return;
    agentSignalQueue.dispatch({
      type: "live2d_signal",
      mood: "curious",
      animation: "poke",
      bubbleText: t("canvas.writeupProposeBubble", {
        defaultValue: "这几张卡片够成一篇文章了，要整理成文吗？",
      }),
      priority: 40,
    });
  }, [showWriteupProposal, t]);

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

  const handleArchitectureRequest = useCallback(async (requestedIntent?: string, requestedNodeIds?: string[]) => {
    const sourceNodeIds = requestedNodeIds ?? (selectedNodeIds.length > 0 ? selectedNodeIds : docRef.current.nodes.map((node) => node.id));
    const intent = requestedIntent ?? architectureIntent;
    setArchitectureLoading(true);
    setArchitectureError(null);
    try {
      const result = await generateArchitecture(
        intent,
        docRef.current.id,
        sourceNodeIds,
        providersRef.current,
      );
      setArchitecturePatch(result.patch as ReturnType<typeof buildArchitecturePatch>);
    } catch (error) {
      setArchitectureError(error instanceof Error ? error.message : String(error));
    } finally {
      setArchitectureLoading(false);
    }
  }, [architectureIntent, noteId, noteIds, selectedNodeIds]);

  const handleArchitectureApply = useCallback(() => {
    if (!architecturePatch) return;
    commitDoc((prev) => applyCanvasPatch(prev, architecturePatch));
    setArchitecturePatch(null);
    setArchitectureOpen(false);
    setArchitectureIntent("");
  }, [architecturePatch, commitDoc]);

  // ── 组卡成文入口：框选卡片 → 类型选择 → Rust canvas.writeup 任务 ──────────
  const handleWriteupStart = useCallback((goal: string) => {
    setWriteupOpen(false);
    setWriteupGoal(goal);
    setWriteupVersion((v) => v + 1);
    // 提议已生效：收起横幅，避免与底部任务面板 Dock 互相遮挡
    setWriteupProposalDismissed(true);
  }, []);

  /** 章节续写：成文落盘后接着写下一章（goal 编码笔记 id + 标题，Rust note.chapter 技能） */
  const handleContinueChapter = useCallback((note: { id: string; title: string }) => {
    setChapterGoal(`续写笔记 ${note.id} 的下一章（当前标题：${note.title || "成文"}）`);
    setChapterVersion((v) => v + 1);
  }, []);

  /** AI 自动分组：一键按语义把画布卡片分成泳道（Rust canvas.group 技能） */
  const handleAiGroup = useCallback(() => {
    setGroupTaskGoal("自动分组画布卡片");
    setGroupTaskVersion((v) => v + 1);
  }, []);

  /** 卡片尺寸调整（Obsidian 风格）：右下角拖拽，pointermove 直接改尺寸，up 时打脏标记 */
  // 屏幕像素增量需除以当前 scale 换算为画布单位，缩放 ≠ 1 时拖拽手感与视觉一致
  const scaleRef = useRef(viewState.scale);
  scaleRef.current = viewState.scale;
  const resizeStateRef = useRef<{
    nodeId: string;
    startClientX: number;
    startClientY: number;
    startW: number;
    startH: number;
  } | null>(null);

  const startNodeResize = useCallback((e: React.PointerEvent, nodeId: string) => {
    e.stopPropagation();
    e.preventDefault();
    const node = docRef.current.nodes.find((n) => n.id === nodeId);
    if (!node) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    resizeStateRef.current = {
      nodeId,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startW: node.width,
      startH: node.height,
    };
  }, []);

  useEffect(() => {
    const move = (e: PointerEvent) => {
      const r = resizeStateRef.current;
      if (!r) return;
      const dx = (e.clientX - r.startClientX) / scaleRef.current;
      const dy = (e.clientY - r.startClientY) / scaleRef.current;
      const next = {
        ...docRef.current,
        nodes: docRef.current.nodes.map((n) =>
          n.id === r.nodeId
            ? { ...n, width: Math.max(140, r.startW + dx), height: Math.max(70, r.startH + dy) }
            : n,
        ),
      };
      docRef.current = next;
      setDoc(next);
    };
    const up = () => {
      if (resizeStateRef.current) {
        dirtyRef.current = true;
        setSaveStatus("idle");
      }
      resizeStateRef.current = null;
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, []);

  // 属性面板跟随选中节点：切到另一张卡片时关闭旧面板，避免编辑错卡片
  useEffect(() => {
    if (nodeMetaPanelId && selectedNodeId && selectedNodeId !== nodeMetaPanelId) {
      setNodeMetaPanelId(null);
    }
  }, [nodeMetaPanelId, selectedNodeId]);

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
          docRef.current = normalizeDoc(loaded);
          setDoc(docRef.current);
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

  /** 文章内容智能绘图：把文本片段解析为内容结构图（主题 + 要点 + 连线）插入画布 */
  const visualizeTextToCanvas = useCallback(
    (text: string, anchor?: { x: number; y: number }) => {
      const visual = buildContentVisual(text);
      if (visual.nodes.length === 0) return;
      const idMap = new Map<string, string>();
      const nodes = visual.nodes.map((n) => {
        const newId = generateId();
        idMap.set(n.id, newId);
        return { ...n, id: newId };
      });
      const edges = visual.edges.map((e) => ({
        ...e,
        id: generateId(),
        fromNodeId: idMap.get(e.fromNodeId) ?? e.fromNodeId,
        toNodeId: idMap.get(e.toNodeId) ?? e.toNodeId,
      }));
      const root = nodes[0];
      let base = anchor;
      if (!base) {
        const selected = selectedNodeIds[0]
          ? docRef.current.nodes.find((n) => n.id === selectedNodeIds[0])
          : null;
        base = selected
          ? { x: selected.x + 440, y: selected.y }
          : { x: viewportWorld.x + 120, y: viewportWorld.y + 90 };
      }
      const shifted = nodes.map((n) => ({ ...n, x: n.x + base.x - root.x, y: n.y + base.y - root.y }));
      commitDoc((prev) => ({
        ...prev,
        nodes: [...prev.nodes, ...shifted],
        edges: [...prev.edges, ...edges],
      }));
      setSelectedNodeIds(shifted.map((n) => n.id));
      trackCanvasEvent("canvas_shape_added", {
        action: "content_visualize",
        nodeCount: shifted.length,
      });
    },
    [selectedNodeIds, viewportWorld, commitDoc, trackCanvasEvent],
  );

  /** 从笔记工作树触发：读取笔记全文 → 智能绘图插入画布 */
  const visualizeNoteToCanvas = useCallback(
    async (noteId: string) => {
      try {
        const note = await getNote(noteId);
        visualizeTextToCanvas(note.content || note.title);
      } catch {
        // 笔记读取失败时静默降级（工作树列表仍可用）
      }
    },
    [visualizeTextToCanvas],
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
        docRef.current = normalizeDoc(loaded);
        setDoc(docRef.current);
        setHistoryState({ canUndo: false, canRedo: false });
        setSaveStatus("idle");
      })
      .catch(() => {
        if (cancelled) return;
        const fallback: CanvasDocument = {
          id: documentId,
          title: initialDocument?.title ?? title ?? "",
          noteId: noteId ?? initialDocument?.noteId,
          noteIds: initialDocument?.noteIds ?? noteIds ?? [],
          nodes: initialDocument?.nodes ?? [],
          edges: initialDocument?.edges ?? [],
          groups: initialDocument?.groups ?? [],
        };
        undoStackRef.current = [];
        redoStackRef.current = [];
        dragStartSnapshotRef.current = null;
        dirtyRef.current = false;
        docRef.current = normalizeDoc(fallback);
        setDoc(docRef.current);
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
      const binding = docRef.current.nodes.find(
        (n) => n.id === nodeId && n.agentTaskId && n.agentStepId,
      );
      commitDoc((prev) => ({
        ...prev,
        nodes: prev.nodes.map((n) => (n.id === nodeId ? { ...n, text } : n)),
      }));
      if (binding?.agentTaskId && binding.agentStepId) {
        trackCanvasEvent("canvas_shape_updated", {
          nodeId,
          action: "agent_step_params_updated",
          taskId: binding.agentTaskId,
          stepId: binding.agentStepId,
          text,
        });
      }
    },
    [commitDoc, trackCanvasEvent],
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
    (
      fromNodeId: string,
      toNodeId: string,
      style: "solid" | "dashed" = "solid",
      relationType: CanvasRelationType = "related",
    ) => {
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
          edges: [
            ...prev.edges,
            { id: generateId(), fromNodeId, toNodeId, style, relationType },
          ],
        };
      });
      trackCanvasEvent("canvas_binding_added", { fromNodeId, toNodeId, style, relationType });
    },
    [commitDoc, trackCanvasEvent],
  );

  /** 连线关系类型选择：点目标后弹出菜单，选类型才真正建边 */
  const [pendingEdge, setPendingEdge] = useState<{
    from: string;
    to: string;
    x: number;
    y: number;
  } | null>(null);

  const handleNodeClick = useCallback(
    (nodeId: string, clientX: number, clientY: number) => {
      if (!linkSourceNodeId) return;
      if (linkSourceNodeId === nodeId) {
        setLinkSourceNodeId(null);
        return;
      }
      const point = toContainerPoint(clientX, clientY);
      setPendingEdge({ from: linkSourceNodeId, to: nodeId, x: point.x, y: point.y });
      setLinkSourceNodeId(null);
    },
    [linkSourceNodeId, toContainerPoint],
  );

  const deleteNodes = useCallback(
    (nodeIds: string[]) => {
      const ids = Array.from(new Set(nodeIds)).filter(Boolean);
      if (ids.length === 0) return;
      const idSet = new Set(ids);
      commitDoc((prev) => ({
        ...prev,
        nodes: prev.nodes.filter((n) => !idSet.has(n.id)),
        edges: prev.edges.filter((e) => !idSet.has(e.fromNodeId) && !idSet.has(e.toNodeId)),
        groups: (prev.groups ?? []).map((group) => ({
          ...group,
          nodeIds: group.nodeIds.filter((id) => !idSet.has(id)),
        })),
      }));
      setSelectedNodeId(null);
      setSelectedNodeIds([]);
      setEditingNodeId(null);
      setNodeContextMenu(null);
      setPendingEdge(null);
      setNodeMetaPanelId((current) => (current && idSet.has(current) ? null : current));
      setLinkSourceNodeId((current) => (current && idSet.has(current) ? null : current));
      trackCanvasEvent("canvas_shape_removed", { nodeIds: ids, count: ids.length });
    },
    [commitDoc, trackCanvasEvent],
  );

  const handleNodePointerDown = useCallback(
    (e: React.PointerEvent, nodeId: string) => {
      e.stopPropagation();
      setNodeContextMenu(null);
      const multi = isModifierPoint(e);
      if (multi) {
        e.preventDefault();
        setEditingNodeId(null);
        setSelectedNodeIds((current) => {
          const exists = current.includes(nodeId);
          const next = exists ? current.filter((id) => id !== nodeId) : [...current, nodeId];
          setSelectedNodeId(next.at(-1) ?? null);
          return next;
        });
        return;
      }
      if (editingNodeId === nodeId || !isPrimaryPoint(e)) return;
      e.preventDefault();
      e.currentTarget.setPointerCapture?.(e.pointerId);
      setSelectedNodeId(nodeId);
      setSelectedNodeIds([nodeId]);
      const node = docRef.current.nodes.find((n) => n.id === nodeId);
      if (!node) return;
      const world = toWorld(e.clientX, e.clientY);
      dragStartSnapshotRef.current = docRef.current;
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

  const handleNodeContextMenu = useCallback(
    (e: React.MouseEvent, nodeId: string) => {
      e.preventDefault();
      e.stopPropagation();
      const selected = selectedIdSet.has(nodeId) ? selectedNodeIds : [nodeId];
      setSelectedNodeId(nodeId);
      setSelectedNodeIds(selected);
      const point = toContainerPoint(e.clientX, e.clientY);
      setNodeContextMenu({ x: point.x, y: point.y, nodeId });
    },
    [selectedIdSet, selectedNodeIds, toContainerPoint],
  );

  const confirmBatchDelete = useCallback(() => {
    const ids = nodeContextMenu
      ? selectedIdSet.has(nodeContextMenu.nodeId)
        ? selectedNodeIds
        : [nodeContextMenu.nodeId]
      : selectedNodeIds;
    if (ids.length === 0) return;
    const ok = window.confirm(
      ids.length > 1 ? `确认批量删除 ${ids.length} 张卡片？` : "确认删除该卡片？",
    );
    if (!ok) return;
    deleteNodes(ids);
  }, [deleteNodes, nodeContextMenu, selectedIdSet, selectedNodeIds]);

  const finishDragInteraction = useCallback(() => {
    // 拖拽结束：把起点快照压入撤销栈（若确有移动）
    if (dragState && dragStartSnapshotRef.current) {
      const start = dragStartSnapshotRef.current;
      dragStartSnapshotRef.current = null;
      if (start !== docRef.current) {
        undoStackRef.current = [...undoStackRef.current.slice(-(MAX_HISTORY - 1)), start];
        redoStackRef.current = [];
        setHistoryState({ canUndo: true, canRedo: false });
        setMoveCommittedTick((tick) => tick + 1);
      }
    }
    if (marqueeState) {
      const box = normalizeScreenRect(marqueeState);
      if (box.width > 4 && box.height > 4) {
        ignoreNextCanvasClickRef.current = true;
        const selected = docRef.current.nodes
          .filter((node) => {
            const a = toScreen(node.x, node.y);
            const b = toScreen(node.x + node.width, node.y + node.height);
            return rectsIntersect(box, {
              left: Math.min(a.x, b.x),
              top: Math.min(a.y, b.y),
              right: Math.max(a.x, b.x),
              bottom: Math.max(a.y, b.y),
            });
          })
          .map((node) => node.id);
        setSelectedNodeIds(selected);
        setSelectedNodeId(selected.at(-1) ?? null);
      }
    }
    document.body.style.userSelect = "";
    setDragState(null);
    setPanState(null);
    setMarqueeState(null);
  }, [dragState, marqueeState, toScreen]);

  useEffect(() => {
    if (!dragState && !panState && !marqueeState) return;
    const onMove = (event: PointerEvent) => {
      if (dragState) {
        const world = toWorld(event.clientX, event.clientY);
        updateNodePosition(
          dragState.nodeId,
          world.x - dragState.offsetX,
          world.y - dragState.offsetY,
        );
      } else if (panState) {
        setViewState((vs) => ({
          ...vs,
          panX: panState.startPanX + (event.clientX - panState.startClientX),
          panY: panState.startPanY + (event.clientY - panState.startClientY),
        }));
      } else if (marqueeState) {
        const rect = svgRef.current?.getBoundingClientRect();
        setMarqueeState((current) =>
          current && rect
            ? {
                ...current,
                currentX: event.clientX - rect.left,
                currentY: event.clientY - rect.top,
              }
            : current,
        );
      }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", finishDragInteraction);
    window.addEventListener("pointercancel", finishDragInteraction);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", finishDragInteraction);
      window.removeEventListener("pointercancel", finishDragInteraction);
    };
  }, [dragState, finishDragInteraction, marqueeState, panState, toWorld, updateNodePosition]);

  const handlePointerUp = useCallback(() => {
    finishDragInteraction();
  }, [finishDragInteraction]);

  const beginCanvasPan = useCallback(
    (e: React.PointerEvent) => {
      if (!isCanvasMarqueePoint(e) && !isCanvasPanPoint(e)) return;
      e.preventDefault();
      e.currentTarget.setPointerCapture?.(e.pointerId);
      setSelectedNodeId(null);
      setSelectedNodeIds([]);
      setEditingNodeId(null);
      setLinkSourceNodeId(null);
      setNodeContextMenu(null);
      document.body.style.userSelect = "none";
      if (isCanvasMarqueePoint(e)) {
        const rect = svgRef.current?.getBoundingClientRect();
        const startX = e.clientX - (rect?.left ?? 0);
        const startY = e.clientY - (rect?.top ?? 0);
        setMarqueeState({
          startX,
          startY,
          currentX: startX,
          currentY: startY,
        });
        return;
      }
      setPanState({
        startClientX: e.clientX,
        startClientY: e.clientY,
        startPanX: viewState.panX,
        startPanY: viewState.panY,
      });
    },
    [viewState.panX, viewState.panY],
  );

  // 空白背景按下：开始平移
  const handleBackgroundPointerDown = useCallback(
    (e: React.PointerEvent) => {
      beginCanvasPan(e);
    },
    [beginCanvasPan],
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

  // P0 保存串行化：同一时刻只允许一个保存请求在途；旧保存不会清除新改动产生的脏标记
  const handleSave = useCallback(async () => {
    const revisionAtStart = revisionRef.current;
    const snapshot = docRef.current;
    const run = async () => {
      await savePromiseRef.current;
      setSaveStatus("saving");
      try {
        const saved = await saveCanvasDocument(snapshot);
        onSave?.(saved);
        // 保存期间若又产生新改动（revision 前进），保留脏标记让下一轮自动保存继续
        if (revisionRef.current === revisionAtStart) {
          dirtyRef.current = false;
          setSaveStatus("saved");
          window.setTimeout(() => setSaveStatus("idle"), 1800);
        } else {
          setSaveStatus("idle");
        }
        trackCanvasEvent("canvas_shape_updated", { action: "save" });
      } catch {
        // 失败保持脏标记，状态置 error，等待下一次改动触发重试
        setSaveStatus("error");
      }
    };
    const promise = run();
    savePromiseRef.current = promise.catch(() => {});
    await promise;
  }, [onSave, trackCanvasEvent]);

  // P0 立即落盘：画布切换 / 手动保存前调用；无改动时为空转安全
  const flush = useCallback(async () => {
    if (!dirtyRef.current) return;
    await handleSave();
  }, [handleSave]);

  // 把 flush 暴露给父组件（切换画布前先保存当前画布）
  useEffect(() => {
    if (!flushRef) return;
    flushRef.current = flush;
    return () => {
      flushRef.current = null;
    };
  }, [flushRef, flush]);

  // 卸载兜底：跳过 React 状态更新，直接落盘最后一次脏文档
  useEffect(() => {
    return () => {
      if (!dirtyRef.current) return;
      const snapshot = docRef.current;
      void saveCanvasDocument(snapshot)
        .then((saved) => onSave?.(saved))
        .catch(() => {});
    };
  }, [onSave]);

  // P0 自动保存：用户改动后 debounce 800ms 触发一次保存
  useEffect(() => {
    if (loading || !dirtyRef.current) return;
    const timer = window.setTimeout(() => {
      void handleSave();
    }, 800);
    return () => window.clearTimeout(timer);
  }, [doc, loading, handleSave]);

  // ── 新手引导流程（ob-1）─────────────────────────────────────────────
  // 进入 demo 阶段时记录基线，用于识别用户是否完成了对应操作
  useEffect(() => {
    if (onboardingPhase !== "demo") return;
    demoBaselineRef.current = {
      panX: viewState.panX,
      panY: viewState.panY,
      scale: viewState.scale,
      nodeCount: doc.nodes.length,
    };
    setDemoStep("pan");
    setCompletedSteps([]);
  }, [onboardingPhase]); // eslint-disable-line react-hooks/exhaustive-deps

  const completeDemoStep = useCallback((step: DemoStepId) => {
    setCompletedSteps((prev) => (prev.includes(step) ? prev : [...prev, step]));
  }, []);

  // 已解锁步骤推进（ob-1）：完成上一步后自动解锁下一步
  useEffect(() => {
    if (onboardingPhase !== "demo") return;
    if (completedSteps.length === 0 || completedSteps.length >= DEMO_STEPS.length) return;
    const nextStep = DEMO_STEPS.find((step) => !completedSteps.includes(step.id));
    if (nextStep) setDemoStep(nextStep.id);
  }, [completedSteps, onboardingPhase]);

  // 自动演示（ob-1）：无需用户操作，每步停留数秒后自动推进（用户若抢先完成该步则直接跳入下一步）
  useEffect(() => {
    if (onboardingPhase !== "demo") return;
    if (completedSteps.length >= DEMO_STEPS.length) return;
    const timer = window.setTimeout(() => completeDemoStep(demoStep), 4000);
    return () => window.clearTimeout(timer);
  }, [onboardingPhase, demoStep, completedSteps, completeDemoStep]);

  // 全部步骤播完后，完成态停留片刻自动结束引导（用户可直接开始创作）
  useEffect(() => {
    if (onboardingPhase !== "demo") return;
    if (completedSteps.length < DEMO_STEPS.length) return;
    const timer = window.setTimeout(() => {
      markOnboardingDone();
      setOnboardingPhase("done");
    }, 3000);
    return () => window.clearTimeout(timer);
  }, [onboardingPhase, completedSteps]);

  // 步骤一：拖拽画布 / 步骤二：缩放视图（依据 viewState 变化检测）
  useEffect(() => {
    if (onboardingPhase !== "demo") return;
    const baseline = demoBaselineRef.current;
    if (!baseline) return;
    if (
      demoStep === "pan" &&
      baseline &&
      (Math.abs(viewState.panX - baseline.panX) > 8 || Math.abs(viewState.panY - baseline.panY) > 8)
    ) {
      completeDemoStep("pan");
    } else if (
      demoStep === "zoom" &&
      baseline &&
      Math.abs(viewState.scale - baseline.scale) > 0.01
    ) {
      completeDemoStep("zoom");
    }
  }, [viewState, demoStep, onboardingPhase, completeDemoStep]);

  // 步骤三：新建卡片（节点数增加）
  useEffect(() => {
    if (onboardingPhase !== "demo" || demoStep !== "create") return;
    const baseline = demoBaselineRef.current;
    if (baseline && doc.nodes.length > baseline.nodeCount) completeDemoStep("create");
  }, [doc.nodes, demoStep, onboardingPhase, completeDemoStep]);

  // 步骤四：移动卡片（拖拽松手提交即视为完成）
  useEffect(() => {
    if (onboardingPhase !== "demo" || demoStep !== "move" || moveCommittedTick === 0) return;
    completeDemoStep("move");
  }, [moveCommittedTick, demoStep, onboardingPhase, completeDemoStep]);

  const finishGuide = useCallback(() => {
    markOnboardingDone();
    setOnboardingPhase("done");
  }, []);

  const jumpMiniMapTo = useCallback(
    (clientX: number, clientY: number) => {
      const rect = svgRef.current?.getBoundingClientRect();
      if (!rect) return;
      const metrics = getMiniMapMetrics(miniMapState, canvasBounds);
      const mapLeft = miniMapState.left + metrics.ox;
      const mapTop = miniMapState.top + metrics.oy;
      const worldX = (clientX - rect.left - mapLeft) / metrics.scale + canvasBounds.minX;
      const worldY = (clientY - rect.top - mapTop) / metrics.scale + canvasBounds.minY;
      setViewState((vs) => ({
        ...vs,
        panX: rect.width / 2 - worldX * vs.scale,
        panY: rect.height / 2 - worldY * vs.scale,
      }));
    },
    [canvasBounds, miniMapState],
  );

  const beginMiniMapViewportDrag = useCallback((event: React.PointerEvent, mapScale: number) => {
    stopCanvasEvent(event);
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setMiniMapDrag({
      kind: "viewport",
      startClientX: event.clientX,
      startClientY: event.clientY,
      startPanX: viewStateRef.current.panX,
      startPanY: viewStateRef.current.panY,
      mapScale,
    });
  }, []);

  const createAgentStepNode = useCallback(
    (payload: AgentStepDropPayload, world: { x: number; y: number }) => {
      const defaults = NODE_DEFAULTS.task;
      const label = payload.tool ?? payload.kind ?? "Agent 步骤";
      const inputText =
        payload.input && Object.keys(payload.input).length > 0
          ? `\n${JSON.stringify(payload.input)}`
          : "";
      const node: CanvasNode = {
        id: generateId(),
        type: "task",
        x: world.x - defaults.width / 2,
        y: world.y - defaults.height / 2,
        width: defaults.width,
        height: defaults.height,
        text: `${label}\n${payload.goal}${inputText}`,
        source: "agent",
        agentTaskId: payload.taskId,
        agentStepId: payload.stepId,
        agentStepStatus: payload.status ?? "Pending",
        agentStepKind: payload.kind,
        agentTool: payload.tool ?? null,
      };
      commitDoc((prev) => ({ ...prev, nodes: [...prev.nodes, node] }));
      setSelectedNodeId(node.id);
      setSelectedNodeIds([node.id]);
      trackCanvasEvent("canvas_shape_added", {
        nodeId: node.id,
        type: node.type,
        source: "agent_task_step",
        taskId: payload.taskId,
        stepId: payload.stepId,
      });
    },
    [commitDoc, trackCanvasEvent],
  );

  const handleCanvasDrop = useCallback(
    (e: React.DragEvent<SVGSVGElement>) => {
      const payload = parseAgentStepPayload(e.dataTransfer);
      if (!payload) return;
      e.preventDefault();
      createAgentStepNode(payload, toWorld(e.clientX, e.clientY));
    },
    [createAgentStepNode, toWorld],
  );

  const handleAskAi = useCallback((prompt: string, autoSend = false) => {
    dispatchAiRequest({ prompt, autoSend });
  }, []);

  /** 应用场景模板（ob-2）：空画布直接采用，非空画布追加到右侧 */
  const applyTemplate = useCallback(
    (templateId: string) => {
      const template = getTemplateById(templateId);
      if (!template) return;
      commitDoc((prev) => {
        if (prev.nodes.length === 0) {
          return {
            ...prev,
            nodes: [...template.document.nodes],
            edges: [...template.document.edges],
          };
        }
        const maxX = prev.nodes.reduce((m, n) => Math.max(m, n.x + n.width), 0);
        const offset = maxX + 320;
        const nodeIdMap = new Map<string, string>();
        const shifted = template.document.nodes.map((node) => {
          const newNodeId = generateId();
          nodeIdMap.set(node.id, newNodeId);
          return { ...node, id: newNodeId, x: node.x + offset, y: node.y + 40 };
        });
        const edges = template.document.edges
          .map((e) => ({
            id: generateId(),
            fromNodeId: nodeIdMap.get(e.fromNodeId) ?? e.fromNodeId,
            toNodeId: nodeIdMap.get(e.toNodeId) ?? e.toNodeId,
            style: e.style,
          }))
          .filter((e) => e.fromNodeId !== e.toNodeId);
        return { ...prev, nodes: [...prev.nodes, ...shifted], edges: [...prev.edges, ...edges] };
      });
      trackCanvasEvent("canvas_template_applied", { templateId });
      markOnboardingDone();
      setOnboardingPhase("done");
    },
    [commitDoc, trackCanvasEvent],
  );

  // ── AI 结构化操作按钮 → 画布执行（ai-3 命令桥）───────────────────────
  useEffect(() => {
    return onCanvasCommand((command) => {
      const vs = viewStateRef.current;
      const rect = svgRef.current?.getBoundingClientRect();
      const centerX = rect ? (-vs.panX + rect.width / 2) / vs.scale : 200;
      const centerY = rect ? (-vs.panY + rect.height / 2) / vs.scale : 200;

      switch (command.kind) {
        case "createCards": {
          const W = NODE_DEFAULTS.card.width;
          const H = NODE_DEFAULTS.card.height;
          const gap = 40;
          const count = command.count;
          // 网格列数：按可视宽度自适应，单批最多 4 列，避免网格超出画布可视区
          const viewW =
            (svgRef.current?.getBoundingClientRect().width ?? 1200) / viewStateRef.current.scale;
          const maxCols = Math.max(1, Math.floor((viewW - gap) / (W + gap)));
          const cols = Math.min(count, Math.max(1, Math.min(maxCols, 4)));
          const gridW = cols * W + (cols - 1) * gap;

          // 自动错位：新一批卡片优先放到已有内容右侧，右侧放不下则放到下方，避免覆盖旧卡片
          const prevNodes = docRef.current.nodes;
          let originX = centerX - gridW / 2;
          let originY = centerY - 80;
          if (prevNodes.length > 0) {
            const minX = Math.min(...prevNodes.map((n) => n.x));
            const maxX = Math.max(...prevNodes.map((n) => n.x + n.width));
            const minY = Math.min(...prevNodes.map((n) => n.y));
            const maxY = Math.max(...prevNodes.map((n) => n.y + n.height));
            if (maxX + gap + gridW <= centerX + viewW / 2) {
              originX = maxX + gap;
              originY = minY;
            } else {
              originX = Math.min(minX, centerX - gridW / 2);
              originY = maxY + gap;
            }
          }

          const nodes: CanvasNode[] = Array.from({ length: count }, (_, i) => {
            const col = i % cols;
            const row = Math.floor(i / cols);
            return {
              id: generateId(),
              type: "card",
              x: originX + col * (W + gap),
              y: originY + row * (H + gap),
              width: W,
              height: H,
              text: command.label || "新卡片",
            };
          });
          commitDoc((prev) => ({ ...prev, nodes: [...prev.nodes, ...nodes] }));
          trackCanvasEvent("canvas_shape_added", { type: "card", count, source: "agent" });
          break;
        }
        case "createNode":
          addNode(command.type, command.text);
          break;
        case "addZone": {
          const zoneNode: CanvasNode = {
            id: generateId(),
            type: "text",
            x: centerX - 260,
            y: centerY - 240,
            width: 520,
            height: 56,
            text: `◆ ${command.label}`,
            source: "zone",
            zIndex: -1,
          };
          commitDoc((prev) => ({ ...prev, nodes: [...prev.nodes, zoneNode] }));
          trackCanvasEvent("canvas_shape_added", {
            type: "zone",
            label: command.label,
            source: "agent",
          });
          break;
        }
        case "applyPlan": {
          commitDoc((prev) => {
            const existing = new Set(
              prev.nodes.filter((n) => n.source === "plan").map((n) => n.text),
            );
            const laneX = 1600;
            let laneY = 200;
            const markers = command.markers
              .map((marker) => {
                const node: CanvasNode = {
                  id: generateId(),
                  type: "text",
                  x: laneX,
                  y: laneY,
                  width: 220,
                  height: 56,
                  text: `▫ ${marker.label}`,
                  source: "plan",
                  zIndex: -1,
                };
                laneY += 96;
                return node;
              })
              .filter((marker) => !existing.has(marker.text));
            if (markers.length === 0) return prev;
            return { ...prev, nodes: [...prev.nodes, ...markers] };
          });
          break;
        }
        case "selectNode": {
          const node = docRef.current.nodes.find((n) => n.id === command.nodeId);
          if (!node || !rect) break;
          setSelectedNodeId(node.id);
          setViewState((vs) => ({
            ...vs,
            panX: vs.panX - (node.x * vs.scale + vs.panX - rect.width / 2),
            panY: vs.panY - (node.y * vs.scale + vs.panY - rect.height / 2),
          }));
          break;
        }
        case "panTo":
          setViewState((vs) => ({
            ...vs,
            panX: (rect ? rect.width / 2 : 320) - command.x * vs.scale,
            panY: (rect ? rect.height / 2 : 240) - command.y * vs.scale,
          }));
          break;
        case "zoomTo":
          setViewState((vs) => ({ ...vs, scale: command.scale }));
          break;
        case "runTutorial":
          setTemplatesDismissed(false);
          setCompletedSteps([]);
          setDemoStep("pan");
          markOnboardingSeen();
          setOnboardingPhase("demo");
          break;
        case "generateArchitecture":
          void handleArchitectureRequest(command.intent, command.nodeIds);
          break;
      }
    });
  }, [commitDoc, addNode, handleArchitectureRequest, trackCanvasEvent]);

  // ── 画布内容快照广播（AI 上下文模块 ④ 读取）────────────────────────
  useEffect(() => {
    if (loading) return;
    const timer = window.setTimeout(() => {
      dispatchCanvasSnapshot({
        documentId,
        nodes: doc.nodes.map((n) => ({ id: n.id, type: n.type, text: n.text })),
        updatedAt: Date.now(),
      });
    }, 500);
    return () => window.clearTimeout(timer);
  }, [doc, loading, documentId]);

  useEffect(() => {
    return onCanvasSnapshotRequest(() => {
      dispatchCanvasSnapshot({
        documentId,
        nodes: docRef.current.nodes.map((n) => ({ id: n.id, type: n.type, text: n.text })),
        updatedAt: Date.now(),
      });
    });
  }, [documentId]);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    onAgentTask((task) => {
      if (disposed) return;
      const stepStatus = new Map(task.plan.map((step) => [step.stepId, step.status]));
      const hasBoundNodes = docRef.current.nodes.some(
        (node) => node.agentTaskId === task.taskId && node.agentStepId,
      );
      if (!hasBoundNodes) return;
      commitDoc((prev) => ({
        ...prev,
        nodes: prev.nodes.map((node) => {
          if (node.agentTaskId !== task.taskId || !node.agentStepId) return node;
          const status = stepStatus.get(node.agentStepId);
          return status ? { ...node, agentStepStatus: status } : node;
        }),
      }));
    }).then((fn) => {
      unlisten = fn;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [commitDoc]);

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

  // 底部任务面板是否打开：面板统一排进底部 Dock 互不遮挡；打开时提问条停靠右下
  const panelsOpen = Boolean(enhanceGoal || writeupGoal || chapterGoal || groupTaskGoal);
  const archivePanelOpen = !archiveDismissed && !noteTreeOpen && archiveSuggestions.length > 0;
  const rightRailOpen = Boolean(composerOpen || nodeMetaPanelId || agent.discussion);
  const onboardingOpen = onboardingPhase === "intro" || onboardingPhase === "demo";
  const quickHelpVisible =
    !panelsOpen &&
    !onboardingOpen &&
    !noteTreeOpen &&
    !archivePanelOpen &&
    !composerOpen &&
    !nodeMetaPanelId &&
    !agent.discussion &&
    agent.connections.length === 0 &&
    !agent.gap;

  return (
    <div className="canvas-home-surface flex h-full min-h-0 flex-1 flex-col relative overflow-hidden select-none">
      {/* 工具栏：flex-wrap 允许窄窗口换行而非溢出裁切；z-20 避免被右上操作条压盖 */}
      <div className="canvas-toolbar-pro absolute top-4 left-4 z-20 flex flex-wrap items-center gap-2">
        {toolbarLeading}
        <button
          type="button"
          onClick={() => addNode("knowledge")}
          className="canvas-control-button canvas-button-secondary"
          title={t("canvas.addKnowledgeTip", { defaultValue: "AI 检索提炼的知识卡（带来源）" })}
        >
          <CardIcon />
          {t("canvas.addKnowledge", { defaultValue: "知识" })}
        </button>
        <button
          type="button"
          onClick={() => addNode("idea")}
          className="canvas-control-button canvas-button-secondary"
        >
          <PlusTextIcon />
          {t("canvas.addIdea", { defaultValue: "想法" })}
        </button>
        <button
          type="button"
          onClick={() => addNode("opinion")}
          className="canvas-control-button canvas-button-secondary"
        >
          <OpinionIcon />
          {t("canvas.addOpinion", { defaultValue: "观点" })}
        </button>
        <button
          type="button"
          onClick={() => addNode("resource")}
          className="canvas-control-button canvas-button-secondary"
        >
          <ResourceIcon />
          {t("canvas.addResource", { defaultValue: "来源" })}
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
          onClick={() => addNode("question")}
          className="canvas-control-button canvas-button-secondary"
        >
          <QuestionIcon />
          {t("canvas.addQuestion", { defaultValue: "问题" })}
        </button>
        <button
          type="button"
          onClick={() => setNoteTreeOpen((v) => !v)}
          className={`canvas-control-button ${
            noteTreeOpen ? "canvas-button-ai" : "canvas-button-secondary"
          }`}
          title={t("canvas.noteTreeTip", {
            defaultValue: "笔记工作树：挂载多篇笔记到当前画布",
          })}
        >
          <NoteTreeIcon />
          {t("canvas.notes", { defaultValue: "笔记" })}
        </button>
        <button
          type="button"
          onClick={() => setComposerOpen((v) => !v)}
          className={`canvas-control-button ${
            composerOpen ? "canvas-button-ai" : "canvas-button-secondary"
          }`}
          title={t("canvas.composerTip", {
            defaultValue: "发布编排：文案/素材/整编/总结/绘图，组合社交作品",
          })}
        >
          <span className="text-[13px] leading-none">✎</span>
          {t("canvas.publish", { defaultValue: "发布" })}
        </button>
        <button
          type="button"
          onClick={createGroupFromSelection}
          disabled={selectedNodeIds.length === 0}
          className="canvas-control-button canvas-button-secondary"
          title={t("canvas.createGroupTip", {
            defaultValue: "把选中的卡片收进一个新分组（泳道）",
          })}
        >
          <GroupIcon />
          {t("canvas.createGroup", { defaultValue: "分组" })}
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
            <button
              type="button"
              onClick={() => setArchitectureOpen(true)}
              disabled={architectureLoading || doc.nodes.length === 0}
              className="canvas-control-button canvas-button-ai"
              title="基于当前画布或选中节点生成架构图"
            >
              <SparkIcon />
              AI 架构
            </button>
            <button
              type="button"
              onClick={handleAiGroup}
              disabled={doc.nodes.length < 3}
              className="canvas-control-button canvas-button-ai"
              title={t("canvas.aiGroupTip", {
                defaultValue: "让 Agent 按语义把画布卡片自动分成泳道（确认后写回）",
              })}
            >
              <GroupIcon />
              {t("canvas.aiGroup", { defaultValue: "AI 分组" })}
            </button>
          </>
        )}
      </div>

      {selectedNodeId && (
        <div className="absolute top-4 right-4 z-10 flex items-center gap-2">
          {selectedNodeIds.length > 1 && (
            <span className="rounded-full border border-bamboo/25 bg-bamboo-mist/80 px-2.5 py-1 text-[11px] font-medium text-bamboo">
              已选 {selectedNodeIds.length} 张
            </span>
          )}
          {agentEnabled && providers.length > 0 && selectedNodeIds.length <= 1 && (
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
          {agentEnabled && providers.length > 0 && selectedNodeIds.length >= 2 && (
            <button
              type="button"
              onClick={() => setWriteupOpen(true)}
              className="canvas-control-button canvas-button-ai"
              title={t("canvas.writeupTip", {
                defaultValue: "把选中的卡片整理成一篇文章（预览确认后落为笔记）",
              })}
            >
              <SparkIcon />
              {t("canvas.writeup", { defaultValue: "整理成文" })}
            </button>
          )}
          {selectedNodeIds.length <= 1 && (
            <button
              type="button"
              onClick={() => {
                setNodeMetaPanelId((prev) => (prev === selectedNodeId ? null : selectedNodeId));
                const node = doc.nodes.find((n) => n.id === selectedNodeId);
                setTagDraft((node?.tags ?? []).join("，"));
              }}
              className="canvas-control-button canvas-button-secondary"
              title={t("canvas.nodeMetaTip", {
                defaultValue: "编辑卡片属性（任务截止 / 颜色标签 / 绑定笔记）",
              })}
            >
              <SlidersIcon />
              {t("canvas.nodeMeta", { defaultValue: "属性" })}
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
            onClick={() =>
              deleteNodes(selectedNodeIds.length > 1 ? selectedNodeIds : [selectedNodeId])
            }
            className="canvas-control-button canvas-button-danger"
          >
            {t("common.delete", { defaultValue: "删除" })}
          </button>
        </div>
      )}

      {/* 底部任务面板 Dock：所有任务面板统一排布在一行，互不遮挡；
          面板过多时横向滚动（右侧预留提问条停靠位，避免 UI 叠在一起） */}
      {panelsOpen && (
        <div className="absolute bottom-4 left-4 right-[460px] z-30 flex items-end gap-3 overflow-x-auto pb-1">
          {enhanceGoal && (
            <div className="w-[320px] shrink-0">
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
              <TaskProgressPanel key={enhanceVersion} goal={enhanceGoal} providers={providers} />
            </div>
          )}

          {writeupGoal && (
            <div className="w-[360px] shrink-0">
              <div className="flex items-center justify-between mb-1.5">
                <span className="canvas-panel-title">
                  {t("canvas.writeupPanel", { defaultValue: "组卡成文" })}
                </span>
                <button
                  type="button"
                  onClick={() => setWriteupGoal(null)}
                  className="canvas-icon-button canvas-button-ghost"
                  aria-label={t("common.close", { defaultValue: "关闭" })}
                >
                  <CloseIcon />
                </button>
              </div>
              <TaskProgressPanel
                key={writeupVersion}
                goal={writeupGoal}
                providers={providers}
                onContinueChapter={handleContinueChapter}
              />
            </div>
          )}

          {/* 章节续写面板：成文落盘后接着写下一章 */}
          {chapterGoal && (
            <div className="w-[320px] shrink-0">
              <div className="flex items-center justify-between mb-1.5">
                <span className="canvas-panel-title">
                  {t("canvas.chapterPanel", { defaultValue: "章节续写" })}
                </span>
                <button
                  type="button"
                  onClick={() => setChapterGoal(null)}
                  className="canvas-icon-button canvas-button-ghost"
                  aria-label={t("common.close", { defaultValue: "关闭" })}
                >
                  <CloseIcon />
                </button>
              </div>
              <TaskProgressPanel key={chapterVersion} goal={chapterGoal} providers={providers} />
            </div>
          )}

          {/* AI 自动分组面板：按语义把画布卡片分成泳道 */}
          {groupTaskGoal && (
            <div className="w-[320px] shrink-0">
              <div className="flex items-center justify-between mb-1.5">
                <span className="canvas-panel-title">
                  {t("canvas.aiGroupPanel", { defaultValue: "AI 自动分组" })}
                </span>
                <button
                  type="button"
                  onClick={() => setGroupTaskGoal(null)}
                  className="canvas-icon-button canvas-button-ghost"
                  aria-label={t("common.close", { defaultValue: "关闭" })}
                >
                  <CloseIcon />
                </button>
              </div>
              <TaskProgressPanel key={groupTaskVersion} goal={groupTaskGoal} providers={providers} />
            </div>
          )}
        </div>
      )}

      {/* 连线关系类型选择：点目标后选择关系才建边（连线从装饰变成关系数据） */}
      {pendingEdge && (
        <div
          className="absolute z-50 min-w-[130px] rounded-xl border border-paper-deep/30 bg-paper/95 p-1.5 text-[12px] text-ink-soft shadow-xl backdrop-blur"
          style={{
            left: Math.min(
              pendingEdge.x,
              (svgRef.current?.clientWidth ?? window.innerWidth) - 150,
            ),
            top: Math.min(
              pendingEdge.y,
              (svgRef.current?.clientHeight ?? window.innerHeight) - 220,
            ),
          }}
          onMouseDown={(event) => event.stopPropagation()}
          onContextMenu={(event) => event.preventDefault()}
        >
          <div className="px-2 py-1 text-[10px] text-ink-ghost">
            {t("canvas.edgeRelation", { defaultValue: "这条连线表示" })}
          </div>
          {CANVAS_RELATION_TYPES.map((rel) => (
            <button
              key={rel.value}
              type="button"
              onClick={() => {
                createEdge(pendingEdge.from, pendingEdge.to, "solid", rel.value);
                setPendingEdge(null);
              }}
              className="flex w-full items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-left hover:bg-paper-warm/60 cursor-pointer"
            >
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-bamboo/70" />
              {rel.label}
            </button>
          ))}
          <div className="my-1 border-t border-paper-deep/15" />
          <button
            type="button"
            onClick={() => setPendingEdge(null)}
            className="w-full rounded-lg px-2.5 py-1.5 text-left text-ink-ghost hover:bg-paper-warm/60 cursor-pointer"
          >
            {t("common.cancel", { defaultValue: "取消" })}
          </button>
        </div>
      )}

      {/* P0-3：Live2D 成文提议横幅（花灵气泡同步由信号队列驱动；置于底部提问条上方） */}
      {architectureOpen && (
        <div className="absolute inset-0 z-50 grid place-items-center bg-ink/10 p-6 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-paper-deep/25 bg-paper p-4 shadow-2xl">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-ink">AI 架构</h2>
              <button type="button" onClick={() => setArchitectureOpen(false)} className="text-xs text-ink-ghost">关闭</button>
            </div>
            {!architecturePatch ? (
              <>
                <p className="mt-2 text-xs text-ink-ghost">{selectedNodeIds.length > 0 ? `将使用已选 ${selectedNodeIds.length} 张卡片` : "将使用整张画布"} 作为上下文。</p>
                <textarea value={architectureIntent} onChange={(event) => setArchitectureIntent(event.target.value)} placeholder="例如：生成订单系统的生产架构" rows={3} className="mt-3 w-full rounded-xl border border-paper-deep/20 bg-paper-warm/30 p-2 text-xs text-ink outline-none" />
                {architectureError && <p className="mt-2 text-xs text-coral">{architectureError}</p>}
                <button type="button" onClick={() => void handleArchitectureRequest()} disabled={architectureLoading} className="mt-3 w-full rounded-xl bg-ink-soft px-3 py-2 text-xs font-medium text-paper">
                  {architectureLoading ? "生成中…" : "生成预览"}
                </button>
              </>
            ) : (
              <>
                <p className="mt-3 text-xs text-ink-soft">{architecturePatch.nodesToAdd.length} 个节点 · {architecturePatch.edgesToAdd.length} 条连线 · {architecturePatch.groupsToAdd.length} 个分组</p>
                <ul className="mt-2 max-h-32 space-y-1 overflow-auto text-xs text-ink-ghost">{architecturePatch.nodesToAdd.map((node) => <li key={node.id}>· {node.text.split("\\n")[0]}</li>)}</ul>
                <div className="mt-3 flex gap-2"><button type="button" onClick={() => setArchitecturePatch(null)} className="flex-1 rounded-xl border border-paper-deep/20 px-3 py-2 text-xs text-ink-ghost">取消</button><button type="button" onClick={handleArchitectureApply} className="flex-1 rounded-xl bg-bamboo px-3 py-2 text-xs font-medium text-paper">确认应用</button></div>
              </>
            )}
          </div>
        </div>
      )}

      {showWriteupProposal && (
        <div className="absolute bottom-20 left-1/2 z-30 flex -translate-x-1/2 items-center gap-3 rounded-2xl border border-bamboo/30 bg-paper/95 px-4 py-2.5 shadow-[0_16px_48px_-16px_rgba(0,0,0,0.4)] backdrop-blur">
          <span className="text-[12px] text-ink-soft">
            {t("canvas.writeupPropose", {
              defaultValue: "花灵：这几张卡片够成一篇文章了，要整理成文吗？",
            })}
          </span>
          <button
            type="button"
            onClick={() => setWriteupOpen(true)}
            className="rounded-lg bg-bamboo px-3 py-1 text-[11px] font-medium text-paper hover:bg-bamboo/90 cursor-pointer"
          >
            {t("canvas.writeup", { defaultValue: "整理成文" })}
          </button>
          <button
            type="button"
            onClick={() => setWriteupProposalDismissed(true)}
            className="rounded-lg px-2 py-1 text-[10px] text-ink-ghost hover:text-ink cursor-pointer"
          >
            {t("common.ignore", { defaultValue: "忽略" })}
          </button>
        </div>
      )}

      <WriteupDialog
        open={writeupOpen}
        nodeIds={selectedNodeIds}
        onClose={() => setWriteupOpen(false)}
        onStart={handleWriteupStart}
      />

      {/* 节点属性面板：按类型编辑专属元数据 */}
      {nodeMetaPanelId &&
        (() => {
          const metaNode = doc.nodes.find((n) => n.id === nodeMetaPanelId) ?? null;
          if (!metaNode) return null;
          const nodeFields = metaNode.fields ?? {};
          // 字段定义（类型化卡片表单：解决"双击空白不知打什么"）
          const fieldDefs = NODE_FIELD_DEFS[metaNode.type] ?? [];
          const patchField = (key: string, value: string) => {
            const current = docRef.current.nodes.find((n) => n.id === metaNode.id)?.fields ?? {};
            patchNode(metaNode.id, { fields: { ...current, [key]: value } });
          };
          return (
            <div className="absolute right-4 top-20 z-40 w-[260px] rounded-2xl border border-paper-deep/25 bg-paper/95 p-3 shadow-[0_16px_48px_-16px_rgba(0,0,0,0.4)] backdrop-blur">
              <div className="flex items-center justify-between mb-2">
                <select
                  value={metaNode.type}
                  onChange={(e) =>
                    patchNode(metaNode.id, { type: e.target.value as CanvasNodeType })
                  }
                  className="h-6 rounded-md border border-paper-deep/25 bg-paper px-1.5 text-[11px] font-medium text-ink outline-none cursor-pointer"
                >
                  {NODE_TYPE_LABELS.map((entry) => (
                    <option key={entry.value} value={entry.value}>
                      {entry.label}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => setNodeMetaPanelId(null)}
                  className="canvas-icon-button canvas-button-ghost"
                  aria-label={t("common.close", { defaultValue: "关闭" })}
                >
                  <CloseIcon />
                </button>
              </div>

              {/* 正文 */}
              <textarea
                value={metaNode.text}
                onChange={(e) => updateNodeText(metaNode.id, e.target.value)}
                rows={3}
                placeholder={
                  metaNode.type === "knowledge"
                    ? "这条知识的核心内容…"
                    : metaNode.type === "opinion"
                      ? "谁持有什么观点…"
                      : metaNode.type === "question"
                        ? "你想探索的问题…"
                        : metaNode.type === "idea"
                          ? "你的想法…"
                          : metaNode.type === "resource"
                            ? "这个来源的价值说明…"
                            : "待办内容…"
                }
                className="w-full resize-y rounded-lg border border-paper-deep/20 bg-paper px-2 py-1.5 text-[12px] text-ink leading-relaxed outline-none placeholder:text-ink-ghost/45 focus:border-ink-ghost/40"
              />

              {/* 类型化字段 */}
              {fieldDefs.length > 0 && (
                <div className="mt-2 space-y-1.5">
                  {fieldDefs.map((def) => (
                    <label key={def.key} className="block text-[11px] text-ink-ghost">
                      {def.label}
                      {def.options ? (
                        <select
                          value={nodeFields[def.key] ?? ""}
                          onChange={(e) => patchField(def.key, e.target.value)}
                          className="mt-0.5 w-full rounded-lg border border-paper-deep/20 bg-paper px-2 py-1 text-[11px] text-ink outline-none cursor-pointer"
                        >
                          <option value="">（未设置）</option>
                          {def.options.map((opt) => (
                            <option key={opt} value={opt}>
                              {opt}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          value={nodeFields[def.key] ?? ""}
                          onChange={(e) => patchField(def.key, e.target.value)}
                          className="mt-0.5 w-full rounded-lg border border-paper-deep/20 bg-paper px-2 py-1 text-[11px] text-ink outline-none focus:border-ink-ghost/40"
                        />
                      )}
                    </label>
                  ))}
                </div>
              )}

              {/* task：完成 + 截止 */}
              {metaNode.type === "task" && (
                <>
                  <label className="mt-2 flex items-center gap-2 text-[11px] text-ink-ghost">
                    <input
                      type="checkbox"
                      checked={Boolean(metaNode.done)}
                      onChange={(e) => patchNode(metaNode.id, { done: e.target.checked })}
                      className="accent-bamboo"
                    />
                    {t("canvas.taskDone", { defaultValue: "已完成" })}
                  </label>
                  <label className="mt-1 block text-[11px] text-ink-ghost">
                    {t("canvas.dueDate", { defaultValue: "截止日期" })}
                    <input
                      type="date"
                      value={metaNode.dueDate ?? ""}
                      onChange={(e) => patchNode(metaNode.id, { dueDate: e.target.value || null })}
                      className="mt-0.5 w-full rounded-lg border border-paper-deep/20 bg-paper px-2 py-1 text-[11px] text-ink outline-none focus:border-ink-ghost/40"
                    />
                  </label>
                </>
              )}

              {/* resource：绑定笔记 */}
              {metaNode.type === "resource" && (
                <label className="mt-2 block text-[11px] text-ink-ghost">
                  {t("canvas.linkNote", { defaultValue: "关联笔记" })}
                  <select
                    value={metaNode.noteId ?? ""}
                    onChange={(e) => patchNode(metaNode.id, { noteId: e.target.value || null })}
                    className="mt-0.5 w-full rounded-lg border border-paper-deep/20 bg-paper px-2 py-1 text-[11px] text-ink outline-none cursor-pointer"
                  >
                    <option value="">{t("canvas.linkNoteNone", { defaultValue: "（未关联）" })}</option>
                    {noteOptions.map((note) => (
                      <option key={note.id} value={note.id}>
                        {note.title}
                      </option>
                    ))}
                  </select>
                </label>
              )}

              {/* 通用：颜色 + 标签 */}
              <div className="mt-2 flex flex-wrap gap-1">
                {NODE_COLORS.map((color) => (
                  <button
                    key={color}
                    type="button"
                    onClick={() =>
                      patchNode(metaNode.id, {
                        color: metaNode.color === color ? null : color,
                      })
                    }
                    className={`h-4 w-4 rounded-full border transition-transform cursor-pointer ${
                      metaNode.color === color
                        ? "scale-110 border-ink"
                        : "border-paper-deep/40 hover:scale-110"
                    }`}
                    style={{ backgroundColor: color }}
                    aria-label={color}
                  />
                ))}
              </div>
              <input
                value={tagDraft}
                onChange={(e) => setTagDraft(e.target.value)}
                onBlur={() =>
                  patchNode(metaNode.id, {
                    tags: tagDraft
                      .split(/[,，]/)
                      .map((s) => s.trim())
                      .filter(Boolean),
                  })
                }
                placeholder={t("canvas.tagsPlaceholder2", {
                  defaultValue: "标签（逗号分隔）",
                })}
                className="mt-1.5 w-full rounded-lg border border-paper-deep/20 bg-paper px-2 py-1 text-[11px] text-ink outline-none placeholder:text-ink-ghost/50 focus:border-ink-ghost/40"
              />

              {metaNode.type === "resource" && metaNode.noteId && (
                <button
                  type="button"
                  onClick={() => openResourceNote(metaNode.id)}
                  className="mt-2 w-full rounded-lg bg-ink-soft px-3 py-1.5 text-[11px] font-medium text-paper hover:opacity-90 cursor-pointer"
                >
                  {t("canvas.openNote", { defaultValue: "打开笔记" })} ↗
                </button>
              )}
            </div>
          );
        })()}

      {saveStatus !== "idle" && saveStatus !== "saving" && (
        <div
          className={`absolute z-20 px-3 py-1.5 rounded-full bg-paper/90 border border-paper-deep/30 text-[10px] text-ink-faint shadow-sm ${
            panelsOpen ? "bottom-[74px] right-4" : "bottom-4 right-4"
          }`}
        >
          {saveStatus === "saved"
            ? t("canvas.saveDone", { defaultValue: "画布已保存" })
            : t("canvas.saveFailed", { defaultValue: "保存失败，请稍后重试" })}
        </div>
      )}

      {noteTreeOpen && (
        <div className="canvas-floating-panel absolute top-16 left-4 bottom-4 z-10 w-[248px] p-3 flex flex-col min-h-0">
          <NoteTreePanel
            mountedIds={doc.noteIds ?? []}
            onToggle={toggleNoteMount}
            onSelectNote={(note) => {
              setNoteTreeOpen(false);
              dispatchOpenNote(note.id);
            }}
            onVisualize={(note) => {
              setNoteTreeOpen(false);
              void visualizeNoteToCanvas(note.id);
            }}
          />
        </div>
      )}

      {composerOpen && (
        <SocialComposerPanel materials={selectedTexts} onClose={() => setComposerOpen(false)} />
      )}

      {archivePanelOpen && (
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
                <div className="canvas-panel-muted line-clamp-2 mt-0.5">{suggestion.reason}</div>
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
              {t("canvas.similarity", { defaultValue: "相似度" })} {(c.similarity * 100).toFixed(0)}
              %
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
      {agent.gap &&
        (() => {
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
      {!composerOpen && agent.discussion && (
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

      <div className="canvas-viewport min-h-0 flex-1 w-full overflow-hidden">
        <svg
          ref={svgRef}
          className="block h-full min-h-0 w-full touch-none cursor-default"
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onPointerDown={(event) => {
          if (event.target === event.currentTarget) beginCanvasPan(event);
        }}
        onDragOver={(event) => {
          if (event.dataTransfer.types.includes(AGENT_STEP_DRAG_TYPE)) event.preventDefault();
        }}
        onDrop={handleCanvasDrop}
        onClick={() => {
          if (ignoreNextCanvasClickRef.current) {
            ignoreNextCanvasClickRef.current = false;
            return;
          }
          setSelectedNodeId(null);
          setSelectedNodeIds([]);
          setEditingNodeId(null);
          setLinkSourceNodeId(null);
          setNodeContextMenu(null);
          setPendingEdge(null);
          setNodeMetaPanelId(null);
        }}
      >
        {/* 固定事件层：整屏透明，点击空白开始平移 */}
        <rect
          width="100%"
          height="100%"
          fill="transparent"
          data-testid="canvas-bg"
          onPointerDown={handleBackgroundPointerDown}
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
          <rect
            x={-5000}
            y={-5000}
            width={10000}
            height={10000}
            fill="url(#grid)"
            pointerEvents="none"
          />
        </g>

        {/* 内容层：连线/建议/节点随缩放平移变换 */}
        <g transform={`translate(${viewState.panX}, ${viewState.panY}) scale(${viewState.scale})`}>
          {/* 连线 */}
          {doc.edges.map((edge) => {
            const from = doc.nodes.find((n) => n.id === edge.fromNodeId);
            const to = doc.nodes.find((n) => n.id === edge.toNodeId);
            if (!from || !to) return null;
            const relationLabel =
              CANVAS_RELATION_TYPES.find((r) => r.value === edge.relationType)?.label ??
              (edge.label || edge.relationType || "");
            const midX = (from.x + from.width / 2 + to.x + to.width / 2) / 2;
            const midY = (from.y + from.height / 2 + to.y + to.height / 2) / 2;
            return (
              <g key={edge.id}>
                <line
                  x1={from.x + from.width / 2}
                  y1={from.y + from.height / 2}
                  x2={to.x + to.width / 2}
                  y2={to.y + to.height / 2}
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeDasharray={edge.style === "dashed" ? "6 4" : undefined}
                  className="canvas-edge-line"
                />
                {relationLabel && (
                  <text
                    x={midX}
                    y={midY - 4}
                    textAnchor="middle"
                    fontSize="9"
                    className="canvas-edge-label"
                    pointerEvents="none"
                  >
                    {relationLabel}
                  </text>
                )}
              </g>
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

          {/* 分组/泳道：背景泳道 + 标题 + 折叠（点在泳道上会透传到下层，标题可点击折叠） */}
          {(doc.groups ?? []).map((group) => {
            const memberNodes = doc.nodes.filter(
              (n) => n.group === group.id || group.nodeIds.includes(n.id),
            );
            if (memberNodes.length === 0) return null;
            const minX = Math.min(...memberNodes.map((n) => n.x)) - 16;
            const minY = Math.min(...memberNodes.map((n) => n.y)) - 34;
            const maxX = Math.max(...memberNodes.map((n) => n.x + n.width)) + 16;
            const maxY = Math.max(...memberNodes.map((n) => n.y + n.height)) + 16;
            const collapsed = collapsedGroups.has(group.id);
            return (
              <g key={group.id} className="canvas-group-layer">
                <rect
                  x={minX}
                  y={minY}
                  width={maxX - minX}
                  height={maxY - minY}
                  rx={12}
                  className="canvas-group-lane"
                  strokeWidth="1"
                  strokeDasharray="5 4"
                  pointerEvents="none"
                />
                <g
                  className="cursor-pointer select-none"
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleGroupCollapsed(group.id);
                  }}
                >
                  <rect
                    x={minX}
                    y={minY - 20}
                    width={maxX - minX}
                    height={20}
                    rx={6}
                    className="canvas-group-title"
                  />
                  <text
                    x={minX + 10}
                    y={minY - 6}
                    fontSize="11"
                    className="canvas-group-title-text"
                  >
                    {collapsed ? "▸" : "▾"} {group.title}（{memberNodes.length}）
                  </text>
                </g>
                {collapsed && (
                  <rect
                    x={minX}
                    y={minY}
                    width={maxX - minX}
                    height={maxY - minY}
                    rx={12}
                    className="canvas-group-collapsed"
                    pointerEvents="none"
                  />
                )}
              </g>
            );
          })}

          {/* 节点（按 zIndex 升序渲染，越靠后越在上层） */}
          {[...doc.nodes]
            .sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0))
            .map((node) => (
              <g
                key={node.id}
                transform={`translate(${node.x}, ${node.y})`}
                onPointerDown={(e) => handleNodePointerDown(e, node.id)}
                onContextMenu={(e) => handleNodeContextMenu(e, node.id)}
                onClick={(e) => {
                  e.stopPropagation();
                  handleNodeClick(node.id, e.clientX, e.clientY);
                }}
                className="cursor-move"
              >
                <rect
                  width={node.width}
                  height={node.height}
                  rx={node.type === "card" ? 12 : node.source === "zone" ? 14 : 4}
                  className={`canvas-node-rect ${
                    node.source === "zone"
                      ? "fill-bamboo-mist/20 stroke-bamboo/45"
                      : node.source === "plan"
                        ? "fill-transparent stroke-ink-faint/40"
                        : selectedIdSet.has(node.id)
                          ? "fill-canvas-card-hover stroke-bamboo"
                          : getNodeStatusClass(node) ||
                            (node.source === "agent"
                              ? "fill-bamboo-mist/40 stroke-bamboo/50"
                              : "fill-canvas-card stroke-canvas-border")
                  }`}
                  strokeWidth={
                    selectedIdSet.has(node.id) ? 2.5 : node.agentStepStatus === "Running" ? 2 : 1
                  }
                  strokeDasharray={
                    node.source === "zone" ||
                    node.source === "plan" ||
                    (node.source === "agent" && !selectedIdSet.has(node.id))
                      ? "6 4"
                      : undefined
                  }
                />
                {/* card 灵感卡：左侧颜色条 */}
                {node.color && node.type === "card" && (
                  <rect
                    x={0}
                    y={5}
                    width={4}
                    height={node.height - 10}
                    rx={2}
                    fill={node.color}
                    pointerEvents="none"
                  />
                )}
                <foreignObject width={node.width} height={node.height}>
                  {node.source === "zone" || node.source === "plan" ? (
                    <div className="w-full h-full flex items-center justify-center select-none">
                      <span
                        className={`text-[13px] font-semibold text-center ${
                          node.source === "zone" ? "text-bamboo" : "text-ink-faint"
                        }`}
                      >
                        {node.text}
                      </span>
                    </div>
                  ) : node.type === "knowledge" ? (
                    // Obsidian 风格网页卡：favicon + 来源标题 + 摘录 + URL，点击打开
                    <div
                      onDoubleClick={(e) => {
                        e.preventDefault();
                        setNodeMetaPanelId(node.id);
                        setTagDraft((node.tags ?? []).join("，"));
                      }}
                      className="flex h-full w-full flex-col p-2"
                    >
                      <div className="flex shrink-0 items-center gap-1.5 border-b border-paper-deep/15 pb-1">
                        <span className="grid h-4 w-4 shrink-0 place-items-center rounded bg-bamboo/15 text-[8px] font-bold text-bamboo">
                          {domainInitial(node.fields?.url)}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-ink">
                          {node.fields?.title || "网页来源"}
                        </span>
                        {node.fields?.url && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              void openUrl(node.fields?.url as string);
                            }}
                            title={node.fields?.url}
                            className="grid h-4 w-4 shrink-0 place-items-center rounded bg-paper/85 text-[10px] text-bamboo hover:bg-bamboo/15 cursor-pointer"
                          >
                            ↗
                          </button>
                        )}
                      </div>
                      <div className="mt-1 min-h-0 flex-1 text-[12px] leading-relaxed text-ink-soft whitespace-pre-wrap overflow-hidden">
                        {node.text}
                      </div>
                      {node.fields?.url && (
                        <div className="shrink-0 truncate text-[9px] text-ink-ghost/70">
                          {node.fields.url}
                        </div>
                      )}
                    </div>
                  ) : node.type === "resource" && node.noteId ? (
                    // Obsidian 风格笔记卡：笔记标题 + 预览，双击/点击打开本地笔记
                    <div
                      onDoubleClick={(e) => {
                        e.preventDefault();
                        openResourceNote(node.id);
                      }}
                      className="flex h-full w-full flex-col p-2"
                    >
                      {(() => {
                        const linked = noteOptions.find((n) => n.id === node.noteId) ?? null;
                        return (
                          <>
                            <div className="flex shrink-0 items-center gap-1.5 border-b border-paper-deep/15 pb-1">
                              <span className="grid h-4 w-4 shrink-0 place-items-center rounded bg-bamboo/15 text-[8px] font-bold text-bamboo">
                                文
                              </span>
                              <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-ink">
                                {linked?.title || "本地笔记"}
                              </span>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  openResourceNote(node.id);
                                }}
                                title={t("canvas.openNote", { defaultValue: "打开笔记" })}
                                className="grid h-4 w-4 shrink-0 place-items-center rounded bg-paper/85 text-[10px] text-bamboo hover:bg-bamboo/15 cursor-pointer"
                              >
                                ↗
                              </button>
                            </div>
                            <div className="mt-1 min-h-0 flex-1 text-[11.5px] leading-relaxed text-ink-ghost whitespace-pre-wrap overflow-hidden">
                              {linked?.preview || node.text}
                            </div>
                          </>
                        );
                      })()}
                    </div>
                  ) : (
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
                          onDoubleClick={(e) => {
                            if (node.type === "resource" && node.noteId) {
                              e.preventDefault();
                              openResourceNote(node.id);
                              return;
                            }
                            // 类型化卡片：双击打开属性面板（结构化表单），不再面对空白输入
                            e.preventDefault();
                            setNodeMetaPanelId(node.id);
                            setTagDraft((node.tags ?? []).join("，"));
                          }}
                          className="relative w-full h-full text-[13px] text-ink-soft leading-relaxed whitespace-pre-wrap overflow-hidden"
                        >
                          {node.agentStepStatus && (
                            <span className="absolute right-0 top-0 rounded-full bg-paper/85 px-1.5 py-0.5 text-[10px] font-medium text-bamboo shadow-sm">
                              {getNodeStatusLabel(node.agentStepStatus)}
                            </span>
                          )}
                          <div
                            className={[
                              node.agentStepStatus ? "pr-12" : "",
                              node.type === "task" ? "pl-4" : "",
                            ]
                              .filter(Boolean)
                              .join(" ")}
                          >
                            {/* task 待办卡：勾选切换完成态 */}
                            {node.type === "task" && (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  toggleTaskDone(node.id);
                                }}
                                title={
                                  node.done
                                    ? t("canvas.taskUndone", { defaultValue: "标记未完成" })
                                    : t("canvas.taskDone", { defaultValue: "标记完成" })
                                }
                                className="absolute left-0 top-0 mt-0.5 grid h-4 w-4 place-items-center rounded border border-paper-deep/50 bg-paper/70 text-[10px] leading-none text-bamboo hover:border-bamboo/50 cursor-pointer"
                              >
                                {node.done ? "✓" : ""}
                              </button>
                            )}
                            <span className={node.done ? "line-through opacity-60" : undefined}>
                              {node.text || (
                                <span className="canvas-empty-text">
                                  {t("canvas.doubleClickToEdit", { defaultValue: "双击编辑" })}
                                </span>
                              )}
                            </span>
                          </div>
                          {/* task：截止日期 */}
                          {node.type === "task" && node.dueDate && (
                            <span className="absolute bottom-1 right-1 rounded bg-paper/85 px-1 py-px text-[9px] text-ink-ghost">
                              {t("canvas.dueDateLabel", { defaultValue: "截止" })} {node.dueDate}
                            </span>
                          )}
                          {/* resource：打开关联笔记 */}
                          {node.type === "resource" && node.noteId && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                openResourceNote(node.id);
                              }}
                              title={t("canvas.openNote", { defaultValue: "打开笔记" })}
                              className="absolute right-0 top-0 grid h-4 w-4 place-items-center rounded bg-paper/85 text-[10px] text-bamboo hover:bg-bamboo/15 cursor-pointer"
                            >
                              ↗
                            </button>
                          )}
                          {/* 成文留痕：参与组卡成文 → 点击溯源打开产出的笔记 */}
                          {node.draftedBy && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                dispatchOpenNote(node.draftedBy as string);
                              }}
                              title={t("canvas.draftedTip", {
                                defaultValue: "已成文，点击查看产出的笔记",
                              })}
                              className="absolute right-0 top-5 rounded bg-bamboo/15 px-1 py-px text-[9px] font-medium text-bamboo hover:bg-bamboo/25 cursor-pointer"
                            >
                              {t("canvas.draftedBadge", { defaultValue: "成文 ✓" })}
                            </button>
                          )}
                          {/* question 问题卡：状态徽章 */}
                          {node.type === "question" && node.fields?.status && (
                            <span className="absolute bottom-1 right-1 rounded bg-paper/85 px-1 py-px text-[9px] text-ink-ghost">
                              {node.fields.status === "已答" ? "已答 ✓" : "待答"}
                            </span>
                          )}
                          {/* card：标签徽章 */}
                          {(node.tags ?? []).length > 0 && (
                            <div className="absolute bottom-1 left-1 right-1 flex flex-wrap gap-0.5">
                              {(node.tags ?? []).slice(0, 3).map((tag) => (
                                <span
                                  key={tag}
                                  className="rounded bg-paper/85 px-1 py-px text-[9px] text-ink-faint"
                                >
                                  #{tag}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </foreignObject>
                {/* Obsidian 风格：右下角尺寸调整手柄 */}
                {node.type !== "question" && (
                  <rect
                    x={node.width - 12}
                    y={node.height - 12}
                    width={12}
                    height={12}
                    fill="transparent"
                    className="cursor-nwse-resize"
                    onPointerDown={(e) => startNodeResize(e, node.id)}
                  >
                    <title>{t("canvas.resize", { defaultValue: "拖动调整大小" })}</title>
                  </rect>
                )}
              </g>
            ))}
        </g>
      </svg>
      </div>

      {marqueeRect && marqueeRect.width > 2 && marqueeRect.height > 2 && (
        <div
          data-testid="canvas-marquee"
          className="pointer-events-none absolute z-40 rounded-lg border border-dashed border-bamboo bg-bamboo-mist/20 shadow-[0_0_0_1px_rgba(79,176,111,0.18)]"
          style={{
            left: marqueeRect.left,
            top: marqueeRect.top,
            width: marqueeRect.width,
            height: marqueeRect.height,
          }}
        />
      )}

      {nodeContextMenu && (
        <div
          className="absolute z-40 min-w-[170px] rounded-xl border border-paper-deep/30 bg-paper/95 p-1.5 text-[12px] text-ink-soft shadow-xl backdrop-blur"
          style={{
            left: Math.min(
              nodeContextMenu.x,
              (svgRef.current?.clientWidth ?? window.innerWidth) - 180,
            ),
            top: Math.min(
              nodeContextMenu.y,
              (svgRef.current?.clientHeight ?? window.innerHeight) - 260,
            ),
          }}
          onMouseDown={(event) => event.stopPropagation()}
          onContextMenu={(event) => event.preventDefault()}
        >
          {(() => {
            const menuNode = doc.nodes.find((n) => n.id === nodeContextMenu.nodeId) ?? null;
            const isTask = menuNode?.type === "task";
            const canOpenNote = menuNode?.type === "resource" && Boolean(menuNode.noteId);
            return (
              <>
                {menuNode && (
                  <button
                    type="button"
                    onClick={() => {
                      void handleArchitectureRequest(`根据节点“${menuNode.text.split("\\n")[0]}”生成系统架构`, [nodeContextMenu.nodeId]);
                      setNodeContextMenu(null);
                    }}
                    className="flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left transition hover:bg-paper-warm/60"
                  >
                    <span>生成 Architecture</span>
                    <span className="text-[10px] text-ink-ghost">✦</span>
                  </button>
                )}
                {menuNode && menuNode.text.trim().length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      visualizeTextToCanvas(menuNode.text, {
                        x: menuNode.x + 440,
                        y: menuNode.y,
                      });
                      setNodeContextMenu(null);
                    }}
                    className="flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left transition hover:bg-paper-warm/60"
                  >
                    <span>
                      {t("canvas.visualizeNode", { defaultValue: "内容智能绘图" })}
                    </span>
                    <span className="text-[10px] text-ink-ghost">🎨</span>
                  </button>
                )}
                {canOpenNote && (
                  <button
                    type="button"
                    onClick={() => {
                      openResourceNote(nodeContextMenu.nodeId);
                      setNodeContextMenu(null);
                    }}
                    className="flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left transition hover:bg-paper-warm/60"
                  >
                    <span>{t("canvas.openNote", { defaultValue: "打开笔记" })}</span>
                    <span className="text-[10px] text-ink-ghost">↗</span>
                  </button>
                )}
                {isTask && (
                  <button
                    type="button"
                    onClick={() => {
                      toggleTaskDone(nodeContextMenu.nodeId);
                      setNodeContextMenu(null);
                    }}
                    className="flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left transition hover:bg-paper-warm/60"
                  >
                    <span>
                      {menuNode?.done
                        ? t("canvas.taskUndone", { defaultValue: "标记未完成" })
                        : t("canvas.taskDone", { defaultValue: "标记完成" })}
                    </span>
                    <span className="text-[10px] text-ink-ghost">{menuNode?.done ? "◌" : "✓"}</span>
                  </button>
                )}
                <div className="px-2.5 pt-1.5 text-[10px] text-ink-ghost">
                  {t("canvas.moveToGroup", { defaultValue: "移到分组" })}
                </div>
                {(doc.groups ?? []).map((group) => (
                  <button
                    key={group.id}
                    type="button"
                    onClick={() => {
                      moveNodesToGroup(group.id);
                      setNodeContextMenu(null);
                    }}
                    className={`flex w-full items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-left transition hover:bg-paper-warm/60 ${
                      menuNode?.group === group.id ? "text-bamboo" : ""
                    }`}
                  >
                    <span className="inline-block h-1.5 w-1.5 rounded-full bg-bamboo/70" />
                    <span className="truncate">{group.title}</span>
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => {
                    moveNodesToGroup(null);
                    setNodeContextMenu(null);
                  }}
                  className="flex w-full items-center rounded-lg px-2.5 py-1.5 text-left text-ink-ghost transition hover:bg-paper-warm/60"
                >
                  {t("canvas.ungroup", { defaultValue: "移出分组" })}
                </button>
                <div className="my-1 border-t border-paper-deep/15" />
                <button
                  type="button"
                  onClick={confirmBatchDelete}
                  className="flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-coral transition hover:bg-coral/10"
                >
                  <span>{selectedNodeIds.length > 1 ? "批量删除" : "删除卡片"}</span>
                  <span className="text-[10px] text-ink-ghost">{selectedNodeIds.length}</span>
                </button>
              </>
            );
          })()}
        </div>
      )}

      <div
        data-testid="canvas-minimap"
        className="absolute z-30 touch-none overflow-hidden rounded-2xl border border-paper-deep/25 bg-paper/90 shadow-[0_18px_50px_-28px_rgba(0,0,0,0.45)] backdrop-blur-xl"
        style={{
          left: miniMapState.left,
          top: miniMapState.top,
          width: miniMapState.width,
          height: miniMapState.height,
        }}
      >
        <div
          className="flex h-7 touch-none cursor-grab items-center justify-between border-b border-paper-deep/15 px-2.5 text-[10px] font-semibold tracking-[0.16em] text-ink-ghost active:cursor-grabbing"
          onPointerDown={(event) => {
            stopCanvasEvent(event);
            event.currentTarget.setPointerCapture?.(event.pointerId);
            setMiniMapDrag({
              kind: "move",
              startX: event.clientX,
              startY: event.clientY,
              startLeft: miniMapState.left,
              startTop: miniMapState.top,
            });
          }}
        >
          <span>MAP</span>
          <span>{doc.nodes.length} cards</span>
        </div>
        {(() => {
          const metrics = getMiniMapMetrics(miniMapState, canvasBounds);
          const { headerH, scale, ox, oy } = metrics;
          const vx = ox + (viewportWorld.x - canvasBounds.minX) * scale;
          const vy = oy + (viewportWorld.y - canvasBounds.minY) * scale;
          const vw = viewportWorld.width * scale;
          const vh = viewportWorld.height * scale;
          return (
            <svg
              data-testid="canvas-minimap-map"
              width={miniMapState.width}
              height={miniMapState.height - headerH}
              className="touch-none cursor-crosshair"
              onPointerDown={(event) => {
                stopCanvasEvent(event);
                jumpMiniMapTo(event.clientX, event.clientY);
              }}
            >
              <rect
                x={0}
                y={0}
                width={miniMapState.width}
                height={miniMapState.height - headerH}
                fill="transparent"
              />
              {doc.nodes.map((node) => (
                <rect
                  key={`mini-${node.id}`}
                  x={ox + (node.x - canvasBounds.minX) * scale}
                  y={oy - headerH + (node.y - canvasBounds.minY) * scale}
                  width={Math.max(3, node.width * scale)}
                  height={Math.max(3, node.height * scale)}
                  rx={2}
                  className={
                    selectedIdSet.has(node.id)
                      ? "fill-bamboo"
                      : node.agentStepStatus
                        ? "fill-bamboo/60"
                        : "fill-ink-faint/45"
                  }
                />
              ))}
              <rect
                data-testid="canvas-minimap-viewport"
                x={vx}
                y={vy - headerH}
                width={Math.max(8, vw)}
                height={Math.max(8, vh)}
                fill="rgba(79,176,111,0.08)"
                stroke="currentColor"
                strokeWidth={1.5}
                className="cursor-grab text-bamboo active:cursor-grabbing"
                onPointerDown={(event) => beginMiniMapViewportDrag(event, scale)}
              />
            </svg>
          );
        })()}
        <button
          type="button"
          aria-label="缩放预览窗口"
          className="absolute bottom-1 right-1 h-4 w-4 cursor-nwse-resize rounded-md border border-paper-deep/20 bg-paper-deep/20"
          onPointerDown={(event) => {
            stopCanvasEvent(event);
            event.currentTarget.setPointerCapture?.(event.pointerId);
            setMiniMapDrag({
              kind: "resize",
              startX: event.clientX,
              startY: event.clientY,
              startWidth: miniMapState.width,
              startHeight: miniMapState.height,
            });
          }}
        />
      </div>

      {/* 新手引导（ob-1/ob-2）：3s 预告动画 → 四步演示卡片 → 模板坞 */}
      {(() => {
        const canvasRect = svgRef.current?.getBoundingClientRect();
        // 演示卡停靠在画布顶部中央（工具栏下方），不遮挡画布中心内容
        const demoAnchor = {
          x: (canvasRect?.width ?? 640) / 2,
          y: 104,
        };
        const stepDef = DEMO_STEPS.find((step) => step.id === demoStep);
        return (
          <CanvasOnboarding
            phase={onboardingPhase}
            activeStep={demoStep}
            completedSteps={completedSteps}
            demoAnchor={demoAnchor}
            highlight={
              stepDef?.target === "toolbar" ? "toolbar" : stepDef?.target === "node" ? "node" : null
            }
            templatesVisible={!templatesDismissed}
            templateDock={rightRailOpen || panelsOpen ? "bottom" : "right"}
            onIntroDone={() => {
              markOnboardingSeen();
              setOnboardingPhase("demo");
            }}
            onSkipGuide={finishGuide}
            onFinishGuide={finishGuide}
            onAskAi={handleAskAi}
            onApplyTemplate={applyTemplate}
            onDismissTemplates={() => setTemplatesDismissed(true)}
          />
        );
      })()}

      {/* 常驻快捷操作提示（ob-3）：仅画布空闲时显示，避免挡住引导、侧栏、属性和任务 Dock */}
      {quickHelpVisible && <CanvasQuickHelp />}
    </div>
  );
}
