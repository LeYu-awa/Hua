-- 协作文档表
CREATE TABLE IF NOT EXISTS public.collab_docs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title text DEFAULT '未命名协作',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- 协作参与者
CREATE TABLE IF NOT EXISTS public.collab_participants (
  doc_id uuid NOT NULL REFERENCES public.collab_docs(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text DEFAULT 'editor' CHECK (role IN ('owner', 'editor', 'viewer')),
  joined_at timestamptz DEFAULT now(),
  PRIMARY KEY (doc_id, user_id)
);

-- 协作聊天消息
CREATE TABLE IF NOT EXISTS public.collab_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_id uuid NOT NULL REFERENCES public.collab_docs(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  content text NOT NULL,
  msg_type text DEFAULT 'text' CHECK (msg_type IN ('text', 'system', 'voice')),
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_collab_messages_doc ON public.collab_messages(doc_id, created_at);
CREATE INDEX IF NOT EXISTS idx_collab_participants_user ON public.collab_participants(user_id);

ALTER TABLE public.collab_docs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.collab_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.collab_messages ENABLE ROW LEVEL SECURITY;

-- 协作文档：参与者可读
CREATE POLICY "collab_docs_select_participant" ON public.collab_docs
  FOR SELECT USING (
    owner_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.collab_participants
      WHERE doc_id = id AND user_id = auth.uid()
    )
  );

-- 协作文档：owner 可创建
CREATE POLICY "collab_docs_insert_owner" ON public.collab_docs
  FOR INSERT WITH CHECK (auth.uid() = owner_id);

-- 协作文档：owner 可更新
CREATE POLICY "collab_docs_update_owner" ON public.collab_docs
  FOR UPDATE USING (auth.uid() = owner_id);

-- 协作文档：owner 可删除
CREATE POLICY "collab_docs_delete_owner" ON public.collab_docs
  FOR DELETE USING (auth.uid() = owner_id);

-- 参与者：协作者可见
CREATE POLICY "collab_participants_select" ON public.collab_participants
  FOR SELECT USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.collab_participants p
      WHERE p.doc_id = doc_id AND p.user_id = auth.uid()
    )
  );

-- 参与者：owner 可添加
CREATE POLICY "collab_participants_insert_owner" ON public.collab_participants
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.collab_docs
      WHERE id = doc_id AND owner_id = auth.uid()
    )
  );

-- 聊天消息：参与者可读
CREATE POLICY "collab_messages_select" ON public.collab_messages
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.collab_participants
      WHERE doc_id = collab_messages.doc_id AND user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM public.collab_docs
      WHERE id = collab_messages.doc_id AND owner_id = auth.uid()
    )
  );

-- 聊天消息：参与者可发
CREATE POLICY "collab_messages_insert" ON public.collab_messages
  FOR INSERT WITH CHECK (
    auth.uid() = sender_id
    AND (
      EXISTS (
        SELECT 1 FROM public.collab_participants
        WHERE doc_id = collab_messages.doc_id AND user_id = auth.uid()
      )
      OR EXISTS (
        SELECT 1 FROM public.collab_docs
        WHERE id = collab_messages.doc_id AND owner_id = auth.uid()
      )
    )
  );
