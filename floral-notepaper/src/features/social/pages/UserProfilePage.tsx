import { useEffect } from 'react';
import { ProfileHeader } from '../components/ProfileHeader';
import { ProfileTabs } from '../components/ProfileTabs';
import { ProfilePageSkeleton } from '../components/ProfilePageSkeleton';
import { useProfileStore } from '../stores/useProfileStore';
import type { ProfileTab } from '../types';

interface UserProfilePageProps {
  userId: string;
  currentUserId?: string | null;
}

export function UserProfilePage({ userId, currentUserId }: UserProfilePageProps) {
  const { profile, stats, isFollowing, loading, activeTab, setActiveTab, loadProfile, toggleFollow } = useProfileStore(currentUserId);

  useEffect(() => { loadProfile(userId); }, [loadProfile, userId]);

  const tabs: ProfileTab[] = [
    { key: 'articles' as const, label: '文章', count: stats?.articleCount },
    { key: 'categories' as const, label: '分类' },
  ];

  if (loading || !profile) {
    return <ProfilePageSkeleton />;
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-paper overflow-y-auto">
      <ProfileHeader
        profile={profile}
        stats={stats}
        isOwnProfile={false}
        isFollowing={isFollowing}
        loading={loading}
        onFollow={() => toggleFollow(userId)}
      />
      <ProfileTabs tabs={tabs} activeTab={activeTab} onTabChange={setActiveTab} />
      <div className="flex-1 overflow-y-auto">
        {/* Same content as MyProfilePage but read-only */}
      </div>
    </div>
  );
}
