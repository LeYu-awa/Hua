// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppConfig, ProviderConfig } from "../features/settings/types";

vi.mock("../components/CanvasPage", () => ({
  CanvasPage: ({ documentId, agentEnabled }: { documentId: string; agentEnabled?: boolean }) => (
    <div data-testid="canvas-page">{`${documentId}:${agentEnabled ? "agent" : "plain"}`}</div>
  ),
}));

vi.mock("../components/CoWritePage", () => ({ CoWritePage: () => <div data-testid="cowrite-page" /> }));
vi.mock("../components/DashboardPage", () => ({ DashboardPage: () => <div data-testid="dashboard-page" /> }));
vi.mock("../components/ElysiaPage", () => ({ ElysiaPage: () => <div data-testid="elysia-page" /> }));
vi.mock("../components/InkPlaybackPage", () => ({
  InkPlaybackPage: ({ noteId }: { noteId: string }) => <div data-testid="playback-page">{noteId}</div>,
}));
vi.mock("../components/MainWindow", () => ({
  MainWindow: () => <div data-testid="main-window" />,
}));
vi.mock("../components/NotePad", () => ({
  NotePad: ({ initialNoteId }: { initialNoteId?: string }) => <div data-testid="notepad-route">{initialNoteId}</div>,
}));
vi.mock("../components/SettingsPage", () => ({
  SettingsPage: () => <div data-testid="settings-page" />,
}));
vi.mock("../components/TileShowcase", () => ({
  TileShowcase: ({ noteId }: { noteId?: string }) => <div data-testid="tile-route">{noteId}</div>,
}));
vi.mock("../components/WritingReportPage", () => ({
  WritingReportPage: ({ noteId }: { noteId: string }) => <div data-testid="report-page">{noteId}</div>,
}));
vi.mock("../features/garden/components/GardenLayout", () => ({
  GardenLayout: ({ userId }: { userId: string | null }) => <div data-testid="garden-page">{userId}</div>,
}));
vi.mock("../features/infinite-canvas/InfiniteCanvasPage", () => ({
  InfiniteCanvasPage: ({ canvasId }: { canvasId: string }) => <div data-testid="infinite-canvas-page">{canvasId}</div>,
}));
vi.mock("../features/social/pages/MyProfilePage", () => ({
  MyProfilePage: ({ userId }: { userId: string }) => <div data-testid="profile-page">{userId}</div>,
}));
vi.mock("../features/studio/pages/StudioEditorPage", () => ({
  StudioEditorPage: ({ userId }: { userId: string }) => <div data-testid="studio-page">{userId}</div>,
}));

import { renderMainView, renderSpecialRoute } from "./routeViews";

const providers: ProviderConfig[] = [];
const config = { agentEnabled: true } as AppConfig;

const baseParams = {
  currentNoteId: "note-1",
  providers,
  settingsConfig: config,
  userId: null,
  onConfigChange: vi.fn(),
  onProvidersChange: vi.fn(),
  onCurrentNoteChange: vi.fn(),
  onCloseSettings: vi.fn(),
};

afterEach(cleanup);

describe("routeViews", () => {
  it("渲染特殊窗口路由", () => {
    render(renderSpecialRoute({ view: "notepad", noteId: "n1" }));
    expect(screen.getByTestId("notepad-route").textContent).toBe("n1");
    cleanup();

    render(renderSpecialRoute({ view: "tile", noteId: "n2" }));
    expect(screen.getByTestId("tile-route").textContent).toBe("n2");
  });

  it("按主侧边栏视图渲染核心页面", () => {
    render(renderMainView({ ...baseParams, sidebarView: "home" }));
    expect(screen.getByTestId("dashboard-page")).toBeTruthy();
    cleanup();

    render(renderMainView({ ...baseParams, sidebarView: "playback" }));
    expect(screen.getByTestId("playback-page").textContent).toBe("note-1");
    cleanup();

    render(renderMainView({ ...baseParams, sidebarView: "report" }));
    expect(screen.getByTestId("report-page").textContent).toBe("note-1");
  });

  it("未登录时画布回退本地 Canvas，登录后使用无限画布", () => {
    render(renderMainView({ ...baseParams, sidebarView: "canvas", userId: null }));
    expect(screen.getByTestId("canvas-page").textContent).toBe("canvas-note-1:agent");
    cleanup();

    render(renderMainView({ ...baseParams, sidebarView: "canvas", userId: "u1" }));
    expect(screen.getByTestId("infinite-canvas-page").textContent).toBe("canvas-note-1");
  });

  it("需要登录的视图显示登录提示", () => {
    render(renderMainView({ ...baseParams, sidebarView: "studio", userId: null }));
    expect(screen.getByText("请先登录")).toBeTruthy();
    cleanup();

    render(renderMainView({ ...baseParams, sidebarView: "profile", userId: null }));
    expect(screen.getByText("请先登录")).toBeTruthy();
  });

  it("登录后懒加载个人主页", async () => {
    render(renderMainView({ ...baseParams, sidebarView: "profile", userId: "u1" }));
    const profilePage = await screen.findByTestId("profile-page");
    expect(profilePage.textContent).toContain("u1");
  });

  it("设置未加载时回退主笔记窗口", () => {
    render(renderMainView({ ...baseParams, sidebarView: "settings", settingsConfig: null }));
    expect(screen.getByTestId("main-window")).toBeTruthy();
  });
});
