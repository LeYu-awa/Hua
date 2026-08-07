import type { ReactNode } from "react";

export type AppView = "home" | "main" | "settings" | "canvas" | "garden" | "profile" | "studio" | "community";

interface AppSidebarProps {
  activeView: AppView;
  onViewChange: (view: AppView) => void;
  /** AI 对话窗口展开状态 */
  chatOpen?: boolean;
  /** 切换 AI 对话窗口展开/收起 */
  onToggleChat?: () => void;
}

interface SidebarItem {
  view: AppView;
  label: string;
  icon: (props: { size?: number }) => ReactNode;
}

interface IconShellProps {
  size?: number;
  children: ReactNode;
}

function IconShell({ size = 20, children }: IconShellProps) {
  return (
    <svg
      className="app-sidebar-icon-svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

function HomeIcon({ size = 20 }: { size?: number }) {
  return (
    <IconShell size={size}>
      <path d="M4.5 10.2 12 4.4l7.5 5.8" />
      <path d="M6.4 9.5v8.1c0 1.05.78 1.9 1.74 1.9h7.72c.96 0 1.74-.85 1.74-1.9V9.5" />
      <path d="M10 19.5v-5.2h4v5.2" />
      <path d="M8.2 6.9V4.8h2.4" opacity="0.42" />
    </IconShell>
  );
}

function NoteIcon({ size = 20 }: { size?: number }) {
  return (
    <IconShell size={size}>
      <path d="M7.2 4.2h6.95L18.8 8.9v9.05c0 1.03-.82 1.85-1.85 1.85h-9.7a1.85 1.85 0 0 1-1.85-1.85V6.05c0-1.03.82-1.85 1.8-1.85Z" />
      <path d="M14 4.45V8.1c0 .56.44 1 1 1h3.55" opacity="0.5" />
      <path d="M8.9 12.4h6.2" />
      <path d="M8.9 15.7h4.6" opacity="0.72" />
    </IconShell>
  );
}

function SettingsIcon({ size = 20 }: { size?: number }) {
  return (
    <IconShell size={size}>
      <path d="M12 8.3a3.7 3.7 0 1 1 0 7.4 3.7 3.7 0 0 1 0-7.4Z" />
      <path d="M18.05 9.35 19.3 7.8l-1.95-2.05-1.62 1.13a7.36 7.36 0 0 0-1.7-.7L13.65 4h-3.3l-.38 2.18c-.6.17-1.18.4-1.7.7L6.65 5.75 4.7 7.8l1.25 1.55a7.62 7.62 0 0 0-.7 1.68L3.2 11.5v2.95l2.05.48c.17.6.4 1.16.7 1.67L4.7 18.2l1.95 2.05 1.62-1.13c.52.3 1.1.53 1.7.7l.38 2.18h3.3l.38-2.18c.6-.17 1.18-.4 1.7-.7l1.62 1.13 1.95-2.05-1.25-1.6c.3-.51.53-1.07.7-1.67l2.05-.48V11.5l-2.05-.47a7.62 7.62 0 0 0-.7-1.68Z" opacity="0.62" />
    </IconShell>
  );
}

function CanvasIcon({ size = 20 }: { size?: number }) {
  return (
    <IconShell size={size}>
      <rect x="4.2" y="4.2" width="15.6" height="15.6" rx="3.2" />
      <path d="M8.1 8.5h.1" />
      <path d="M15.8 15.5h.1" />
      <path d="M8.25 8.5 15.75 15.5" opacity="0.5" />
      <path d="M12 4.2v15.6" opacity="0.22" />
      <path d="M4.2 12h15.6" opacity="0.22" />
    </IconShell>
  );
}

function GardenIcon({ size = 20 }: { size?: number }) {
  return (
    <IconShell size={size}>
      <path d="M12 19.6c4.14 0 7.5-3.08 7.5-6.88 0-3.8-3.36-6.88-7.5-6.88s-7.5 3.08-7.5 6.88c0 1.94.87 3.7 2.28 4.95l-.84 2.77 3.02-1.52c.92.43 1.96.68 3.04.68Z" />
      <path d="M9.1 12.45h.1" />
      <path d="M12 11.55h.1" />
      <path d="M14.9 12.45h.1" />
    </IconShell>
  );
}

function StudioIcon({ size = 20 }: { size?: number }) {
  return (
    <IconShell size={size}>
      <path d="M5 18.9h14" opacity="0.5" />
      <path d="m14.9 4.75 4.35 4.35-8.9 8.9-4.6 1.25 1.25-4.6 7.9-7.9Z" />
      <path d="m13.45 6.2 4.35 4.35" opacity="0.45" />
    </IconShell>
  );
}

function ProfileIcon({ size = 20 }: { size?: number }) {
  return (
    <IconShell size={size}>
      <path d="M12 12.1a3.95 3.95 0 1 0 0-7.9 3.95 3.95 0 0 0 0 7.9Z" />
      <path d="M4.75 19.8c.9-3.05 3.55-5.05 7.25-5.05s6.35 2 7.25 5.05" />
    </IconShell>
  );
}

function ChatIcon({ size = 20 }: { size?: number }) {
  return (
    <IconShell size={size}>
      <path d="M5.2 18.35 4.5 21l3.05-1.38c1.22.6 2.62.93 4.1.93 4.65 0 8.42-3.42 8.42-7.65s-3.77-7.65-8.42-7.65-8.42 3.42-8.42 7.65c0 2.12.94 4.03 2.47 5.45Z" />
      <path d="M8.7 12.55h.1" />
      <path d="M11.8 12.55h.1" />
      <path d="M14.9 12.55h.1" />
    </IconShell>
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

function getSidebarItemClass(active: boolean) {
  return active ? "app-sidebar-item is-active" : "app-sidebar-item";
}

export function AppSidebar({ activeView, onViewChange, chatOpen = false, onToggleChat }: AppSidebarProps) {
  const settingsActive = activeView === "settings";

  return (
    <nav className="app-sidebar-pro" aria-label="主导航">
      <button
        type="button"
        onClick={onToggleChat}
        title={chatOpen ? "收起 AI 助手" : "展开 AI 助手"}
        aria-pressed={chatOpen}
        disabled={!onToggleChat}
        className={getSidebarItemClass(chatOpen)}
      >
        <span className="app-sidebar-icon-frame">
          <ChatIcon />
        </span>
        <span className="app-sidebar-label">AI 助手</span>
      </button>

      <div className="app-sidebar-separator" />

      {sidebarItems.map((item) => {
        const isActive = activeView === item.view;

        return (
          <button
            key={item.view}
            type="button"
            onClick={() => onViewChange(item.view)}
            aria-current={isActive ? "page" : undefined}
            className={getSidebarItemClass(isActive)}
          >
            <span className="app-sidebar-icon-frame">
              <item.icon />
            </span>
            <span className="app-sidebar-label">{item.label}</span>
          </button>
        );
      })}

      <div className="app-sidebar-spacer" />

      <button
        type="button"
        onClick={() => onViewChange("settings")}
        aria-current={settingsActive ? "page" : undefined}
        className={getSidebarItemClass(settingsActive)}
      >
        <span className="app-sidebar-icon-frame">
          <SettingsIcon />
        </span>
        <span className="app-sidebar-label">设置</span>
      </button>
    </nav>
  );
}
