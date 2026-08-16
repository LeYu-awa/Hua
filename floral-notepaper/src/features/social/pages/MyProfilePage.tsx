import { useEffect, useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { ProfileHeader } from "../components/ProfileHeader";
import { ProfileTabs } from "../components/ProfileTabs";
import { CreationCard } from "../components/CreationCard";
import { CategoryShowcase } from "../components/CategoryShowcase";
import { SocialGraph } from "../components/SocialGraph";
import { ProfilePageSkeleton } from "../components/ProfilePageSkeleton";
import { useProfileStore } from "../stores/useProfileStore";
import { getUserArticles } from "../../garden/api";
import { getCategories } from "../../garden/api";
import type { GardenArticle } from "../../garden/types";
import type { Category } from "../../garden/types";
import type { ProfileTab } from "../types";

interface MyProfilePageProps {
  userId: string;
  currentUserId?: string | null;
}

function ProfileMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl border border-paper-deep/20 bg-paper/70 px-4 py-3">
      <div className="text-[18px] font-semibold text-ink-soft">{value}</div>
      <div className="text-[11px] text-ink-ghost/70 mt-0.5">{label}</div>
    </div>
  );
}

export function MyProfilePage({ userId, currentUserId }: MyProfilePageProps) {
  const { t } = useTranslation();
  const {
    profile,
    stats,
    isFollowing,
    loading,
    activeTab,
    setActiveTab,
    loadProfile,
    toggleFollow,
    updateProfile,
  } = useProfileStore(currentUserId);
  const [articles, setArticles] = useState<GardenArticle[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [showEdit, setShowEdit] = useState(false);
  const [editNickname, setEditNickname] = useState("");
  const [editBio, setEditBio] = useState("");

  const isOwnProfile = currentUserId === userId;
  const publicCount = articles.filter((article) => article.isPublic).length;
  const totalViews = articles.reduce((sum, article) => sum + article.viewCount, 0);
  const totalLikes = articles.reduce((sum, article) => sum + article.likeCount, 0);

  const tabs: ProfileTab[] = [
    { key: "articles", label: t("profile.articles", "文章"), count: stats?.articleCount },
    { key: "categories", label: t("profile.categories", "分类") },
    { key: "followers", label: t("profile.followers", "粉丝"), count: stats?.followerCount },
    { key: "following", label: t("profile.following", "关注"), count: stats?.followingCount },
  ];

  useEffect(() => {
    loadProfile(userId);
  }, [loadProfile, userId]);

  useEffect(() => {
    if (activeTab === "articles") {
      getUserArticles(userId).then(setArticles);
    } else if (activeTab === "categories") {
      getCategories(userId).then(setCategories);
    }
  }, [activeTab, userId]);

  const handleEditProfile = useCallback(() => {
    if (profile) {
      setEditNickname(profile.nickname);
      setEditBio(profile.bio);
    }
    setShowEdit(true);
  }, [profile]);

  const handleSaveProfile = useCallback(async () => {
    await updateProfile({ nickname: editNickname, bio: editBio });
    setShowEdit(false);
  }, [updateProfile, editNickname, editBio]);

  if (loading || !profile) {
    return <ProfilePageSkeleton />;
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-paper overflow-y-auto">
      <ProfileHeader
        profile={profile}
        stats={stats}
        isOwnProfile={isOwnProfile}
        isFollowing={isFollowing}
        loading={loading}
        onFollow={() => toggleFollow(userId)}
        onEditProfile={handleEditProfile}
      />

      <div className="px-8 py-4 border-b border-paper-deep/10 bg-paper-warm/25">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <ProfileMetric label={t("profile.totalWorks", "全部作品")} value={articles.length} />
          <ProfileMetric label={t("profile.publicWorks", "公开作品")} value={publicCount} />
          <ProfileMetric
            label={t("profile.views", "浏览")}
            value={stats?.viewCount ?? totalViews}
          />
          <ProfileMetric
            label={t("profile.likes", "获赞")}
            value={stats?.likeCount ?? totalLikes}
          />
        </div>
      </div>

      <ProfileTabs tabs={tabs} activeTab={activeTab} onTabChange={setActiveTab} />

      <div className="flex-1 overflow-y-auto">
        {activeTab === "articles" && (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 p-4">
            {articles.map((article) => (
              <CreationCard key={article.id} article={article} />
            ))}
            {articles.length === 0 && (
              <div className="col-span-full text-center py-12 text-[13px] text-ink-ghost">
                {t("profile.noArticles", "还没有发布文章")}
              </div>
            )}
          </div>
        )}
        {activeTab === "categories" && <CategoryShowcase categories={categories} />}
        {activeTab === "followers" && <SocialGraph userId={userId} mode="followers" />}
        {activeTab === "following" && <SocialGraph userId={userId} mode="following" />}
      </div>

      {/* Edit Profile Dialog */}
      {showEdit && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 backdrop-blur-sm"
          onClick={() => setShowEdit(false)}
        >
          <div
            className="bg-paper rounded-2xl shadow-xl border border-paper-deep/20 p-6 w-[400px]"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-[15px] font-medium text-ink-soft mb-4">
              {t("profile.editProfile", "编辑资料")}
            </h3>
            <div className="space-y-4">
              <div>
                <label className="text-[12px] text-ink-ghost block mb-1">
                  {t("profile.nickname", "昵称")}
                </label>
                <input
                  value={editNickname}
                  onChange={(e) => setEditNickname(e.target.value)}
                  className="w-full px-3 py-2 text-[13px] bg-paper-warm/60 rounded-lg border border-paper-deep/20 outline-none focus:border-bamboo/50"
                />
              </div>
              <div>
                <label className="text-[12px] text-ink-ghost block mb-1">
                  {t("profile.bio", "个人简介")}
                </label>
                <textarea
                  value={editBio}
                  onChange={(e) => setEditBio(e.target.value)}
                  rows={3}
                  className="w-full px-3 py-2 text-[13px] bg-paper-warm/60 rounded-lg border border-paper-deep/20 outline-none focus:border-bamboo/50 resize-none"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-6">
              <button
                onClick={() => setShowEdit(false)}
                className="px-4 py-1.5 text-[13px] text-ink-ghost hover:text-ink-soft rounded-lg transition-colors cursor-pointer"
              >
                {t("common.cancel", "取消")}
              </button>
              <button
                onClick={handleSaveProfile}
                className="px-4 py-1.5 text-[13px] bg-bamboo text-cloud rounded-lg hover:bg-bamboo-light transition-colors cursor-pointer"
              >
                {t("common.save", "保存")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
