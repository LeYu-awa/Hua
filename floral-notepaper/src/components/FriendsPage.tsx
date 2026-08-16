import { useState, useEffect, useCallback } from "react";
import {
  searchUsers,
  sendFriendRequest,
  getIncomingRequests,
  getOutgoingRequests,
  getFriendList,
  handleFriendRequest,
  removeFriend,
} from "../features/friends/api";
import { SYSTEM_BOT_NAME } from "../features/collab/constants";
import { addSystemFriend } from "../features/friends/api";
import type {
  UserSearchResult,
  FriendRequestWithProfile,
  FriendWithProfile,
} from "../features/friends/types";

type FriendsTab = "friends" | "search" | "requests";

export function FriendsPage() {
  const [activeTab, setActiveTab] = useState<FriendsTab>("friends");

  // 好友列表
  const [friends, setFriends] = useState<FriendWithProfile[]>([]);
  const [friendsLoading, setFriendsLoading] = useState(true);

  // 搜索
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<UserSearchResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);

  // 请求
  const [incomingRequests, setIncomingRequests] = useState<FriendRequestWithProfile[]>([]);
  const [outgoingRequests, setOutgoingRequests] = useState<FriendRequestWithProfile[]>([]);
  const [requestsLoading, setRequestsLoading] = useState(true);

  // 消息
  const [message, setMessage] = useState<{ text: string; type: "success" | "error" } | null>(null);

  const showMessage = useCallback((text: string, type: "success" | "error") => {
    setMessage({ text, type });
    setTimeout(() => setMessage(null), 3000);
  }, []);

  // ---- 加载好友列表 ----
  const loadFriends = useCallback(async () => {
    setFriendsLoading(true);
    try {
      const list = await getFriendList();
      setFriends(list);
    } catch (e) {
      showMessage(e instanceof Error ? e.message : "加载好友列表失败", "error");
    } finally {
      setFriendsLoading(false);
    }
  }, [showMessage]);

  // ---- 加载请求 ----
  const loadRequests = useCallback(async () => {
    setRequestsLoading(true);
    try {
      const [incoming, outgoing] = await Promise.all([
        getIncomingRequests(),
        getOutgoingRequests(),
      ]);
      setIncomingRequests(incoming);
      setOutgoingRequests(outgoing);
    } catch (e) {
      showMessage(e instanceof Error ? e.message : "加载请求失败", "error");
    } finally {
      setRequestsLoading(false);
    }
  }, [showMessage]);

  // ---- 搜索 ----
  const handleSearch = useCallback(async () => {
    if (!searchQuery.trim()) return;
    setSearchLoading(true);
    try {
      const results = await searchUsers(searchQuery.trim());
      setSearchResults(results);
    } catch (e) {
      showMessage(e instanceof Error ? e.message : "搜索失败", "error");
    } finally {
      setSearchLoading(false);
    }
  }, [searchQuery, showMessage]);

  // ---- 发送好友请求 ----
  const handleSendRequest = useCallback(
    async (receiverId: string) => {
      try {
        await sendFriendRequest(receiverId);
        showMessage("好友请求已发送", "success");
        setSearchResults((prev) =>
          prev.map((r) =>
            r.id === receiverId ? { ...r, friend_status: "pending_sent" as const } : r,
          ),
        );
      } catch (e) {
        showMessage(e instanceof Error ? e.message : "发送失败", "error");
      }
    },
    [showMessage],
  );

  // ---- 处理请求 ----
  const handleProcessRequest = useCallback(
    async (requestId: string, status: "accepted" | "rejected") => {
      try {
        await handleFriendRequest(requestId, status);
        showMessage(status === "accepted" ? "已接受好友请求" : "已拒绝好友请求", "success");
        await loadRequests();
        if (status === "accepted") await loadFriends();
      } catch (e) {
        showMessage(e instanceof Error ? e.message : "操作失败", "error");
      }
    },
    [showMessage, loadRequests, loadFriends],
  );

  // ---- 删除好友 ----
  const handleRemoveFriend = useCallback(
    async (friendId: string) => {
      if (!window.confirm("确定删除这个好友？")) return;
      try {
        await removeFriend(friendId);
        showMessage("已删除好友", "success");
        await loadFriends();
      } catch (e) {
        showMessage(e instanceof Error ? e.message : "删除失败", "error");
      }
    },
    [showMessage, loadFriends],
  );

  useEffect(() => {
    if (activeTab === "friends") void loadFriends();
    else if (activeTab === "requests") void loadRequests();
  }, [activeTab, loadFriends, loadRequests]);

  // ---- 渲染：好友列表 ----
  const renderFriends = () => (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-display font-semibold text-ink">
          我的好友
          <span className="ml-1.5 text-ink-ghost font-mono text-[11px]">{friends.length}</span>
        </h2>
      </div>

      {friendsLoading ? (
        <div className="text-xs text-ink-ghost text-center py-8">加载中...</div>
      ) : friends.length === 0 ? (
        <div className="text-xs text-ink-ghost text-center py-8 leading-relaxed">
          <p>还没有好友</p>
          <button
            onClick={async () => {
              try {
                await addSystemFriend();
                showMessage(`已添加 ${SYSTEM_BOT_NAME} 为好友`, "success");
                await loadFriends();
              } catch (e) {
                const msg = e instanceof Error ? e.message : "添加失败";
                // "已经是好友了" 表示之前添加成功了但列表没刷新，直接重新加载
                if (msg === "已经是好友了") {
                  await loadFriends();
                } else {
                  showMessage(msg, "error");
                }
              }
            }}
            className="mt-4 px-5 py-2 rounded-lg text-[12px] font-medium text-cloud bg-bamboo/85 hover:bg-bamboo transition-colors cursor-pointer inline-flex items-center gap-2"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <line x1="19" y1="8" x2="19" y2="14" />
              <line x1="22" y1="11" x2="16" y2="11" />
            </svg>
            添加 {SYSTEM_BOT_NAME}
          </button>
        </div>
      ) : (
        <div className="space-y-1">
          {friends.map((friend) => (
            <div
              key={friend.id}
              className="flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-paper-warm/70 transition-colors group"
            >
              <div className="w-8 h-8 rounded-full bg-bamboo-mist/60 flex items-center justify-center text-xs font-display font-bold text-bamboo shrink-0">
                {friend.profile.display_name.charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-medium text-ink truncate">
                  {friend.profile.display_name}
                </p>
                <p className="text-[10px] text-ink-ghost font-mono truncate">
                  {friend.profile.email}
                </p>
              </div>
              <button
                onClick={() => handleRemoveFriend(friend.friend_id)}
                className="opacity-0 group-hover:opacity-100 px-2 py-1 rounded-md text-[10px] text-red-400 hover:bg-danger-bg transition-all cursor-pointer"
              >
                删除
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  // ---- 渲染：搜索 ----
  const renderSearch = () => (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSearch()}
          placeholder="搜索用户（邮箱或昵称）..."
          className="flex-1 h-9 px-3 rounded-lg text-[12px] font-body text-ink bg-paper-warm/70 border border-paper-deep/40 focus:border-bamboo/30 placeholder:text-ink-ghost/50 outline-none"
        />
        <button
          onClick={handleSearch}
          disabled={searchLoading || !searchQuery.trim()}
          className="h-9 px-4 rounded-lg text-[11px] font-medium text-cloud bg-bamboo/85 hover:bg-bamboo disabled:opacity-40 transition-colors cursor-pointer"
        >
          {searchLoading ? "搜索中..." : "搜索"}
        </button>
      </div>

      {searchResults.length > 0 && (
        <div className="space-y-1">
          {searchResults.map((user) => (
            <div
              key={user.id}
              className="flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-paper-warm/70 transition-colors"
            >
              <div className="w-8 h-8 rounded-full bg-bamboo-mist/60 flex items-center justify-center text-xs font-display font-bold text-bamboo shrink-0">
                {user.display_name.charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-medium text-ink truncate">{user.display_name}</p>
                <p className="text-[10px] text-ink-ghost font-mono truncate">{user.email}</p>
              </div>
              {user.friend_status === "none" && (
                <button
                  onClick={() => handleSendRequest(user.id)}
                  className="px-3 py-1.5 rounded-lg text-[10px] font-medium text-bamboo bg-bamboo-mist/60 hover:bg-bamboo-mist/90 transition-colors cursor-pointer"
                >
                  加好友
                </button>
              )}
              {user.friend_status === "pending_sent" && (
                <span className="px-3 py-1.5 rounded-lg text-[10px] text-ink-ghost bg-paper-warm/60">
                  已发送
                </span>
              )}
              {user.friend_status === "pending_received" && (
                <span className="px-3 py-1.5 rounded-lg text-[10px] text-amber-600/70 bg-amber-50/50">
                  待处理
                </span>
              )}
              {user.friend_status === "friends" && (
                <span className="px-3 py-1.5 rounded-lg text-[10px] text-bamboo bg-bamboo-mist/40">
                  已是好友
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {searchQuery && !searchLoading && searchResults.length === 0 && (
        <div className="text-xs text-ink-ghost text-center py-8">没有找到匹配的用户</div>
      )}
    </div>
  );

  // ---- 渲染：请求 ----
  const renderRequests = () => (
    <div>
      {requestsLoading ? (
        <div className="text-xs text-ink-ghost text-center py-8">加载中...</div>
      ) : (
        <div className="space-y-4">
          {/* 收到的请求 */}
          <div>
            <h3 className="text-[11px] font-mono text-ink-faint mb-2 uppercase tracking-wider">
              收到的请求 ({incomingRequests.length})
            </h3>
            {incomingRequests.length === 0 ? (
              <p className="text-[11px] text-ink-ghost pl-1">暂无</p>
            ) : (
              <div className="space-y-1">
                {incomingRequests.map((req) => (
                  <div
                    key={req.id}
                    className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-paper-warm/50"
                  >
                    <div className="w-8 h-8 rounded-full bg-bamboo-mist/60 flex items-center justify-center text-xs font-display font-bold text-bamboo shrink-0">
                      {req.sender.display_name.charAt(0).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-medium text-ink truncate">
                        {req.sender.display_name}
                      </p>
                      {req.message && (
                        <p className="text-[10px] text-ink-ghost truncate">{req.message}</p>
                      )}
                    </div>
                    <div className="flex gap-1.5 shrink-0">
                      <button
                        onClick={() => handleProcessRequest(req.id, "accepted")}
                        className="px-3 py-1.5 rounded-lg text-[10px] font-medium text-cloud bg-bamboo/85 hover:bg-bamboo transition-colors cursor-pointer"
                      >
                        接受
                      </button>
                      <button
                        onClick={() => handleProcessRequest(req.id, "rejected")}
                        className="px-3 py-1.5 rounded-lg text-[10px] text-ink-faint hover:text-ink-soft bg-paper-warm hover:bg-paper-deep/30 transition-colors cursor-pointer"
                      >
                        拒绝
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 已发送的请求 */}
          <div>
            <h3 className="text-[11px] font-mono text-ink-faint mb-2 uppercase tracking-wider">
              已发送的请求 ({outgoingRequests.length})
            </h3>
            {outgoingRequests.length === 0 ? (
              <p className="text-[11px] text-ink-ghost pl-1">暂无</p>
            ) : (
              <div className="space-y-1">
                {outgoingRequests.map((req) => (
                  <div
                    key={req.id}
                    className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-paper-warm/30"
                  >
                    <div className="w-8 h-8 rounded-full bg-bamboo-mist/40 flex items-center justify-center text-xs font-display font-bold text-ink-faint shrink-0">
                      {req.receiver.display_name.charAt(0).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-medium text-ink truncate">
                        {req.receiver.display_name}
                      </p>
                      <p className="text-[10px] text-ink-ghost">等待对方响应</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );

  // ---- 主渲染 ----
  return (
    <div className="flex-1 flex flex-col min-h-0" style={{ backgroundColor: "var(--color-paper)" }}>
      {/* 顶部标题栏 */}
      <header className="shrink-0 flex items-center justify-between h-11 px-4 border-b border-paper-deep/20 bg-paper/80 backdrop-blur-sm">
        <h1 className="text-sm font-display font-bold text-ink tracking-wide select-none">好友</h1>
      </header>

      {/* 消息提示 */}
      {message && (
        <div
          className={`shrink-0 mx-3 mt-2 px-3 py-2 rounded-lg text-[11px] ${
            message.type === "success"
              ? "bg-bamboo-mist/60 text-bamboo"
              : "bg-red-50/80 text-red-500"
          }`}
        >
          {message.text}
        </div>
      )}

      {/* Tab 切换 */}
      <div className="shrink-0 flex border-b border-paper-deep/20 px-3 gap-0.5">
        {[
          { key: "friends" as const, label: "好友" },
          { key: "search" as const, label: "搜索" },
          { key: "requests" as const, label: "请求" },
        ].map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-4 py-2.5 text-[11px] font-medium transition-colors cursor-pointer border-b-2 -mb-[1px] ${
              activeTab === tab.key
                ? "text-bamboo border-bamboo"
                : "text-ink-ghost border-transparent hover:text-ink-soft"
            }`}
          >
            {tab.label}
            {tab.key === "requests" &&
              (incomingRequests.length > 0 || outgoingRequests.length > 0) && (
                <span className="ml-1.5 px-1.5 py-0.5 rounded-full bg-bamboo/15 text-[9px] text-bamboo font-mono">
                  {incomingRequests.length + outgoingRequests.length}
                </span>
              )}
          </button>
        ))}
      </div>

      {/* 内容区 */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        {activeTab === "friends" && renderFriends()}
        {activeTab === "search" && renderSearch()}
        {activeTab === "requests" && renderRequests()}
      </div>
    </div>
  );
}
