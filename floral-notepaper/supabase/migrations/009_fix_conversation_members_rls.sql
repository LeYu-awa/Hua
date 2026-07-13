-- ============================================
-- 修复所有包含 conversation_members 子查询的 RLS 策略
-- 使用 SECURITY DEFINER 函数避免无限递归
-- ============================================

-- 创建辅助函数，避免 RLS 自递归
CREATE OR REPLACE FUNCTION public.is_conversation_member(conv_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.conversation_members
    WHERE conversation_id = conv_id AND user_id = auth.uid()
  );
$$;

-- ============================================
-- conversation_members
-- ============================================
DROP POLICY IF EXISTS "成员可查看成员列表" ON conversation_members;
CREATE POLICY "成员可查看成员列表"
  ON conversation_members FOR SELECT
  USING (public.is_conversation_member(conversation_id));

DROP POLICY IF EXISTS "成员可邀请其他人" ON conversation_members;
CREATE POLICY "成员可邀请其他人"
  ON conversation_members FOR INSERT
  WITH CHECK (public.is_conversation_member(conversation_id));

-- ============================================
-- conversations
-- ============================================
DROP POLICY IF EXISTS "成员可查看对话" ON conversations;
CREATE POLICY "成员可查看对话"
  ON conversations FOR SELECT
  USING (public.is_conversation_member(id));

-- ============================================
-- messages
-- ============================================
DROP POLICY IF EXISTS "成员可查看消息" ON messages;
CREATE POLICY "成员可查看消息"
  ON messages FOR SELECT
  USING (public.is_conversation_member(conversation_id));

DROP POLICY IF EXISTS "成员可发送消息" ON messages;
CREATE POLICY "成员可发送消息"
  ON messages FOR INSERT
  WITH CHECK (sender_id = auth.uid() AND public.is_conversation_member(conversation_id));

-- ============================================
-- collab_documents
-- ============================================
DROP POLICY IF EXISTS "成员可查看文档" ON collab_documents;
CREATE POLICY "成员可查看文档"
  ON collab_documents FOR SELECT
  USING (public.is_conversation_member(conversation_id));

DROP POLICY IF EXISTS "成员可创建文档" ON collab_documents;
CREATE POLICY "成员可创建文档"
  ON collab_documents FOR INSERT
  WITH CHECK (created_by = auth.uid() AND public.is_conversation_member(conversation_id));

DROP POLICY IF EXISTS "成员可更新文档" ON collab_documents;
CREATE POLICY "成员可更新文档"
  ON collab_documents FOR UPDATE
  USING (public.is_conversation_member(conversation_id));

DROP POLICY IF EXISTS "成员可删除文档" ON collab_documents;
CREATE POLICY "成员可删除文档"
  ON collab_documents FOR DELETE
  USING (public.is_conversation_member(conversation_id));
