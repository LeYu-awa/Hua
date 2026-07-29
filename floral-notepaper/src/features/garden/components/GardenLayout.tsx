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
      <div className="flex items-center justify-between px-6 py-3 border-b border-paper-deep/10">
        <h2 className="text-[15px] font-medium text-ink-soft">
          {space === 'public' ? t('garden.publicGarden', '公共花园') : t('garden.personalGarden', '个人花园')}
        </h2>
        <SpaceSwitcher active={space} onChange={setSpace} />
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
