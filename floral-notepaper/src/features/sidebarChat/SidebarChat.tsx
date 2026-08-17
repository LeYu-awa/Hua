import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ProviderConfig } from "../settings/types";
import { logUsage } from "../settings/stats";
import {
  shouldAutoSpeak,
  speakText,
  stopSpeech,
  subscribeSpeechState,
  unlockSpeechPlayback,
} from "../tts";
import {
  buildPendingToolMessage,
  formatAgentToolOutput,
  formatToolParams,
  getErrorText,
  runAssistantPlan,
  type CompletionOptions,
  type PendingToolPlan,
} from "./agentRuntime";
import {
  executeAssistantTool,
  getAssistantAgentConfig,
  listAssistantToolChanges,
  restoreAssistantToolChange,
  type AssistantAgentConfig,
  type NoteChangeRecord,
} from "./assistantTools";
import { buildLineDiff } from "./writebackDiff";
import {
  buildAgentTools,
  DEFAULT_AGENT_PERMISSION_POLICY,
  getStreamToolCallDelta,
  isKnownAgentTool,
  mergeToolCallDelta,
  parseToolArguments,
  requiresConfirmForTool,
  toolDisplayName,
  type AgentToolCall,
  type AgentToolDefinition,
} from "./agentTools";
import { runAgentLoop } from "./agentLoop";
import { MentionComposer, type ModelPickerOption } from "./MentionComposer";
import {
  buildToolPlanFromMentions,
  formatNoteReferenceToken,
  resolveNoteReference,
  TOOL_MENTIONS,
  type NoteMention,
} from "./mentions";
import { ChatWritebackReview } from "./ChatWritebackReview";
import { getNote } from "../notes/api";
import {
  detectAssistantToolPlan,
  parseExplicitToolCommand,
  parseInvokeText,
  requiresConfirmation,
  toolLabel,
  type AssistantToolPlan,
} from "./toolPlanner";
import {
  onAiRequest,
  onCanvasSnapshot,
  requestCanvasSnapshot,
  type CanvasSnapshot,
} from "../canvas/canvasCommands";
import { hasUsableProvider } from "../diary/composeDiaryContent";
import { DiarySuggestionCard } from "../diary/DiarySuggestionCard";
import { onOpenChatTask } from "../diary/diaryEvents";
import { useDiarySuggestion } from "../diary/useDiarySuggestion";
import { recallBaseline, recallMemory } from "../agent/memoryRecall";
import type { StructuredReply } from "./structuredReply";

export interface SidebarChatMessage {
  role: "user" | "assistant";
  content: string;
  createdAt: number;
  /** AI 回复的结构化解析结果（ai-2 四大模块）；未解析出结构化内容时为 undefined，按普通气泡渲染 */
  structured?: StructuredReply | null;
}

interface SidebarChatTask {
  id: string;
  title: string;
  messages: SidebarChatMessage[];
  createdAt: number;
  updatedAt: number;
}

interface SidebarChatProps {
  open: boolean;
  onClose: () => void;
  providers: ProviderConfig[];
  /** 引导联动（ob-4）：收到 AI 请求时通知外层打开对话面板 */
  onRequestOpen?: () => void;
}

type ModelRequestMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

const TASKS_STORAGE_KEY = "sidebar_ai_chat_tasks";
const LEGACY_MESSAGES_STORAGE_KEY = "sidebar_ai_chat_messages";
/** 持久化上限（条），超出丢弃最旧消息 */
const STORAGE_LIMIT = 100;
/** 请求携带的上下文条数（上下文记忆窗口） */
const CONTEXT_WINDOW = 16;
const CHAT_PANEL_MIN_WIDTH = 340;
const CHAT_PANEL_MAX_WIDTH = 640;
const TASK_PANEL_MIN_WIDTH = 180;
const TASK_PANEL_MAX_WIDTH = 320;
const RESIZE_HANDLE_WIDTH = 6;
const AUTO_SPEAK_MAX_CHARS = 72;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

const SYSTEM_PROMPT =
  "你是「花笺」内置的 AI 助手，风格温和、表达简洁。你可以围绕笔记写作、复盘、灵感收集、时间管理等方面提供帮助。回答使用中文，使用 Markdown 排版，保持简洁。" +
  `上下文记忆：对话历史会自动保存在本机，并随请求附带最近 ${CONTEXT_WINDOW} 条消息作为上下文，因此你可以引用之前聊过的内容。`;

/** 标准 Agent 模式下追加的系统指令：模型自主决定调用哪个工具、传什么参数 */
const AGENT_SYSTEM_SUFFIX =
  "你是一个智能体：当用户请求与本地笔记（搜索/读取/新建/编辑/移动分类）、联网搜索、打开链接或复制文本相关时，" +
  "应自主选择可用工具并填好参数执行，而不是只给建议。规则：只读工具（note.search / note.list / note.read）可直接调用；" +
  "写笔记、联网、外部副作用类工具会先整轮征求用户确认，确认后才会真正执行。收到 tool 结果后，基于真实结果继续回答；" +
  "若工具找不到目标，向用户说明并询问更精确的信息，不要编造笔记内容。";

/**
 * 解析拖拽载荷：
 * - 笔记卡片（主页/便签列表）：application/x-floral-note 是 { type: "note", id, title } JSON
 * - 文档/协作文件列表（LocalFiles/SharedFiles）：text/plain 是 { type, docId, title } JSON
 * - 兜底：text/plain 直接当作 note id
 */
function parseDropPayload(raw: string): { id?: string; title?: string } | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (parsed && typeof parsed === "object") {
      const title = typeof parsed.title === "string" ? parsed.title : undefined;
      const id =
        typeof parsed.docId === "string"
          ? parsed.docId
          : typeof parsed.id === "string"
            ? parsed.id
            : undefined;
      if (title || id) return { id, title };
    }
  } catch {
    // 非 JSON：直接当作 note id
  }
  return { id: raw };
}

function getDropPayload(dataTransfer: DataTransfer): { id?: string; title?: string } | null {
  const floralPayload = dataTransfer.getData("application/x-floral-note");
  if (floralPayload) return parseDropPayload(floralPayload);
  const plainPayload = dataTransfer.getData("text/plain");
  if (plainPayload) return parseDropPayload(plainPayload);
  return null;
}

/** 是否包含显式的 @工具 提及（如 @搜索笔记），用于区分"快捷命令"与"#引用上下文" */
function hasExplicitToolMention(text: string): boolean {
  return Array.from(text.matchAll(/@([^\s]+)/g)).some((match) =>
    TOOL_MENTIONS.some((tool) => match[1] === tool.token),
  );
}

/** 提取输入里的 #引用 笔记（按全局唯一 id 精准定位），作为 Agent 上下文注入 */
function extractReferencedNotes(
  text: string,
  notes: NoteMention[],
): { id: string; title: string }[] {
  const refs: { id: string; title: string }[] = [];
  for (const match of text.matchAll(/#([^\s]+)/g)) {
    const resolved = resolveNoteReference(match[1], notes);
    if (resolved?.id) refs.push({ id: resolved.id, title: resolved.title });
  }
  return refs;
}

function getAutoSpeakText(text: string): string {
  const normalized = text
    .replace(/```[\s\S]*?```/g, "")
    .replace(/[#>*_`\-[\]]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (normalized.length <= AUTO_SPEAK_MAX_CHARS) return normalized;
  const sentence = normalized.match(/^.{12,72}?[。！？!?]/)?.[0]?.trim();
  return sentence || `${normalized.slice(0, AUTO_SPEAK_MAX_CHARS)}……`;
}

/** 格式化变更时间戳（ISO 字符串）为「MM-DD HH:mm」 */
function formatChangeTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const MARKDOWN_CONTENT_CLASS =
  "text-[12.5px] leading-relaxed text-ink-soft break-words [&_h1]:text-[15px] [&_h1]:font-bold [&_h1]:text-ink [&_h1]:mb-1.5 [&_h2]:text-[14px] [&_h2]:font-bold [&_h2]:text-ink [&_h2]:mb-1.5 [&_h3]:text-[13px] [&_h3]:font-semibold [&_h3]:text-ink [&_h3]:mb-1 [&_p]:mb-1.5 [&_ul]:mb-1.5 [&_ul]:pl-4 [&_ul]:list-disc [&_ol]:mb-1.5 [&_ol]:pl-4 [&_ol]:list-decimal [&_li]:mb-0.5 [&_strong]:text-ink [&_strong]:font-semibold [&_code]:text-bamboo [&_code]:bg-bamboo-mist/50 [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-[11px] [&_pre]:bg-ink/5 [&_pre]:text-ink-soft [&_pre]:p-2 [&_pre]:rounded-lg [&_pre]:text-[11px] [&_pre]:overflow-x-auto [&_pre]:mb-1.5 [&_a]:text-bamboo [&_a]:underline [&_blockquote]:border-l-2 [&_blockquote]:border-bamboo/40 [&_blockquote]:pl-3 [&_blockquote]:text-ink-faint [&_hr]:border-paper-deep/30 [&_hr]:my-2";

function splitAgentMessage(content: string) {
  const flow: string[] = [];
  const answer: string[] = [];

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === "**Agent 执行流程**") continue;

    const quoteStatus = /^>\s*(.+)$/.exec(trimmed);
    if (quoteStatus?.[1]) {
      flow.push(quoteStatus[1].trim());
      continue;
    }

    const listStatus = /^[-*]\s+(.+)$/.exec(trimmed);
    if (
      listStatus?.[1] &&
      /^(调用工具|已确认|自动执行|工具执行完成|已读取|优化稿已生成|已拒绝)/.test(listStatus[1])
    ) {
      flow.push(listStatus[1].trim());
      continue;
    }

    answer.push(line);
  }

  return { flow, answer: answer.join("\n").trim() };
}

function TypingDots() {
  return (
    <span className="inline-flex items-center gap-1.5 text-ink-ghost">
      <span className="w-1.5 h-1.5 rounded-full bg-bamboo/60 animate-bounce [animation-delay:-0.3s]" />
      <span className="w-1.5 h-1.5 rounded-full bg-bamboo/60 animate-bounce [animation-delay:-0.15s]" />
      <span className="w-1.5 h-1.5 rounded-full bg-bamboo/60 animate-bounce" />
    </span>
  );
}

function UserPromptMessage({ content }: { content: string }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[88%] whitespace-pre-wrap break-words text-right text-[12.5px] leading-relaxed text-ink">
        {content}
      </div>
    </div>
  );
}

function AgentTimelineMessage({ content }: { content: string }) {
  const { flow, answer } = splitAgentMessage(content);
  return (
    <div className="relative ml-1 w-full border-l border-paper-deep/30 pl-3">
      <span className="absolute -left-[3px] top-1.5 h-1.5 w-1.5 rounded-full bg-bamboo" />
      {flow.length > 0 && (
        <details className="mb-2 text-[11px] text-ink-faint">
          <summary className="w-fit cursor-pointer select-none text-bamboo hover:text-bamboo-light">
            Thought · {flow.length} 步
          </summary>
          <ol className="mt-1.5 space-y-1 border-l border-paper-deep/20 pl-3">
            {flow.map((item, index) => (
              <li key={`${index}-${item}`} className="relative leading-relaxed">
                <span className="absolute -left-[15px] top-1.5 h-1.5 w-1.5 rounded-full bg-paper-deep/60" />
                {item}
              </li>
            ))}
          </ol>
        </details>
      )}
      {answer ? (
        <div className={MARKDOWN_CONTENT_CLASS}>
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{answer}</ReactMarkdown>
        </div>
      ) : (
        <TypingDots />
      )}
    </div>
  );
}

function AgentTypingMessage() {
  return (
    <div className="relative ml-1 w-full border-l border-paper-deep/30 pl-3">
      <span className="absolute -left-[3px] top-1.5 h-1.5 w-1.5 rounded-full bg-bamboo" />
      <TypingDots />
    </div>
  );
}

export function SidebarChat({ open, onClose, providers, onRequestOpen }: SidebarChatProps) {
  const initialTasks = useMemo(() => loadChatTasks(), []);
  const [tasks, setTasks] = useState<SidebarChatTask[]>(initialTasks);
  const [activeTaskId, setActiveTaskId] = useState(initialTasks[0].id);
  const activeTask = useMemo(
    () => tasks.find((task) => task.id === activeTaskId) ?? tasks[0] ?? createChatTask(),
    [activeTaskId, tasks],
  );
  const messages = activeTask.messages;
  /** 日记提议（diary S1）：把当前活跃任务的消息映射为日记源数据 */
  const diarySourceMessages = useMemo(
    () =>
      messages.map((message) => ({
        role: message.role,
        content: message.content,
        createdAt: message.createdAt,
      })),
    [messages],
  );
  const diarySuggestion = useDiarySuggestion({
    taskId: activeTask.id,
    messages: diarySourceMessages,
    providers,
  });
  const setMessages = useCallback(
    (
      updater: SidebarChatMessage[] | ((messages: SidebarChatMessage[]) => SidebarChatMessage[]),
    ) => {
      setTasks((current) =>
        current.map((task) => {
          if (task.id !== activeTaskId) return task;
          const nextMessages = typeof updater === "function" ? updater(task.messages) : updater;
          return {
            ...task,
            messages: nextMessages.slice(-STORAGE_LIMIT),
            title: getTaskTitle(task, nextMessages),
            updatedAt: Date.now(),
          };
        }),
      );
    },
    [activeTaskId],
  );
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [selectedProviderId, setSelectedProviderId] = useState("");
  const [selectedModelId, setSelectedModelId] = useState("");
  const [pendingTool, setPendingTool] = useState<PendingToolPlan | null>(null);
  /** 标准 Agent 待确认轮次：ref 保存 resolver（避免闭包过期），state 仅用于横幅展示 */
  const pendingAgentRoundRef = useRef<{
    calls: AgentToolCall[];
    resolve: (ok: boolean) => void;
  } | null>(null);
  const [pendingAgentCalls, setPendingAgentCalls] = useState<AgentToolCall[] | null>(null);
  const [agentConfig, setAgentConfig] = useState<AssistantAgentConfig | null>(null);
  const [noteOptions, setNoteOptions] = useState<NoteMention[]>([]);
  const [menuTaskId, setMenuTaskId] = useState<string | null>(null);
  const [renamingTaskId, setRenamingTaskId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [taskPanelOpen, setTaskPanelOpen] = useState(false);
  const [chatPanelOpen, setChatPanelOpen] = useState(true);
  const [speechPlaying, setSpeechPlaying] = useState(false);
  /** 日记跳转提示（diary S1）：来源对话已清空时显示短暂提示 */
  const [chatTaskNotice, setChatTaskNotice] = useState<string | null>(null);
  const chatTaskNoticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** 对话面板宽度（默认 360，可拖动，持久化本地） */
  const [chatPanelWidth, setChatPanelWidth] = useState(() => {
    const saved = Number(window.localStorage.getItem("sidebar_chat_panel_width"));
    return Number.isFinite(saved) && saved >= CHAT_PANEL_MIN_WIDTH && saved <= CHAT_PANEL_MAX_WIDTH
      ? saved
      : 360;
  });
  /** 任务栏宽度（仅通过对话面板左侧分隔线调整） */
  const [taskPanelWidth, setTaskPanelWidth] = useState(() => {
    const saved = Number(window.localStorage.getItem("sidebar_chat_task_panel_width"));
    return Number.isFinite(saved) && saved >= TASK_PANEL_MIN_WIDTH && saved <= TASK_PANEL_MAX_WIDTH
      ? saved
      : 240;
  });
  const resizeFrameRef = useRef<number | null>(null);
  const asideRef = useRef<HTMLElement>(null);
  const chatPanelRef = useRef<HTMLDivElement>(null);
  const taskPanelRef = useRef<HTMLDivElement>(null);
  const [chatWidthDragging, setChatWidthDragging] = useState(false);
  /** 历史变更面板：AI 写回 / 历史恢复的笔记变更快照 */
  const [changesOpen, setChangesOpen] = useState(false);
  const [changes, setChanges] = useState<NoteChangeRecord[]>([]);
  const [changesLoading, setChangesLoading] = useState(false);
  const [expandedChangeId, setExpandedChangeId] = useState<string | null>(null);
  const [restoringChangeId, setRestoringChangeId] = useState<string | null>(null);
  const [chatDragOver, setChatDragOver] = useState(false);
  const [writebackApplying, setWritebackApplying] = useState(false);
  const [writebackResolved, setWritebackResolved] = useState<"applied" | "cancelled" | null>(null);
  /** AI 上下文模块（④）：最新画布快照（ref 供异步回调读取，无需触发渲染） */
  const canvasSnapshotRef = useRef<CanvasSnapshot | null>(null);
  /** 引导联动（ob-4）：待自动发送的文本（input 更新到同一值后触发 handleSend） */
  const autoSendRef = useRef<string | null>(null);

  useEffect(() => {
    requestCanvasSnapshot();
  }, [open]);

  useEffect(() => {
    return onCanvasSnapshot((snapshot) => {
      canvasSnapshotRef.current = snapshot;
    });
  }, []);

  useEffect(() => {
    return onAiRequest((payload) => {
      setInput(payload.prompt);
      onRequestOpen?.();
      if (payload.autoSend) autoSendRef.current = payload.prompt;
    });
  }, [onRequestOpen]);

  useEffect(() => {
    if (open && !taskPanelOpen && !chatPanelOpen) {
      onClose();
    }
  }, [open, taskPanelOpen, chatPanelOpen, onClose]);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      localStorage.setItem(TASKS_STORAGE_KEY, JSON.stringify(tasks.slice(0, 20)));
    } catch {
      // ignore
    }
  }, [tasks]);

  useEffect(() => {
    void getAssistantAgentConfig()
      .then(setAgentConfig)
      .catch(() => setAgentConfig(null));
  }, []);

  /** 日记页跳回对话（diary S1）：激活指定任务并展开面板；空 taskId 仅展开面板 */
  useEffect(() => {
    return onOpenChatTask((taskId) => {
      if (!taskId) {
        setChatPanelOpen(true);
        onRequestOpen?.();
        return;
      }
      const task = tasks.find((item) => item.id === taskId);
      if (!task) {
        setChatTaskNotice("该对话已清空，无法跳转");
        if (chatTaskNoticeTimerRef.current) clearTimeout(chatTaskNoticeTimerRef.current);
        chatTaskNoticeTimerRef.current = setTimeout(() => setChatTaskNotice(null), 3000);
        return;
      }
      setActiveTaskId(taskId);
      setChatPanelOpen(true);
      onRequestOpen?.();
    });
  }, [tasks, onRequestOpen]);

  /** 加载本地笔记索引，供输入区 # 联想使用 */
  const loadNoteOptions = useCallback(async () => {
    try {
      const res = await executeAssistantTool<{ notes: NoteMention[] }>({
        tool: "note.search",
        params: { query: "", limit: 30 },
      });
      const notes = (res.data?.notes ?? []).filter(
        (note) => note && typeof note.id === "string" && typeof note.title === "string",
      );
      setNoteOptions(notes);
    } catch {
      // 工具不可用时静默忽略，联想列表保持为空
    }
  }, []);

  useEffect(() => {
    if (open) void loadNoteOptions();
  }, [open, loadNoteOptions]);

  const enabledProviders = useMemo(
    () => providers.filter((p) => p.enabled && p.models.length > 0),
    [providers],
  );

  const activeProvider = useMemo(
    () => enabledProviders.find((p) => p.id === selectedProviderId) ?? enabledProviders[0] ?? null,
    [enabledProviders, selectedProviderId],
  );

  const activeModels = useMemo(() => activeProvider?.models ?? [], [activeProvider]);

  const activeModel = useMemo(
    () => activeModels.find((m) => m.modelId === selectedModelId) ?? activeModels[0],
    [activeModels, selectedModelId],
  );

  /** 拍平为输入区模型选择器使用的选项列表 */
  const modelOptions = useMemo<ModelPickerOption[]>(
    () =>
      enabledProviders.flatMap((p) =>
        p.models.map((m) => ({
          providerId: p.id,
          providerName: p.name,
          modelId: m.modelId,
          modelLabel: m.displayName || m.modelId,
        })),
      ),
    [enabledProviders],
  );

  const handlePickModel = useCallback((providerId: string, modelId: string) => {
    setSelectedProviderId(providerId);
    setSelectedModelId(modelId);
  }, []);

  const contextWindow = agentConfig?.contextPolicy.recentMessages ?? CONTEXT_WINDOW;
  const agentModeLabel = agentConfig?.mode === "autonomous" ? "自主模式" : "工作流模式";

  useEffect(() => {
    if (enabledProviders.length > 0 && !selectedProviderId) {
      const ds = enabledProviders.find((p) => p.name.toLowerCase().includes("deepseek"));
      const provider = ds ?? enabledProviders[0];
      setSelectedProviderId(provider.id);
      setSelectedModelId(provider.models[0]?.modelId ?? "");
    }
  }, [enabledProviders, selectedProviderId]);

  useEffect(() => {
    return subscribeSpeechState(setSpeechPlaying);
  }, []);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, loading, pendingTool]);

  const speakAssistantReply = useCallback((reply: string) => {
    const text = reply.trim();
    if (!text || !shouldAutoSpeak()) return;
    const speechText = getAutoSpeakText(text);
    void speakText(speechText, { emotion: "happy" }).then((ok) => {
      if (!ok)
        console.warn("[tts] AI 助手回复未能开始播放，请检查 TTS 配置或本地服务。", {
          text: speechText.slice(0, 80),
        });
    });
  }, []);

  /** AI 回复最终化：默认保留普通 Markdown 文本，不再强制解析成四模块卡片。 */
  const finalizeAssistantMessage = useCallback(
    (_prev: SidebarChatMessage[], text: string, createdAt: number): SidebarChatMessage => ({
      role: "assistant",
      content: text,
      createdAt,
    }),
    [],
  );

  const appendAssistantReply = useCallback(
    (reply: string) => {
      const createdAt = Date.now();
      setMessages((prev) => [...prev, finalizeAssistantMessage(prev, reply, createdAt)]);
      speakAssistantReply(reply);
    },
    [setMessages, speakAssistantReply, finalizeAssistantMessage],
  );

  const appendAssistantDraft = useCallback(
    (initial = "") => {
      const createdAt = Date.now() + Math.random();
      setMessages((prev) => [...prev, { role: "assistant", content: initial, createdAt }]);
      return createdAt;
    },
    [setMessages],
  );

  const appendAssistantDelta = useCallback(
    (createdAt: number, delta: string) => {
      if (!delta) return;
      setMessages((prev) =>
        prev.map((msg) =>
          msg.createdAt === createdAt ? { ...msg, content: msg.content + delta } : msg,
        ),
      );
    },
    [setMessages],
  );

  const replaceAssistantDraft = useCallback(
    (createdAt: number, content: string) => {
      setMessages((prev) =>
        prev.map((msg) =>
          msg.createdAt === createdAt ? finalizeAssistantMessage(prev, content, createdAt) : msg,
        ),
      );
    },
    [setMessages, finalizeAssistantMessage],
  );

  /** 取消标准 Agent 待确认轮次（拒绝），并释放挂起的 loop */
  const cancelPendingAgentRound = useCallback(() => {
    pendingAgentRoundRef.current?.resolve(false);
    pendingAgentRoundRef.current = null;
    setPendingAgentCalls(null);
  }, []);

  /** 横幅确认/拒绝标准 Agent 的整轮工具调用 */
  const resolveAgentRound = useCallback((ok: boolean) => {
    const pending = pendingAgentRoundRef.current;
    if (!pending) return;
    pendingAgentRoundRef.current = null;
    setPendingAgentCalls(null);
    pending.resolve(ok);
  }, []);

  /** 执行标准 Agent 的一次工具调用：解析模型参数 → 调后端 → 转文本回喂模型 */
  const executeAgentTool = useCallback(async (call: AgentToolCall): Promise<string> => {
    if (!isKnownAgentTool(call.name)) {
      throw new Error(`未知工具：${call.name}，请从可用工具中选择`);
    }
    const params = parseToolArguments(call.arguments);
    // 防御性归一化：模型漏传 mode 或偶发 overwrite/覆盖 等旧写法时，统一按"整篇覆盖"执行
    if (params.mode === "overwrite" || params.mode === "覆盖") {
      params.mode = "replace";
    }
    if (params.mode !== "replace" && params.mode !== "append") {
      params.mode = "replace";
    }
    const response = await executeAssistantTool({ tool: call.name, params, confirmed: true });
    return formatAgentToolOutput(call.name, response);
  }, []);

  /** 加载笔记变更历史 */
  const loadChanges = useCallback(async () => {
    setChangesLoading(true);
    try {
      const list = await listAssistantToolChanges(50);
      setChanges(list);
    } catch {
      setChanges([]);
    } finally {
      setChangesLoading(false);
    }
  }, []);

  /** 开关历史变更面板 */
  const toggleChanges = useCallback(() => {
    setChangesOpen((prev) => {
      const next = !prev;
      if (next) void loadChanges();
      return next;
    });
  }, [loadChanges]);

  /** 恢复某次变更：把笔记写回该变更发生前的内容 */
  const restoreChange = useCallback(
    async (change: NoteChangeRecord) => {
      if (restoringChangeId) return;
      if (
        !window.confirm(
          `确定恢复「${change.title}」的此版本吗？当前内容将被替换为该变更发生前的内容。`,
        )
      ) {
        return;
      }
      setRestoringChangeId(change.id);
      try {
        const result = await restoreAssistantToolChange(change.id);
        appendAssistantReply(
          `已恢复笔记「${result.note.title}」到变更前的版本（正文现约 ${result.note.wordCount} 字）。\n\n` +
            `恢复来源：${formatChangeTime(change.timestamp)} 的 ${change.source === "ai" ? "AI 助手" : "历史恢复"}${change.mode === "replace" ? "（整篇覆盖）" : "（追加）"}。`,
        );
        await loadChanges();
      } catch (err) {
        appendAssistantReply(`恢复失败：${getErrorText(err)}`);
      } finally {
        setRestoringChangeId(null);
      }
    },
    [appendAssistantReply, loadChanges, restoringChangeId],
  );

  const clearHistory = useCallback(() => {
    setMessages([]);
    setPendingTool(null);
    cancelPendingAgentRound();
    stopSpeech();
  }, [setMessages, cancelPendingAgentRound]);

  const createNewTask = useCallback(() => {
    const nextTask = createChatTask();
    setTasks((current) => [nextTask, ...current].slice(0, 20));
    setActiveTaskId(nextTask.id);
    setPendingTool(null);
    cancelPendingAgentRound();
    stopSpeech();
  }, [cancelPendingAgentRound]);

  const startRenameTask = useCallback((task: SidebarChatTask) => {
    setMenuTaskId(null);
    setRenamingTaskId(task.id);
    setRenameDraft(task.title);
  }, []);

  const commitRenameTask = useCallback(() => {
    if (!renamingTaskId) return;
    const title = renameDraft.trim() || "未命名任务";
    setTasks((current) =>
      current.map((task) =>
        task.id === renamingTaskId ? { ...task, title, updatedAt: Date.now() } : task,
      ),
    );
    setRenamingTaskId(null);
    setRenameDraft("");
  }, [renameDraft, renamingTaskId]);

  const deleteTask = useCallback(
    (taskId: string) => {
      setMenuTaskId(null);
      if (!window.confirm("确定删除该对话吗？删除后不可恢复。")) return;
      const remaining = tasks.filter((task) => task.id !== taskId);
      if (remaining.length === 0) {
        // 删除最后一个对话后立即新建，避免 activeTask 回退成幽灵任务导致消息被静默丢弃
        const nextTask = createChatTask();
        setTasks([nextTask]);
        setActiveTaskId(nextTask.id);
      } else {
        setTasks(remaining);
        if (activeTask.id === taskId) setActiveTaskId(remaining[0].id);
      }
      cancelPendingAgentRound();
      stopSpeech();
    },
    [activeTask.id, cancelPendingAgentRound, tasks],
  );

  const requestModelMessages = useCallback(
    async (modelMessages: ModelRequestMessage[], options?: CompletionOptions) => {
      if (!activeProvider || !activeModel) {
        throw new Error("请先配置并启用 AI 供应商");
      }

      const apiUrl = activeProvider.baseUrl.replace(/\/+$/, "") + activeProvider.apiPath;
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (activeProvider.apiKey) headers.Authorization = `Bearer ${activeProvider.apiKey}`;
      const stream = Boolean(options?.onDelta);

      const response = await fetch(apiUrl, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: activeModel.modelId,
          messages: modelMessages,
          stream,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`API 错误 (${response.status}): ${errorText}`);
      }

      if (stream && response.body) {
        const streamed = await readStreamingCompletion(response, options?.onDelta);
        logModelUsage(activeProvider.name, streamed.usage);
        return streamed.reply.trim() || "（未收到回复）";
      }

      const data = await response.json();
      logModelUsage(activeProvider.name, data.usage);
      return getCompletionText(data) || "（未收到回复）";
    },
    [activeProvider, activeModel],
  );

  /** 标准 Agent 请求：带 tools 的流式调用，返回最终文本 + 模型请求的工具调用 */
  const requestModelAgent = useCallback(
    async (
      modelMessages: ModelRequestMessage[],
      options?: { tools?: AgentToolDefinition[]; onDelta?: (delta: string) => void },
    ) => {
      if (!activeProvider || !activeModel) {
        throw new Error("请先配置并启用 AI 供应商");
      }

      const apiUrl = activeProvider.baseUrl.replace(/\/+$/, "") + activeProvider.apiPath;
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (activeProvider.apiKey) headers.Authorization = `Bearer ${activeProvider.apiKey}`;

      const buildBody = (tools?: AgentToolDefinition[]) =>
        JSON.stringify({
          model: activeModel.modelId,
          messages: modelMessages,
          stream: true,
          ...(tools && tools.length > 0 ? { tools, tool_choice: "auto" } : {}),
        });

      let response = await fetch(apiUrl, {
        method: "POST",
        headers,
        body: buildBody(options?.tools),
      });
      if (!response.ok && options?.tools && options.tools.length > 0) {
        // 模型/网关不支持 function calling → 回退纯对话；
        // 同时移除系统指令里的工具引导（AGENT_SYSTEM_SUFFIX），
        // 避免模型在无 tools 定义时用 <invoke> 文本"假装"调用工具
        const fallbackMessages = modelMessages.map((m) =>
          m.role === "system"
            ? { ...m, content: (m.content || "").replace(AGENT_SYSTEM_SUFFIX, "") }
            : m,
        );
        const fallback = await fetch(apiUrl, {
          method: "POST",
          headers,
          body: JSON.stringify({
            model: activeModel.modelId,
            messages: fallbackMessages,
            stream: true,
          }),
        });
        if (!fallback.ok) {
          const errorText = await response.text();
          throw new Error(`API 错误 (${response.status}): ${errorText}`);
        }
        response = fallback;
      } else if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`API 错误 (${response.status}): ${errorText}`);
      }

      if (!response.body) throw new Error("响应无数据流");
      const streamed = await readStreamingCompletion(response, options?.onDelta);
      logModelUsage(activeProvider.name, streamed.usage);
      return {
        reply: streamed.reply.trim(),
        toolCalls: streamed.toolCalls ?? [],
      };
    },
    [activeProvider, activeModel],
  );

  const requestModelCompletion = useCallback(
    (prompt: string, options?: CompletionOptions) =>
      requestModelMessages([{ role: "user", content: prompt }], options),
    [requestModelMessages],
  );

  const executeToolPlan = useCallback(
    async (plan: AssistantToolPlan, confirmed: boolean) => {
      setLoading(true);
      const draftId = appendAssistantDraft(
        `**Agent 执行流程**\n\n- ${confirmed ? "已确认" : "自动执行"}：${plan.title}`,
      );
      let generationStarted = false;
      try {
        const result = await runAssistantPlan(plan, confirmed, {
          complete: requestModelCompletion,
          createId: () => `${Date.now()}-${Math.random().toString(36).slice(2)}`,
          onStatus: (status) => appendAssistantDelta(draftId, `\n- ${status}`),
          onGeneratedDelta: (delta) => {
            if (!generationStarted) {
              generationStarted = true;
              appendAssistantDelta(draftId, "\n\n**生成过程**\n\n");
            }
            appendAssistantDelta(draftId, delta);
          },
        });

        if (result.pendingTool) {
          // 需要确认/写回审查的待定工具统一留在对话内展示：
          // 普通待确认走顶部横幅；带 review 的在消息区渲染代码式 diff 卡片
          setPendingTool(result.pendingTool);
          setWritebackResolved(null);
        }

        appendAssistantDelta(draftId, `\n\n${result.assistantMessage}`);
        speakAssistantReply(result.assistantMessage);
      } catch (err) {
        replaceAssistantDraft(draftId, `错误：${getErrorText(err)}`);
      } finally {
        setLoading(false);
      }
    },
    [
      appendAssistantDelta,
      appendAssistantDraft,
      replaceAssistantDraft,
      requestModelCompletion,
      speakAssistantReply,
    ],
  );

  const handleSend = useCallback(
    async (overrideText?: string) => {
      const text = (overrideText ?? input).trim();
      if (!text || loading) return;

      void unlockSpeechPlayback();

      const userMsg: SidebarChatMessage = { role: "user", content: text, createdAt: Date.now() };
      const nextMessages = [...messages, userMsg].slice(-STORAGE_LIMIT);
      setMessages(nextMessages);
      setInput("");

      const mentionPlan = buildToolPlanFromMentions(text, noteOptions);
      const commandPlan = parseExplicitToolCommand(text);

      // 1) 显式工具命令（@工具、/命令）→ 快速路径，用户显式指定了工具；
      //    纯 #引用 不在此列，交给 Agent 作为上下文处理
      const explicitPlan =
        commandPlan ?? (mentionPlan && hasExplicitToolMention(text) ? mentionPlan : null);
      if (explicitPlan) {
        if (requiresConfirmation(explicitPlan.tool)) {
          const pending = {
            ...explicitPlan,
            id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
          };
          setPendingTool(pending);
          appendAssistantReply(buildPendingToolMessage(pending));
          return;
        }
        await executeToolPlan(explicitPlan, false);
        return;
      }

      if (!activeProvider || !activeModel) {
        // 2) 未配置模型：退化为规则启发式工具计划，@/#/本地读搜等仍可用
        const fallbackPlan = mentionPlan ?? detectAssistantToolPlan(text);
        if (fallbackPlan) {
          if (requiresConfirmation(fallbackPlan.tool)) {
            const pending = {
              ...fallbackPlan,
              id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
            };
            setPendingTool(pending);
            appendAssistantReply(buildPendingToolMessage(pending));
            return;
          }
          await executeToolPlan(fallbackPlan, false);
          return;
        }
        appendAssistantReply(
          "请先在 设置 → 供应商 中添加并启用 AI 供应商；本地读笔记、搜索笔记等工具指令仍可直接使用。",
        );
        return;
      }

      // 方案 C：明确联网意图词（搜索/查一下/最新/实时等）直接走规则路径触发 web.search，
      // 不依赖模型 function calling（部分网关不支持，会退化成 <invoke> 文本）
      const webRulePlan = detectAssistantToolPlan(text);
      if (webRulePlan?.tool === "web.search") {
        if (requiresConfirmation(webRulePlan.tool)) {
          const pending: PendingToolPlan = {
            ...webRulePlan,
            id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
          };
          setPendingTool(pending);
          appendAssistantReply(buildPendingToolMessage(pending));
          return;
        }
        await executeToolPlan(webRulePlan, false);
        return;
      }

      // 3) 标准 Agent（function calling）：模型自己决定调用哪个工具、传什么参数；
      //    #引用笔记作为上下文注入，模型自主决定是否读取后完成任务
      setLoading(true);
      const draftId = appendAssistantDraft("");
      try {
        const referencedNotes = extractReferencedNotes(text, noteOptions);
        const referenceContext = referencedNotes.length
          ? "\n\n用户在本次请求中引用了以下笔记（如需其内容可调用 note.read 并按 id 读取，读取后才能总结/改写）：\n" +
            referencedNotes.map((note) => `- 「${note.title}」（id: ${note.id}）`).join("\n")
          : "";

        // 记忆层闭环：召回本地历史（笔记/日记/产出）与用户画像，注入系统上下文
        const [memoryBlock, baselineBlock] = await Promise.all([
          recallMemory(text),
          recallBaseline(),
        ]);

        const contextMessages: ModelRequestMessage[] = [
          {
            role: "system",
            content:
              SYSTEM_PROMPT + AGENT_SYSTEM_SUFFIX + referenceContext + memoryBlock + baselineBlock,
          },
          ...nextMessages.slice(-contextWindow).map((m) => ({ role: m.role, content: m.content })),
        ];

        const result = await runAgentLoop(contextMessages, {
          requestWithTools: (messages) =>
            requestModelAgent(messages as ModelRequestMessage[], {
              tools: buildAgentTools(),
              onDelta: (delta) => {
                appendAssistantDelta(draftId, delta);
              },
            }),
          onAgentStatus: (status) => appendAssistantDelta(draftId, `\n\n> ${status}\n\n`),
          confirmRound: async (calls) => {
            // 每次确认前拉最新权限配置，保证设置面板的改动立即生效
            let policy = DEFAULT_AGENT_PERMISSION_POLICY;
            try {
              const config = await getAssistantAgentConfig();
              policy = config.permissionPolicy;
            } catch {
              // 拉取失败时按最安全默认处理
            }
            const needsConfirm = calls.some((call) => requiresConfirmForTool(call.name, policy));
            if (!needsConfirm) return true;
            return new Promise<boolean>((resolve) => {
              pendingAgentRoundRef.current = { calls, resolve };
              setPendingAgentCalls(calls);
            });
          },
          executeTool: executeAgentTool,
        });

        if (result.finishedByToolLimit) {
          appendAssistantDelta(draftId, "\n\n（已达到单次工具调用轮次上限，请补充信息后继续对话）");
        }

        if (result.text) {
          // 方案 B 兜底：网关不支持 function calling 时，模型可能用 <invoke> 文本模拟工具调用
          // （未真正执行）。识别已知工具后解析参数、转为真实工具计划执行；危险工具仍走确认。
          const invoke = parseInvokeText(result.text);
          const invokeName = invoke?.name;
          if (invokeName !== undefined && isKnownAgentTool(invokeName)) {
            const params = invoke?.params ?? {};
            replaceAssistantDraft(
              draftId,
              `检测到文本形式的工具调用请求，正在执行 **${toolLabel(invokeName)}**。`,
            );
            const invokePlan: AssistantToolPlan = {
              tool: invokeName,
              params,
              title: toolLabel(invokeName),
              description: `解析到文本工具调用 ${invokeName}（${JSON.stringify(params)}），转为真实工具执行。`,
            };
            if (requiresConfirmation(invokeName)) {
              const pending: PendingToolPlan = {
                ...invokePlan,
                id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
              };
              setPendingTool(pending);
              appendAssistantReply(buildPendingToolMessage(pending));
            } else {
              await executeToolPlan(invokePlan, false);
            }
          } else {
            // 始终用最终完整文本收尾：流式片段替换为完整回复并解析为四大模块结构化数据（ai-2）
            replaceAssistantDraft(draftId, result.text);
            speakAssistantReply(result.text);
          }
        }
      } catch (err) {
        replaceAssistantDraft(draftId, `错误：${getErrorText(err)}`);
      } finally {
        setLoading(false);
      }
    },
    [
      input,
      loading,
      messages,
      contextWindow,
      noteOptions,
      activeProvider,
      activeModel,
      setMessages,
      appendAssistantDelta,
      appendAssistantDraft,
      appendAssistantReply,
      executeAgentTool,
      executeToolPlan,
      replaceAssistantDraft,
      requestModelAgent,
      speakAssistantReply,
    ],
  );

  // 引导联动（ob-4）：input 就绪后自动发送（AI 主动询问 / 「让 AI 帮我创作」）
  useEffect(() => {
    if (autoSendRef.current === null || input !== autoSendRef.current) return;
    const text = autoSendRef.current;
    autoSendRef.current = null;
    void handleSend(text);
  }, [input, handleSend]);

  const confirmPendingTool = useCallback(async () => {
    if (!pendingTool || loading) return;
    const plan = pendingTool;
    setPendingTool(null);
    await executeToolPlan(plan, true);
  }, [pendingTool, loading, executeToolPlan]);

  const cancelPendingTool = useCallback(() => {
    if (!pendingTool || loading) return;
    appendAssistantReply(`已取消工具调用：${toolLabel(pendingTool.tool)}。`);
    setPendingTool(null);
  }, [pendingTool, loading, appendAssistantReply]);

  /** 接受写回审查：把待定工具的优化稿写回笔记，并留在对话记录里标记结果 */
  const applyChatWriteback = useCallback(async () => {
    if (!pendingTool?.review || writebackApplying) return;
    const plan = pendingTool;
    const review = pendingTool.review;
    setWritebackApplying(true);
    try {
      const response = await executeAssistantTool<{ note?: { id: string; title?: string } }>({
        tool: plan.tool,
        params: plan.params,
        confirmed: true,
      });
      const noteTitle =
        (typeof response.data?.note?.title === "string" && response.data.note.title) ||
        review.title;
      appendAssistantReply(`已接受变更，已将优化稿写回笔记「${noteTitle}」。`);
      setWritebackResolved("applied");
    } catch (err) {
      appendAssistantReply(`写回失败：${getErrorText(err)}`);
    } finally {
      setWritebackApplying(false);
    }
  }, [pendingTool, writebackApplying, appendAssistantReply]);

  /** 放弃写回审查：取消写回，并在对话记录里标记结果 */
  const cancelChatWriteback = useCallback(() => {
    if (!pendingTool?.review || writebackApplying) return;
    appendAssistantReply(`已放弃本次写回变更（${pendingTool.review.title}），原笔记保持不变。`);
    setWritebackResolved("cancelled");
  }, [pendingTool, writebackApplying, appendAssistantReply]);

  /** 把拖入对话面板的笔记/文档以 # 提及的形式追加到输入框 */
  const handleDropNote = useCallback(
    async (payload: { id?: string; title?: string }) => {
      let title = payload.title;
      if (!title && payload.id) {
        title = noteOptions.find((note) => note.id === payload.id)?.title;
        if (!title) {
          try {
            const note = await getNote(payload.id);
            title = note.title || undefined;
          } catch {
            title = undefined;
          }
        }
      }
      if (!title) return;
      const token = formatNoteReferenceToken(title, payload.id);
      setInput((prev) => {
        const needsSpace = prev.length > 0 && !/\s$/.test(prev);
        return prev + (needsSpace ? " " : "") + "#" + token + " ";
      });
    },
    [noteOptions],
  );

  useEffect(() => {
    window.localStorage.setItem("sidebar_chat_panel_width", String(chatPanelWidth));
  }, [chatPanelWidth]);

  useEffect(() => {
    window.localStorage.setItem("sidebar_chat_task_panel_width", String(taskPanelWidth));
  }, [taskPanelWidth]);

  useEffect(() => {
    return () => {
      if (resizeFrameRef.current !== null) {
        window.cancelAnimationFrame(resizeFrameRef.current);
      }
    };
  }, []);

  const resizePanels = useCallback(
    (nextWidth: number, target: "chat" | "task") => {
      const nextAsideWidth =
        (target === "task" ? nextWidth : taskPanelOpen ? taskPanelWidth : 0) +
        (target === "chat" ? nextWidth : chatPanelOpen ? chatPanelWidth : 0) +
        (taskPanelOpen ? RESIZE_HANDLE_WIDTH : 0) +
        (chatPanelOpen ? RESIZE_HANDLE_WIDTH : 0);

      if (target === "chat" && chatPanelRef.current) {
        chatPanelRef.current.style.width = `${nextWidth}px`;
      }
      if (target === "task" && taskPanelRef.current) {
        taskPanelRef.current.style.width = `${nextWidth}px`;
      }
      if (asideRef.current) {
        asideRef.current.style.width = `${nextAsideWidth}px`;
      }
    },
    [chatPanelOpen, chatPanelWidth, taskPanelOpen, taskPanelWidth],
  );

  const scheduleResize = useCallback(
    (nextWidth: number, target: "chat" | "task") => {
      if (resizeFrameRef.current !== null) {
        window.cancelAnimationFrame(resizeFrameRef.current);
      }
      resizeFrameRef.current = window.requestAnimationFrame(() => {
        resizeFrameRef.current = null;
        resizePanels(nextWidth, target);
      });
    },
    [resizePanels],
  );

  /** 拖动对话面板右侧手柄调节对话区宽度 */
  const startChatWidthDrag = useCallback(
    (event: React.MouseEvent) => {
      event.preventDefault();
      const startX = event.clientX;
      const startWidth = chatPanelWidth;
      setChatWidthDragging(true);

      let lastWidth = startWidth;
      const onMove = (ev: MouseEvent) => {
        lastWidth = clamp(
          startWidth + (ev.clientX - startX),
          CHAT_PANEL_MIN_WIDTH,
          CHAT_PANEL_MAX_WIDTH,
        );
        scheduleResize(lastWidth, "chat");
      };
      const onUp = () => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        if (resizeFrameRef.current !== null) {
          window.cancelAnimationFrame(resizeFrameRef.current);
          resizeFrameRef.current = null;
        }
        resizePanels(lastWidth, "chat");
        setChatPanelWidth(lastWidth);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        document.body.classList.remove("sidebar-chat-resizing");
        setChatWidthDragging(false);
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      document.body.classList.add("sidebar-chat-resizing");
    },
    [chatPanelWidth, resizePanels, scheduleResize],
  );

  /** 拖动对话面板左侧分隔线，仅调节任务栏宽度 */
  const startTaskWidthDrag = useCallback(
    (event: React.MouseEvent) => {
      event.preventDefault();
      const startX = event.clientX;
      const startWidth = taskPanelWidth;
      setChatWidthDragging(true);

      let lastWidth = startWidth;
      const onMove = (ev: MouseEvent) => {
        lastWidth = clamp(
          startWidth + (ev.clientX - startX),
          TASK_PANEL_MIN_WIDTH,
          TASK_PANEL_MAX_WIDTH,
        );
        scheduleResize(lastWidth, "task");
      };
      const onUp = () => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        if (resizeFrameRef.current !== null) {
          window.cancelAnimationFrame(resizeFrameRef.current);
          resizeFrameRef.current = null;
        }
        resizePanels(lastWidth, "task");
        setTaskPanelWidth(lastWidth);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        document.body.classList.remove("sidebar-chat-resizing");
        setChatWidthDragging(false);
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      document.body.classList.add("sidebar-chat-resizing");
    },
    [resizePanels, scheduleResize, taskPanelWidth],
  );

  const asideWidth =
    (taskPanelOpen ? taskPanelWidth + RESIZE_HANDLE_WIDTH : 0) +
    (chatPanelOpen ? chatPanelWidth + RESIZE_HANDLE_WIDTH : 0);

  return (
    <aside
      ref={asideRef}
      style={{ width: open && asideWidth > 0 ? `${asideWidth}px` : "0px" }}
      className={`sidebar-chat-panel relative shrink-0 h-full flex flex-col bg-paper border-r border-paper-deep/15 transition-[width,opacity,margin] duration-300 ease-out overflow-hidden ${
        chatWidthDragging ? "transition-none" : ""
      } ${open && asideWidth > 0 ? "opacity-100" : "opacity-0 border-r-0"}`}
      onDragEnter={() => {
        setChatDragOver(true);
      }}
      onDragOver={(e) => {
        // Tauri WebView2 内拖拽自定义 MIME 时 types 可能不稳定；始终阻止默认行为以允许 drop。
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setChatDragOver(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setChatDragOver(false);
        const payload = getDropPayload(e.dataTransfer);
        if (payload) void handleDropNote(payload);
      }}
    >
      {chatDragOver && (
        <div className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center bg-bamboo/10">
          <div className="rounded-full border border-bamboo/50 bg-paper px-3 py-1.5 text-[11px] font-medium text-bamboo shadow-lg">
            松开以在对话中引用该笔记
          </div>
        </div>
      )}
      <div className="h-full flex overflow-hidden">
        {/* 任务列表面板（对话栏的左侧栏） */}
        {taskPanelOpen && (
          <div
            ref={taskPanelRef}
            style={{ width: taskPanelWidth }}
            className="sidebar-chat-task-panel shrink-0 flex flex-col min-w-[180px] max-w-[320px] border-r border-paper-deep/15 bg-paper-warm/30"
          >
            <div className="shrink-0 flex items-center justify-between px-3 py-2.5 border-b border-paper-deep/20">
              <span className="text-[11px] font-semibold text-ink-ghost">任务列表</span>
              <div className="flex items-center gap-1">
                <span className="text-[9px] text-ink-ghost">{tasks.length} 个</span>
                {!chatPanelOpen && (
                  <button
                    type="button"
                    onClick={() => setChatPanelOpen(true)}
                    className="w-5 h-5 flex items-center justify-center rounded-md text-ink-ghost hover:text-ink-faint hover:bg-paper-warm transition-all cursor-pointer"
                    title="展开对话栏"
                  >
                    <svg
                      width="10"
                      height="10"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                      <path d="M8 10h.01M12 10h.01M16 10h.01" />
                    </svg>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setTaskPanelOpen(false)}
                  className="w-5 h-5 flex items-center justify-center rounded-md text-ink-ghost hover:text-ink-faint hover:bg-paper-warm transition-all cursor-pointer"
                  title="收起任务栏"
                >
                  <svg
                    width="10"
                    height="10"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                  >
                    <path d="M15 18l-6-6 6-6" />
                  </svg>
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto px-2.5 py-2.5 space-y-1.5 min-h-0">
              {tasks.map((task) => {
                const userCount = task.messages.filter((m) => m.role === "user").length;
                const isActive = task.id === activeTask.id;
                const isRenaming = renamingTaskId === task.id;
                return (
                  <div key={task.id} className="group relative">
                    <button
                      type="button"
                      onClick={() => {
                        setActiveTaskId(task.id);
                        setPendingTool(null);
                        cancelPendingAgentRound();
                        setChatPanelOpen(true);
                      }}
                      className={`w-full rounded-xl border px-2.5 py-2 pr-7 text-left transition-all cursor-pointer ${
                        isActive
                          ? "border-bamboo/30 bg-bamboo-mist/50"
                          : "border-paper-deep/20 bg-paper-warm/50 hover:border-bamboo/25 hover:bg-bamboo-mist/25"
                      }`}
                    >
                      {isRenaming ? (
                        <input
                          autoFocus
                          value={renameDraft}
                          onChange={(e) => setRenameDraft(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") commitRenameTask();
                            if (e.key === "Escape") {
                              setRenamingTaskId(null);
                              setRenameDraft("");
                            }
                          }}
                          onClick={(e) => e.stopPropagation()}
                          className="w-full rounded-md bg-cloud px-1.5 py-0.5 text-[11.5px] font-medium text-ink outline-none"
                          placeholder="任务名称"
                        />
                      ) : (
                        <>
                          <div className="flex items-center justify-between gap-2">
                            <span className="truncate text-[11.5px] font-medium text-ink">
                              {task.title}
                            </span>
                            <span className="shrink-0 rounded-full bg-paper/70 px-1.5 py-0.5 text-[9px] text-ink-faint">
                              {userCount} 条
                            </span>
                          </div>
                          <div className="mt-1 flex items-center justify-between gap-2">
                            <span className="truncate text-[9.5px] text-ink-ghost">
                              {task.messages.length > 0
                                ? (task.messages[task.messages.length - 1]?.content ?? "")
                                    .replace(/\s+/g, " ")
                                    .slice(0, 22)
                                : "还没有消息"}
                            </span>
                            <span className="shrink-0 text-[9px] text-ink-ghost/70">
                              {formatTaskTime(task.updatedAt)}
                            </span>
                          </div>
                        </>
                      )}
                    </button>

                    {!isRenaming && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setMenuTaskId((id) => (id === task.id ? null : task.id));
                        }}
                        className="absolute right-1.5 top-2 w-5 h-5 flex items-center justify-center rounded-md bg-paper/90 text-ink-faint shadow-sm hover:bg-paper-warm hover:text-ink transition-all cursor-pointer opacity-0 group-hover:opacity-100"
                        title="任务操作"
                      >
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor">
                          <circle cx="5" cy="12" r="1.8" />
                          <circle cx="12" cy="12" r="1.8" />
                          <circle cx="19" cy="12" r="1.8" />
                        </svg>
                      </button>
                    )}

                    {menuTaskId === task.id && (
                      <div className="absolute right-2 top-8 z-20 w-28 rounded-lg border border-paper-deep/20 bg-paper shadow-xl py-1">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            startRenameTask(task);
                          }}
                          className="w-full px-2.5 py-1.5 text-left text-[11px] text-ink-soft hover:bg-paper-warm transition-colors"
                        >
                          重命名
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            deleteTask(task.id);
                          }}
                          className="w-full px-2.5 py-1.5 text-left text-[11px] text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors"
                        >
                          删除任务
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
              {tasks.length === 0 && (
                <div className="rounded-xl border border-dashed border-paper-deep/25 px-3 py-5 text-center text-[10px] text-ink-ghost">
                  暂无任务，点击「新建任务」开始
                </div>
              )}
            </div>
            <div className="shrink-0 px-2.5 py-2.5 border-t border-paper-deep/15">
              <button
                type="button"
                onClick={createNewTask}
                className="w-full h-7 rounded-lg bg-bamboo text-[11px] font-medium text-cloud hover:bg-bamboo-light transition-all cursor-pointer"
                title="新建任务"
              >
                + 新建任务
              </button>
            </div>
          </div>
        )}

        {taskPanelOpen && chatPanelOpen && (
          <div
            className="w-[6px] shrink-0 cursor-col-resize bg-transparent hover:bg-paper-deep/25 active:bg-paper-deep/35 transition-colors"
            onMouseDown={startTaskWidthDrag}
            title="拖动调节任务栏宽度"
          />
        )}

        {/* 对话面板 */}
        {chatPanelOpen && (
          <>
            <div
              ref={chatPanelRef}
              style={{ width: chatPanelWidth }}
              className="sidebar-chat-conversation relative shrink-0 flex flex-col min-w-[340px] max-w-[640px] contain-layout"
            >
              <div className="shrink-0 flex min-h-[44px] items-center justify-between gap-2 px-3 py-2.5 border-b border-paper-deep/20">
                <div className="flex items-center gap-2 min-w-0 overflow-hidden">
                  <svg
                    width="15"
                    height="15"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="text-bamboo shrink-0"
                  >
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                    <path d="M8 10h.01M12 10h.01M16 10h.01" />
                  </svg>
                  <span className="shrink-0 text-[13px] font-display font-semibold text-ink select-none">
                    AI 助手
                  </span>
                  <span className="min-w-0 max-w-[140px] truncate rounded-full bg-paper-warm/70 px-2 py-0.5 text-[9px] text-ink-ghost">
                    {activeTask.title}
                  </span>
                </div>

                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={stopSpeech}
                    className={`w-6 h-6 flex items-center justify-center rounded-md transition-all cursor-pointer ${
                      speechPlaying
                        ? "bg-red-50 text-red-500 hover:bg-red-100 dark:bg-red-500/10 dark:hover:bg-red-500/15"
                        : "text-ink-ghost hover:text-ink-faint hover:bg-paper-warm"
                    }`}
                    title={speechPlaying ? "停止当前 AI 朗读" : "停止 AI 朗读"}
                  >
                    <svg
                      width="11"
                      height="11"
                      viewBox="0 0 24 24"
                      fill="currentColor"
                      aria-hidden="true"
                    >
                      <rect x="6" y="6" width="12" height="12" rx="1.5" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    onClick={toggleChanges}
                    className="w-6 h-6 flex items-center justify-center rounded-md text-ink-ghost hover:text-ink-faint hover:bg-paper-warm transition-all cursor-pointer"
                    title="历史变更（AI 写回与恢复记录）"
                  >
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
                      <polyline points="3 3 3 8 8 8" />
                      <path d="M12 7v5l3 2" />
                    </svg>
                  </button>
                  {!taskPanelOpen && (
                    <button
                      type="button"
                      onClick={() => setTaskPanelOpen(true)}
                      className="w-6 h-6 flex items-center justify-center rounded-md text-ink-ghost hover:text-ink-faint hover:bg-paper-warm transition-all cursor-pointer"
                      title="展开任务栏"
                    >
                      <svg
                        width="12"
                        height="12"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <line x1="8" y1="6" x2="21" y2="6" />
                        <line x1="8" y1="12" x2="21" y2="12" />
                        <line x1="8" y1="18" x2="21" y2="18" />
                        <line x1="3" y1="6" x2="3.01" y2="6" />
                        <line x1="3" y1="12" x2="3.01" y2="12" />
                        <line x1="3" y1="18" x2="3.01" y2="18" />
                      </svg>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={clearHistory}
                    className="w-6 h-6 flex items-center justify-center rounded-md text-ink-ghost hover:text-ink-faint hover:bg-paper-warm transition-all cursor-pointer"
                    title="清空对话（上下文记忆）"
                  >
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <polyline points="3 6 5 6 21 6" />
                      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    onClick={() => setChatPanelOpen(false)}
                    className="w-6 h-6 flex items-center justify-center rounded-md text-ink-ghost hover:text-ink-faint hover:bg-paper-warm transition-all cursor-pointer"
                    title="收起对话栏"
                  >
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                    >
                      <path d="M15 18l-6-6 6-6" />
                    </svg>
                  </button>
                </div>
              </div>

              {pendingTool && !pendingTool.review && (
                <div className="shrink-0 border-b border-paper-deep/20 bg-bamboo-mist/35 px-3 py-2 text-[11px] text-ink-soft">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-ink">待确认：{pendingTool.title}</span>
                    <span className="rounded-full bg-paper/80 px-2 py-0.5 text-[9px] text-bamboo">
                      {toolLabel(pendingTool.tool)}
                    </span>
                  </div>
                  <p className="mt-1 leading-relaxed text-ink-faint">{pendingTool.description}</p>
                  <pre className="mt-2 max-h-20 overflow-auto rounded-lg bg-paper/80 p-2 font-mono text-[10px] leading-relaxed text-ink-faint whitespace-pre-wrap">
                    {formatToolParams(pendingTool.params)}
                  </pre>
                  <div className="mt-2 flex gap-2">
                    <button
                      type="button"
                      onClick={() => void confirmPendingTool()}
                      disabled={loading}
                      className="rounded-lg bg-bamboo px-3 py-1.5 text-[11px] font-medium text-cloud disabled:opacity-50"
                    >
                      确认执行
                    </button>
                    <button
                      type="button"
                      onClick={cancelPendingTool}
                      disabled={loading}
                      className="rounded-lg border border-paper-deep/30 bg-paper px-3 py-1.5 text-[11px] text-ink-faint disabled:opacity-50"
                    >
                      取消
                    </button>
                  </div>
                </div>
              )}

              {pendingAgentCalls && pendingAgentCalls.length > 0 && (
                <div className="shrink-0 border-b border-paper-deep/20 bg-bamboo-mist/35 px-3 py-2 text-[11px] text-ink-soft">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-ink">待确认工具调用</span>
                    <span className="rounded-full bg-paper/80 px-2 py-0.5 text-[9px] text-bamboo">
                      {pendingAgentCalls.length} 个
                    </span>
                  </div>
                  <ul className="mt-1.5 space-y-1">
                    {pendingAgentCalls.map((call, index) => (
                      <li
                        key={call.id || `${call.name}-${index}`}
                        className="flex items-start gap-1.5"
                      >
                        <span className="mt-px shrink-0 rounded bg-paper/80 px-1.5 py-0.5 text-[9px] font-medium text-bamboo">
                          {toolDisplayName(call.name)}
                        </span>
                        <span className="break-all font-mono text-[10px] leading-relaxed text-ink-faint">
                          {formatAgentCallSummary(call)}
                        </span>
                      </li>
                    ))}
                  </ul>
                  <div className="mt-2 flex gap-2">
                    <button
                      type="button"
                      onClick={() => resolveAgentRound(true)}
                      disabled={loading}
                      className="rounded-lg bg-bamboo px-3 py-1.5 text-[11px] font-medium text-cloud disabled:opacity-50"
                    >
                      执行本轮
                    </button>
                    <button
                      type="button"
                      onClick={() => resolveAgentRound(false)}
                      disabled={loading}
                      className="rounded-lg border border-paper-deep/30 bg-paper px-3 py-1.5 text-[11px] text-ink-faint disabled:opacity-50"
                    >
                      拒绝
                    </button>
                  </div>
                </div>
              )}

              <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-3 space-y-3 min-h-0">
                {messages.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full text-center select-none">
                    <div className="w-10 h-10 rounded-2xl bg-bamboo-mist/60 flex items-center justify-center mb-2.5">
                      <svg
                        width="18"
                        height="18"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className="text-bamboo"
                      >
                        <path d="M12 3c-4.97 0-9 3.58-9 8 0 2.52 1.32 4.76 3.36 6.22l-1.36 4.78 5.64-3.22c.44.14.9.22 1.36.22 4.97 0 9-3.58 9-8s-4.03-8-9-8z" />
                        <circle cx="9" cy="11" r="0.5" fill="currentColor" />
                        <circle cx="12" cy="10" r="0.5" fill="currentColor" />
                        <circle cx="15" cy="11" r="0.5" fill="currentColor" />
                      </svg>
                    </div>
                    <p className="text-[12px] font-medium text-ink-soft">
                      你好，我是「花笺」AI 助手
                    </p>
                    <p className="mt-1 text-[10px] text-ink-ghost leading-relaxed max-w-[230px]">
                      输入 @ 调用工具、#
                      引用笔记，或直接把笔记卡片拖进对话框引用。优化写回会在对话里生成代码式变更预览，确认前不会修改笔记。
                    </p>
                  </div>
                ) : (
                  messages.map((msg, i) =>
                    msg.role === "user" ? (
                      <UserPromptMessage key={`${msg.createdAt}-${i}`} content={msg.content} />
                    ) : (
                      <AgentTimelineMessage key={`${msg.createdAt}-${i}`} content={msg.content} />
                    ),
                  )
                )}
                {diarySuggestion.status !== "idle" && (
                  <DiarySuggestionCard
                    status={diarySuggestion.status}
                    willFallback={!hasUsableProvider(providers)}
                    onConfirm={() => void diarySuggestion.confirm()}
                    onDismissLater={diarySuggestion.dismissLater}
                    onDismissToday={diarySuggestion.dismissToday}
                  />
                )}
                {pendingTool?.review && (
                  <ChatWritebackReview
                    pendingTool={pendingTool}
                    applying={writebackApplying}
                    resolved={writebackResolved}
                    onApply={() => void applyChatWriteback()}
                    onCancel={cancelChatWriteback}
                  />
                )}
                {loading && messages[messages.length - 1]?.role !== "assistant" && (
                  <AgentTypingMessage />
                )}
              </div>

              {chatTaskNotice && (
                <div className="shrink-0 px-3 py-1.5 text-[10px] text-ink-ghost bg-paper-warm/40 border-t border-paper-deep/20">
                  {chatTaskNotice}
                </div>
              )}
              <div className="shrink-0 px-3 py-2.5 border-t border-paper-deep/20">
                <MentionComposer
                  input={input}
                  onChange={setInput}
                  onSend={() => void handleSend()}
                  loading={loading}
                  placeholder={
                    activeProvider && activeModel
                      ? "输入消息，@ 工具、# 引用笔记，Enter 发送"
                      : "未配置模型：可输入 @搜索笔记 等本地工具指令"
                  }
                  noteOptions={noteOptions}
                  onRefreshNotes={() => void loadNoteOptions()}
                  modelOptions={modelOptions}
                  selectedProviderId={selectedProviderId}
                  selectedModelId={selectedModelId}
                  onPickModel={handlePickModel}
                  activeLabel={
                    activeProvider && activeModel
                      ? `${activeProvider.name} · ${activeModel.displayName || activeModel.modelId}`
                      : "未配置模型"
                  }
                  hasModel={Boolean(activeProvider && activeModel)}
                  agentModeLabel={agentModeLabel}
                />
              </div>
              <div
                className="absolute right-0 top-0 bottom-0 z-20 w-[6px] translate-x-1/2 cursor-col-resize bg-transparent hover:bg-bamboo/30 active:bg-bamboo/40 transition-colors"
                onMouseDown={startChatWidthDrag}
                title="拖动调节对话区域宽度"
              />
            </div>
          </>
        )}
      </div>

      {changesOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/30 backdrop-blur-sm"
          onClick={() => setChangesOpen(false)}
        >
          <div
            className="flex h-[72vh] w-[560px] max-w-[92vw] flex-col rounded-2xl border border-paper-deep/20 bg-paper shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-paper-deep/15 px-4 py-3">
              <span className="text-[13px] font-semibold text-ink">历史变更</span>
              <button
                type="button"
                onClick={() => setChangesOpen(false)}
                className="w-6 h-6 flex items-center justify-center rounded-md text-ink-ghost hover:text-ink-faint hover:bg-paper-warm transition-all cursor-pointer"
                title="关闭"
              >
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto px-3 py-3 space-y-2">
              {changesLoading ? (
                <p className="py-8 text-center text-[11px] text-ink-ghost">加载变更记录中…</p>
              ) : changes.length === 0 ? (
                <p className="py-8 text-center text-[11px] leading-relaxed text-ink-ghost">
                  暂无变更记录。
                  <br />
                  AI 助手写回笔记后会自动保存前后快照，可在这里查看对比并恢复。
                </p>
              ) : (
                changes.map((change) => {
                  const charDelta = change.afterContent.length - change.beforeContent.length;
                  const expanded = expandedChangeId === change.id;
                  return (
                    <div
                      key={change.id}
                      className="rounded-xl border border-paper-deep/20 bg-paper-warm/40 px-3 py-2"
                    >
                      <button
                        type="button"
                        className="w-full text-left"
                        onClick={() => setExpandedChangeId(expanded ? null : change.id)}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate text-[12px] font-medium text-ink">
                            {change.title}
                          </span>
                          <span className="shrink-0 text-[10px] text-ink-ghost">
                            {formatChangeTime(change.timestamp)}
                          </span>
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] text-ink-faint">
                          <span className="rounded bg-bamboo-mist/40 px-1.5 py-0.5 text-bamboo">
                            {change.source === "ai" ? "AI 助手" : "历史恢复"}
                          </span>
                          <span>{change.mode === "replace" ? "整篇覆盖" : "追加内容"}</span>
                          <span className={charDelta >= 0 ? "text-emerald-600" : "text-red-500"}>
                            字数 {charDelta >= 0 ? `+${charDelta}` : charDelta}
                          </span>
                          <span className="ml-auto text-ink-ghost">
                            {expanded ? "收起 ▲" : "查看对比 ▼"}
                          </span>
                        </div>
                      </button>
                      {expanded && (
                        <div className="mt-2 rounded-lg bg-ink/5 px-2 py-2 font-mono text-[11px] leading-relaxed max-h-56 overflow-y-auto">
                          {buildLineDiff(change.beforeContent, change.afterContent).map(
                            (line, index) => (
                              <div
                                key={index}
                                className={
                                  line.type === "add"
                                    ? "bg-emerald-400/10 text-emerald-700"
                                    : line.type === "remove"
                                      ? "bg-red-400/10 text-red-500 line-through decoration-red-400/40"
                                      : "text-ink-faint"
                                }
                              >
                                {line.text || " "}
                              </div>
                            ),
                          )}
                        </div>
                      )}
                      <div className="mt-2 flex justify-end">
                        <button
                          type="button"
                          onClick={() => restoreChange(change)}
                          disabled={restoringChangeId !== null}
                          className="rounded-lg bg-bamboo px-3 py-1.5 text-[11px] font-medium text-cloud disabled:opacity-50"
                        >
                          {restoringChangeId === change.id ? "恢复中…" : "恢复此版本"}
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}

async function readStreamingCompletion(response: Response, onDelta?: (delta: string) => void) {
  const reader = response.body?.getReader();
  if (!reader) return { reply: "", usage: undefined, toolCalls: [] as AgentToolCall[] };

  const decoder = new TextDecoder();
  let buffer = "";
  let rawText = "";
  let reply = "";
  let usage: unknown;
  const toolCalls: AgentToolCall[] = [];

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    const chunk = decoder.decode(value, { stream: true });
    rawText += chunk;
    buffer += chunk;
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;

      try {
        const data = JSON.parse(payload);
        const delta = getCompletionDelta(data);
        if (delta) {
          reply += delta;
          onDelta?.(delta);
        }
        const toolDeltas = getStreamToolCallDelta(data);
        if (toolDeltas) {
          const merged = mergeToolCallDelta(toolCalls, toolDeltas);
          toolCalls.length = 0;
          toolCalls.push(...merged);
        }
        if (data.usage) usage = data.usage;
      } catch {
        // ignore malformed stream frames
      }
    }
  }

  if (!reply.trim() && toolCalls.length === 0) {
    try {
      const data = JSON.parse(rawText.trim());
      reply = getCompletionText(data);
      usage = data.usage;
    } catch {
      // ignore non-json fallback
    }
  }

  return { reply, usage, toolCalls };
}

function getCompletionDelta(data: unknown) {
  if (!isRecord(data)) return "";
  const choices = Array.isArray(data.choices) ? data.choices : [];
  const first = choices[0];
  if (!isRecord(first)) return "";
  const delta = isRecord(first.delta) ? first.delta.content : undefined;
  if (typeof delta === "string") return delta;
  const message = isRecord(first.message) ? first.message.content : undefined;
  return typeof message === "string" ? message : "";
}

function getCompletionText(data: unknown) {
  if (!isRecord(data)) return "";
  const choices = Array.isArray(data.choices) ? data.choices : [];
  const first = choices[0];
  if (!isRecord(first)) return "";
  const message = isRecord(first.message) ? first.message.content : undefined;
  return typeof message === "string" ? message.trim() : "";
}

function logModelUsage(providerName: string, usage: unknown) {
  if (!isRecord(usage)) return;
  const inputTokens = typeof usage.prompt_tokens === "number" ? usage.prompt_tokens : 0;
  const outputTokens = typeof usage.completion_tokens === "number" ? usage.completion_tokens : 0;
  const cachedTokens =
    typeof usage.prompt_cache_hit_tokens === "number"
      ? usage.prompt_cache_hit_tokens
      : typeof usage.cached_tokens === "number"
        ? usage.cached_tokens
        : 0;
  if (inputTokens + outputTokens + cachedTokens > 0) {
    void logUsage(providerName, inputTokens, outputTokens, cachedTokens);
  }
}

function loadChatTasks(): SidebarChatTask[] {
  try {
    const saved = localStorage.getItem(TASKS_STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved) as SidebarChatTask[];
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed
          .filter((task) => task && typeof task.id === "string" && Array.isArray(task.messages))
          .slice(0, 20)
          .map((task) => ({
            ...task,
            title: task.title || getTaskTitle(task, task.messages),
            messages: task.messages.slice(-STORAGE_LIMIT),
            createdAt: typeof task.createdAt === "number" ? task.createdAt : Date.now(),
            updatedAt: typeof task.updatedAt === "number" ? task.updatedAt : Date.now(),
          }));
      }
    }

    const legacy = localStorage.getItem(LEGACY_MESSAGES_STORAGE_KEY);
    if (legacy) {
      const parsed = JSON.parse(legacy) as SidebarChatMessage[];
      if (Array.isArray(parsed) && parsed.length > 0) {
        const task = createChatTask(parsed.slice(-STORAGE_LIMIT));
        return [{ ...task, title: getTaskTitle(task, task.messages) }];
      }
    }
  } catch {
    // ignore
  }
  return [createChatTask()];
}

function createChatTask(messages: SidebarChatMessage[] = []): SidebarChatTask {
  const now = Date.now();
  const task: SidebarChatTask = {
    id: `${now}-${Math.random().toString(36).slice(2)}`,
    title: "新任务",
    messages,
    createdAt: now,
    updatedAt: now,
  };
  return { ...task, title: getTaskTitle(task, messages) };
}

function getTaskTitle(task: SidebarChatTask, messages: SidebarChatMessage[]) {
  const firstUserMessage = messages.find(
    (message) => message.role === "user" && message.content.trim(),
  );
  if (firstUserMessage) return firstUserMessage.content.trim().replace(/\s+/g, " ").slice(0, 18);
  return task.title && task.title !== "新任务" ? task.title : "新任务";
}

function formatTaskTime(value: number) {
  const date = new Date(value);
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  return sameDay
    ? date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })
    : date.toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" });
}

/** 待确认横幅上展示单次工具调用的参数摘要 */
function formatAgentCallSummary(call: AgentToolCall): string {
  const params = parseToolArguments(call.arguments);
  const parts = Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== "")
    .map(([key, value]) => {
      const text = typeof value === "string" ? value : JSON.stringify(value);
      return `${key}=${text.length > 40 ? `${text.slice(0, 40)}…` : text}`;
    });
  return parts.length > 0 ? parts.join(" ") : "无参数";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
