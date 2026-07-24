import { useState } from "react";

export type AppView = "home" | "main" | "settings" | "canvas" | "garden" | "profile" | "studio";

interface AppSidebarProps {
  activeView: AppView;
  onViewChange: (view: AppView) => void;
}

interface SidebarItem {
  view: AppView;
  label: string;
  icon: (props: { size?: number }) => React.ReactNode;
}

function HomeIcon({ size = 18 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <polyline points="9 22 9 12 15 12 15 22" />
    </svg>
  );
}

function NoteIcon({ size = 18 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M16 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8z" />
      <polyline points="16 3 16 8 21 8" />
      <line x1="8" y1="12" x2="16" y2="12" />
      <line x1="8" y1="16" x2="14" y2="16" />
    </svg>
  );
}

function SettingsIcon({ size = 18 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

function CanvasIcon({ size = 18 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <circle cx="15.5" cy="15.5" r="1.5" />
      <path d="M3 12h18" opacity="0.3" />
      <path d="M12 3v18" opacity="0.3" />
    </svg>
  );
}

function GardenIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3c-4.97 0-9 3.58-9 8 0 2.52 1.32 4.76 3.36 6.22l-1.36 4.78 5.64-3.22c.44.14.9.22 1.36.22 4.97 0 9-3.58 9-8s-4.03-8-9-8z" />
      <circle cx="9" cy="11" r="0.5" fill="currentColor" opacity="0.6" />
      <circle cx="12" cy="10" r="0.5" fill="currentColor" opacity="0.6" />
      <circle cx="15" cy="11" r="0.5" fill="currentColor" opacity="0.6" />
    </svg>
  );
}

function StudioIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
      <circle cx="12" cy="12" r="0.5" fill="currentColor" opacity="0.3" />
    </svg>
  );
}

function ProfileIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

const sidebarItems: SidebarItem[] = [
  { view: "home", label: "首页", icon: HomeIcon },
  { view: "main", label: "笔记", icon: NoteIcon },
  { view: "canvas", label: "画布", icon: CanvasIcon },
  { view: "garden", label: "花园", icon: GardenIcon },
  { view: "studio", label: "创作台", icon: StudioIcon },
  { view: "profile", label: "主页", icon: ProfileIcon },
];

export function AppSidebar({ activeView, onViewChange }: AppSidebarProps) {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const settingsActive = activeView === "settings";

  return (
    <nav className="w-[110px] h-full bg-paper flex flex-col py-4 gap-0.5 shrink-0 border-r border-paper-deep/15">
      {sidebarItems.map((item, idx) => {
        const isActive = activeView === item.view;
        const isHovered = hoveredIdx === idx;

        return (
          <button
            key={item.view}
            onClick={() => onViewChange(item.view)}
            onMouseEnter={() => setHoveredIdx(idx)}
            onMouseLeave={() => setHoveredIdx(null)}
            className={`flex items-center gap-2.5 mx-1.5 px-2.5 h-10 rounded-xl transition-all duration-200 cursor-pointer ${
              isActive
                ? "text-bamboo bg-bamboo-mist/80"
                : isHovered
                  ? "text-ink-soft bg-paper-warm/80"
                  : "text-ink-ghost hover:text-ink-faint"
            }`}
          >
            <item.icon size={20} />
            <span className="text-[12px] font-medium truncate">{item.label}</span>
          </button>
        );
      })}

      <div className="flex-1" />

      <button
        type="button"
        onClick={() => onViewChange("settings")}
        className={`flex items-center gap-2.5 mx-1.5 px-2.5 h-10 rounded-xl transition-all duration-200 cursor-pointer ${
          settingsActive
            ? "text-bamboo bg-bamboo-mist/80"
            : "text-ink-ghost hover:text-ink-soft hover:bg-paper-warm/80"
        }`}
      >
        <SettingsIcon size={20} />
        <span className="text-[12px] font-medium">设置</span>
      </button>
    </nav>
  );
}
