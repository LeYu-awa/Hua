import { lazy, Suspense } from "react";
import { CanvasPage } from "../components/CanvasPage";
import { DashboardPage } from "../components/DashboardPage";
import { MainWindow } from "../components/MainWindow";
import { NotePad } from "../components/NotePad";
import { SettingsPage } from "../components/SettingsPage";
import { TileShowcase } from "../components/TileShowcase";
import type { AppView } from "../components/AppSidebar";
import { GardenLayout } from "../features/garden/components/GardenLayout";
import { InfiniteCanvasPage } from "../features/infinite-canvas/InfiniteCanvasPage";
import { ProfilePageSkeleton } from "../features/social/components/ProfilePageSkeleton";
import { StudioEditorPage } from "../features/studio/pages/StudioEditorPage";
import type { ProviderConfig, AppConfig } from "../features/settings/types";
import type { AppRoute } from "../features/windows/windowRoutes";

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

export function renderSpecialRoute(route: AppRoute) {
  if (route.view === "notepad") {
    return <NotePad initialNoteId={route.noteId} />;
  }

  if (route.view === "tile") {
    return <TileShowcase noteId={route.noteId} />;
  }

  return null;
}

export function renderMainView({
  sidebarView,
  currentNoteId,
  providers,
  settingsConfig,
  userId,
  onConfigChange,
  onProvidersChange,
  onCurrentNoteChange,
  onCloseSettings,
}: RenderMainViewParams) {
  if (sidebarView === "home") return <DashboardPage />;
  if (sidebarView === "canvas") {
    return userId ? (
      <InfiniteCanvasPage userId={userId} canvasId={`canvas-${currentNoteId || "draft"}`} />
    ) : (
      <CanvasPage
        documentId={`canvas-${currentNoteId || "draft"}`}
        noteId={currentNoteId}
        providers={providers}
        agentEnabled={Boolean(settingsConfig?.agentEnabled)}
      />
    );
  }
  if (sidebarView === "garden") return <GardenLayout userId={userId} />;
  if (sidebarView === "studio") {
    return userId ? <StudioEditorPage userId={userId} /> : <LoginRequiredState />;
  }
  if (sidebarView === "profile") {
    return userId ? (
      <Suspense fallback={<ProfilePageSkeleton />}>
        <MyProfilePage userId={userId} currentUserId={userId} />
      </Suspense>
    ) : (
      <LoginRequiredState />
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
      onCurrentNoteChange={onCurrentNoteChange}
    />
  );
}
