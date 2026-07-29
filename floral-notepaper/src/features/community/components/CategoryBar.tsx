import { useRef, useEffect } from "react";
import type { Category } from "../types";

interface CategoryBarProps {
  categories: Category[];
  activeId: string;
  onSelect: (id: string) => void;
}

export function CategoryBar({ categories, activeId, onSelect }: CategoryBarProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (activeRef.current) {
      activeRef.current.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
        inline: "center",
      });
    }
  }, [activeId]);

  return (
    <div
      ref={scrollRef}
      className="flex items-center gap-2 overflow-x-auto scrollbar-hidden py-2 px-1"
    >
      {categories.map((cat) => {
        const isActive = cat.id === activeId;
        return (
          <button
            key={cat.id}
            ref={isActive ? activeRef : undefined}
            onClick={() => onSelect(cat.id)}
            className={`
              flex-shrink-0 flex items-center gap-1.5 px-4 py-1.5 rounded-full text-sm font-medium
              transition-all duration-200 cursor-pointer whitespace-nowrap select-none
              ${isActive
                ? "bg-[#FF2442] text-white shadow-sm"
                : "bg-[var(--color-cloud)] text-[var(--color-ink-faint)] border border-[var(--color-paper-deep)] hover:border-[var(--color-ink-ghost)]"
              }
            `}
          >
            <span className="text-base">{cat.icon}</span>
            <span>{cat.name}</span>
          </button>
        );
      })}
    </div>
  );
}
