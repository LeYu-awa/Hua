import type { Category } from "../../garden/types";

interface CategoryShowcaseProps {
  categories: Category[];
  onCategoryClick?: (category: Category) => void;
}

export function CategoryShowcase({ categories, onCategoryClick }: CategoryShowcaseProps) {
  return (
    <div className="flex flex-wrap gap-2 p-4">
      {categories.map((cat) => (
        <button
          key={cat.id}
          onClick={() => onCategoryClick?.(cat)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] border transition-colors cursor-pointer hover:shadow-sm"
          style={{ borderColor: cat.color || "#e0e0e0", color: cat.color || "#666" }}
        >
          {cat.icon && <span>{cat.icon}</span>}
          <span>{cat.name}</span>
          <span className="opacity-60">({cat.articleCount})</span>
        </button>
      ))}
    </div>
  );
}
