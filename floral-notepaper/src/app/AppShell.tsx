import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { tabToIndentListener } from "indent-textarea";
import { AppSidebar } from "../components/AppSidebar";
import type { AppView } from "../components/AppSidebar";
import { ContextMenuProvider } from "../components/ContextMenu";
import { WindowFrame } from "../components/WindowFrame";
import { AuthGateProvider } from "../features/auth/authGate";
import { supabase } from "../features/auth/supabase";
import { listNotes, getNote } from "../features/notes/api";
import { getConfig, saveConfig } from "../features/settings/api";
import { applyTheme, watchSystemTheme } from "../features/settings/theme";
import type { AppConfig, ProviderConfig, ThemeOption } from "../features/settings/types";
import { uploadConfig, downloadConfig } from "../features/sync/api";
import { installExternalLinkHandler } from "../features/windows/externalLinks";
import { getInitialRoute } from "../features/windows/windowRoutes";
import { syncLanguage } from "../locales";
import { Live2DCompanionLayer } from "../features/live2d/Live2DCompanionLayer";
import { LingChatCompanionLayer } from "../features/companion/components/LingChatCompanionLayer";
import { SidebarChat } from "../features/sidebarChat";
import { onOpenNote } from "../features/notes/openNoteEvents";
import { renderMainView, renderSpecialRoute } from "./routeViews";
import { NAVIGATE_EVENT } from "./navigation";
import { PetDialogueOverlay } from "../features/companion/PetDialogueOverlay";
import { loadPetMode, restorePetModeIfNeeded, subscribePetMode } from "../features/companion/petModeStore";

export function AppShell() {
  const route = getInitialRoute();

  const [sidebarView, setSidebarView] = useState<AppView>("home");
  const [chatOpen, setChatOpen] = useState(false);
  const [providers, setProviders] = useState<ProviderConfig[]>([]);
  const [settingsConfig, setSettingsConfig] = useState<AppConfig | null>(null);
  const [currentNoteId, setCurrentNoteId] = useState("");
  const [userId, setUserId] = useState<string | null>(null);
  /** Agent 产出落盘后的待打开笔记（切到笔记视图时传给 MainWindow） */
  const [pendingOpenNoteId, setPendingOpenNoteId] = useState<string | null>(null);
  /** 桌宠模式：开启时隐藏主 UI，仅保留 Live2D 角色 + 气泡层 */
  const [petMode, setPetMode] = useState<boolean>(() => loadPetMode().enabled);
  const syncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return subscribePetMode((state) => setPetMode(state.enabled));
  }, []);

  useEffect(() => {
    // 上次退出时若停留在桌宠模式，启动后自动恢复
    restorePetModeIfNeeded();
  }, []);

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

  useEffect(() => {
    if (!userId || !settingsConfig) return;
    downloadConfig(userId)
      .then((remote) => {
        if (remote) {
          const merged = { ...settingsConfig, ...remote };
          setSettingsConfig(merged);
          setProviders(merged.providers ?? []);
        }
      })
      .catch(() => {});
  }, [userId]);

  /** Agent 产出落盘 → 打开笔记：切到笔记视图并记录待打开笔记 id */
  useEffect(() => {
    return onOpenNote((noteId) => {
      setPendingOpenNoteId(noteId);
      setSidebarView("main");
    });
  }, []);

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

  const handleCurrentNoteChange = useCallback((note: { id: string; content: string }) => {
    setCurrentNoteId(note.id);
  }, []);

  useEffect(() => {
    listNotes()
      .then(async (notes) => {
        if (notes.length > 0 && !currentNoteId) {
          const note = await getNote(notes[0].id);
          setCurrentNoteId(note.id);
        }
      })
      .catch(() => {});
  }, []);

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
    // 全局拦截外部链接：防止裸 <a href> 把 webview 导航到外部站点后
    // 回退触发整个应用重新加载（见 features/windows/externalLinks）
    return installExternalLinkHandler();
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

    const preventSystemMenu = (event: KeyboardEvent) => {
      if (event.altKey && event.code === "Space") {
        event.preventDefault();
      }
    };
    document.addEventListener("keydown", preventSystemMenu, true);
    return () => document.removeEventListener("keydown", preventSystemMenu, true);
  }, []);

  // 跨组件视图导航：画布「发布编排」等深层组件通过全局事件请求切换侧边栏视图
  useEffect(() => {
    const onNavigate = (event: Event) => {
      const view = (event as CustomEvent<AppView>).detail;
      if (view) setSidebarView(view);
    };
    window.addEventListener(NAVIGATE_EVENT, onNavigate);
    return () => window.removeEventListener(NAVIGATE_EVENT, onNavigate);
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

  const specialRouteView = renderSpecialRoute(route);
  if (specialRouteView) {
    const content = (
      <div className="h-full font-body text-ink overflow-hidden">{specialRouteView}</div>
    );

    return (
      <ContextMenuProvider>
        {route.view === "tile" ? <WindowFrame>{content}</WindowFrame> : content}
      </ContextMenuProvider>
    );
  }

  return (
    <ContextMenuProvider>
      <AuthGateProvider userId={userId}>
        <WindowFrame>
          {petMode ? (
            // 桌宠模式：隐藏主 UI，仅保留 Live2D 角色层与台词气泡
            <PetDialogueOverlay />
          ) : (
            <div className="h-full font-body text-ink overflow-hidden flex">
              <AppSidebar
                activeView={sidebarView}
                onViewChange={setSidebarView}
                chatOpen={chatOpen}
                onToggleChat={() => setChatOpen((v) => !v)}
              />
              {/* 左侧 AI 对话窗口（类 workbuddy 首页对话模式，可展开/收起） */}
              <SidebarChat
                open={chatOpen}
                onClose={() => setChatOpen(false)}
                providers={providers}
                onRequestOpen={() => setChatOpen(true)}
              />
              <div className="app-main-content flex-1 flex flex-col min-w-0">
                {renderMainView({
                  sidebarView,
                  currentNoteId,
                  providers,
                  settingsConfig,
                  userId,
                  openNoteId: pendingOpenNoteId,
                  onConfigChange: handleConfigChange,
                  onProvidersChange: handleProvidersChange,
                  onCurrentNoteChange: handleCurrentNoteChange,
                  onCloseSettings: () => setSidebarView("home"),
                })}
              </div>
            </div>
          )}
          {/* 主窗口嵌入式 Live2D 层（surface=embedded，position:fixed 覆盖在主界面之上） */}
          <Live2DCompanionLayer surface="embedded" providers={providers} />
          {/* LingChat 桌宠层（renderer=lingchat 时渲染，与 Live2D 层互斥，内部自行门控） */}
          <LingChatCompanionLayer surface="embedded" providers={providers} />
        </WindowFrame>
      </AuthGateProvider>
    </ContextMenuProvider>
  );
}
