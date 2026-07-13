-- ============================================
-- RPC 函数
-- ============================================

-- 查找两个用户之间的 direct 会话
CREATE OR REPLACE FUNCTION find_direct_conversation(user_a uuid, user_b uuid)
RETURNS SETOF conversations
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT DISTINCT c.*
  FROM conversations c
  WHERE c.type = 'direct'
    AND EXISTS (
      SELECT 1 FROM conversation_members cm1
      WHERE cm1.conversation_id = c.id AND cm1.user_id = user_a
    )
    AND EXISTS (
      SELECT 1 FROM conversation_members cm2
      WHERE cm2.conversation_id = c.id AND cm2.user_id = user_b
    );
$$;
