import type { BottomTab } from "../types";

interface BottomTabBarProps {
  active: BottomTab;
  onChange: (tab: BottomTab) => void;
}

type BottomTabItem = { key: BottomTab; label: string; icon: React.ReactNode; isWrite?: boolean };

const TABS: BottomTabItem[] = [
  {
    key: "home",
    label: "首页",
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
        <polyline points="9 22 9 12 15 12 15 22" />
      </svg>
    ),
  },
  {
    key: "category",
    label: "分类",
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="7" height="7" />
        <rect x="14" y="3" width="7" height="7" />
        <rect x="14" y="14" width="7" height="7" />
        <rect x="3" y="14" width="7" height="7" />
      </svg>
    ),
  },
  {
    key: "write",
    label: "写文章",
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <line x1="12" y1="5" x2="12" y2="19" />
        <line x1="5" y1="12" x2="19" y2="12" />
      </svg>
    ),
    isWrite: true,
  },
  {
    key: "notifications",
    label: "通知",
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
        <path d="M13.73 21a2 2 0 0 1-3.46 0" />
      </svg>
    ),
  },
  {
    key: "profile",
    label: "我的",
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
        <circle cx="12" cy="7" r="4" />
      </svg>
    ),
  },
];

export function BottomTabBar({ active, onChange }: BottomTabBarProps) {
  return (
    <nav className="flex items-center justify-around px-2 pt-1.5 pb-3 bg-[var(--color-cloud)]/90 backdrop-blur-lg border-t border-[var(--color-paper-deep)]">
      {TABS.map((tab) => {
        const isActive = tab.key === active;
        const isWrite = tab.isWrite;

        if (isWrite) {
          return (
            <button
              key={tab.key}
              onClick={() => onChange(tab.key)}
              className="flex flex-col items-center gap-0.5 cursor-pointer relative -top-3"
            >
              <div className="w-11 h-11 rounded-full bg-[#FF2442] text-white flex items-center justify-center shadow-lg shadow-[#FF2442]/30">
                {tab.icon}
              </div>
              <span className="text-[10px] font-medium text-[#FF2442]">{tab.label}</span>
            </button>
          );
        }

        return (
          <button
            key={tab.key}
            onClick={() => onChange(tab.key)}
            className={`flex flex-col items-center gap-0.5 py-1 cursor-pointer transition-colors duration-200 ${
              isActive ? "text-[#FF2442]" : "text-[var(--color-ink-ghost)]"
            }`}
          >
            {tab.icon}
            <span className="text-[10px]">{tab.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
