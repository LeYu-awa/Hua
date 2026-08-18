import { lazy, Suspense } from "react";
import { DashboardPage } from "../components/DashboardPage";
import { MainWindow } from "../components/MainWindow";
import { NotePad } from "../components/NotePad";
import { SettingsPage } from "../components/SettingsPage";
import { TileShowcase } from "../components/TileShowcase";
import type { AppView } from "../components/AppSidebar";
import { GardenLayout } from "../features/garden/components/GardenLayout";
import { CompanionFloatingPage } from "../features/companion/components/CompanionFloatingPage";
import { DiaryPage } from "../features/diary/DiaryPage";
import { ProfilePageSkeleton } from "../features/social/components/ProfilePageSkeleton";
import { StudioEditorPage } from "../features/studio/pages/StudioEditorPage";
import { SocialPublishPage } from "../features/social/pages/SocialPublishPage";
import { CanvasWorkspacePage } from "../features/canvas/pages/CanvasWorkspacePage";
import type { ProviderConfig, AppConfig } from "../features/settings/types";
import type { AppRoute } from "../features/windows/windowRoutes";
import { useAuthGate } from "../features/auth/authGate";

const MyProfilePage = lazy(() =>
  import("../features/social/pages/MyProfilePage").then((module) => ({
    default: module.MyProfilePage,
  })),
);

interface RenderMainViewParams {
  sidebarView: AppView;
  currentNoteId: string;
  providers: ProviderConfig[];
  settingsConfig: AppConfig | null;
  userId: string | null;
  /** Agent 产出落盘后的待打开笔记 id（切到笔记视图时传给 MainWindow） */
  openNoteId?: string | null;
  onConfigChange: (config: AppConfig) => void;
  onProvidersChange: (providers: ProviderConfig[]) => void;
  onCurrentNoteChange: (note: { id: string; content: string }) => void;
  onCloseSettings: () => void;
}

export function LoginRequiredState() {
  return (
    <div className="flex-1 flex items-center justify-center bg-paper">
      <div className="text-[13px] text-ink-ghost">请先登录</div>
    </div>
  );
}

/** 游客访问个人主页时的登录引导（登录弹窗由 AuthGateProvider 统一管理） */
export function GuestProfilePrompt() {
  const { openLogin } = useAuthGate();
  return (
    <div className="flex-1 flex flex-col items-center justify-center bg-paper">
      <div className="text-center">
        <div className="text-[32px] mb-3">🌿</div>
        <div className="text-[15px] font-medium text-ink-soft">登录后查看你的个人花园</div>
        <p className="mt-1.5 text-[12px] text-ink-ghost">
          公开内容可在「花园」自由浏览，登录可管理自己的作品与主页
        </p>
        <button
          type="button"
          onClick={() => openLogin("登录后查看个人主页")}
          className="mt-4 rounded-lg bg-bamboo px-5 py-2 text-[13px] font-medium text-cloud transition-colors hover:bg-bamboo-light cursor-pointer"
        >
          去登录
        </button>
      </div>
    </div>
  );
}

export function renderSpecialRoute(route: AppRoute) {
  if (route.view === "notepad") {
    return <NotePad initialNoteId={route.noteId} />;
  }

  if (route.view === "tile") {
    return <TileShowcase noteId={route.noteId} />;
  }

  if (route.view === "companion") {
    return <CompanionFloatingPage />;
  }

  return null;
}

export function renderMainView({
  sidebarView,
  currentNoteId,
  providers,
  settingsConfig,
  userId,
  openNoteId,
  onConfigChange,
  onProvidersChange,
  onCurrentNoteChange,
  onCloseSettings,
}: RenderMainViewParams) {
  if (sidebarView === "home") return <DashboardPage />;
  if (sidebarView === "canvas") {
    // 多画布工作台：画布列表（创建/命名/切换），进入后由工作台内部渲染 CanvasPage
    return (
      <CanvasWorkspacePage
        providers={providers}
        agentEnabled={Boolean(settingsConfig?.agentEnabled)}
        userId={userId ?? undefined}
      />
    );
  }
  if (sidebarView === "diary") return <DiaryPage />;
  if (sidebarView === "garden") return <GardenLayout userId={userId} />;
  if (sidebarView === "studio") {
    return <StudioEditorPage userId={userId ?? undefined} />;
  }
  if (sidebarView === "social") {
    return <SocialPublishPage userId={userId ?? undefined} />;
  }
  if (sidebarView === "profile") {
    return userId ? (
      <Suspense fallback={<ProfilePageSkeleton />}>
        <MyProfilePage userId={userId} currentUserId={userId} />
      </Suspense>
    ) : (
      <GuestProfilePrompt />
    );
  }
  if (sidebarView === "settings" && settingsConfig) {
    return (
      <SettingsPage
        config={settingsConfig}
        providers={providers}
        currentNoteId={currentNoteId}
        onConfigChange={onConfigChange}
        onProvidersChange={onProvidersChange}
        onClose={onCloseSettings}
      />
    );
  }

  return (
    <MainWindow
      initialConfig={settingsConfig ?? undefined}
      initialNoteId={openNoteId ?? undefined}
      onCurrentNoteChange={onCurrentNoteChange}
    />
  );
}
