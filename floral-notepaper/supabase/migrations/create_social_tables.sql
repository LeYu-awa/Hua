-- ============================================
-- Phase 0: 社交 + 协作 数据库表
-- ============================================

-- 1. friend_requests — 好友请求
CREATE TABLE IF NOT EXISTS friend_requests (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id   uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  receiver_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status      text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected')),
  message     text DEFAULT '',
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- 同一对 sender-receiver 只能有一条 pending 记录
CREATE UNIQUE INDEX IF NOT EXISTS idx_friend_requests_pending
  ON friend_requests(sender_id, receiver_id) WHERE status = 'pending';

-- 2. friends — 好友关系
CREATE TABLE IF NOT EXISTS friends (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  friend_id  uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, friend_id)
);

-- 3. conversations — 会话
CREATE TABLE IF NOT EXISTS conversations (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type       text NOT NULL CHECK (type IN ('direct', 'group')),
  name       text DEFAULT '',
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 4. conversation_members — 会话成员
CREATE TABLE IF NOT EXISTS conversation_members (
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  joined_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (conversation_id, user_id)
);

-- 5. messages — 消息
CREATE TABLE IF NOT EXISTS messages (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  content         text NOT NULL DEFAULT '',
  message_type    text NOT NULL CHECK (message_type IN ('text', 'image', 'file', 'system', 'action')),
  attachments     jsonb DEFAULT '[]'::jsonb,
  metadata        jsonb DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, created_at DESC);

-- 6. collab_documents — 协作文档
CREATE TABLE IF NOT EXISTS collab_documents (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  title           text NOT NULL DEFAULT '未命名文档',
  parent_id       uuid REFERENCES collab_documents(id) ON DELETE SET NULL,
  is_folder       boolean NOT NULL DEFAULT false,
  created_by      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  updated_by      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_collab_documents_conversation ON collab_documents(conversation_id);

-- ============================================
-- updated_at 自动更新函数
-- ============================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_friend_requests_updated_at
  BEFORE UPDATE ON friend_requests
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER set_conversations_updated_at
  BEFORE UPDATE ON conversations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER set_collab_documents_updated_at
  BEFORE UPDATE ON collab_documents
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- RLS 策略
-- ============================================

-- friend_requests
ALTER TABLE friend_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "用户可查看自己发送或收到的请求"
  ON friend_requests FOR SELECT
  USING (sender_id = auth.uid() OR receiver_id = auth.uid());

CREATE POLICY "用户可发送好友请求"
  ON friend_requests FOR INSERT
  WITH CHECK (sender_id = auth.uid());

CREATE POLICY "接收方可更新请求状态"
  ON friend_requests FOR UPDATE
  USING (receiver_id = auth.uid());

-- friends
ALTER TABLE friends ENABLE ROW LEVEL SECURITY;

CREATE POLICY "用户可查看自己的好友列表"
  ON friends FOR SELECT
  USING (user_id = auth.uid() OR friend_id = auth.uid());

CREATE POLICY "用户可添加好友（需有 accepted 的请求）"
  ON friends FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "用户可删除好友关系"
  ON friends FOR DELETE
  USING (user_id = auth.uid() OR friend_id = auth.uid());

-- conversations
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "成员可查看对话"
  ON conversations FOR SELECT
  USING (
    id IN (
      SELECT conversation_id FROM conversation_members WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "认证用户可创建对话"
  ON conversations FOR INSERT
  WITH CHECK (created_by = auth.uid());

-- conversation_members
ALTER TABLE conversation_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "成员可查看成员列表"
  ON conversation_members FOR SELECT
  USING (
    conversation_id IN (
      SELECT conversation_id FROM conversation_members WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "成员可邀请其他人"
  ON conversation_members FOR INSERT
  WITH CHECK (
    conversation_id IN (
      SELECT conversation_id FROM conversation_members WHERE user_id = auth.uid()
    )
  );

-- messages
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "成员可查看消息"
  ON messages FOR SELECT
  USING (
    conversation_id IN (
      SELECT conversation_id FROM conversation_members WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "成员可发送消息"
  ON messages FOR INSERT
  WITH CHECK (
    sender_id = auth.uid() AND
    conversation_id IN (
      SELECT conversation_id FROM conversation_members WHERE user_id = auth.uid()
    )
  );

-- collab_documents
ALTER TABLE collab_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "成员可查看文档"
  ON collab_documents FOR SELECT
  USING (
    conversation_id IN (
      SELECT conversation_id FROM conversation_members WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "成员可创建文档"
  ON collab_documents FOR INSERT
  WITH CHECK (
    created_by = auth.uid() AND
    conversation_id IN (
      SELECT conversation_id FROM conversation_members WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "成员可更新文档"
  ON collab_documents FOR UPDATE
  USING (
    conversation_id IN (
      SELECT conversation_id FROM conversation_members WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "成员可删除文档"
  ON collab_documents FOR DELETE
  USING (
    conversation_id IN (
      SELECT conversation_id FROM conversation_members WHERE user_id = auth.uid()
    )
  );
