import { useEffect, useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { ContentGrid } from "../components/ContentGrid";
import { useGardenStore } from "../stores/useGardenStore";
import type { GardenArticle } from "../types";

interface PersonalGardenPageProps {
  userId: string;
  onArticleClick?: (article: GardenArticle) => void;
}

export function PersonalGardenPage({ userId, onArticleClick }: PersonalGardenPageProps) {
  const { t } = useTranslation();
  const { articles, folders, loading, loadUserArticles, loadFolders, createFolder } =
    useGardenStore(userId);
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [folderName, setFolderName] = useState("");

  useEffect(() => {
    loadUserArticles();
    loadFolders();
  }, [loadUserArticles, loadFolders]);

  const handleCreateFolder = useCallback(() => {
    if (folderName.trim()) {
      createFolder(folderName.trim());
      setFolderName("");
      setShowNewFolder(false);
    }
  }, [folderName, createFolder]);

  const publicCount = articles.filter((article) => article.isPublic).length;
  const draftCount = Math.max(articles.length - publicCount, 0);
  const recentCount = articles.filter(
    (article) => Date.now() - article.updatedAt < 1000 * 60 * 60 * 24 * 7,
  ).length;
  const growthStage =
    articles.length >= 12
      ? t("garden.blooming", "开花期")
      : articles.length >= 4
        ? t("garden.growing", "生长期")
        : t("garden.sprout", "萌芽期");

  return (
    <>
      <div className="w-56 shrink-0 border-r border-paper-deep/20 p-3 space-y-3 overflow-y-auto">
        <div>
          <div className="text-[11px] font-medium text-ink-faint/60 px-3 py-1">
            {t("garden.projects", "项目与文件夹")}
          </div>
          <button
            onClick={() => {}}
            className="w-full text-left px-3 py-1.5 text-[13px] bg-bamboo-mist/50 text-bamboo rounded-lg transition-colors cursor-pointer"
          >
            全部项目 <span className="float-right text-[11px]">{articles.length}</span>
          </button>
          {folders.map((f) => (
            <div key={f.id} className="px-3 py-1.5 text-[13px] text-ink-soft rounded-lg">
              {f.type === "folder" ? "文件夹" : "项目"} · {f.name}
            </div>
          ))}
          {showNewFolder ? (
            <div className="px-2 mt-1">
              <input
                autoFocus
                value={folderName}
                onChange={(e) => setFolderName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleCreateFolder();
                  if (e.key === "Escape") setShowNewFolder(false);
                }}
                className="w-full px-2 py-1 text-[13px] bg-paper-warm/80 rounded-lg border border-bamboo/30 outline-none"
                placeholder={t("garden.folderName", "文件夹名称")}
              />
            </div>
          ) : (
            <button
              onClick={() => setShowNewFolder(true)}
              className="w-full text-left px-3 py-1.5 text-[12px] text-bamboo hover:bg-bamboo-mist/40 rounded-lg transition-colors cursor-pointer"
            >
              + {t("garden.newFolder", "新建文件夹")}
            </button>
          )}
        </div>

        <div className="rounded-2xl border border-paper-deep/20 bg-paper-warm/35 p-3">
          <div className="text-[11px] font-medium text-ink-faint/70 mb-2">
            {t("garden.growthStatus", "植物状态")}
          </div>
          <div className="h-24 rounded-xl bg-gradient-to-br from-bamboo-mist/70 to-paper/80 flex flex-col items-center justify-center text-center">
            <div className="text-[18px] text-bamboo">✦</div>
            <div className="text-[13px] font-medium text-ink-soft mt-1">{growthStage}</div>
            <div className="text-[10px] text-ink-ghost/75 mt-0.5">
              {t("garden.growthHint", "持续创作会让花园更丰盛")}
            </div>
          </div>
        </div>
      </div>

      <div className="flex-1 flex flex-col min-w-0">
        <div className="px-4 pt-4 grid grid-cols-2 lg:grid-cols-4 gap-3">
          <GardenStat label={t("garden.totalWorks", "全部内容")} value={articles.length} />
          <GardenStat label={t("garden.publicWorks", "公开作品")} value={publicCount} />
          <GardenStat label={t("garden.drafts", "草稿/私密")} value={draftCount} />
          <GardenStat label={t("garden.recentUpdates", "近 7 日更新")} value={recentCount} />
        </div>
        <ContentGrid
          articles={articles}
          loading={loading}
          onArticleClick={onArticleClick}
          emptyText={t("garden.noPersonalArticles", "还没有创作内容，去画布开始吧！")}
          variant="personal"
        />
      </div>
    </>
  );
}

function GardenStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl border border-paper-deep/20 bg-paper/70 px-4 py-3">
      <div className="text-[18px] font-semibold text-ink-soft">{value}</div>
      <div className="text-[11px] text-ink-ghost/70 mt-0.5">{label}</div>
    </div>
  );
}
