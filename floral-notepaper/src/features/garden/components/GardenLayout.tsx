import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SpaceSwitcher } from './SpaceSwitcher';
import { PublicGardenPage } from '../pages/PublicGardenPage';
import { PersonalGardenPage } from '../pages/PersonalGardenPage';
import { ArticleDetailPage } from '../pages/ArticleDetailPage';
import type { GardenArticle } from '../types';

interface GardenLayoutProps {
  userId?: string | null;
}

export function GardenLayout({ userId }: GardenLayoutProps) {
  const { t } = useTranslation();
  const [space, setSpace] = useState<'public' | 'personal'>('public');
  const [selectedArticle, setSelectedArticle] = useState<GardenArticle | null>(null);

  if (selectedArticle) {
    return (
      <div className="flex-1 flex flex-col min-h-0 bg-paper">
        <ArticleDetailPage
          userId={userId ?? ''}
          currentUserId={userId}
          article={selectedArticle}
          onBack={() => setSelectedArticle(null)}
          onRefresh={() => setSelectedArticle(null)}
        />
      </div>
    );
  }

  if (space === 'personal' && !userId) {
    return (
      <div className="flex-1 flex items-center justify-center bg-paper">
        <div className="text-center">
          <div className="text-[32px] mb-2">🔒</div>
          <div className="text-[13px] text-ink-ghost">{t('garden.loginRequired', '请登录后访问个人花园')}</div>
          <button
            onClick={() => setSpace('public')}
            className="mt-3 px-4 py-1.5 text-[13px] bg-bamboo text-cloud rounded-lg hover:bg-bamboo-light transition-colors cursor-pointer"
          >
            {t('garden.browsePublic', '浏览公共花园')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-paper">
      {/* Global header with SpaceSwitcher */}
      <div className="px-6 py-4 border-b border-paper-deep/10 bg-paper/80">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-[16px] font-medium text-ink-soft">
              {space === 'public' ? t('garden.publicGarden', '公共花园') : t('garden.personalGarden', '我的花园')}
            </h2>
            <p className="text-[11px] text-ink-ghost/75 mt-0.5">
              {space === 'public'
                ? t('garden.publicGardenHint', '发现公开作品、灵感集合和主题分类')
                : t('garden.personalGardenHint', '整理项目、草稿、画布与长期写作状态')}
            </p>
          </div>
          <SpaceSwitcher active={space} onChange={setSpace} />
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 flex min-h-0">
        {space === 'public' ? (
          <PublicGardenPage userId={userId} onArticleClick={setSelectedArticle} />
        ) : (
          userId ? <PersonalGardenPage userId={userId} onArticleClick={setSelectedArticle} /> : null
        )}
      </div>
    </div>
  );
}
