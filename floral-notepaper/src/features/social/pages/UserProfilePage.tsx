import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ProfileHeader } from "../components/ProfileHeader";
import { ProfileTabs } from "../components/ProfileTabs";
import { ProfilePageSkeleton } from "../components/ProfilePageSkeleton";
import { CreationCard } from "../components/CreationCard";
import { CategoryShowcase } from "../components/CategoryShowcase";
import { useProfileStore } from "../stores/useProfileStore";
import { getUserArticles, getCategories } from "../../garden/api";
import type { GardenArticle, Category } from "../../garden/types";
import type { ProfileTab } from "../types";

interface UserProfilePageProps {
  userId: string;
  currentUserId?: string | null;
}

export function UserProfilePage({ userId, currentUserId }: UserProfilePageProps) {
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
  } = useProfileStore(currentUserId);
  const [articles, setArticles] = useState<GardenArticle[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const isOwnProfile = currentUserId === userId;

  useEffect(() => {
    loadProfile(userId);
  }, [loadProfile, userId]);

  useEffect(() => {
    getUserArticles(userId).then((items) =>
      setArticles(isOwnProfile ? items : items.filter((item) => item.isPublic)),
    );
    getCategories(userId).then(setCategories);
  }, [isOwnProfile, userId]);

  const tabs: ProfileTab[] = [
    {
      key: "articles" as const,
      label: t("profile.articles", "文章"),
      count: articles.length || stats?.articleCount,
    },
    {
      key: "categories" as const,
      label: t("profile.categories", "分类"),
      count: categories.length,
    },
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
      <div className="px-8 py-4 border-b border-paper-deep/10 bg-paper-warm/25">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <ProfileMetric label={t("profile.publicWorks", "公开作品")} value={articles.length} />
          <ProfileMetric label={t("profile.categories", "分类")} value={categories.length} />
          <ProfileMetric label={t("profile.views", "浏览")} value={stats?.viewCount ?? 0} />
          <ProfileMetric label={t("profile.likes", "获赞")} value={stats?.likeCount ?? 0} />
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
                {t("profile.noPublicArticles", "还没有公开作品")}
              </div>
            )}
          </div>
        )}
        {activeTab === "categories" && <CategoryShowcase categories={categories} />}
      </div>
    </div>
  );
}

function ProfileMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl border border-paper-deep/20 bg-paper/70 px-4 py-3">
      <div className="text-[18px] font-semibold text-ink-soft">{value}</div>
      <div className="text-[11px] text-ink-ghost/70 mt-0.5">{label}</div>
    </div>
  );
}
