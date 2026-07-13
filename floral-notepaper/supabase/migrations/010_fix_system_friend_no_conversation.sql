-- ============================================
-- 修复 add_system_friend：已存在好友但没有会话时，
-- 自动补建会话，而不是直接抛异常退出
-- ============================================

CREATE OR REPLACE FUNCTION add_system_friend(p_user_id uuid, p_bot_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_conv_id uuid;
  v_count   int;
BEGIN
  -- 1. 确保好友关系存在
  SELECT COUNT(*) INTO v_count
  FROM public.friends
  WHERE user_id = p_user_id AND friend_id = p_bot_id;

  IF v_count = 0 THEN
    INSERT INTO public.friends (user_id, friend_id)
    VALUES (p_user_id, p_bot_id);
  END IF;

  -- 2. 查找已有私聊会话
  SELECT c.id INTO v_conv_id
  FROM public.conversations c
  WHERE c.type = 'direct'
    AND EXISTS (SELECT 1 FROM public.conversation_members cm1 WHERE cm1.conversation_id = c.id AND cm1.user_id = p_user_id)
    AND EXISTS (SELECT 1 FROM public.conversation_members cm2 WHERE cm2.conversation_id = c.id AND cm2.user_id = p_bot_id)
  LIMIT 1;

  -- 3. 如果没有会话，创建一个
  IF v_conv_id IS NULL THEN
    INSERT INTO public.conversations (type, created_by)
    VALUES ('direct', p_user_id)
    RETURNING id INTO v_conv_id;

    INSERT INTO public.conversation_members (conversation_id, user_id) VALUES
      (v_conv_id, p_user_id),
      (v_conv_id, p_bot_id);
  END IF;

  RETURN v_conv_id;
END;
$$;
