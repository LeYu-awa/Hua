import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ProviderConfig } from "../features/settings/types";
import { logUsage } from "../features/settings/stats";
import {
  distillChatMessages,
  type ChatMessage,
  type DistillSuggestion,
} from "../features/agent/chatDistill";
import { getCanvasDocument, saveCanvasDocument } from "../features/canvas/api";
import type { CanvasNode } from "../features/canvas/types";

interface Message {
  role: "user" | "assistant" | "system";
  content: string;
}

interface DeepSeekChatProps {
  open: boolean;
  onClose: () => void;
  docTitle: string;
  docContent: string;
  providers: ProviderConfig[];
  /** 当前笔记 ID，用于把聊天沉淀写入对应画布 */
  noteId?: string;
  /** Agent 总开关 */
  agentEnabled?: boolean;
}

const SYSTEM_PROMPT =
  "你是一个文档分析助手。用户会向你提问关于当前文档的问题。请根据文档内容给出简洁、准确的回答。如果问题与文档无关，也可以直接回答。当前文档如下：";

function buildInitialMessages(title: string, content: string): Message[] {
  const docInfo = `文档标题：${title || "无标题"}\n\n文档内容：\n${content}`;
  return [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: docInfo },
    { role: "assistant", content: "已理解文档内容，有什么我可以帮你的吗？" },
  ];
}

export function DeepSeekChat({
  open,
  onClose,
  docTitle,
  docContent,
  providers,
  noteId,
  agentEnabled = false,
}: DeepSeekChatProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [initDone, setInitDone] = useState(false);
  const [panelHeight, setPanelHeight] = useState(320);
  const [taskPanelRatio, setTaskPanelRatio] = useState(0.24);
  const [selectedProviderId, setSelectedProviderId] = useState<string>("");
  const [selectedModelId, setSelectedModelId] = useState<string>("");
  // 场景九：聊天沉淀为画布节点
  const [dismissedDistill, setDismissedDistill] = useState<Set<string>>(() => new Set());
  const [sunkDistill, setSunkDistill] = useState<Set<string>>(() => new Set());
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentAreaRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // 启用的供应商
  const enabledProviders = useMemo(
    () => providers.filter((p) => p.enabled && p.models.length > 0),
    [providers],
  );

  // 选中的供应商
  const activeProvider = useMemo(
    () => enabledProviders.find((p) => p.id === selectedProviderId) ?? enabledProviders[0] ?? null,
    [enabledProviders, selectedProviderId],
  );

  // 选中供应商的模型列表
  const activeModels = useMemo(() => activeProvider?.models ?? [], [activeProvider]);

  // 选中的模型
  const activeModel = useMemo(
    () => activeModels.find((m) => m.modelId === selectedModelId) ?? activeModels[0],
    [activeModels, selectedModelId],
  );

  // 初始化默认选中的供应商和模型
  useEffect(() => {
    if (enabledProviders.length > 0 && !selectedProviderId) {
      // 优先选 DeepSeek
      const ds = enabledProviders.find((p) => p.name.toLowerCase().includes("deepseek"));
      const provider = ds ?? enabledProviders[0];
      setSelectedProviderId(provider.id);
      setSelectedModelId(provider.models[0]?.modelId ?? "");
    }
  }, [enabledProviders, selectedProviderId]);

  // 初始化：首次打开时传入文档内容
  useEffect(() => {
    if (open && !initDone) {
      setMessages(buildInitialMessages(docTitle, docContent));
      setInitDone(true);
    }
    if (!open) {
      setInitDone(false);
    }
  }, [open, initDone, docTitle, docContent]);

  // 当文档内容变化时更新上下文
  useEffect(() => {
    if (open && initDone) {
      setMessages((prev) => {
        const next = [...prev];
        const docInfo = `文档标题：${docTitle || "无标题"}\n\n文档内容：\n${docContent}`;
        next[0] = { role: "system", content: SYSTEM_PROMPT };
        next[1] = { role: "user", content: docInfo };
        return next;
      });
    }
  }, [open, initDone, docTitle, docContent]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 150);
    }
  }, [open]);

  const handleResizeStart = (e: React.MouseEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startHeight = panelHeight;

    const onMove = (ev: MouseEvent) => {
      const delta = startY - ev.clientY;
      setPanelHeight(Math.min(Math.max(startHeight + delta, 150), window.innerHeight * 0.7));
    };
    const onUp = () => {
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };

    document.body.style.userSelect = "none";
    document.body.style.cursor = "row-resize";
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };

  const handleTaskResizeStart = (e: React.MouseEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startRatio = taskPanelRatio;
    const areaHeight = contentAreaRef.current?.getBoundingClientRect().height ?? panelHeight;

    const onMove = (ev: MouseEvent) => {
      const delta = startY - ev.clientY;
      const nextRatio = startRatio + delta / Math.max(areaHeight, 1);
      setTaskPanelRatio(Math.min(Math.max(nextRatio, 0.16), 0.48));
    };
    const onUp = () => {
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };

    document.body.style.userSelect = "none";
    document.body.style.cursor = "row-resize";
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };

  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || loading || !activeProvider || !activeModel) return;

    const userMsg: Message = { role: "user", content: text };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput("");
    setLoading(true);

    const apiUrl = activeProvider.baseUrl.replace(/\/+$/, "") + activeProvider.apiPath;

    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (activeProvider.apiKey) {
        headers["Authorization"] = `Bearer ${activeProvider.apiKey}`;
      }

      const response = await fetch(apiUrl, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: activeModel.modelId,
          messages: newMessages.map((m) => ({ role: m.role, content: m.content })),
          stream: false,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`API 错误 (${response.status}): ${errorText}`);
      }

      const data = await response.json();
      const reply: Message = {
        role: "assistant",
        content: data.choices?.[0]?.message?.content ?? "（未收到回复）",
      };
      setMessages((prev) => [...prev, reply]);

      // 记录用量到统计
      const usage = data.usage ?? {};
      const inputTokens = (usage.prompt_tokens as number) ?? 0;
      const outputTokens = (usage.completion_tokens as number) ?? 0;
      const cachedTokens =
        (usage.prompt_cache_hit_tokens as number) ?? (usage.cached_tokens as number) ?? 0;
      if (inputTokens + outputTokens + cachedTokens > 0) {
        void logUsage(activeProvider.name, inputTokens, outputTokens, cachedTokens);
      }
    } catch (err) {
      const errorMsg: Message = {
        role: "assistant",
        content: `错误：${err instanceof Error ? err.message : "未知错误"}`,
      };
      setMessages((prev) => [...prev, errorMsg]);
    } finally {
      setLoading(false);
    }
  }, [input, loading, messages, activeProvider, activeModel]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void sendMessage();
    }
  };

  // 场景九：把「决策 / 待办 / 风险」类消息识别出来，建议沉淀成画布节点（可忽略）
  const distillSuggestions = useMemo<DistillSuggestion[]>(() => {
    if (!agentEnabled || !noteId) return [];
    const chatMessages: ChatMessage[] = messages
      .slice(2)
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m, i) => ({
        id: `chat-${i}`,
        docId: noteId,
        senderId: m.role,
        content: m.content,
        createdAt: i,
      }));
    return distillChatMessages(chatMessages);
  }, [messages, agentEnabled, noteId]);

  const visibleSuggestions = useMemo(
    () =>
      distillSuggestions.filter(
        (s) => !dismissedDistill.has(s.messageId) && !sunkDistill.has(s.messageId),
      ),
    [distillSuggestions, dismissedDistill, sunkDistill],
  );

  const sinkToCanvas = useCallback(
    async (suggestion: DistillSuggestion) => {
      if (!noteId) return;
      const docId = `canvas-${noteId}`;
      try {
        let canvasDoc = await getCanvasDocument(docId).catch(() => null);
        if (!canvasDoc) {
          canvasDoc = { id: docId, noteId, nodes: [], edges: [] };
        }
        const offset = canvasDoc.nodes.length;
        const newNode: CanvasNode = {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          type: "card",
          x: 120 + (offset % 4) * 60,
          y: 120 + (offset % 4) * 40,
          width: 240,
          height: 120,
          // 保留来源可追溯：文案 + 来自聊天标注
          text: `${suggestion.suggestedText}\n\n— 来自聊天`,
          source: "agent",
        };
        await saveCanvasDocument({ ...canvasDoc, nodes: [...canvasDoc.nodes, newNode] });
        setSunkDistill((prev) => new Set(prev).add(suggestion.messageId));
      } catch {
        // 写入失败静默降级（例如非 Tauri 运行时）
        setSunkDistill((prev) => new Set(prev).add(suggestion.messageId));
      }
    },
    [noteId],
  );

  const CATEGORY_LABEL: Record<string, string> = {
    decision: "决策",
    todo: "待办",
    risk: "风险",
    question: "问题",
    chatter: "闲聊",
  };

  return (
    <div
      className={`relative w-full shrink-0 border-t border-paper-deep/20 bg-paper/90 transition-all duration-300 ease-out flex flex-col overflow-hidden ${
        open ? "opacity-100" : "h-0 opacity-0 border-t-0"
      }`}
      style={{ height: open ? panelHeight : 0 }}
    >
      {/* 拖拽手柄 */}
      <div
        className="shrink-0 h-2 cursor-row-resize hover:bg-bamboo/15 transition-colors flex items-center justify-center"
        onMouseDown={handleResizeStart}
      >
        <div className="w-10 h-[3px] rounded-full bg-paper-deep/40 hover:bg-bamboo/50 transition-colors" />
      </div>

      <div ref={contentAreaRef} className="flex-1 flex flex-col min-h-0 w-full px-4">
        {/* 标题栏 */}
        <div className="flex items-center justify-between py-2 shrink-0">
          <div className="flex items-center gap-2 min-w-0">
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

            {activeProvider ? (
              <div className="flex items-center gap-1.5 min-w-0">
                {/* 供应商选择 */}
                <select
                  value={selectedProviderId}
                  onChange={(e) => {
                    const pid = e.target.value;
                    setSelectedProviderId(pid);
                    const p = enabledProviders.find((x) => x.id === pid);
                    if (p?.models[0]) setSelectedModelId(p.models[0].modelId);
                  }}
                  className="h-6 px-1.5 rounded-md bg-paper-warm/60 border border-paper-deep/30 text-[11px] font-mono text-ink-soft cursor-pointer outline-none max-w-[100px] truncate"
                >
                  {enabledProviders.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>

                {/* 模型选择 */}
                {activeModels.length > 1 && (
                  <select
                    value={selectedModelId}
                    onChange={(e) => setSelectedModelId(e.target.value)}
                    className="h-6 px-1.5 rounded-md bg-paper-warm/60 border border-paper-deep/30 text-[10px] font-mono text-ink-faint cursor-pointer outline-none max-w-[120px] truncate"
                  >
                    {activeModels.map((m) => (
                      <option key={m.modelId} value={m.modelId}>
                        {m.displayName}
                      </option>
                    ))}
                  </select>
                )}

                <span className="text-[10px] text-ink-ghost">· 分析当前文档</span>
              </div>
            ) : (
              <span className="text-[11px] text-ink-ghost">请先在设置中添加并启用供应商</span>
            )}
          </div>

          <button
            onClick={onClose}
            className="w-6 h-6 flex items-center justify-center rounded-md text-ink-ghost hover:text-ink-faint hover:bg-paper-warm transition-all cursor-pointer shrink-0 ml-2"
            title="关闭"
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
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* 消息列表 */}
        {!activeProvider ? (
          <div className="flex-1 flex items-center justify-center text-[12px] text-ink-ghost">
            请在设置 → 供应商中添加并启用一个供应商以使用 AI 助手
          </div>
        ) : (
          <div
            ref={scrollRef}
            className="overflow-y-auto pb-2 space-y-3 min-h-[96px]"
            style={{ flex: visibleSuggestions.length > 0 ? `${1 - taskPanelRatio} 1 0` : "1 1 0" }}
          >
            {messages.slice(2).map((msg, i) => (
              <div
                key={i}
                className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
              >
                {msg.role === "user" ? (
                  <div className="max-w-[80%] rounded-xl px-3.5 py-2 text-[13px] leading-relaxed bg-bamboo text-cloud">
                    {msg.content}
                  </div>
                ) : (
                  <div className="max-w-[80%] rounded-xl px-3.5 py-2 text-[13px] leading-relaxed bg-paper-warm/80 text-ink-soft border border-paper-deep/20 [&_h1]:text-[15px] [&_h1]:font-bold [&_h1]:text-ink [&_h1]:mb-1 [&_h2]:text-[14px] [&_h2]:font-bold [&_h2]:text-ink [&_h2]:mb-1 [&_h3]:text-[13px] [&_h3]:font-semibold [&_h3]:text-ink [&_p]:mb-1.5 [&_ul]:mb-1.5 [&_ul]:pl-4 [&_ul]:list-disc [&_ol]:mb-1.5 [&_ol]:pl-4 [&_ol]:list-decimal [&_li]:mb-0.5 [&_strong]:text-ink [&_strong]:font-semibold [&_code]:text-bamboo [&_code]:bg-bamboo-mist/60 [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-[12px] [&_pre]:bg-paper-deep/30 [&_pre]:text-ink-soft [&_pre]:p-2 [&_pre]:rounded-lg [&_pre]:text-[12px] [&_pre]:overflow-x-auto [&_pre]:mb-1.5 [&_a]:text-bamboo [&_a]:underline [&_blockquote]:border-l-2 [&_blockquote]:border-bamboo/40 [&_blockquote]:pl-3 [&_blockquote]:text-ink-faint [&_table]:w-full [&_table]:text-left [&_th]:font-semibold [&_th]:text-ink [&_th]:p-1 [&_td]:p-1 [&_hr]:border-paper-deep/30 [&_hr]:my-2">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
                  </div>
                )}
              </div>
            ))}
            {loading && (
              <div className="flex justify-start">
                <div className="bg-paper-warm/80 border border-paper-deep/20 rounded-xl px-3.5 py-2 flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-bamboo/60 animate-bounce [animation-delay:-0.3s]" />
                  <span className="w-1.5 h-1.5 rounded-full bg-bamboo/60 animate-bounce [animation-delay:-0.15s]" />
                  <span className="w-1.5 h-1.5 rounded-full bg-bamboo/60 animate-bounce" />
                </div>
              </div>
            )}
          </div>
        )}

        {visibleSuggestions.length > 0 && (
          <div
            className="shrink-0 h-2 cursor-row-resize hover:bg-bamboo/15 transition-colors flex items-center justify-center"
            onMouseDown={handleTaskResizeStart}
            title="拖拽同步调整对话区与任务区高度"
          >
            <div className="w-10 h-[3px] rounded-full bg-paper-deep/40 hover:bg-bamboo/50 transition-colors" />
          </div>
        )}

        {/* 场景九：聊天沉淀建议 */}
        {visibleSuggestions.length > 0 && (
          <div
            className="shrink-0 overflow-y-auto border-t border-bamboo/20 pt-2 pb-1 space-y-1.5 min-h-[72px]"
            style={{ flexBasis: `${taskPanelRatio * 100}%` }}
          >
            {visibleSuggestions.map((s) => (
              <div
                key={s.messageId}
                className="flex items-start gap-2 rounded-lg bg-bamboo-mist/40 border border-bamboo/20 px-2.5 py-1.5 animate-fade-in"
              >
                <span className="shrink-0 mt-0.5 text-[9px] px-1.5 py-0.5 rounded-full bg-bamboo/15 text-bamboo font-medium">
                  {CATEGORY_LABEL[s.category] ?? s.category}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-[11px] text-ink-soft leading-snug truncate">
                    {s.suggestedText}
                  </div>
                  <div className="text-[10px] text-ink-ghost/70 mt-0.5">{s.message}</div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => void sinkToCanvas(s)}
                    className="text-[10px] px-2 py-1 rounded-md bg-bamboo text-cloud hover:bg-bamboo-light transition-colors cursor-pointer"
                  >
                    沉淀到画布
                  </button>
                  <button
                    type="button"
                    onClick={() => setDismissedDistill((prev) => new Set(prev).add(s.messageId))}
                    className="text-[10px] px-1.5 py-1 rounded-md text-ink-ghost hover:bg-paper-deep/20 transition-colors cursor-pointer"
                  >
                    忽略
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* 输入区 */}
        <div className="py-2.5 border-t border-paper-deep/20 shrink-0">
          <div className="flex items-end gap-2">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={activeProvider ? "输入问题，按 Enter 发送……" : "请先配置供应商"}
              rows={1}
              disabled={!activeProvider}
              className="flex-1 resize-none rounded-lg px-3 py-2 text-[13px] font-body text-ink placeholder:text-ink-ghost/50 bg-paper-warm/60 border border-paper-deep/30 focus:border-bamboo/30 focus:bg-cloud transition-all disabled:opacity-50"
            />
            <button
              onClick={() => void sendMessage()}
              disabled={!input.trim() || loading || !activeProvider}
              className="shrink-0 w-8 h-8 flex items-center justify-center rounded-lg bg-bamboo text-cloud hover:bg-bamboo-light disabled:opacity-40 disabled:cursor-not-allowed transition-all cursor-pointer"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <line x1="12" y1="19" x2="12" y2="5" />
                <polyline points="5 12 12 5 19 12" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
