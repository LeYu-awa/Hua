import { useState, useEffect } from 'react';
import { getFollowers, getFollowing } from '../api';

interface SocialGraphProps {
  userId: string;
  mode: 'followers' | 'following';
}

export function SocialGraph({ userId, mode }: SocialGraphProps) {
  const [userIds, setUserIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    (mode === 'followers' ? getFollowers(userId) : getFollowing(userId))
      .then(setUserIds)
      .finally(() => setLoading(false));
  }, [userId, mode]);

  if (loading) return <div className="p-8 text-center text-[13px] text-ink-ghost">加载中...</div>;

  if (userIds.length === 0) {
    return (
      <div className="p-8 text-center text-[13px] text-ink-ghost">
        {mode === 'followers' ? '还没有粉丝' : '还没有关注任何人'}
      </div>
    );
  }

  return (
    <div className="p-4 space-y-2">
      {userIds.map(uid => (
        <div key={uid} className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-paper-warm/60 transition-colors">
          <div className="w-8 h-8 rounded-full bg-paper-warm flex items-center justify-center text-[14px] text-ink-ghost">
            {uid.charAt(0).toUpperCase()}
          </div>
          <span className="text-[13px] text-ink-soft">{uid.slice(0, 8)}...</span>
        </div>
      ))}
    </div>
  );
}
