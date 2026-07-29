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
      <ContentGrid
        articles={articles}
        loading={loading}
        onArticleClick={onArticleClick}
        emptyText={t('garden.noArticles', '暂无公开内容')}
      />
      <CategoryCreator open={showCreator} onClose={() => setShowCreator(false)} onCreate={createCategory} />
    </>
  );
}
