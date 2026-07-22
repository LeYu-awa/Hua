import { useState } from 'react';
import { useStudioStore } from '../stores/useStudioStore';
import type { GardenArticle } from '../../garden/types';

interface EditorSidebarProps {
  onCreateNew: () => void;
  onSelectArticle: (article: GardenArticle) => void;
}

export function EditorSidebar({ onCreateNew, onSelectArticle }: EditorSidebarProps) {
  const { filteredArticles, articleSearchQuery, setArticleSearchQuery, currentArticle } = useStudioStore();
  const [tab, setTab] = useState<'articles' | 'drafts' | 'inspiration'>('articles');

  return (
    <aside className="w-[260px] border-r border-paper-deep/10 bg-paper-warm/20 flex flex-col shrink-0">
      {/* Header */}
      <div className="px-4 py-3 border-b border-paper-deep/10">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-[13px] font-medium text-ink">创作列表</h2>
          <button
            type="button"
            onClick={onCreateNew}
            className="px-3 py-1 text-[11px] bg-bamboo text-cloud rounded-lg hover:bg-bamboo-light transition-colors cursor-pointer"
          >
            + 新建
          </button>
        </div>
        <input
          value={articleSearchQuery}
          onChange={e => setArticleSearchQuery(e.target.value)}
          placeholder="搜索文章..."
          className="w-full px-2.5 py-1.5 text-[12px] bg-paper-warm/60 border border-paper-deep/10 rounded-lg focus:outline-none focus:border-bamboo/40"
        />
      </div>

      {/* Tabs */}
      <div className="flex border-b border-paper-deep/10">
        {(['articles', 'drafts', 'inspiration'] as const).map(t => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`flex-1 py-2 text-[11px] font-medium transition-colors cursor-pointer ${
              tab === t ? 'text-bamboo border-b-2 border-bamboo' : 'text-ink-ghost hover:text-ink-soft'
            }`}
          >
            {{ articles: '文章', drafts: '草稿', inspiration: '灵感' }[t]}
          </button>
        ))}
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {tab === 'articles' && (
          <ArticleList
            articles={filteredArticles}
            currentId={currentArticle?.id}
            onSelect={onSelectArticle}
          />
        )}
        {tab === 'drafts' && (
          <div className="p-4 text-center text-[12px] text-ink-ghost">
            草稿将在自动保存时创建
          </div>
        )}
        {tab === 'inspiration' && <InspirationTab />}
      </div>
    </aside>
  );
}

function ArticleList({ articles, currentId, onSelect }: {
  articles: GardenArticle[];
  currentId?: string;
  onSelect: (article: GardenArticle) => void;
}) {
  if (articles.length === 0) {
    return (
      <div className="p-6 text-center">
        <div className="text-[24px] text-ink-ghost mb-2">📝</div>
        <div className="text-[12px] text-ink-ghost mb-3">还没有文章</div>
        <button
          type="button"
          onClick={() => {}}
          className="text-[11px] text-bamboo hover:underline cursor-pointer"
        >
          开始创作 →
        </button>
      </div>
    );
  }

  return (
    <div className="py-1">
      {articles.map(article => (
        <button
          key={article.id}
          type="button"
          onClick={() => onSelect(article)}
          className={`w-full text-left px-3 py-2.5 border-b border-paper-deep/5 last:border-0 transition-colors cursor-pointer hover:bg-paper-warm/40 ${
            currentId === article.id ? 'bg-bamboo-mist/15 border-l-2 border-l-bamboo' : ''
          }`}
        >
          <div className="text-[12px] font-medium text-ink truncate">
            {article.title || '未命名'}
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-50 text-gray-500">草稿</span>
            <span className="text-[10px] text-ink-ghost">
              {new Date(article.updatedAt).toLocaleDateString()}
            </span>
          </div>
        </button>
      ))}
    </div>
  );
}

function InspirationTab() {
  const inspirationDrafts = useStudioStore((s: { inspirationDrafts: import('../types').InspirationDraft[] }) => s.inspirationDrafts);

  if (inspirationDrafts.length === 0) {
    return (
      <div className="p-6 text-center">
        <div className="text-[24px] text-ink-ghost mb-2">💡</div>
        <div className="text-[12px] text-ink-ghost">暂无灵感记录</div>
        <div className="text-[11px] text-ink-ghost mt-1">使用快捷输入记录灵感</div>
      </div>
    );
  }

  return (
    <div className="py-1">
      {inspirationDrafts.map((draft: import('../types').InspirationDraft) => (
        <div key={draft.id} className="px-3 py-2.5 border-b border-paper-deep/5">
          <div className="text-[12px] text-ink line-clamp-2">{draft.content}</div>
          <div className="text-[10px] text-ink-ghost mt-1">
            来源: {draft.source} · {new Date(draft.createdAt).toLocaleDateString()}
          </div>
        </div>
      ))}
    </div>
  );
}
