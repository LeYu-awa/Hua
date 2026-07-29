import { supabase } from '../auth/supabase';
import type { UserProfile, UserStats } from './types';

export async function getUserProfile(userId: string): Promise<UserProfile | null> {
  const { data } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single();
  if (!data) return null;
  return {
    id: String(data.id),
    nickname: String(data.display_name ?? ''),
    bio: String(data.bio ?? ''),
    avatarUrl: String(data.avatar_url ?? ''),
    bannerUrl: String(data.banner_url ?? ''),
    website: String(data.website ?? ''),
    location: String(data.location ?? ''),
    createdAt: new Date(String(data.created_at)).getTime(),
  };
}

export async function updateUserProfile(userId: string, updates: Partial<Pick<UserProfile, 'nickname' | 'bio' | 'website' | 'location'>>): Promise<void> {
  await supabase.from('profiles').update({
    display_name: updates.nickname,
    bio: updates.bio,
    website: updates.website,
    location: updates.location,
    updated_at: new Date().toISOString(),
  }).eq('id', userId);
}

export async function uploadBanner(userId: string, file: File): Promise<string | null> {
  const fileExt = file.name.split('.').pop();
  const filePath = `banners/${userId}.${fileExt}`;
  const { error: uploadError } = await supabase.storage.from('avatars').upload(filePath, file, { upsert: true });
  if (uploadError) throw uploadError;
  const { data: urlData } = supabase.storage.from('avatars').getPublicUrl(filePath);
  return urlData.publicUrl;
}

// Stats
export async function getUserStats(userId: string): Promise<UserStats> {
  const { data } = await supabase.from('user_stats').select('*').eq('user_id', userId).single();
  if (!data) return { userId, articleCount: 0, followerCount: 0, followingCount: 0, likeCount: 0, viewCount: 0 };
  return {
    userId: String(data.user_id),
    articleCount: Number(data.article_count ?? 0),
    followerCount: Number(data.follower_count ?? 0),
    followingCount: Number(data.following_count ?? 0),
    likeCount: Number(data.like_count ?? 0),
    viewCount: Number(data.view_count ?? 0),
  };
}

// Follows
export async function isFollowing(followerId: string, followingId: string): Promise<boolean> {
  const { data } = await supabase
    .from('follows')
    .select('id')
    .eq('follower_id', followerId)
    .eq('following_id', followingId)
    .single();
  return !!data;
}

export async function followUser(followerId: string, followingId: string): Promise<void> {
  await supabase.from('follows').insert({ follower_id: followerId, following_id: followingId });
}

export async function unfollowUser(followerId: string, followingId: string): Promise<void> {
  await supabase.from('follows').delete().eq('follower_id', followerId).eq('following_id', followingId);
}

export async function getFollowers(userId: string): Promise<string[]> {
  const { data } = await supabase.from('follows').select('follower_id').eq('following_id', userId);
  return (data ?? []).map(d => String(d.follower_id));
}

export async function getFollowing(userId: string): Promise<string[]> {
  const { data } = await supabase.from('follows').select('following_id').eq('follower_id', userId);
  return (data ?? []).map(d => String(d.following_id));
}
