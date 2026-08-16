import { useEffect, useState, useCallback } from "react";
import { getConversationList, addSystemFriend } from "../features/friends/api";
import type { ConversationPreview } from "../features/friends/types";
import { supabase } from "../features/auth/supabase";
import { DocumentMode } from "./canvas/DocumentMode";
import { CanvasMode } from "./canvas/CanvasMode";
import { ChatPanel } from "./right/ChatPanel";
import { SharedFiles } from "./right/SharedFiles";
import { LocalFiles } from "./right/LocalFiles";

type CenterMode = "document" | "canvas";
type RightTab = "chat" | "shared" | "local";

// ============================================
// SVG 图标组件
// ============================================
function DocumentIcon({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
    </svg>
  );
}

function CanvasIcon({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </svg>
  );
}

function ChatIcon({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      <line x1="12" y1="9" x2="12" y2="9.01" />
      <line x1="8" y1="9" x2="8" y2="9.01" />
      <line x1="16" y1="9" x2="16" y2="9.01" />
    </svg>
  );
}

function SharedIcon({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function NotesIcon({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M16 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8z" />
      <polyline points="16 3 16 8 21 8" />
      <line x1="8" y1="12" x2="16" y2="12" />
      <line x1="8" y1="16" x2="14" y2="16" />
    </svg>
  );
}

export function CoWritePage() {
  // 左侧：会话列表
  const [conversations, setConversations] = useState<ConversationPreview[]>([]);
  const [selectedConvId, setSelectedConvId] = useState<string | null>(null);
  const [convLoading, setConvLoading] = useState(true);
  const [convError, setConvError] = useState<string | null>(null);

  // 中间：模式切换
  const [centerMode, setCenterMode] = useState<CenterMode>("canvas");

  // 中间：文档模式（选中文档）
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null);
  const [docTitle, setDocTitle] = useState("");

  // 右侧：切换 Tab
  const [rightTab, setRightTab] = useState<RightTab>("chat");
  const [rightVisible, setRightVisible] = useState(true);

  // 当前用户（监听登录/登出）
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  useEffect(() => {
    // 初始化：获取当前 session
    supabase.auth.getUser().then(({ data }) => {
      if (data.user?.id) setCurrentUserId(data.user.id);
    });

    // 持续监听 auth 变化
    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_IN" && session?.user) {
        setCurrentUserId(session.user.id);
      } else if (event === "SIGNED_OUT") {
        setCurrentUserId(null);
      }
    });

    return () => listener.subscription.unsubscribe();
  }, []);

  // 加载会话列表
  const loadConversations = useCallback(async () => {
    if (!currentUserId) return;
    setConvLoading(true);
    setConvError(null);
    try {
      // 先确保系统好友会话存在（已存在好友时不会报错，只会补建会话）
      try {
        await addSystemFriend();
      } catch {
        /* 忽略 */
      }
      const list = await getConversationList();
      setConversations(list);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "加载失败";
      setConvError(msg);
      console.error("加载会话列表失败:", e);
    } finally {
      setConvLoading(false);
    }
  }, [currentUserId]);

  // 依赖 currentUserId，登录后自动重新加载
  useEffect(() => {
    loadConversations();
  }, [loadConversations]);

  // 切换会话时重置状态，并为回放页保留最近会话
  useEffect(() => {
    setSelectedDocId(null);
    setDocTitle("");
    if (selectedConvId) {
      localStorage.setItem("floral-last-conversation-id", selectedConvId);
    }
  }, [selectedConvId]);

  // ==========================================
  // 渲染：左侧会话列表
  // ==========================================
  const renderLeftPanel = () => (
    <div className="flex flex-col h-full">
      <div className="shrink-0 px-3 py-2.5 border-b border-paper-deep/20 flex items-center justify-between">
        <h2 className="text-[11px] font-mono text-ink-faint uppercase tracking-wider">对话</h2>
        <button
          onClick={loadConversations}
          disabled={convLoading}
          className="p-1 rounded text-ink-ghost hover:text-ink hover:bg-paper-warm/60 transition-colors cursor-pointer disabled:opacity-40"
          title="刷新"
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
            className={convLoading ? "animate-spin" : ""}
          >
            <polyline points="23 4 23 10 17 10" />
            <polyline points="1 20 1 14 7 14" />
            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
          </svg>
        </button>
      </div>
      <div className="flex-1 overflow-y-auto">
        {convLoading ? (
          <div className="text-[11px] text-ink-ghost text-center py-8">加载中...</div>
        ) : convError ? (
          <div className="text-[11px] text-red-400 text-center py-8 leading-relaxed px-3">
            <p>加载失败</p>
            <p className="mt-1 text-ink-faint text-[10px] break-all">{convError}</p>
            <button
              onClick={loadConversations}
              className="mt-3 px-3 py-1.5 rounded-lg border border-paper-deep/40 text-ink-faint hover:text-ink hover:bg-paper-warm/60 transition-colors cursor-pointer"
            >
              重试
            </button>
          </div>
        ) : conversations.length === 0 ? (
          <div className="text-[11px] text-ink-ghost text-center py-8 leading-relaxed">
            <p>还没有对话</p>
            <p className="mt-1">先在好友页面加好友</p>
          </div>
        ) : (
          <div className="py-1">
            {conversations.map((conv) => {
              const friend =
                conv.members.find((m) => m.user_id !== currentUserId) ?? conv.members[0];
              return (
                <button
                  key={conv.id}
                  onClick={() => setSelectedConvId(conv.id)}
                  className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-left transition-colors cursor-pointer hover:bg-paper-warm/60 ${
                    selectedConvId === conv.id ? "bg-paper-warm/80" : ""
                  }`}
                >
                  <div className="w-8 h-8 rounded-full bg-bamboo-mist/60 flex items-center justify-center text-[11px] font-display font-bold text-bamboo shrink-0">
                    {friend?.display_name?.charAt(0).toUpperCase() ?? "?"}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[12px] font-medium text-ink truncate">
                      {friend?.display_name ?? "未知用户"}
                    </p>
                    {conv.last_message && (
                      <p className="text-[10px] text-ink-ghost truncate mt-0.5">
                        {conv.last_message.content}
                      </p>
                    )}
                  </div>
                  <div className="shrink-0 text-[9px] text-ink-faint font-mono">
                    {conv.last_message
                      ? new Date(conv.last_message.created_at).toLocaleTimeString("zh-CN", {
                          hour: "2-digit",
                          minute: "2-digit",
                        })
                      : ""}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );

  // ==========================================
  // 渲染：中间区域
  // ==========================================
  const renderCenter = () => (
    <div className="flex-1 flex flex-col min-w-0">
      {/* 模式切换栏 */}
      <div className="shrink-0 flex items-center justify-between h-11 px-4 border-b border-paper-deep/20 bg-paper/80 backdrop-blur-sm">
        <div className="flex items-center gap-1 bg-paper-warm/80 rounded-lg p-0.5 border border-paper-deep/15">
          <button
            onClick={() => setCenterMode("document")}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-[11px] font-medium transition-all cursor-pointer ${
              centerMode === "document"
                ? "bg-cloud text-ink shadow-sm"
                : "text-ink-ghost hover:text-ink-soft"
            }`}
          >
            <DocumentIcon size={13} />
            文档
          </button>
          <button
            onClick={() => setCenterMode("canvas")}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-[11px] font-medium transition-all cursor-pointer ${
              centerMode === "canvas"
                ? "bg-cloud text-ink shadow-sm"
                : "text-ink-ghost hover:text-ink-soft"
            }`}
          >
            <CanvasIcon size={13} />
            画布
          </button>
        </div>

        <button
          onClick={() => setRightVisible(!rightVisible)}
          className="px-2 py-1 rounded text-[10px] text-ink-ghost hover:text-ink hover:bg-paper-warm/60 transition-colors cursor-pointer"
        >
          {rightVisible ? "隐藏侧栏" : "显示侧栏"}
        </button>
      </div>

      {/* 内容区 */}
      <div className="flex-1 min-h-0">
        {centerMode === "document" ? (
          <DocumentMode
            selectedDocId={selectedDocId}
            docTitle={docTitle}
            onDocTitleChange={setDocTitle}
          />
        ) : (
          <CanvasMode conversationId={selectedConvId} />
        )}
      </div>
    </div>
  );

  // ==========================================
  // 渲染：右侧栏
  // ==========================================
  const rightTabs: { key: RightTab; label: string; icon: React.ReactNode }[] = [
    { key: "chat", label: "聊天", icon: <ChatIcon size={13} /> },
    { key: "shared", label: "共享文件", icon: <SharedIcon size={13} /> },
    { key: "local", label: "笔记", icon: <NotesIcon size={13} /> },
  ];

  const renderRightPanel = () => (
    <div className="flex flex-col h-full">
      {/* Tab 切换按钮 */}
      <div className="shrink-0 flex items-center border-b border-paper-deep/20 bg-paper/50">
        {rightTabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setRightTab(tab.key)}
            className={`flex-1 flex items-center justify-center gap-1 py-2.5 text-[10px] font-medium transition-colors cursor-pointer border-b-2 -mb-[1px] ${
              rightTab === tab.key
                ? "text-bamboo border-bamboo"
                : "text-ink-ghost border-transparent hover:text-ink-soft"
            }`}
            title={tab.label}
          >
            {tab.icon}
          </button>
        ))}
      </div>

      {/* Tab 内容 */}
      <div className="flex-1 min-h-0 flex flex-col">
        {rightTab === "chat" && (
          <ChatPanel conversationId={selectedConvId} currentUserId={currentUserId} />
        )}
        {rightTab === "shared" && <SharedFiles conversationId={selectedConvId} />}
        {rightTab === "local" && <LocalFiles />}
      </div>
    </div>
  );

  // ==========================================
  // 主渲染
  // ==========================================
  return (
    <div className="flex-1 flex flex-col min-h-0" style={{ backgroundColor: "var(--color-paper)" }}>
      <div className="flex-1 flex min-h-0">
        {/* 左栏：会话列表 */}
        <div className="shrink-0 w-[220px] border-r border-paper-deep/20 bg-paper/50 flex flex-col">
          {renderLeftPanel()}
        </div>

        {/* 中栏：文档/画布 */}
        {renderCenter()}

        {/* 右栏：聊天/文件 */}
        {rightVisible && (
          <div className="shrink-0 w-[260px] border-l border-paper-deep/20 bg-paper/50 flex flex-col">
            {renderRightPanel()}
          </div>
        )}
      </div>
    </div>
  );
}
