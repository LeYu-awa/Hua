-- 学习社交平台：新增表结构迁移

-- 1. 用户资料扩展（在现有 profiles 表基础上添加字段）
ALTER TABLE profiles
ADD COLUMN IF NOT EXISTS bio TEXT DEFAULT '',
ADD COLUMN IF NOT EXISTS banner_url TEXT DEFAULT '',
ADD COLUMN IF NOT EXISTS website TEXT DEFAULT '',
ADD COLUMN IF NOT EXISTS location TEXT DEFAULT '';

-- 2. 用户统计数据
CREATE TABLE IF NOT EXISTS user_stats (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  article_count INT DEFAULT 0,
  follower_count INT DEFAULT 0,
  following_count INT DEFAULT 0,
  like_count INT DEFAULT 0,
  view_count INT DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE user_stats ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user_stats_select" ON user_stats
  FOR SELECT USING (true);

CREATE POLICY "user_stats_update" ON user_stats
  FOR UPDATE USING (auth.uid() = user_id);

-- 3. 关注关系（区别于现有的 friends 双向好友，follows 是单向关注）
CREATE TABLE IF NOT EXISTS follows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  follower_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  following_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(follower_id, following_id)
);

ALTER TABLE follows ENABLE ROW LEVEL SECURITY;

CREATE POLICY "follows_select" ON follows
  FOR SELECT USING (true);

CREATE POLICY "follows_insert" ON follows
  FOR INSERT WITH CHECK (auth.uid() = follower_id);

CREATE POLICY "follows_delete" ON follows
  FOR DELETE USING (auth.uid() = follower_id);

-- 4. 分类标签
CREATE TABLE IF NOT EXISTS categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  icon TEXT DEFAULT '',
  color TEXT DEFAULT '',
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  parent_id UUID REFERENCES categories(id) ON DELETE SET NULL,
  article_count INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "categories_select" ON categories
  FOR SELECT USING (true);

CREATE POLICY "categories_insert" ON categories
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "categories_update" ON categories
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "categories_delete" ON categories
  FOR DELETE USING (auth.uid() = user_id);

-- 5. 花园文章
CREATE TABLE IF NOT EXISTS garden_articles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL DEFAULT '',
  summary TEXT DEFAULT '',
  content TEXT DEFAULT '',
  category_id UUID REFERENCES categories(id) ON DELETE SET NULL,
  tags TEXT[] DEFAULT '{}',
  author_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  is_public BOOLEAN DEFAULT false,
  cover_image TEXT DEFAULT '',
  view_count INT DEFAULT 0,
  like_count INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE garden_articles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "garden_articles_select_public" ON garden_articles
  FOR SELECT USING (is_public = true OR auth.uid() = author_id);

CREATE POLICY "garden_articles_insert" ON garden_articles
  FOR INSERT WITH CHECK (auth.uid() = author_id);

CREATE POLICY "garden_articles_update" ON garden_articles
  FOR UPDATE USING (auth.uid() = author_id);

CREATE POLICY "garden_articles_delete" ON garden_articles
  FOR DELETE USING (auth.uid() = author_id);

-- 6. 个人花园文件夹
CREATE TABLE IF NOT EXISTS garden_folders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  parent_id UUID REFERENCES garden_folders(id) ON DELETE SET NULL,
  article_ids UUID[] DEFAULT '{}',
  type TEXT DEFAULT 'folder' CHECK (type IN ('folder', 'project')),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE garden_folders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "garden_folders_select" ON garden_folders
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "garden_folders_insert" ON garden_folders
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "garden_folders_update" ON garden_folders
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "garden_folders_delete" ON garden_folders
  FOR DELETE USING (auth.uid() = user_id);

-- 7. 无限画布节点持久化
CREATE TABLE IF NOT EXISTS canvas_nodes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('search_card', 'article', 'journal', 'workflow', 'note')),
  x FLOAT DEFAULT 0,
  y FLOAT DEFAULT 0,
  width FLOAT DEFAULT 240,
  height FLOAT DEFAULT 160,
  z_index INT DEFAULT 0,
  title TEXT DEFAULT '',
  summary TEXT DEFAULT '',
  content TEXT DEFAULT '',
  source_url TEXT DEFAULT '',
  workflow_id TEXT DEFAULT '',
  tags TEXT[] DEFAULT '{}',
  ai_expanded BOOLEAN DEFAULT false,
  metadata JSONB DEFAULT '{}',
  canvas_id TEXT DEFAULT 'default',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE canvas_nodes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "canvas_nodes_select" ON canvas_nodes
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "canvas_nodes_insert" ON canvas_nodes
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "canvas_nodes_update" ON canvas_nodes
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "canvas_nodes_delete" ON canvas_nodes
  FOR DELETE USING (auth.uid() = user_id);

-- 索引
CREATE INDEX IF NOT EXISTS idx_garden_articles_author ON garden_articles(author_id);
CREATE INDEX IF NOT EXISTS idx_garden_articles_public ON garden_articles(is_public);
CREATE INDEX IF NOT EXISTS idx_garden_articles_category ON garden_articles(category_id);
CREATE INDEX IF NOT EXISTS idx_garden_articles_created ON garden_articles(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_categories_user ON categories(user_id);
CREATE INDEX IF NOT EXISTS idx_follows_follower ON follows(follower_id);
CREATE INDEX IF NOT EXISTS idx_follows_following ON follows(following_id);
CREATE INDEX IF NOT EXISTS idx_garden_folders_user ON garden_folders(user_id);
CREATE INDEX IF NOT EXISTS idx_canvas_nodes_user ON canvas_nodes(user_id);
CREATE INDEX IF NOT EXISTS idx_canvas_nodes_canvas ON canvas_nodes(canvas_id);
