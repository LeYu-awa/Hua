import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CategorySidebar } from '../components/CategorySidebar';
import { ContentGrid } from '../components/ContentGrid';
import { CategoryCreator } from '../components/CategoryCreator';
import { useGardenStore } from '../stores/useGardenStore';
import type { GardenArticle } from '../types';

interface PublicGardenPageProps {
  userId?: string | null;
  onArticleClick?: (article: GardenArticle) => void;
}

export function PublicGardenPage({ userId, onArticleClick }: PublicGardenPageProps) {
  const { t } = useTranslation();
  const {
    categories, articles, loading,
    loadCategories, loadPublicArticles, createCategory,
  } = useGardenStore(userId);
  const [activeCategoryId, setActiveCategoryId] = useState<string | undefined>(undefined);
  const [showCreator, setShowCreator] = useState(false);

  useEffect(() => { loadCategories(); }, [loadCategories]);
  useEffect(() => { loadPublicArticles(activeCategoryId); }, [loadPublicArticles, activeCategoryId]);

  return (
    <>
      <CategorySidebar
        categories={categories}
        activeCategoryId={activeCategoryId}
        onSelectCategory={setActiveCategoryId}
        onCreateCategory={() => setShowCreator(true)}
      />
      <div className="flex-1 flex flex-col min-w-0">
        <div className="px-4 pt-4">
          <div className="rounded-2xl border border-paper-deep/20 bg-paper-warm/35 px-4 py-3 flex items-center justify-between gap-4">
            <div>
              <div className="text-[13px] font-medium text-ink-soft">{t('garden.discoverTitle', '发现正在生长的作品')}</div>
              <div className="text-[11px] text-ink-ghost/75 mt-0.5">{t('garden.discoverHint', '按主题筛选公开文章、灵感集合与创作项目')}</div>
            </div>
            <div className="hidden md:flex items-center gap-2 text-[11px] text-ink-ghost/70">
              <span className="px-2 py-1 rounded-full bg-paper/70">{articles.length} 篇作品</span>
              <span className="px-2 py-1 rounded-full bg-paper/70">{categories.length} 个主题</span>
            </div>
          </div>
        </div>
        <ContentGrid
          articles={articles}
          loading={loading}
          onArticleClick={onArticleClick}
          emptyText={t('garden.noArticles', '暂无公开内容')}
        />
      </div>
      <CategoryCreator open={showCreator} onClose={() => setShowCreator(false)} onCreate={createCategory} />
    </>
  );
}
