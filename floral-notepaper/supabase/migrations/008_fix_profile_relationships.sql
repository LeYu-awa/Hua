-- ============================================
-- 修复 Supabase schema cache 的 profile 关系
-- 
-- 问题：friends.friend_id / friend_requests.sender_id 
-- 等列的 FK 只指向 auth.users，没有指向 profiles，
-- 导致 Supabase 的 schema cache 找不到
-- friends→profiles 的关系，profile 联表查询报错：
--   "Could not find a relationship between 'friends' and 'profiles'"
--
-- 修复：给这些列添加指向 profiles(id) 的第二 FK，
-- PostgreSQL 允许同一列有多个 FK 约束。
-- 由于 profiles.id 本身 FK 到 auth.users.id，
-- 值域与 auth.users.id 一致，安全无冲突。
-- ============================================

DO $$ BEGIN
  -- friends.friend_id → profiles.id
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'friends_friend_id_fkey_profiles'
  ) THEN
    ALTER TABLE friends
      ADD CONSTRAINT friends_friend_id_fkey_profiles
      FOREIGN KEY (friend_id) REFERENCES profiles(id) ON DELETE CASCADE;
  END IF;

  -- friend_requests.sender_id → profiles.id
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'friend_requests_sender_id_fkey_profiles'
  ) THEN
    ALTER TABLE friend_requests
      ADD CONSTRAINT friend_requests_sender_id_fkey_profiles
      FOREIGN KEY (sender_id) REFERENCES profiles(id) ON DELETE CASCADE;
  END IF;

  -- friend_requests.receiver_id → profiles.id
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'friend_requests_receiver_id_fkey_profiles'
  ) THEN
    ALTER TABLE friend_requests
      ADD CONSTRAINT friend_requests_receiver_id_fkey_profiles
      FOREIGN KEY (receiver_id) REFERENCES profiles(id) ON DELETE CASCADE;
  END IF;

  -- conversation_members.user_id → profiles.id
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'conversation_members_user_id_fkey_profiles'
  ) THEN
    ALTER TABLE conversation_members
      ADD CONSTRAINT conversation_members_user_id_fkey_profiles
      FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;
  END IF;
END $$;
