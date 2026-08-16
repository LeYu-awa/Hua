import type { Category } from "../types";

interface CategorySidebarProps {
  categories: Category[];
  activeCategoryId?: string;
  onSelectCategory: (id?: string) => void;
  onCreateCategory: () => void;
}

export function CategorySidebar({
  categories,
  activeCategoryId,
  onSelectCategory,
  onCreateCategory,
}: CategorySidebarProps) {
  return (
    <div className="w-48 shrink-0 border-r border-paper-deep/20 p-3 space-y-1">
      <button
        onClick={() => onSelectCategory(undefined)}
        className={`w-full text-left px-3 py-1.5 text-[13px] rounded-lg transition-colors cursor-pointer ${
          !activeCategoryId
            ? "bg-bamboo-mist/60 text-bamboo font-medium"
            : "text-ink-soft hover:bg-paper-warm/60"
        }`}
      >
        📋 全部
      </button>
      {categories.map((cat) => (
        <button
          key={cat.id}
          onClick={() => onSelectCategory(cat.id)}
          className={`w-full text-left px-3 py-1.5 text-[13px] rounded-lg transition-colors cursor-pointer ${
            activeCategoryId === cat.id
              ? "bg-bamboo-mist/60 text-bamboo font-medium"
              : "text-ink-soft hover:bg-paper-warm/60"
          }`}
        >
          {cat.icon || "📄"} {cat.name}
          <span className="float-right text-ink-ghost text-[11px]">{cat.articleCount}</span>
        </button>
      ))}
      <button
        onClick={onCreateCategory}
        className="w-full text-left px-3 py-1.5 text-[12px] text-bamboo hover:bg-bamboo-mist/40 rounded-lg transition-colors mt-2 cursor-pointer"
      >
        + 新建分类
      </button>
    </div>
  );
}
