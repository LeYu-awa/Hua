import { useEffect, useState, useCallback, useRef } from "react";
import "./App.css";
import { ContextMenuProvider } from "./components/ContextMenu";
import { MainWindow } from "./components/MainWindow";
import { NotePad } from "./components/NotePad";
import { TileShowcase } from "./components/TileShowcase";
import { AppSidebar } from "./components/AppSidebar";
import { SettingsPage } from "./components/SettingsPage";
import { DashboardPage } from "./components/DashboardPage";
import { InkPlaybackPage } from "./components/InkPlaybackPage";
import { CoWritePage } from "./components/CoWritePage";
import { FriendsPage } from "./components/FriendsPage";
import { ElysiaPage } from "./components/ElysiaPage";
import { WindowFrame } from "./components/WindowFrame";
import { tabToIndentListener } from "indent-textarea";
import { getConfig, saveConfig } from "./features/settings/api";
import { applyTheme, watchSystemTheme } from "./features/settings/theme";
import type { AppConfig, ThemeOption, ProviderConfig } from "./features/settings/types";
import type { AppView } from "./components/AppSidebar";
import { getInitialRoute } from "./features/windows/windowRoutes";
import { syncLanguage } from "./locales";
import { listen } from "@tauri-apps/api/event";
import { supabase } from "./features/auth/supabase";
import { uploadConfig, downloadConfig } from "./features/sync/api";

function App() {
  const route = getInitialRoute();

  const [sidebarView, setSidebarView] = useState<AppView>("cowrite");
  const [providers, setProviders] = useState<ProviderConfig[]>([]);
  const [settingsConfig, setSettingsConfig] = useState<AppConfig | null>(null);

  // 认证状态
  const [userId, setUserId] = useState<string | null>(null);
  const syncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 监听认证状态变化
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session?.user) {
        setUserId(data.session.user.id);
      }
    });

    const { data: authListener } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_IN" && session?.user) {
        setUserId(session.user.id);
      } else if (event === "SIGNED_OUT") {
        setUserId(null);
      }
    });

    return () => authListener.subscription.unsubscribe();
  }, []);

  // 登录后自动拉取云端配置
  useEffect(() => {
    if (!userId || !settingsConfig) return;
    downloadConfig(userId)
      .then((remote) => {
        if (remote) {
          // 合并：remote 覆盖本地（云端优先）
          const merged = { ...settingsConfig, ...remote };
          setSettingsConfig(merged);
          setProviders(merged.providers ?? []);
        }
      })
      .catch(() => {});
  }, [userId]);

  // 配置变更时自动上传（防抖 3 秒）
  const scheduleSync = useCallback(
    (config: AppConfig) => {
      if (!userId) return;
      if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
      syncTimerRef.current = setTimeout(() => {
        uploadConfig(userId, config).catch(() => {});
      }, 3000);
    },
    [userId],
  );

  useEffect(() => {
    let cleanup = () => {};
    getConfig()
      .then((config) => {
        const theme = (config.theme || "system") as ThemeOption;
        applyTheme(theme);
        cleanup = watchSystemTheme(theme);
        document.documentElement.style.setProperty(
          "--tab-indent-size",
          String(config.tabIndentSize ?? 2),
        );
        void syncLanguage(config.locale);
        setSettingsConfig(config);
        setProviders(config.providers ?? []);
      })
      .catch(() => {});
    return () => cleanup();
  }, []);

  useEffect(() => {
    let themeCleanup = () => {};
    const unlisten = listen<AppConfig>("config-changed", (event) => {
      const theme = (event.payload.theme || "system") as ThemeOption;
      applyTheme(theme);
      themeCleanup();
      themeCleanup = watchSystemTheme(theme);
      document.documentElement.style.setProperty(
        "--tab-indent-size",
        String(event.payload.tabIndentSize ?? 2),
      );
      void syncLanguage(event.payload.locale);
      setSettingsConfig(event.payload);
      setProviders(event.payload.providers ?? []);
    });
    return () => {
      themeCleanup();
      void unlisten.then((fn) => fn());
    };
  }, []);

  useEffect(() => {
    const handleTab = (event: KeyboardEvent) => {
      const target = event.target;
      if (!(target instanceof HTMLTextAreaElement)) return;
      if (target.dataset.tabIndent !== "true") return;
      tabToIndentListener(event);
    };
    window.addEventListener("keydown", handleTab, true);
    return () => window.removeEventListener("keydown", handleTab, true);
  }, []);

  useEffect(() => {
    const isWindows =
      navigator.userAgent.includes("Windows") || navigator.platform.toLowerCase().startsWith("win");
    if (!isWindows) return;

    const preventSystemMenu = (e: KeyboardEvent) => {
      if (e.altKey && e.code === "Space") {
        e.preventDefault();
      }
    };
    document.addEventListener("keydown", preventSystemMenu, true);
    return () => document.removeEventListener("keydown", preventSystemMenu, true);
  }, []);

  const handleProvidersChange = useCallback(
    async (newProviders: ProviderConfig[]) => {
      setProviders(newProviders);
      if (settingsConfig) {
        const updated = { ...settingsConfig, providers: newProviders };
        setSettingsConfig(updated);
        try {
          const saved = await saveConfig(updated);
          setSettingsConfig(saved);
          scheduleSync(saved);
        } catch {
          // silently fail
        }
      }
    },
    [settingsConfig, scheduleSync],
  );

  const handleConfigChange = useCallback(
    async (newConfig: AppConfig) => {
      setSettingsConfig(newConfig);
      try {
        const saved = await saveConfig(newConfig);
        setSettingsConfig(saved);
        scheduleSync(saved);
      } catch {
        // silently fail
      }
    },
    [scheduleSync],
  );

  if (route.view === "notepad") {
    return (
      <ContextMenuProvider>
        <div className="h-full font-body text-ink overflow-hidden">
          <NotePad initialNoteId={route.noteId} />
        </div>
      </ContextMenuProvider>
    );
  }

  if (route.view === "tile") {
    return (
      <ContextMenuProvider>
        <WindowFrame>
          <div className="h-full font-body text-ink overflow-hidden">
            <TileShowcase noteId={route.noteId} />
          </div>
        </WindowFrame>
      </ContextMenuProvider>
    );
  }

  return (
    <ContextMenuProvider>
      <WindowFrame>
        <div className="h-full font-body text-ink overflow-hidden flex">
          <AppSidebar activeView={sidebarView} onViewChange={setSidebarView} />
          <div className="flex-1 flex flex-col min-w-0">
            {sidebarView === "home" ? (
              <DashboardPage />
            ) : sidebarView === "playback" ? (
              <InkPlaybackPage />
            ) : sidebarView === "cowrite" ? (
              <CoWritePage />
            ) : sidebarView === "friends" ? (
              <FriendsPage />
            ) : sidebarView === "elysia" ? (
              <ElysiaPage />
            ) : sidebarView === "settings" && settingsConfig ? (
              <SettingsPage
                config={settingsConfig}
                providers={providers}
                onConfigChange={handleConfigChange}
                onProvidersChange={handleProvidersChange}
                onClose={() => setSidebarView("home")}
              />
            ) : (
              <MainWindow
                initialConfig={settingsConfig ?? undefined}
              />
            )}
          </div>
        </div>
      </WindowFrame>
    </ContextMenuProvider>
  );
}

export default App;
