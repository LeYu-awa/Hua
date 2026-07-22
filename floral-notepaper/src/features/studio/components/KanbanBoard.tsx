import { useStudioStore } from '../stores/useStudioStore';
import type { GardenArticle } from '../../garden/types';

interface KanbanBoardProps {
  onSelectArticle: (article: GardenArticle) => void;
}

export function KanbanBoard({ onSelectArticle }: KanbanBoardProps) {
  const kanbanColumns = useStudioStore((s: { kanbanColumns: import('../types').KanbanColumn[] }) => s.kanbanColumns);

  return (
    <div className="flex-1 flex gap-3 p-4 overflow-x-auto min-h-0">
      {kanbanColumns.map((column: import('../types').KanbanColumn) => (
        <div key={column.id} className="flex-1 min-w-[220px] max-w-[280px] flex flex-col bg-paper-warm/30 rounded-xl border border-paper-deep/10">
          {/* Column Header */}
          <div className="px-3 py-2.5 border-b border-paper-deep/10 flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <span className="text-[14px]">{column.icon}</span>
              <span className="text-[12px] font-medium text-ink">{column.title}</span>
            </div>
            <span className="text-[11px] text-ink-ghost bg-paper-warm/60 px-1.5 py-0.5 rounded-full">
              {column.articles.length}
            </span>
          </div>

          {/* Cards */}
          <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
            {column.articles.length === 0 ? (
              <div className="py-6 text-center text-[11px] text-ink-ghost">
                拖入文章或开始创作
              </div>
            ) : (
              column.articles.map((article: import('../../garden/types').GardenArticle) => (
                <button
                  key={article.id}
                  type="button"
                  onClick={() => onSelectArticle(article)}
                  className="w-full text-left bg-paper rounded-lg border border-paper-deep/10 p-2.5 hover:shadow-md transition-shadow cursor-pointer group"
                >
                  <div className="text-[12px] font-medium text-ink truncate">
                    {article.title || '未命名'}
                  </div>
                  {article.summary && (
                    <div className="text-[11px] text-ink-ghost mt-1 line-clamp-2">
                      {article.summary}
                    </div>
                  )}
                  <div className="flex items-center gap-2 mt-1.5">
                    <span className="text-[10px] text-ink-ghost">
                      {new Date(article.updatedAt).toLocaleDateString()}
                    </span>
                    {article.tags && article.tags.length > 0 && (
                      <span className="text-[10px] text-bamboo-ghost truncate">
                        {article.tags.slice(0, 2).join(', ')}
                      </span>
                    )}
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
