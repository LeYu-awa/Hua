-- ============================================
-- 允许好友读取彼此的 profiles 资料
-- ============================================

-- 允许认证用户读取好友的资料
CREATE POLICY "profiles_select_friends" ON public.profiles
  FOR SELECT USING (
    auth.role() = 'authenticated'
    AND (
      -- 自己的资料永远可读
      auth.uid() = id
      -- 好友的资料可读
      OR id IN (
        SELECT friend_id FROM public.friends WHERE user_id = auth.uid()
      )
      -- 自己的好友关系对方的资料
      OR id IN (
        SELECT user_id FROM public.friends WHERE friend_id = auth.uid()
      )
    )
  );

-- 删除旧的严格策略（已由上面的新策略覆盖）
DROP POLICY IF EXISTS "profiles_select_own" ON public.profiles;
