import { supabase } from '../auth/supabase';
import type { Category, GardenArticle, GardenFolder } from './types';

// Categories
export async function getCategories(userId?: string): Promise<Category[]> {
  let query = supabase.from('categories').select('*');
  if (userId) query = query.eq('user_id', userId);
  const { data } = await query.order('created_at', { ascending: true });
  return (data ?? []).map(mapCategory);
}

export async function createCategory(name: string, userId: string, icon?: string, color?: string): Promise<Category | null> {
  const { data } = await supabase.from('categories').insert({ name, user_id: userId, icon, color }).select().single();
  return data ? mapCategory(data) : null;
}

export async function deleteCategory(id: string): Promise<void> {
  await supabase.from('categories').delete().eq('id', id);
}

// Articles
export async function getPublicArticles(categoryId?: string): Promise<GardenArticle[]> {
  let query = supabase.from('garden_articles').select('*').eq('is_public', true);
  if (categoryId) query = query.eq('category_id', categoryId);
  const { data } = await query.order('created_at', { ascending: false });
  return (data ?? []).map(mapArticle);
}

export async function getUserArticles(userId: string): Promise<GardenArticle[]> {
  const { data } = await supabase.from('garden_articles').select('*').eq('author_id', userId).order('created_at', { ascending: false });
  return (data ?? []).map(mapArticle);
}

export async function createArticle(article: Partial<GardenArticle>, userId: string): Promise<GardenArticle | null> {
  const { data } = await supabase.from('garden_articles').insert({
    title: article.title,
    summary: article.summary,
    content: article.content,
    category_id: article.categoryId,
    tags: article.tags,
    author_id: userId,
    is_public: article.isPublic ?? false,
    cover_image: article.coverImage,
  }).select().single();
  return data ? mapArticle(data) : null;
}

export async function updateArticle(id: string, updates: Partial<GardenArticle>): Promise<void> {
  await supabase.from('garden_articles').update({
    title: updates.title,
    summary: updates.summary,
    content: updates.content,
    category_id: updates.categoryId,
    tags: updates.tags,
    is_public: updates.isPublic,
    cover_image: updates.coverImage,
    updated_at: new Date().toISOString(),
  }).eq('id', id);
}

export async function deleteArticle(id: string): Promise<void> {
  await supabase.from('garden_articles').delete().eq('id', id);
}

// Folders
export async function getFolders(userId: string): Promise<GardenFolder[]> {
  const { data } = await supabase.from('garden_folders').select('*').eq('user_id', userId).order('created_at', { ascending: true });
  return (data ?? []).map(mapFolder);
}

export async function createFolder(name: string, userId: string, parentId?: string): Promise<GardenFolder | null> {
  const { data } = await supabase.from('garden_folders').insert({ name, user_id: userId, parent_id: parentId }).select().single();
  return data ? mapFolder(data) : null;
}

export async function deleteFolder(id: string): Promise<void> {
  await supabase.from('garden_folders').delete().eq('id', id);
}

// Mappers
function mapCategory(item: Record<string, unknown>): Category {
  return {
    id: String(item.id),
    name: String(item.name),
    icon: String(item.icon ?? ''),
    color: String(item.color ?? ''),
    userId: String(item.user_id),
    parentId: item.parent_id ? String(item.parent_id) : undefined,
    articleCount: Number(item.article_count ?? 0),
    createdAt: new Date(String(item.created_at)).getTime(),
  };
}

function mapArticle(item: Record<string, unknown>): GardenArticle {
  return {
    id: String(item.id),
    title: String(item.title),
    summary: String(item.summary ?? ''),
    content: String(item.content ?? ''),
    categoryId: String(item.category_id ?? ''),
    tags: (item.tags as string[]) ?? [],
    authorId: String(item.author_id),
    isPublic: Boolean(item.is_public),
    coverImage: item.cover_image ? String(item.cover_image) : undefined,
    viewCount: Number(item.view_count ?? 0),
    likeCount: Number(item.like_count ?? 0),
    createdAt: new Date(String(item.created_at)).getTime(),
    updatedAt: new Date(String(item.updated_at)).getTime(),
  };
}

function mapFolder(item: Record<string, unknown>): GardenFolder {
  return {
    id: String(item.id),
    name: String(item.name),
    userId: String(item.user_id),
    parentId: item.parent_id ? String(item.parent_id) : undefined,
    articleIds: (item.article_ids as string[]) ?? [],
    type: String(item.type) as 'folder' | 'project',
    createdAt: new Date(String(item.created_at)).getTime(),
    updatedAt: new Date(String(item.updated_at)).getTime(),
  };
}
