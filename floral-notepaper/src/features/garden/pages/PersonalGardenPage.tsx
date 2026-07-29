import { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { ContentGrid } from '../components/ContentGrid';
import { useGardenStore } from '../stores/useGardenStore';
import type { GardenArticle } from '../types';

interface PersonalGardenPageProps {
  userId: string;
  onArticleClick?: (article: GardenArticle) => void;
}

export function PersonalGardenPage({ userId, onArticleClick }: PersonalGardenPageProps) {
  const { t } = useTranslation();
  const {
    articles, folders, loading,
    loadUserArticles, loadFolders, createFolder,
  } = useGardenStore(userId);
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [folderName, setFolderName] = useState('');

  useEffect(() => { loadUserArticles(); loadFolders(); }, [loadUserArticles, loadFolders]);

  const handleCreateFolder = useCallback(() => {
    if (folderName.trim()) {
      createFolder(folderName.trim());
      setFolderName('');
      setShowNewFolder(false);
    }
  }, [folderName, createFolder]);

  return (
    <>
      <div className="w-48 shrink-0 border-r border-paper-deep/20 p-3 space-y-1">
        <div className="text-[11px] font-medium text-ink-faint/60 px-3 py-1">{t('garden.folders', '文件夹')}</div>
        <button
          onClick={() => {}}
          className="w-full text-left px-3 py-1.5 text-[13px] text-ink-soft hover:bg-paper-warm/60 rounded-lg transition-colors cursor-pointer"
        >
          📂 {t('garden.allProjects', '全部项目')}
        </button>
        {folders.map(f => (
          <div key={f.id} className="px-3 py-1.5 text-[13px] text-ink-soft rounded-lg">
            {f.type === 'folder' ? '📁' : '📦'} {f.name}
          </div>
        ))}
        {showNewFolder ? (
          <div className="px-2">
            <input
              autoFocus
              value={folderName}
              onChange={e => setFolderName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleCreateFolder(); if (e.key === 'Escape') setShowNewFolder(false); }}
              className="w-full px-2 py-1 text-[13px] bg-paper-warm/80 rounded-lg border border-bamboo/30 outline-none"
              placeholder={t('garden.folderName', '文件夹名称')}
            />
          </div>
        ) : (
          <button
            onClick={() => setShowNewFolder(true)}
            className="w-full text-left px-3 py-1.5 text-[12px] text-bamboo hover:bg-bamboo-mist/40 rounded-lg transition-colors cursor-pointer"
          >
            + {t('garden.newFolder', '新建文件夹')}
          </button>
        )}
      </div>
      
      <ContentGrid
        articles={articles}
        loading={loading}
        onArticleClick={onArticleClick}
        emptyText={t('garden.noPersonalArticles', '还没有创作内容，去画布开始吧！')}
      />
    </>
  );
}
