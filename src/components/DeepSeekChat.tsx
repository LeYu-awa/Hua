import { useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface Message {
  role: "user" | "assistant" | "system";
  content: string;
}

interface DeepSeekChatProps {
  open: boolean;
  onClose: () => void;
  docTitle: string;
  docContent: string;
}

const DEEPSEEK_API_KEY = "sk-87ba077faf1143f9bef90cc5ca0711f1";
const DEEPSEEK_API_URL = "https://api.deepseek.com/v1/chat/completions";
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

export function DeepSeekChat({ open, onClose, docTitle, docContent }: DeepSeekChatProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [initDone, setInitDone] = useState(false);
  const [panelHeight, setPanelHeight] = useState(320);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

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

  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || loading) return;

    const userMsg: Message = { role: "user", content: text };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput("");
    setLoading(true);

    try {
      const response = await fetch(DEEPSEEK_API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${DEEPSEEK_API_KEY}`,
        },
        body: JSON.stringify({
          model: "deepseek-chat",
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
    } catch (err) {
      const errorMsg: Message = {
        role: "assistant",
        content: `错误：${err instanceof Error ? err.message : "未知错误"}`,
      };
      setMessages((prev) => [...prev, errorMsg]);
    } finally {
      setLoading(false);
    }
  }, [input, loading, messages]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void sendMessage();
    }
  };

  return (
    <div
      className={`shrink-0 border-t border-paper-deep/30 bg-paper/90 transition-all duration-300 ease-out flex flex-col overflow-hidden ${
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

      <div className="flex-1 flex flex-col min-h-0 w-full px-4">
        {/* 标题栏 */}
        <div className="flex items-center justify-between py-2 shrink-0">
          <div className="flex items-center gap-2">
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="text-bamboo"
            >
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              <path d="M8 10h.01M12 10h.01M16 10h.01" />
            </svg>
            <span className="text-[12px] font-display font-medium text-ink-soft">
              DeepSeek 助手
            </span>
            <span className="text-[10px] text-ink-ghost">· 分析当前文档</span>
          </div>
          <button
            onClick={onClose}
            className="w-6 h-6 flex items-center justify-center rounded-md text-ink-ghost hover:text-ink-faint hover:bg-paper-warm transition-all cursor-pointer"
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
        <div ref={scrollRef} className="flex-1 overflow-y-auto pb-2 space-y-3 min-h-0">
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

        {/* 输入区 */}
        <div className="py-2.5 border-t border-paper-deep/20 shrink-0">
          <div className="flex items-end gap-2">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="输入问题，按 Enter 发送……"
              rows={1}
              className="flex-1 resize-none rounded-lg px-3 py-2 text-[13px] font-body text-ink placeholder:text-ink-ghost/50 bg-paper-warm/60 border border-paper-deep/30 focus:border-bamboo/30 focus:bg-cloud transition-all"
            />
            <button
              onClick={() => void sendMessage()}
              disabled={!input.trim() || loading}
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
