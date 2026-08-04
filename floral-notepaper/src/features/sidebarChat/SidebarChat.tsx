import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ProviderConfig } from "../settings/types";
import { logUsage } from "../settings/stats";
import { shouldAutoSpeak, speakText, stopSpeech } from "../tts";

export interface SidebarChatMessage {
  role: "user" | "assistant";
  content: string;
  createdAt: number;
}

interface SidebarChatProps {
  open: boolean;
  onClose: () => void;
  providers: ProviderConfig[];
}

const MESSAGES_STORAGE_KEY = "sidebar_ai_chat_messages";
/** 持久化上限（条），超出丢弃最旧消息 */
const STORAGE_LIMIT = 100;
/** 请求携带的上下文条数（上下文记忆窗口） */
const CONTEXT_WINDOW = 16;

const SYSTEM_PROMPT =
  "你是「花笺」内置的 AI 助手，风格温和、表达简洁。你可以围绕笔记写作、复盘、灵感收集、时间管理等方面提供帮助。回答使用中文，使用 Markdown 排版，保持简洁。" +
  `上下文记忆：对话历史会自动保存在本机，并随请求附带最近 ${CONTEXT_WINDOW} 条消息作为上下文，因此你可以引用之前聊过的内容。`;

function buildSystemMessage(): SidebarChatMessage {
  return { role: "assistant", content: SYSTEM_PROMPT, createdAt: 0 };
}

export function SidebarChat({ open, onClose, providers }: SidebarChatProps) {
  const [messages, setMessages] = useState<SidebarChatMessage[]>(() => {
    try {
      const saved = localStorage.getItem(MESSAGES_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as SidebarChatMessage[];
        if (Array.isArray(parsed) && parsed.length > 0) return parsed.slice(-STORAGE_LIMIT);
      }
    } catch {
      // ignore
    }
    return [];
  });
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [selectedProviderId, setSelectedProviderId] = useState("");
  const [selectedModelId, setSelectedModelId] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // 持久化：本地上下文记忆
  useEffect(() => {
    try {
      localStorage.setItem(MESSAGES_STORAGE_KEY, JSON.stringify(messages.slice(-STORAGE_LIMIT)));
    } catch {
      // ignore
    }
  }, [messages]);

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

  // 初始化默认供应商/模型（优先 DeepSeek）
  useEffect(() => {
    if (enabledProviders.length > 0 && !selectedProviderId) {
      const ds = enabledProviders.find((p) => p.name.toLowerCase().includes("deepseek"));
      const provider = ds ?? enabledProviders[0];
      setSelectedProviderId(provider.id);
      setSelectedModelId(provider.models[0]?.modelId ?? "");
    }
  }, [enabledProviders, selectedProviderId]);

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 150);
    }
  }, [open]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, loading]);

  const clearHistory = useCallback(() => {
    setMessages([]);
    stopSpeech();
  }, []);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || loading || !activeProvider || !activeModel) return;

    const userMsg: SidebarChatMessage = { role: "user", content: text, createdAt: Date.now() };
    const nextMessages = [...messages, userMsg].slice(-STORAGE_LIMIT);
    setMessages(nextMessages);
    setInput("");
    setLoading(true);

    const apiUrl = activeProvider.baseUrl.replace(/\/+$/, "") + activeProvider.apiPath;
    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (activeProvider.apiKey) headers["Authorization"] = `Bearer ${activeProvider.apiKey}`;

      // 上下文记忆：系统提示 + 最近 CONTEXT_WINDOW 条对话
      const contextMessages = [buildSystemMessage(), ...nextMessages.slice(-CONTEXT_WINDOW)];

      const response = await fetch(apiUrl, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: activeModel.modelId,
          messages: contextMessages.map((m) => ({ role: m.role, content: m.content })),
          stream: false,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`API 错误 (${response.status}): ${errorText}`);
      }

      const data = await response.json();
      const reply = data.choices?.[0]?.message?.content ?? "（未收到回复）";
      const assistantMsg: SidebarChatMessage = {
        role: "assistant",
        content: reply,
        createdAt: Date.now(),
      };
      setMessages((prev) => [...prev, assistantMsg]);

      // 用量统计
      const usage = data.usage ?? {};
      const inputTokens = (usage.prompt_tokens as number) ?? 0;
      const outputTokens = (usage.completion_tokens as number) ?? 0;
      const cachedTokens =
        (usage.prompt_cache_hit_tokens as number) ?? (usage.cached_tokens as number) ?? 0;
      if (inputTokens + outputTokens + cachedTokens > 0) {
        void logUsage(activeProvider.name, inputTokens, outputTokens, cachedTokens);
      }

      // TTS 触发条件：启用自动朗读时朗读助手回复
      if (shouldAutoSpeak()) {
        void speakText(reply, { emotion: "happy" });
      }
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: `错误：${err instanceof Error ? err.message : "未知错误"}`, createdAt: Date.now() },
      ]);
    } finally {
      setLoading(false);
    }
  }, [input, loading, messages, activeProvider, activeModel]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  };

  return (
    <aside
      className={`shrink-0 h-full flex flex-col bg-paper border-r border-paper-deep/15 transition-[width,opacity,margin] duration-300 ease-out overflow-hidden ${
        open ? "w-[320px] max-w-[85vw] opacity-100" : "w-0 opacity-0 border-r-0"
      }`}
    >
      <div className="h-full min-w-[320px] flex flex-col">
        {/* 标题栏 */}
        <div className="shrink-0 flex items-center justify-between px-3 py-2.5 border-b border-paper-deep/20">
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
            <span className="text-[13px] font-display font-semibold text-ink select-none">AI 助手</span>
          </div>

          <div className="flex items-center gap-1 shrink-0 ml-2">
            <button
              type="button"
              onClick={clearHistory}
              className="w-6 h-6 flex items-center justify-center rounded-md text-ink-ghost hover:text-ink-faint hover:bg-paper-warm transition-all cursor-pointer"
              title="清空对话（上下文记忆）"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              </svg>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="w-6 h-6 flex items-center justify-center rounded-md text-ink-ghost hover:text-ink-faint hover:bg-paper-warm transition-all cursor-pointer"
              title="收起"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <path d="M15 18l-6-6 6-6" />
              </svg>
            </button>
          </div>
        </div>

        {/* 供应商 / 模型选择 */}
        <div className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 border-b border-paper-deep/15">
          {activeProvider ? (
            <>
              <select
                value={selectedProviderId}
                onChange={(e) => {
                  const pid = e.target.value;
                  setSelectedProviderId(pid);
                  const p = enabledProviders.find((x) => x.id === pid);
                  if (p?.models[0]) setSelectedModelId(p.models[0].modelId);
                }}
                className="h-6 px-1.5 rounded-md bg-paper-warm/60 border border-paper-deep/30 text-[10px] font-mono text-ink-soft cursor-pointer outline-none max-w-[100px] truncate"
              >
                {enabledProviders.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              {activeModels.length > 1 && (
                <select
                  value={selectedModelId}
                  onChange={(e) => setSelectedModelId(e.target.value)}
                  className="h-6 px-1.5 rounded-md bg-paper-warm/60 border border-paper-deep/30 text-[10px] font-mono text-ink-faint cursor-pointer outline-none max-w-[110px] truncate"
                >
                  {activeModels.map((m) => (
                    <option key={m.modelId} value={m.modelId}>
                      {m.displayName}
                    </option>
                  ))}
                </select>
              )}
            </>
          ) : (
            <span className="text-[10px] text-ink-ghost">请先在 设置 → 供应商 中添加并启用供应商</span>
          )}
        </div>

        {/* 消息列表 */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-3 space-y-3 min-h-0">
          {messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center select-none">
              <div className="w-10 h-10 rounded-2xl bg-bamboo-mist/60 flex items-center justify-center mb-2.5">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="text-bamboo">
                  <path d="M12 3c-4.97 0-9 3.58-9 8 0 2.52 1.32 4.76 3.36 6.22l-1.36 4.78 5.64-3.22c.44.14.9.22 1.36.22 4.97 0 9-3.58 9-8s-4.03-8-9-8z" />
                  <circle cx="9" cy="11" r="0.5" fill="currentColor" />
                  <circle cx="12" cy="10" r="0.5" fill="currentColor" />
                  <circle cx="15" cy="11" r="0.5" fill="currentColor" />
                </svg>
              </div>
              <p className="text-[12px] font-medium text-ink-soft">你好，我是「花笺」AI 助手</p>
              <p className="mt-1 text-[10px] text-ink-ghost leading-relaxed max-w-[220px]">
                可以帮你梳理笔记、复盘写作、沉淀灵感。对话会自动保存在本机，并作为上下文记忆。
              </p>
            </div>
          ) : (
            messages.map((msg, i) =>
              msg.role === "user" ? (
                <div key={i} className="flex justify-end">
                  <div className="max-w-[85%] rounded-xl px-3 py-2 text-[12.5px] leading-relaxed bg-bamboo text-cloud whitespace-pre-wrap break-words">
                    {msg.content}
                  </div>
                </div>
              ) : (
                <div key={i} className="flex justify-start">
                  <div className="max-w-[88%] rounded-xl px-3 py-2 text-[12.5px] leading-relaxed bg-paper-warm/80 text-ink-soft border border-paper-deep/20 [&_h1]:text-[14px] [&_h1]:font-bold [&_h1]:text-ink [&_h1]:mb-1 [&_h2]:text-[13px] [&_h2]:font-bold [&_h2]:text-ink [&_h2]:mb-1 [&_h3]:text-[12.5px] [&_h3]:font-semibold [&_h3]:text-ink [&_p]:mb-1.5 [&_ul]:mb-1.5 [&_ul]:pl-4 [&_ul]:list-disc [&_ol]:mb-1.5 [&_ol]:pl-4 [&_ol]:list-decimal [&_li]:mb-0.5 [&_strong]:text-ink [&_strong]:font-semibold [&_code]:text-bamboo [&_code]:bg-bamboo-mist/60 [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-[11px] [&_pre]:bg-paper-deep/30 [&_pre]:text-ink-soft [&_pre]:p-2 [&_pre]:rounded-lg [&_pre]:text-[11px] [&_pre]:overflow-x-auto [&_pre]:mb-1.5 [&_a]:text-bamboo [&_a]:underline [&_blockquote]:border-l-2 [&_blockquote]:border-bamboo/40 [&_blockquote]:pl-3 [&_blockquote]:text-ink-faint [&_hr]:border-paper-deep/30 [&_hr]:my-2">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
                  </div>
                </div>
              ),
            )
          )}
          {loading && (
            <div className="flex justify-start">
              <div className="bg-paper-warm/80 border border-paper-deep/20 rounded-xl px-3 py-2 flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-bamboo/60 animate-bounce [animation-delay:-0.3s]" />
                <span className="w-1.5 h-1.5 rounded-full bg-bamboo/60 animate-bounce [animation-delay:-0.15s]" />
                <span className="w-1.5 h-1.5 rounded-full bg-bamboo/60 animate-bounce" />
              </div>
            </div>
          )}
        </div>

        {/* 输入区 */}
        <div className="shrink-0 px-3 py-2.5 border-t border-paper-deep/20">
          <div className="flex items-end gap-2">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={activeProvider ? "输入消息，Enter 发送 / Shift+Enter 换行" : "请先配置供应商"}
              rows={1}
              disabled={!activeProvider}
              className="flex-1 resize-none rounded-lg px-3 py-2 text-[12.5px] font-body text-ink placeholder:text-ink-ghost/50 bg-paper-warm/60 border border-paper-deep/30 focus:border-bamboo/30 focus:bg-cloud transition-all disabled:opacity-50 outline-none"
            />
            <button
              type="button"
              onClick={() => void handleSend()}
              disabled={!input.trim() || loading || !activeProvider}
              className="shrink-0 w-8 h-8 flex items-center justify-center rounded-lg bg-bamboo text-cloud hover:bg-bamboo-light disabled:opacity-40 disabled:cursor-not-allowed transition-all cursor-pointer"
              title="发送"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="19" x2="12" y2="5" />
                <polyline points="5 12 12 5 19 12" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </aside>
  );
}
