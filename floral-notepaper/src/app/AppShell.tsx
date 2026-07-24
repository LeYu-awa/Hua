import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { tabToIndentListener } from "indent-textarea";
import { AppSidebar } from "../components/AppSidebar";
import type { AppView } from "../components/AppSidebar";
import { ContextMenuProvider } from "../components/ContextMenu";
import { WindowFrame } from "../components/WindowFrame";
import { supabase } from "../features/auth/supabase";
import { listNotes, getNote } from "../features/notes/api";
import { getConfig, saveConfig } from "../features/settings/api";
import { applyTheme, watchSystemTheme } from "../features/settings/theme";
import type { AppConfig, ProviderConfig, ThemeOption } from "../features/settings/types";
import { uploadConfig, downloadConfig } from "../features/sync/api";
import { getInitialRoute } from "../features/windows/windowRoutes";
import { syncLanguage } from "../locales";
import { renderMainView, renderSpecialRoute } from "./routeViews";

export function AppShell() {
  const route = getInitialRoute();

  const [sidebarView, setSidebarView] = useState<AppView>("home");
  const [providers, setProviders] = useState<ProviderConfig[]>([]);
  const [settingsConfig, setSettingsConfig] = useState<AppConfig | null>(null);
  const [currentNoteId, setCurrentNoteId] = useState("");
  const [userId, setUserId] = useState<string | null>(null);
  const syncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    console.log("[App] handleCurrentNoteChange", note);
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
    const content = <div className="h-full font-body text-ink overflow-hidden">{specialRouteView}</div>;

    return (
      <ContextMenuProvider>
        {route.view === "tile" ? <WindowFrame>{content}</WindowFrame> : content}
      </ContextMenuProvider>
    );
  }

  return (
    <ContextMenuProvider>
      <WindowFrame>
        <div className="h-full font-body text-ink overflow-hidden flex">
          <AppSidebar activeView={sidebarView} onViewChange={setSidebarView} />
          <div className="flex-1 flex flex-col min-w-0">
            {renderMainView({
              sidebarView,
              currentNoteId,
              providers,
              settingsConfig,
              userId,
              onConfigChange: handleConfigChange,
              onProvidersChange: handleProvidersChange,
              onCurrentNoteChange: handleCurrentNoteChange,
              onCloseSettings: () => setSidebarView("home"),
            })}
          </div>
        </div>
      </WindowFrame>
    </ContextMenuProvider>
  );
}
