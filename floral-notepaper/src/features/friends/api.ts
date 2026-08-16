// ============================================
// 好友系统 API — Supabase 操作封装
// ============================================

import { supabase } from "../auth/supabase";
import { SYSTEM_BOT_USER_ID } from "../collab/constants";
import type {
  FriendRequest,
  FriendRequestWithProfile,
  FriendWithProfile,
  Conversation,
  ConversationPreview,
  Message,
  UserSearchResult,
  Attachment,
} from "./types";

// ============================================
// 辅助
// ============================================

// ============================================
// 辅助 — 批量获取用户资料
// ============================================

async function getCurrentUserId(): Promise<string> {
  const { data } = await supabase.auth.getUser();
  if (!data.user?.id) throw new Error("未登录");
  return data.user.id;
}

/** 批量获取用户资料（避免联表查询依赖 schema cache） */
async function fetchProfiles(
  userIds: string[],
): Promise<Map<string, { display_name: string; avatar_url: string | null; email: string }>> {
  const ids = [...new Set(userIds)].filter(Boolean);
  if (ids.length === 0) return new Map();
  const { data } = await supabase
    .from("profiles")
    .select("id, display_name, avatar_url, email")
    .in("id", ids);
  return new Map(
    (data ?? []).map((p) => [
      p.id,
      {
        display_name: p.display_name ?? p.email?.split("@")[0] ?? "用户",
        avatar_url: p.avatar_url,
        email: p.email ?? "",
      },
    ]),
  );
}

// ============================================
// 好友请求
// ============================================

/** 发送好友请求 */
export async function sendFriendRequest(
  receiverId: string,
  message?: string,
): Promise<FriendRequest> {
  const { data, error } = await supabase
    .from("friend_requests")
    .insert({ receiver_id: receiverId, message: message ?? "" })
    .select()
    .single();

  if (error) throw new Error(error.message);
  return data;
}

/** 获取收到的好友请求（待处理） */
export async function getIncomingRequests(): Promise<FriendRequestWithProfile[]> {
  const userId = await getCurrentUserId();

  // 1. 查询请求列表（不含 profile 联表）
  const { data, error } = await supabase
    .from("friend_requests")
    .select("*")
    .eq("status", "pending")
    .eq("receiver_id", userId)
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);
  if (!data || data.length === 0) return [];

  // 2. 批量获取发送方资料
  const profiles = await fetchProfiles(data.map((r) => r.sender_id));

  // 3. 合并
  return data.map((r) => ({
    ...r,
    sender: profiles.get(r.sender_id) ?? { display_name: "未知用户", avatar_url: null, email: "" },
    receiver: profiles.get(r.receiver_id) ?? {
      display_name: "未知用户",
      avatar_url: null,
      email: "",
    },
  })) as FriendRequestWithProfile[];
}

/** 获取发送的好友请求 */
export async function getOutgoingRequests(): Promise<FriendRequestWithProfile[]> {
  const userId = await getCurrentUserId();

  const { data, error } = await supabase
    .from("friend_requests")
    .select("*")
    .eq("status", "pending")
    .eq("sender_id", userId)
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);
  if (!data || data.length === 0) return [];

  const profiles = await fetchProfiles(data.map((r) => r.receiver_id));

  return data.map((r) => ({
    ...r,
    sender: profiles.get(r.sender_id) ?? { display_name: "未知用户", avatar_url: null, email: "" },
    receiver: profiles.get(r.receiver_id) ?? {
      display_name: "未知用户",
      avatar_url: null,
      email: "",
    },
  })) as FriendRequestWithProfile[];
}

/** 处理好友请求（接受/拒绝） */
export async function handleFriendRequest(
  requestId: string,
  status: "accepted" | "rejected",
): Promise<void> {
  // 获取请求详情
  const { data: request, error: fetchError } = await supabase
    .from("friend_requests")
    .select("*")
    .eq("id", requestId)
    .single();

  if (fetchError) throw new Error(fetchError.message);

  // 更新请求状态
  const { error: updateError } = await supabase
    .from("friend_requests")
    .update({ status })
    .eq("id", requestId);

  if (updateError) throw new Error(updateError.message);

  // 如果接受，创建双向好友关系
  if (status === "accepted") {
    const { error: friendError1 } = await supabase.from("friends").insert({
      user_id: request.sender_id,
      friend_id: request.receiver_id,
    });
    if (friendError1) throw new Error(friendError1.message);

    const { error: friendError2 } = await supabase.from("friends").insert({
      user_id: request.receiver_id,
      friend_id: request.sender_id,
    });
    if (friendError2) throw new Error(friendError2.message);

    // 创建私聊会话
    await createDirectConversation(request.sender_id, request.receiver_id);
  }
}

// ============================================
// 好友列表
// ============================================

/** 获取好友列表（带资料） */
export async function getFriendList(): Promise<FriendWithProfile[]> {
  const userId = await getCurrentUserId();

  // 1. 查询好友列表（不含 profile 联表）
  const { data, error } = await supabase
    .from("friends")
    .select("id, user_id, friend_id, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);
  if (!data || data.length === 0) return [];

  // 2. 批量获取好友资料
  const profiles = await fetchProfiles(data.map((r) => r.friend_id));

  // 3. 合并
  return data.map((r) => ({
    id: r.id,
    user_id: r.user_id,
    friend_id: r.friend_id,
    created_at: r.created_at,
    profile: profiles.get(r.friend_id) ?? { display_name: "未知用户", avatar_url: null, email: "" },
  })) as FriendWithProfile[];
}

/** 删除好友 */
export async function removeFriend(friendId: string): Promise<void> {
  const userId = await getCurrentUserId();

  const { error } = await supabase
    .from("friends")
    .delete()
    .or(
      `and(user_id.eq.${userId},friend_id.eq.${friendId}),and(user_id.eq.${friendId},friend_id.eq.${userId})`,
    );

  if (error) throw new Error(error.message);
}

// ============================================
// 搜索用户
// ============================================

/** 搜索用户（按 email 或 display_name） */
export async function searchUsers(query: string): Promise<UserSearchResult[]> {
  const userId = await getCurrentUserId();

  // 搜索 profiles
  const { data: profiles, error } = await supabase
    .from("profiles")
    .select("id, email, display_name, avatar_url")
    .or(`email.ilike.%${query}%,display_name.ilike.%${query}%`)
    .neq("id", userId)
    .limit(20);

  if (error) throw new Error(error.message);

  // 查询每个用户的好友状态
  const results: UserSearchResult[] = await Promise.all(
    (profiles ?? []).map(async (profile) => {
      let friend_status: UserSearchResult["friend_status"] = "none";

      // 检查是否已是好友
      const { count: friendCount } = await supabase
        .from("friends")
        .select("*", { count: "exact", head: true })
        .eq("user_id", userId)
        .eq("friend_id", profile.id);

      if (friendCount && friendCount > 0) {
        friend_status = "friends";
      } else {
        // 检查是否有待处理的请求
        const { data: pendingReqs } = await supabase
          .from("friend_requests")
          .select("*")
          .eq("status", "pending")
          .or(
            `and(sender_id.eq.${userId},receiver_id.eq.${profile.id}),and(sender_id.eq.${profile.id},receiver_id.eq.${userId})`,
          );

        if (pendingReqs && pendingReqs.length > 0) {
          const req = pendingReqs[0];
          friend_status = req.sender_id === userId ? "pending_sent" : "pending_received";
        }
      }

      return {
        id: profile.id,
        email: profile.email ?? "",
        display_name: profile.display_name ?? profile.email?.split("@")[0] ?? "用户",
        avatar_url: profile.avatar_url,
        friend_status,
      };
    }),
  );

  return results;
}

// ============================================
// 聊天会话
// ============================================

/** 创建私聊会话（如果已存在则返回现有） */
async function createDirectConversation(userA: string, userB: string): Promise<Conversation> {
  // 查找两人都在的 direct 类型会话
  const { data: existing } = await supabase.rpc("find_direct_conversation", {
    user_a: userA,
    user_b: userB,
  });

  if (existing && (existing as unknown[]).length > 0) {
    return (existing as unknown[])[0] as Conversation;
  }

  // 创建新会话
  const { data: conv, error: convError } = await supabase
    .from("conversations")
    .insert({ type: "direct", created_by: userA })
    .select()
    .single();

  if (convError) throw new Error(convError.message);

  // 添加成员
  const { error: memberError } = await supabase.from("conversation_members").insert([
    { conversation_id: conv.id, user_id: userA },
    { conversation_id: conv.id, user_id: userB },
  ]);

  if (memberError) throw new Error(memberError.message);

  return conv;
}

/** 获取会话列表（带最后消息预览） */
export async function getConversationList(): Promise<ConversationPreview[]> {
  const userId = await getCurrentUserId();

  const { data: memberships, error: mError } = await supabase
    .from("conversation_members")
    .select("conversation_id")
    .eq("user_id", userId);

  if (mError) throw new Error(mError.message);
  if (!memberships || memberships.length === 0) return [];

  const convIds = memberships.map((m) => m.conversation_id);

  // 获取会话详情
  const { data: conversations, error: cError } = await supabase
    .from("conversations")
    .select("*")
    .in("id", convIds)
    .order("updated_at", { ascending: false });

  if (cError) throw new Error(cError.message);

  // 构建预览列表
  const previews: ConversationPreview[] = await Promise.all(
    (conversations ?? []).map(async (conv) => {
      // 获取最后一条消息
      const { data: lastMsg } = await supabase
        .from("messages")
        .select("content, sender_id, created_at, message_type")
        .eq("conversation_id", conv.id)
        .order("created_at", { ascending: false })
        .limit(1);

      // 获取成员资料
      const { data: members } = await supabase
        .from("conversation_members")
        .select("user_id")
        .eq("conversation_id", conv.id);

      const memberProfiles = await fetchProfiles((members ?? []).map((m) => m.user_id));

      return {
        id: conv.id,
        type: conv.type,
        name: conv.name,
        last_message:
          lastMsg && lastMsg.length > 0
            ? {
                content: lastMsg[0].content,
                sender_id: lastMsg[0].sender_id,
                created_at: lastMsg[0].created_at,
                message_type: lastMsg[0].message_type,
              }
            : null,
        unread_count: 0,
        members: (members ?? []).map((m) => {
          const p = memberProfiles.get(m.user_id);
          return {
            user_id: m.user_id,
            display_name: p?.display_name ?? "用户",
            avatar_url: p?.avatar_url ?? null,
          };
        }),
        updated_at: conv.updated_at,
      };
    }),
  );

  return previews;
}

/** 获取会话消息 */
export async function getMessages(
  conversationId: string,
  options?: { limit?: number; before?: string },
): Promise<Message[]> {
  let query = supabase
    .from("messages")
    .select("*")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false });

  if (options?.limit) query = query.limit(options.limit);
  if (options?.before) query = query.lt("created_at", options.before);

  const { data, error } = await query;

  if (error) throw new Error(error.message);
  return (data ?? []).reverse() as Message[];
}

/** 发送消息 */
export async function sendMessage(
  conversationId: string,
  content: string,
  options?: {
    messageType?: Message["message_type"];
    attachments?: Attachment[];
    metadata?: Record<string, unknown>;
  },
): Promise<Message> {
  const userId = await getCurrentUserId();

  const { data, error } = await supabase
    .from("messages")
    .insert({
      conversation_id: conversationId,
      sender_id: userId,
      content,
      message_type: options?.messageType ?? "text",
      attachments: options?.attachments ?? [],
      metadata: options?.metadata ?? {},
    })
    .select()
    .single();

  if (error) throw new Error(error.message);

  // 更新会话时间
  await supabase
    .from("conversations")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", conversationId);

  return data;
}

/** 上传文件到对话 */
export async function uploadChatFile(conversationId: string, file: File): Promise<Attachment> {
  await getCurrentUserId();

  const filePath = `${conversationId}/${Date.now()}_${file.name}`;
  const { error: uploadError } = await supabase.storage.from("chat-files").upload(filePath, file);

  if (uploadError) throw new Error(uploadError.message);

  const { data: urlData } = supabase.storage.from("chat-files").getPublicUrl(filePath);

  const isImage = file.type.startsWith("image/");

  let dimensions: { width?: number; height?: number } = {};
  if (isImage) {
    dimensions = await new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        resolve({ width: img.naturalWidth, height: img.naturalHeight });
      };
      img.onerror = () => resolve({});
      img.src = urlData.publicUrl;
    });
  }

  return {
    type: isImage ? "image" : "file",
    name: file.name,
    url: urlData.publicUrl,
    size: file.size,
    mime_type: file.type,
    ...dimensions,
  };
}

/** 获取或创建与某好友的私聊会话 */
export async function getOrCreateDirectConversation(friendId: string): Promise<Conversation> {
  const userId = await getCurrentUserId();
  return createDirectConversation(userId, friendId);
}

// ============================================
// 系统好友
// ============================================

/** 添加系统好友（花箴助手）到当前用户的好友列表 */
export async function addSystemFriend(): Promise<void> {
  const userId = await getCurrentUserId();

  // 通过 SECURITY DEFINER RPC 一次完成：检查+插入好友+创建会话
  const { error } = await supabase.rpc("add_system_friend", {
    p_user_id: userId,
    p_bot_id: SYSTEM_BOT_USER_ID,
  });

  if (error) throw new Error(error.message);
}
