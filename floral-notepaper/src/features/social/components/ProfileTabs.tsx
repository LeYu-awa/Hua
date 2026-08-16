import { useTranslation } from "react-i18next";
import type { ProfileTab } from "../types";

interface ProfileTabsProps {
  tabs: ProfileTab[];
  activeTab: string;
  onTabChange: (key: string) => void;
}

const TAB_ICONS: Record<string, string> = {
  articles: "📝",
  likes: "❤️",
  following: "👥",
  followers: "👤",
  categories: "📂",
};

export function ProfileTabs({ tabs, activeTab, onTabChange }: ProfileTabsProps) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-1 px-8 py-2 border-b border-paper-deep/10">
      {tabs.map((tab) => (
        <button
          key={tab.key}
          onClick={() => onTabChange(tab.key)}
          className={`flex items-center gap-1.5 px-4 py-2 text-[13px] rounded-lg transition-colors cursor-pointer ${
            activeTab === tab.key
              ? "bg-bamboo-mist/60 text-bamboo font-medium"
              : "text-ink-ghost hover:text-ink-soft hover:bg-paper-warm/60"
          }`}
        >
          <span>{TAB_ICONS[tab.key] || "📄"}</span>
          <span>{t(`profile.tab.${tab.key}`, tab.label)}</span>
          {tab.count !== undefined && <span className="text-[11px] opacity-60">({tab.count})</span>}
        </button>
      ))}
    </div>
  );
}
