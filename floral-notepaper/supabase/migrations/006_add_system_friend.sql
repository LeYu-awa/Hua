-- ============================================
-- 添加系统好友 RPC（SECURITY DEFINER）
-- 绕过 RLS，允许以任意 user_id 插入记录
-- ============================================

-- 添加系统好友并创建私聊会话
CREATE OR REPLACE FUNCTION add_system_friend(p_user_id uuid, p_bot_id uuid)
RETURNS uuid  -- 返回会话 ID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_conv_id uuid;
  v_count int;
BEGIN
  -- 检查是否已经是好友
  SELECT COUNT(*) INTO v_count
  FROM public.friends
  WHERE user_id = p_user_id AND friend_id = p_bot_id;

  IF v_count > 0 THEN
    RAISE EXCEPTION '已经是好友了';
  END IF;

  -- 1. 创建单向好友关系（只需用户视角的记录）
  INSERT INTO public.friends (user_id, friend_id)
  VALUES (p_user_id, p_bot_id);

  -- 2. 查找或创建私聊会话
  SELECT c.id INTO v_conv_id
  FROM public.conversations c
  WHERE c.type = 'direct'
    AND EXISTS (SELECT 1 FROM public.conversation_members cm1 WHERE cm1.conversation_id = c.id AND cm1.user_id = p_user_id)
    AND EXISTS (SELECT 1 FROM public.conversation_members cm2 WHERE cm2.conversation_id = c.id AND cm2.user_id = p_bot_id)
  LIMIT 1;

  IF v_conv_id IS NULL THEN
    -- 创建新会话
    INSERT INTO public.conversations (type, created_by)
    VALUES ('direct', p_user_id)
    RETURNING id INTO v_conv_id;

    -- 添加成员（SECURITY DEFINER 绕过 RLS）
    INSERT INTO public.conversation_members (conversation_id, user_id) VALUES
      (v_conv_id, p_user_id),
      (v_conv_id, p_bot_id);
  END IF;

  RETURN v_conv_id;
END;
$$;
