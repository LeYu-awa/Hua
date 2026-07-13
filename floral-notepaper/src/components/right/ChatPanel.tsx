import { useCallback, useEffect, useRef, useState } from "react";
import { getMessages, sendMessage } from "../../features/friends/api";
import { recordAgentChatMessageEvent } from "../../features/agent/api";
import type { Message } from "../../features/friends/types";

interface ChatPanelProps {
  conversationId: string | null;
  currentUserId: string | null;
}

export function ChatPanel({ conversationId, currentUserId }: ChatPanelProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [msgInput, setMsgInput] = useState("");
  const [loading, setLoading] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!conversationId) {
      setMessages([]);
      return;
    }
    setLoading(true);
    getMessages(conversationId, { limit: 50 })
      .then(setMessages)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [conversationId]);

  // 自动滚动到底部
  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSend = useCallback(async () => {
    if (!conversationId || !msgInput.trim()) return;
    try {
      const msg = await sendMessage(conversationId, msgInput.trim());
      setMessages((prev) => [...prev, msg]);
      setMsgInput("");
      if (currentUserId) {
        recordAgentChatMessageEvent({
          conversationId,
          messageId: msg.id,
          userId: currentUserId,
          content: msg.content,
          timestamp: msg.created_at,
        }).catch(console.warn);
      }
    } catch (e) {
      console.error(e);
    }
  }, [conversationId, currentUserId, msgInput]);

  if (!conversationId) {
    return (
      <div className="flex-1 flex items-center justify-center text-[10px] text-ink-faint">
        选择对话查看聊天
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* 消息列表 */}
      <div ref={listRef} className="flex-1 overflow-y-auto px-2 py-2 space-y-1.5">
        {loading ? (
          <div className="text-[10px] text-ink-faint text-center py-6">加载中...</div>
        ) : messages.length === 0 ? (
          <div className="text-[10px] text-ink-faint text-center py-6">暂无消息</div>
        ) : (
          messages.map((msg) => {
            const isSelf = msg.sender_id === currentUserId;
            return (
              <div
                key={msg.id}
                className={`flex ${isSelf ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[85%] px-2.5 py-1.5 rounded-xl text-[11px] leading-relaxed ${
                    isSelf
                      ? "bg-bamboo/20 text-ink-soft"
                      : "bg-paper-warm/70 text-ink"
                  }`}
                >
                  <p>{msg.content}</p>
                  <p className="text-[8px] text-ink-faint mt-0.5 font-mono">
                    {new Date(msg.created_at).toLocaleTimeString("zh-CN", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </p>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* 输入框 */}
      <div className="shrink-0 flex items-center gap-1.5 px-2 py-2 border-t border-paper-deep/20">
        <input
          type="text"
          value={msgInput}
          onChange={(e) => setMsgInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSend()}
          placeholder="发送消息..."
          className="flex-1 h-7 px-2.5 rounded-lg text-[11px] bg-paper-warm/60 border border-paper-deep/30 focus:border-bamboo/30 outline-none text-ink placeholder:text-ink-faint/50"
        />
        <button
          onClick={handleSend}
          disabled={!msgInput.trim()}
          className="h-7 px-2.5 rounded-lg text-[10px] font-medium text-cloud bg-bamboo/85 hover:bg-bamboo disabled:opacity-40 transition-colors cursor-pointer"
        >
          发送
        </button>
      </div>
    </div>
  );
}
