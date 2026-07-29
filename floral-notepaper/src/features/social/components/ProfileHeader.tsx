import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { UserProfile, UserStats } from '../types';

interface ProfileHeaderProps {
  profile: UserProfile | null;
  stats: UserStats | null;
  isOwnProfile: boolean;
  isFollowing?: boolean;
  loading?: boolean;
  onFollow?: () => void;
  onEditProfile?: () => void;
  onBannerChange?: (file: File) => void;
}

export function ProfileHeader({ profile, stats, isOwnProfile, isFollowing, loading, onFollow, onEditProfile, onBannerChange }: ProfileHeaderProps) {
  const { t } = useTranslation();
  const [bannerHover, setBannerHover] = useState(false);

  if (loading || !profile) {
    return (
      <div className="h-[320px] flex items-center justify-center bg-paper-warm">
        <div className="text-[13px] text-ink-ghost">{t('common.loading', '加载中...')}</div>
      </div>
    );
  }

  return (
    <div className="relative">
      {/* Banner */}
      <div
        className="h-[280px] relative overflow-hidden"
        onMouseEnter={() => setBannerHover(true)}
        onMouseLeave={() => setBannerHover(false)}
      >
        {profile.bannerUrl ? (
          <img src={profile.bannerUrl} alt="" className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full bg-gradient-to-br from-bamboo-mist via-paper-warm to-ink-faint/20" />
        )}
        {isOwnProfile && bannerHover && (
          <label className="absolute bottom-4 right-4 px-3 py-1.5 bg-paper/80 backdrop-blur-sm rounded-lg text-[12px] text-ink-soft cursor-pointer hover:bg-paper transition-colors">
            {t('profile.changeBanner', '更换封面')}
            <input type="file" accept="image/*" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) onBannerChange?.(f); }} />
          </label>
        )}
      </div>

      {/* Profile info overlay */}
      <div className="relative px-8 -mt-20">
        <div className="flex items-end gap-6">
          {/* Avatar */}
          <div className="w-24 h-24 rounded-full ring-4 ring-paper overflow-hidden bg-paper-warm shadow-lg shrink-0">
            {profile.avatarUrl ? (
              <img src={profile.avatarUrl} alt="" className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-[32px] text-ink-ghost">
                {profile.nickname?.charAt(0)?.toUpperCase() || '?'}
              </div>
            )}
          </div>

          {/* Info */}
          <div className="flex-1 min-w-0 pb-2">
            <h1 className="text-[22px] font-semibold text-ink-soft">{profile.nickname || '未设置昵称'}</h1>
            <p className="text-[13px] text-ink-ghost/80 mt-0.5">{profile.bio || '这个人很懒，什么都没写...'}</p>
            <div className="flex items-center gap-4 mt-2">
              {profile.location && <span className="text-[12px] text-ink-ghost/60">📍 {profile.location}</span>}
              {profile.website && <a href={profile.website} target="_blank" rel="noopener noreferrer" className="text-[12px] text-bamboo hover:underline">🔗 {profile.website}</a>}
            </div>
          </div>

          {/* Actions */}
          <div className="pb-2 shrink-0">
            {isOwnProfile ? (
              <button onClick={onEditProfile} className="px-5 py-2 text-[13px] bg-paper border border-paper-deep/30 rounded-xl text-ink-soft hover:bg-paper-warm transition-colors cursor-pointer">
                {t('profile.editProfile', '编辑资料')}
              </button>
            ) : (
              <button
                onClick={onFollow}
                className={`px-5 py-2 text-[13px] rounded-xl transition-all cursor-pointer ${
                  isFollowing ? 'bg-paper border border-paper-deep/30 text-ink-soft hover:bg-paper-warm' : 'bg-bamboo text-cloud hover:bg-bamboo-light'
                }`}
              >
                {isFollowing ? t('profile.following', '已关注') : t('profile.follow', '关注')}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Stats bar */}
      {stats && (
        <div className="flex items-center gap-8 px-8 mt-4 pb-4 border-b border-paper-deep/10">
          <div className="text-center">
            <div className="text-[18px] font-semibold text-ink-soft">{stats.articleCount}</div>
            <div className="text-[11px] text-ink-ghost/60">{t('profile.articles', '文章')}</div>
          </div>
          <div className="text-center">
            <div className="text-[18px] font-semibold text-ink-soft">{stats.followerCount}</div>
            <div className="text-[11px] text-ink-ghost/60">{t('profile.followers', '粉丝')}</div>
          </div>
          <div className="text-center">
            <div className="text-[18px] font-semibold text-ink-soft">{stats.followingCount}</div>
            <div className="text-[11px] text-ink-ghost/60">{t('profile.following', '关注')}</div>
          </div>
          <div className="text-center">
            <div className="text-[18px] font-semibold text-ink-soft">{stats.likeCount}</div>
            <div className="text-[11px] text-ink-ghost/60">{t('profile.likes', '获赞')}</div>
          </div>
        </div>
      )}
    </div>
  );
}
