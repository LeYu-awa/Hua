-- 用户花灵角色表
CREATE TABLE IF NOT EXISTS public.user_hanaling (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  character_id text NOT NULL DEFAULT 'meihua',
  character_name text DEFAULT '未命名花灵',
  level int DEFAULT 1,
  experience int DEFAULT 0,
  mood text DEFAULT 'neutral' CHECK (mood IN ('happy', 'neutral', 'sleepy', 'excited', 'worried')),
  last_active_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.user_hanaling ENABLE ROW LEVEL SECURITY;

-- 所有认证用户可读（让好友能看到你的花灵）
CREATE POLICY "hanaling_select_all" ON public.user_hanaling
  FOR SELECT USING (true);

-- 只能更新自己的花灵
CREATE POLICY "hanaling_update_own" ON public.user_hanaling
  FOR UPDATE USING (auth.uid() = user_id);

-- 只能创建自己的花灵
CREATE POLICY "hanaling_insert_own" ON public.user_hanaling
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- 新用户注册时自动创建花灵
CREATE OR REPLACE FUNCTION public.handle_new_user_hanaling()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.user_hanaling (user_id)
  VALUES (NEW.id)
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created_hanaling ON auth.users;
CREATE TRIGGER on_auth_user_created_hanaling
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user_hanaling();
