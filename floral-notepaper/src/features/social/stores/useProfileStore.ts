import { useState, useCallback } from 'react';
import type { UserProfile, UserStats } from '../types';
import * as api from '../api';

export function useProfileStore(currentUserId?: string | null) {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [stats, setStats] = useState<UserStats | null>(null);
  const [isFollowing, setIsFollowing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('articles');

  const loadProfile = useCallback(async (userId: string) => {
    setLoading(true);
    try {
      const [profileData, statsData] = await Promise.all([
        api.getUserProfile(userId),
        api.getUserStats(userId),
      ]);
      setProfile(profileData);
      setStats(statsData);
      if (currentUserId && currentUserId !== userId) {
        const following = await api.isFollowing(currentUserId, userId);
        setIsFollowing(following);
      }
    } finally {
      setLoading(false);
    }
  }, [currentUserId]);

  const updateProfile = useCallback(async (updates: Partial<Pick<UserProfile, 'nickname' | 'bio' | 'website' | 'location'>>) => {
    if (!profile) return;
    await api.updateUserProfile(profile.id, updates);
    setProfile(prev => prev ? { ...prev, ...updates } : null);
  }, [profile]);

  const toggleFollow = useCallback(async (targetUserId: string) => {
    if (!currentUserId) return;
    if (isFollowing) {
      await api.unfollowUser(currentUserId, targetUserId);
      setIsFollowing(false);
      setStats(prev => prev ? { ...prev, followerCount: Math.max(0, prev.followerCount - 1) } : null);
    } else {
      await api.followUser(currentUserId, targetUserId);
      setIsFollowing(true);
      setStats(prev => prev ? { ...prev, followerCount: prev.followerCount + 1 } : null);
    }
  }, [currentUserId, isFollowing]);

  return {
    profile, stats, isFollowing, loading, activeTab,
    setActiveTab, loadProfile, updateProfile, toggleFollow,
  };
}
