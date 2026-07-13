// ============================================
// 好友系统类型定义
// ============================================

/** 好友请求状态 */
export type FriendRequestStatus = "pending" | "accepted" | "rejected";

/** 好友请求 */
export interface FriendRequest {
  id: string;
  sender_id: string;
  receiver_id: string;
  status: FriendRequestStatus;
  message: string;
  created_at: string;
  updated_at: string;
}

/** 好友关系 */
export interface Friend {
  id: string;
  user_id: string;
  friend_id: string;
  created_at: string;
}

/** 会话类型 */
export type ConversationType = "direct" | "group";

/** 会话 */
export interface Conversation {
  id: string;
  type: ConversationType;
  name: string;
  created_by: string;
  created_at: string;
  updated_at: string;
}

/** 会话成员 */
export interface ConversationMember {
  conversation_id: string;
  user_id: string;
  joined_at: string;
}

/** 消息类型 */
export type MessageType = "text" | "image" | "file" | "system" | "action";

/** 附件 */
export interface Attachment {
  type: "image" | "file";
  name: string;
  url: string;
  size: number;
  mime_type: string;
  width?: number;
  height?: number;
}

/** 消息 */
export interface Message {
  id: string;
  conversation_id: string;
  sender_id: string;
  content: string;
  message_type: MessageType;
  attachments: Attachment[];
  metadata: Record<string, unknown>;
  created_at: string;
}

// ============================================
// 前端展示用（join 了 profiles 表）
// ============================================

/** 好友 + 用户资料（展示用） */
export interface FriendWithProfile {
  id: string;
  user_id: string;
  friend_id: string;
  profile: {
    display_name: string;
    avatar_url: string | null;
    email: string;
  };
  created_at: string;
}

/** 好友请求 + 发送方/接收方资料 */
export interface FriendRequestWithProfile extends FriendRequest {
  sender: {
    display_name: string;
    avatar_url: string | null;
    email: string;
  };
  receiver: {
    display_name: string;
    avatar_url: string | null;
    email: string;
  };
}

/** 会话预览（对话列表用） */
export interface ConversationPreview {
  id: string;
  type: ConversationType;
  name: string;
  last_message: {
    content: string;
    sender_id: string;
    created_at: string;
    message_type: MessageType;
  } | null;
  unread_count: number;
  members: {
    user_id: string;
    display_name: string;
    avatar_url: string | null;
  }[];
  updated_at: string;
}

/** 搜索用户结果 */
export interface UserSearchResult {
  id: string;
  email: string;
  display_name: string;
  avatar_url: string | null;
  friend_status: "none" | "pending_sent" | "pending_received" | "friends";
}
