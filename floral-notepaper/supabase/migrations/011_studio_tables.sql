-- 11. 创作台模块：花箴·创作台 (Floral Creation Studio) 表结构迁移
-- 关联设计文档：Docs/plans/2026-07-22-floral-creation-studio-design.md

-- ============================================
-- 1. 文档版本历史表
--    每次手动「保存」生成一个版本快照
-- ============================================
CREATE TABLE IF NOT EXISTS document_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  article_id UUID NOT NULL REFERENCES garden_articles(id) ON DELETE CASCADE,
  version_number INT NOT NULL,
  content JSONB NOT NULL,          -- 完整块结构快照
  title TEXT,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  change_summary TEXT              -- 本次变更摘要（自动生成）
);

CREATE INDEX IF NOT EXISTS idx_versions_article
  ON document_versions(article_id, version_number DESC);

ALTER TABLE document_versions ENABLE ROW LEVEL SECURITY;

-- 版本历史：创建者和文章作者可读
CREATE POLICY "document_versions_select" ON document_versions
  FOR SELECT USING (
    auth.uid() = created_by
    OR EXISTS (
      SELECT 1 FROM garden_articles
      WHERE garden_articles.id = document_versions.article_id
      AND garden_articles.author_id = auth.uid()
    )
  );

CREATE POLICY "document_versions_insert" ON document_versions
  FOR INSERT WITH CHECK (auth.uid() = created_by);

-- ============================================
-- 2. 草稿表
--    自动存稿的中间存储，与 garden_articles 解耦
-- ============================================
CREATE TABLE IF NOT EXISTS drafts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  article_id UUID REFERENCES garden_articles(id) ON DELETE SET NULL,
  title TEXT DEFAULT '',
  content JSONB NOT NULL DEFAULT '{}',
  source TEXT CHECK (source IN ('manual', 'import', 'convert_from_note')) DEFAULT 'manual',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_drafts_user ON drafts(user_id, updated_at DESC);

ALTER TABLE drafts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "drafts_owner_all" ON drafts
  FOR ALL USING (auth.uid() = user_id);

-- ============================================
-- 3. 创作轨迹日志表
--    记录创作过程中的每一次操作
-- ============================================
CREATE TABLE IF NOT EXISTS activity_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  article_id UUID REFERENCES garden_articles(id) ON DELETE SET NULL,
  action_type TEXT NOT NULL CHECK (action_type IN (
    'edit', 'create_draft', 'collect_material',
    'add_note', 'export_segment', 'publish'
  )),
  metadata JSONB DEFAULT '{}',     -- { position, block_type, change_size, ... }
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_activity_user ON activity_log(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_article ON activity_log(article_id, created_at DESC);

ALTER TABLE activity_log ENABLE ROW LEVEL SECURITY;

-- 创作轨迹：自己可见
CREATE POLICY "activity_log_select" ON activity_log
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "activity_log_insert" ON activity_log
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- ============================================
-- 4. 灵感草稿表
--    快速记录灵感，可升级为正式文章
-- ============================================
CREATE TABLE IF NOT EXISTS inspiration_drafts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  article_id UUID REFERENCES garden_articles(id) ON DELETE SET NULL,
  content TEXT NOT NULL,
  source TEXT CHECK (source IN ('quick_note', 'clipboard', 'wechat', 'browser')) DEFAULT 'quick_note',
  source_url TEXT,
  is_task BOOLEAN DEFAULT false,   -- 是否标记为待创作任务
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_inspiration_user ON inspiration_drafts(user_id, created_at DESC);

ALTER TABLE inspiration_drafts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "inspiration_drafts_owner_all" ON inspiration_drafts
  FOR ALL USING (auth.uid() = user_id);

-- ============================================
-- 5. 素材收集表
--    从微信、浏览器等渠道导入的素材
-- ============================================
CREATE TABLE IF NOT EXISTS collected_materials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  article_id UUID REFERENCES garden_articles(id) ON DELETE SET NULL,
  title TEXT,
  summary TEXT,
  cover_url TEXT,
  source_url TEXT NOT NULL,
  source_type TEXT CHECK (source_type IN ('wechat', 'web', 'manual')) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_materials_user ON collected_materials(user_id, created_at DESC);

ALTER TABLE collected_materials ENABLE ROW LEVEL SECURITY;

CREATE POLICY "collected_materials_owner_all" ON collected_materials
  FOR ALL USING (auth.uid() = user_id);

-- ============================================
-- 6. 创作批注表
--    在任意编辑块上添加的思路备注
-- ============================================
CREATE TABLE IF NOT EXISTS creation_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  article_id UUID REFERENCES garden_articles(id) ON DELETE CASCADE,
  block_id TEXT,                   -- TipTap 块 ID，选填
  content TEXT NOT NULL,
  is_promoted BOOLEAN DEFAULT false, -- 是否已转正为正文段落
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notes_article ON creation_notes(article_id, created_at DESC);

ALTER TABLE creation_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "creation_notes_owner_all" ON creation_notes
  FOR ALL USING (auth.uid() = user_id);

-- ============================================
-- 7. 存储桶：创作素材
-- ============================================
INSERT INTO storage.buckets (id, name, public)
  VALUES ('studio_materials', 'studio_materials', false)
  ON CONFLICT (id) DO NOTHING;

CREATE POLICY "studio_materials_select" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'studio_materials'
    AND (auth.role() = 'authenticated')
  );

CREATE POLICY "studio_materials_insert" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'studio_materials'
    AND auth.role() = 'authenticated'
  );

CREATE POLICY "studio_materials_update" ON storage.objects
  FOR UPDATE USING (
    bucket_id = 'studio_materials'
    AND auth.uid() = owner
  );

-- ============================================
-- 8. garden_articles 补充字段：封面裁剪信息
-- ============================================
ALTER TABLE garden_articles
  ADD COLUMN IF NOT EXISTS cover_crop JSONB DEFAULT NULL,   -- { x, y, width, height }
  ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'editing', 'reviewing', 'published'));

-- ============================================
-- 9. 自动更新 updated_at 的触发器
-- ============================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'set_drafts_updated_at'
  ) THEN
    CREATE TRIGGER set_drafts_updated_at
      BEFORE UPDATE ON drafts
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
END;
$$;
