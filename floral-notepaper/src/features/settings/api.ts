import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { hydrateConfigFromCache, prepareConfigForStorage } from "./apiKeyCache";
import type { AppConfig, ViewMode } from "./types";

export interface ShortcutCheckResult {
  available: boolean;
  conflictType: "none" | "current" | "invalid" | "system" | "registered" | "unknown";
  message: string;
}

export async function getConfig(): Promise<AppConfig> {
  const config = await invoke<AppConfig>("config_get");
  const hydrated = hydrateConfigFromCache(config);
  if ((config.providers ?? []).some((provider) => provider.apiKey?.trim())) {
    void invoke<AppConfig>("config_save", { config: prepareConfigForStorage(config) }).catch(() => {});
  }
  return hydrated;
}

export async function saveConfig(config: AppConfig): Promise<AppConfig> {
  const saved = await invoke<AppConfig>("config_save", { config: prepareConfigForStorage(config) });
  return hydrateConfigFromCache(saved);
}

export function checkGlobalShortcut(shortcut: string): Promise<ShortcutCheckResult> {
  return invoke("global_shortcut_check", { shortcut });
}

export async function chooseNotesDirectory(): Promise<string | null> {
  const path = await open({
    directory: true,
    multiple: false,
  });

  return typeof path === "string" ? path : null;
}

export async function chooseBackgroundImage(): Promise<string | null> {
  const path = await open({
    directory: false,
    multiple: false,
    filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "gif"] }],
  });

  return typeof path === "string" ? path : null;
}

export function normalizeViewMode(value: string): ViewMode {
  if (value === "edit" || value === "split" || value === "preview") {
    return value;
  }

  return "split";
}
