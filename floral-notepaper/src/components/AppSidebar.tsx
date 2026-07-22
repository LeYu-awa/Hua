import { useState } from "react";

export type AppView = "home" | "main" | "settings" | "playback" | "cowrite" | "elysia" | "canvas" | "report" | "garden" | "profile" | "studio";

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

function PlaybackIcon({ size = 18 }: { size?: number }) {
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
      <polygon points="5 3 19 12 5 21 5 3" />
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

function CowriteIcon({ size = 18 }: { size?: number }) {
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
      <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
      <path d="M15 5l4 4" />
      <path d="M7 20h1" opacity="0.4" />
    </svg>
  );
}

function ElysiaIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <path d="M12 6v6l4 2" />
      <path d="M8 10h.01M16 14h.01" opacity="0.5" />
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

function ReportIcon({ size = 18 }: { size?: number }) {
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
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
      <polyline points="10 9 9 9 8 9" />
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
  { view: "playback", label: "墨迹回放", icon: PlaybackIcon },
  { view: "cowrite", label: "共笔", icon: CowriteIcon },
  { view: "elysia", label: "Elysia", icon: ElysiaIcon },
  { view: "canvas", label: "画布", icon: CanvasIcon },
  { view: "report", label: "复盘", icon: ReportIcon },
  { view: "garden", label: "花园", icon: GardenIcon },
  { view: "studio", label: "创作台", icon: StudioIcon },
  { view: "profile", label: "主页", icon: ProfileIcon },
];

export function AppSidebar({ activeView, onViewChange }: AppSidebarProps) {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const settingsActive = activeView === "settings";

  return (
    <nav className="w-[52px] h-full bg-paper flex flex-col items-center py-4 gap-1 shrink-0">
      {sidebarItems.map((item, idx) => {
        const isActive = activeView === item.view;
        const isHovered = hoveredIdx === idx;

        return (
          <button
            key={item.view}
            onClick={() => onViewChange(item.view)}
            onMouseEnter={() => setHoveredIdx(idx)}
            onMouseLeave={() => setHoveredIdx(null)}
            className={`relative w-9 h-9 flex items-center justify-center rounded-xl transition-all duration-200 cursor-pointer group ${
              isActive
                ? "text-bamboo bg-bamboo-mist/80"
                : isHovered
                  ? "text-ink-soft bg-paper-warm/80"
                  : "text-ink-ghost hover:text-ink-faint"
            }`}
            title={item.label}
          >
            <item.icon size={17} />
            <div className="absolute left-full ml-2 px-2 py-1 rounded-md bg-ink/85 text-cloud text-[11px] whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity duration-150 z-50 shadow-lg">
              {item.label}
            </div>
          </button>
        );
      })}

      <div className="flex-1" />

      <button
        type="button"
        onClick={() => onViewChange("settings")}
        className={`relative w-9 h-9 flex items-center justify-center rounded-xl transition-all duration-200 cursor-pointer group ${
          settingsActive
            ? "text-bamboo bg-bamboo-mist/80"
            : "text-ink-ghost hover:text-ink-soft hover:bg-paper-warm/80"
        }`}
        title="设置"
      >
        <SettingsIcon size={17} />
        <div className="absolute left-full ml-2 px-2 py-1 rounded-md bg-ink/85 text-cloud text-[11px] whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity duration-150 z-50 shadow-lg">
          设置
        </div>
      </button>
    </nav>
  );
}
