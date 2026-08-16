import type { SortMode } from "../types";

interface SortSwitcherProps {
  active: SortMode;
  onChange: (mode: SortMode) => void;
}

const SORT_OPTIONS: { value: SortMode; label: string }[] = [
  { value: "recommend", label: "推荐" },
  { value: "latest", label: "最新" },
  { value: "hot", label: "热榜" },
];

export function SortSwitcher({ active, onChange }: SortSwitcherProps) {
  return (
    <div className="flex items-center gap-1 bg-[var(--color-paper-warm)] rounded-lg p-0.5">
      {SORT_OPTIONS.map((opt) => {
        const isActive = opt.value === active;
        return (
          <button
            key={opt.value}
            onClick={() => onChange(opt.value)}
            className={`
              px-3.5 py-1 rounded-md text-sm font-medium transition-all duration-200 cursor-pointer select-none
              ${
                isActive
                  ? "bg-[#FF2442] text-white shadow-sm"
                  : "text-[var(--color-ink-faint)] hover:text-[var(--color-ink)]"
              }
            `}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
