// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppConfig } from "../features/settings/types";

const mockGetInitialRoute = vi.fn(() => ({ view: "main" }));
const mockGetConfig = vi.fn();
const mockSaveConfig = vi.fn(async (config: AppConfig) => config);
const mockListNotes = vi.fn(async () => []);
const mockGetNote = vi.fn();
const mockDownloadConfig = vi.fn(async () => null);
const mockUploadConfig = vi.fn(async () => undefined);
const mockSyncLanguage = vi.fn(async () => undefined);
const mockApplyTheme = vi.fn();
const mockWatchSystemTheme = vi.fn(() => vi.fn());
const mockListenUnsubscribe = vi.fn();
const mockListen = vi.fn(() => Promise.resolve(mockListenUnsubscribe));
const mockGetSession = vi.fn(async () => ({ data: { session: null } }));
const mockOnAuthStateChange = vi.fn(() => ({
  data: { subscription: { unsubscribe: vi.fn() } },
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: (...args: unknown[]) => mockListen(...args),
}));

vi.mock("indent-textarea", () => ({
  tabToIndentListener: vi.fn(),
}));

vi.mock("../features/windows/windowRoutes", () => ({
  getInitialRoute: () => mockGetInitialRoute(),
}));

vi.mock("../features/settings/api", () => ({
  getConfig: () => mockGetConfig(),
  saveConfig: (config: AppConfig) => mockSaveConfig(config),
}));

vi.mock("../features/settings/theme", () => ({
  applyTheme: (...args: unknown[]) => mockApplyTheme(...args),
  watchSystemTheme: (...args: unknown[]) => mockWatchSystemTheme(...args),
}));

vi.mock("../features/notes/api", () => ({
  listNotes: () => mockListNotes(),
  getNote: (id: string) => mockGetNote(id),
}));

vi.mock("../features/auth/supabase", () => ({
  supabase: {
    auth: {
      getSession: () => mockGetSession(),
      onAuthStateChange: (...args: unknown[]) => mockOnAuthStateChange(...args),
    },
  },
}));

vi.mock("../features/sync/api", () => ({
  downloadConfig: (userId: string) => mockDownloadConfig(userId),
  uploadConfig: (userId: string, config: AppConfig) => mockUploadConfig(userId, config),
}));

vi.mock("../locales", () => ({
  syncLanguage: (...args: unknown[]) => mockSyncLanguage(...args),
}));

vi.mock("../components/ContextMenu", () => ({
  ContextMenuProvider: ({ children }: { children: React.ReactNode }) => <div data-testid="context-menu">{children}</div>,
}));
vi.mock("../components/WindowFrame", () => ({
  WindowFrame: ({ children }: { children: React.ReactNode }) => <div data-testid="window-frame">{children}</div>,
}));
vi.mock("../components/AppSidebar", () => ({
  AppSidebar: ({ activeView, onViewChange }: { activeView: string; onViewChange: (view: string) => void }) => (
    <div data-testid="sidebar">
      <span data-testid="active-view">{activeView}</span>
      <button type="button" onClick={() => onViewChange("home")}>首页</button>
      <button type="button" onClick={() => onViewChange("settings")}>设置</button>
    </div>
  ),
}));

vi.mock("../features/sidebarChat", () => ({
  SidebarChat: () => <div data-testid="sidebar-chat" />,
}));

vi.mock("./routeViews", () => ({
  renderSpecialRoute: vi.fn((route: { view: string; noteId?: string }) => {
    if (route.view === "notepad") return <div data-testid="special-route">notepad:{route.noteId}</div>;
    if (route.view === "tile") return <div data-testid="special-route">tile:{route.noteId}</div>;
    return null;
  }),
  renderMainView: vi.fn(({ sidebarView }: { sidebarView: string }) => <div data-testid="main-view">{sidebarView}</div>),
}));

import { AppShell } from "./AppShell";
import { renderMainView } from "./routeViews";

const config = {
  locale: "zh-CN",
  theme: "light",
  tabIndentSize: 2,
  providers: [],
} as unknown as AppConfig;

beforeEach(() => {
  vi.clearAllMocks();
  mockGetInitialRoute.mockReturnValue({ view: "main" });
  mockGetConfig.mockResolvedValue(config);
  mockListNotes.mockResolvedValue([]);
  mockGetSession.mockResolvedValue({ data: { session: null } });
});

afterEach(cleanup);

describe("AppShell", () => {
  it("渲染主窗口壳层并初始化配置", async () => {
    render(<AppShell />);

    expect(screen.getByTestId("context-menu")).toBeTruthy();
    expect(screen.getByTestId("window-frame")).toBeTruthy();
    expect(screen.getByTestId("sidebar")).toBeTruthy();
    expect(screen.getByTestId("main-view").textContent).toBe("home");

    await waitFor(() => expect(mockGetConfig).toHaveBeenCalled());
    expect(mockApplyTheme).toHaveBeenCalledWith("light");
    expect(mockSyncLanguage).toHaveBeenCalledWith("zh-CN");
  });

  it("侧边栏切换会更新传给 routeViews 的视图", async () => {
    render(<AppShell />);

    fireEvent.click(screen.getByText("首页"));

    await waitFor(() => expect(screen.getByTestId("main-view").textContent).toBe("home"));
    expect(renderMainView).toHaveBeenLastCalledWith(expect.objectContaining({ sidebarView: "home" }));
  });

  it("特殊 notepad 路由不渲染主侧边栏", () => {
    mockGetInitialRoute.mockReturnValue({ view: "notepad", noteId: "note-1" });

    render(<AppShell />);

    expect(screen.getByTestId("special-route").textContent).toBe("notepad:note-1");
    expect(screen.queryByTestId("sidebar")).toBeNull();
    expect(screen.queryByTestId("window-frame")).toBeNull();
  });

  it("特殊 tile 路由保留窗口框架", () => {
    mockGetInitialRoute.mockReturnValue({ view: "tile", noteId: "note-2" });

    render(<AppShell />);

    expect(screen.getByTestId("special-route").textContent).toBe("tile:note-2");
    expect(screen.getByTestId("window-frame")).toBeTruthy();
    expect(screen.queryByTestId("sidebar")).toBeNull();
  });
});
