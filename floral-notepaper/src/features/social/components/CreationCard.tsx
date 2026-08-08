import type { GardenArticle } from '../../garden/types';

interface CreationCardProps {
  article: GardenArticle;
  onClick?: (article: GardenArticle) => void;
}

export function CreationCard({ article, onClick }: CreationCardProps) {
  return (
    <button
      onClick={() => onClick?.(article)}
      className="text-left bg-paper rounded-xl border border-paper-deep/20 p-4 hover:shadow-md hover:border-bamboo/30 transition-all cursor-pointer group"
    >
      {article.coverImage && (
        <div className="w-full h-36 rounded-lg mb-3 overflow-hidden bg-paper-warm">
          <img src={article.coverImage} alt="" className="w-full h-full object-cover" />
        </div>
      )}
      <h3 className="text-[14px] font-medium text-ink-soft group-hover:text-bamboo transition-colors line-clamp-2">{article.title}</h3>
      <p className="text-[12px] text-ink-ghost/80 mt-1 line-clamp-2">{article.summary}</p>
      <div className="flex items-center gap-2 mt-2">
        <span className="px-2 py-0.5 rounded-full bg-bamboo-mist/45 text-[10px] text-bamboo">
          {article.isPublic ? '公开' : '私密'}
        </span>
        {article.tags[0] && <span className="text-[10px] text-ink-ghost/70">#{article.tags[0]}</span>}
      </div>
      <div className="flex items-center gap-3 mt-2 text-[11px] text-ink-ghost/60">
        <span>{article.viewCount} 阅读</span>
        <span>{article.likeCount} 喜欢</span>
        <span className="ml-auto">{new Date(article.updatedAt || article.createdAt).toLocaleDateString()}</span>
      </div>
      {article.tags.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-2">
          {article.tags.slice(0, 3).map(tag => (
            <span key={tag} className="px-1.5 py-0.5 text-[10px] rounded-full bg-bamboo-mist/40 text-bamboo">{tag}</span>
          ))}
        </div>
      )}
    </button>
  );
}
