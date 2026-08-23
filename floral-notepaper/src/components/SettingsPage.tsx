import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { checkGlobalShortcut, chooseBackgroundImage } from "../features/settings/api";
import type {
  AppConfig,
  BackgroundFit,
  ProviderConfig,
  ThemeOption,
  TileColorMode,
  ViewMode,
} from "../features/settings/types";
import {
  formatHeldKeys,
  hotkeyToConfigString,
  isValidGlobalShortcut,
  shortcutPlatform,
} from "../features/settings/shortcutRecorder";
import { useShortcutRecorder } from "../features/settings/useShortcutRecorder";
import { DEFAULT_TILE_COLOR, normalizeTileColor } from "../features/settings/tileColor";
import { applyTheme, watchSystemTheme } from "../features/settings/theme";
import { LOCALE_OPTIONS } from "../locales/locale-whitelist";
import { SlidingButtonGroup } from "./SlidingButtonGroup";
import { invoke } from "@tauri-apps/api/core";
import type { ModelConfig } from "../features/settings/types";
import { StatsPanel } from "../features/settings/components/StatsPanel";
import { AccountPanelSkeleton } from "./AccountPanelSkeleton";
import { CoWritePage } from "./CoWritePage";
import { InkPlaybackPage } from "./InkPlaybackPage";
import { ElysiaPage } from "./ElysiaPage";
import { WritingReportPage } from "./WritingReportPage";
import { OPEN_PET_SETTINGS_EVENT, consumePetSettingsDeepLink } from "../app/navigation";

const AccountPanel = lazy(() =>
  import("./AccountPanel").then((module) => ({ default: module.AccountPanel })),
);

/* ─── settings section enum ─── */
type SettingsSection =
  | "preferences"
  | "providers"
  | "aiIntegration"
  | "defaultModels"
  | "hotkeys"
  | "account"
  | "stats"
  | "about"
  | "playback"
  | "cowrite"
  | "elysia"
  | "report";

interface SectionDef {
  key: SettingsSection;
  label: string;
  icon: string;
}

const SECTIONS: SectionDef[] = [
  { key: "preferences", label: "偏好设置", icon: "monitor" },
  { key: "providers", label: "供应商", icon: "boxes" },
  { key: "aiIntegration", label: "AI 集成", icon: "sparkle" },
  { key: "defaultModels", label: "默认模型", icon: "heart" },
  { key: "hotkeys", label: "快捷键", icon: "keyboard" },
  { key: "account", label: "账户", icon: "user" },
  { key: "stats", label: "统计", icon: "chart" },
  { key: "about", label: "关于", icon: "info" },
  { key: "playback", label: "墨迹回放", icon: "play" },
  { key: "cowrite", label: "共笔", icon: "edit" },
  { key: "elysia", label: "Elysia", icon: "sparkle" },
  { key: "report", label: "复盘", icon: "clipboard" },
];

/* ─── props ─── */
interface SettingsPageProps {
  config: AppConfig;
  providers: ProviderConfig[];
  currentNoteId?: string;
  onConfigChange: (config: AppConfig) => void;
  onProvidersChange: (providers: ProviderConfig[]) => void;
  onClose: () => void;
}

/* ─── main ─── */
export function SettingsPage({
  config,
  providers,
  currentNoteId = "",
  onConfigChange,
  onProvidersChange,
}: SettingsPageProps) {
  // 桌宠「设置」按钮深链：挂载时直接进入 elysia 分区；已挂载时由事件切换
  const elysiaTabRef = useRef<"pet" | undefined>(consumePetSettingsDeepLink()?.tab ?? undefined);
  const [activeSection, setActiveSection] = useState<SettingsSection>(
    elysiaTabRef.current ? "elysia" : "preferences",
  );
  useEffect(() => {
    const handler = () => setActiveSection("elysia");
    window.addEventListener(OPEN_PET_SETTINGS_EVENT, handler);
    return () => window.removeEventListener(OPEN_PET_SETTINGS_EVENT, handler);
  }, []);

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-paper">
      {/* body: left nav + right content */}
      <div className="flex-1 flex min-h-0">
        <div className="w-[220px] shrink-0 bg-paper border-r border-paper-deep/25 flex flex-col">
          {/* page title in sidebar header */}
          <div className="px-4 pt-2 pb-1.5">
            <h2 className="text-[15px] font-display font-semibold text-ink-soft tracking-tight">
              设置
            </h2>
          </div>
          <div className="flex-1 overflow-y-auto px-2 py-1">
            {SECTIONS.map((sec) => {
              const isActive = sec.key === activeSection;
              return (
                <NavItem
                  key={sec.key}
                  section={sec}
                  active={isActive}
                  onSelect={() => setActiveSection(sec.key)}
                />
              );
            })}
          </div>
        </div>

        {/* right content */}
        <div className="flex-1 flex flex-col min-w-0 min-h-0">
          <SectionContent
            section={activeSection}
            config={config}
            providers={providers}
            currentNoteId={currentNoteId}
            initialElysiaTab={elysiaTabRef.current}
            onConfigChange={onConfigChange}
            onProvidersChange={onProvidersChange}
          />
        </div>
      </div>
    </div>
  );
}

/* ─── nav item ─── */
function NavItem({
  section,
  active,
  onSelect,
}: {
  section: SectionDef;
  active: boolean;
  onSelect: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const show = active || hovered;

  return (
    <button
      onClick={onSelect}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className={`
        w-full flex items-center gap-2.5 h-9 px-3 rounded-xl text-left
        transition-all duration-200 cursor-pointer
        ${show ? "text-ink" : "text-ink-ghost"}
      `}
      style={{
        backgroundColor: active
          ? "var(--bg-bamboo-mist)"
          : hovered
            ? "var(--bg-paper-warm)"
            : "transparent",
      }}
    >
      <SectionIcon
        type={section.icon}
        size={16}
        color={show ? "var(--color-bamboo)" : "var(--color-ink-ghost)"}
      />
      <span className="text-[12px] font-medium truncate">{section.label}</span>
    </button>
  );
}

/* ─── section icon (SVG paintings) ─── */
function SectionIcon({ type, size, color }: { type: string; size: number; color: string }) {
  const s = { width: size, height: size };

  switch (type) {
    case "monitor":
      return (
        <svg
          {...s}
          viewBox="0 0 24 24"
          fill="none"
          stroke={color}
          strokeWidth="2"
          strokeLinecap="round"
        >
          <rect x="3.5" y="4.5" width="17" height="12" rx="2" />
          <line x1="12" y1="16.5" x2="12" y2="20" />
          <line x1="8.5" y1="20" x2="15.5" y2="20" />
        </svg>
      );
    case "boxes":
      return (
        <svg
          {...s}
          viewBox="0 0 24 24"
          fill="none"
          stroke={color}
          strokeWidth="2"
          strokeLinecap="round"
        >
          <path d="M12 4l7 4v8l-7 4-7-4V8l7-4z" />
          <line x1="12" y1="4" x2="12" y2="12" />
          <line x1="5" y1="8" x2="19" y2="8" />
        </svg>
      );
    case "heart":
      return (
        <svg
          {...s}
          viewBox="0 0 24 24"
          fill="none"
          stroke={color}
          strokeWidth="2"
          strokeLinecap="round"
        >
          <path d="M12 20.2C5.1 15.2 3.7 11.5 3.7 8.6c0-3 2.3-4.7 4.8-4.7C10.1 3.9 11.3 4.8 12 6c.7-1.2 1.9-2.1 3.5-2.1 2.5 0 4.8 1.7 4.8 4.7 0 2.9-1.4 6.6-8.3 11.6z" />
        </svg>
      );
    case "keyboard":
      return (
        <svg
          {...s}
          viewBox="0 0 24 24"
          fill="none"
          stroke={color}
          strokeWidth="2"
          strokeLinecap="round"
        >
          <rect x="3.5" y="6" width="17" height="12" rx="2" />
          <line x1="8" y1="16" x2="16" y2="16" />
        </svg>
      );
    case "chart":
      return (
        <svg
          {...s}
          viewBox="0 0 24 24"
          fill="none"
          stroke={color}
          strokeWidth="2"
          strokeLinecap="round"
        >
          <line x1="4" y1="20" x2="20" y2="20" />
          <rect x="5.5" y="12.5" width="3.2" height="7.5" rx="1" />
          <rect x="10.4" y="7.5" width="3.2" height="12.5" rx="1" />
          <rect x="15.3" y="4.5" width="3.2" height="15.5" rx="1" />
        </svg>
      );
    case "info":
      return (
        <svg
          {...s}
          viewBox="0 0 24 24"
          fill="none"
          stroke={color}
          strokeWidth="2"
          strokeLinecap="round"
        >
          <circle cx="12" cy="12" r="7.2" />
          <circle cx="12" cy="7.8" r="0.5" fill={color} stroke="none" />
          <line x1="12" y1="11" x2="12" y2="16.5" />
        </svg>
      );
    case "user":
      return (
        <svg
          {...s}
          viewBox="0 0 24 24"
          fill="none"
          stroke={color}
          strokeWidth="2"
          strokeLinecap="round"
        >
          <circle cx="12" cy="8" r="4" />
          <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" />
        </svg>
      );
    case "play":
      return (
        <svg
          {...s}
          viewBox="0 0 24 24"
          fill="none"
          stroke={color}
          strokeWidth="2"
          strokeLinecap="round"
        >
          <polygon points="5 3 19 12 5 21 5 3" />
        </svg>
      );
    case "edit":
      return (
        <svg
          {...s}
          viewBox="0 0 24 24"
          fill="none"
          stroke={color}
          strokeWidth="2"
          strokeLinecap="round"
        >
          <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
          <path d="M15 5l4 4" />
        </svg>
      );
    case "sparkle":
      return (
        <svg
          {...s}
          viewBox="0 0 24 24"
          fill="none"
          stroke={color}
          strokeWidth="2"
          strokeLinecap="round"
        >
          <circle cx="12" cy="12" r="10" />
          <path d="M12 6v6l4 2" />
        </svg>
      );
    case "clipboard":
      return (
        <svg
          {...s}
          viewBox="0 0 24 24"
          fill="none"
          stroke={color}
          strokeWidth="2"
          strokeLinecap="round"
        >
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
          <line x1="16" y1="13" x2="8" y2="13" />
          <line x1="16" y1="17" x2="8" y2="17" />
        </svg>
      );
    default:
      return null;
  }
}

/* ─── section content router ─── */
function SectionContent({
  section,
  config,
  providers,
  currentNoteId,
  initialElysiaTab,
  onConfigChange,
  onProvidersChange,
}: {
  section: SettingsSection;
  config: AppConfig;
  providers: ProviderConfig[];
  currentNoteId: string;
  initialElysiaTab?: "pet";
  onConfigChange: (config: AppConfig) => void;
  onProvidersChange: (providers: ProviderConfig[]) => void;
}) {
  switch (section) {
    case "preferences":
      return <PreferencesPanel config={config} onChange={onConfigChange} />;
    case "providers":
      return <ProvidersPanel providers={providers} onProvidersChange={onProvidersChange} />;
    case "aiIntegration":
      return <AiIntegrationPanel config={config} onChange={onConfigChange} />;
    case "defaultModels":
      return <DefaultModelsPanel config={config} providers={providers} onChange={onConfigChange} />;
    case "hotkeys":
      return <HotkeysPanel config={config} onChange={onConfigChange} />;
    case "account":
      return (
        <Suspense fallback={<AccountPanelSkeleton />}>
          <AccountPanel config={config} onConfigChange={onConfigChange} />
        </Suspense>
      );
    case "stats":
      return <StatsPanel providers={providers} />;
    case "about":
      return <AboutPanel />;
    case "playback":
      return <InkPlaybackPage noteId={currentNoteId} />;
    case "cowrite":
      return <CoWritePage />;
    case "elysia":
      return <ElysiaPage initialTab={initialElysiaTab} />;
    case "report":
      return <WritingReportPage noteId={currentNoteId} providers={providers} />;
  }
}

/* ══════════════════════════════════════
   1. 偏好设置 panel
   ══════════════════════════════════════ */
function PreferencesPanel({
  config,
  onChange,
}: {
  config: AppConfig;
  onChange: (c: AppConfig) => void;
}) {
  const { t } = useTranslation();
  const setCfg = <K extends keyof AppConfig>(key: K, value: AppConfig[K]) => {
    onChange({ ...config, [key]: value });
  };

  const themeOptions = useMemo<Array<{ value: ThemeOption; label: string }>>(
    () => [
      { value: "light", label: t("settings.theme.light", { defaultValue: "浅色" }) },
      { value: "dark", label: t("settings.theme.dark", { defaultValue: "深色" }) },
      { value: "system", label: t("settings.theme.system", { defaultValue: "跟随系统" }) },
    ],
    [t],
  );
  const localeOptions = useMemo(
    () =>
      LOCALE_OPTIONS.map(({ value, labelKey, defaultLabel }) => ({
        value,
        label: t(labelKey, { defaultValue: defaultLabel }),
      })),
    [t],
  );
  const tileColorModes = useMemo<Array<{ value: TileColorMode; label: string }>>(
    () => [
      { value: "system", label: t("settings.tileColor.followTheme", { defaultValue: "跟随主题" }) },
      { value: "custom", label: t("settings.tileColor.custom", { defaultValue: "自定义" }) },
    ],
    [t],
  );
  const viewModes = useMemo<Array<{ value: ViewMode; label: string }>>(
    () => [
      { value: "edit", label: t("settings.defaultView.edit", { defaultValue: "编辑" }) },
      { value: "split", label: t("settings.defaultView.split", { defaultValue: "分栏" }) },
      { value: "preview", label: t("settings.defaultView.preview", { defaultValue: "预览" }) },
    ],
    [t],
  );
  const backgroundFits = useMemo<Array<{ value: BackgroundFit; label: string }>>(
    () => [
      { value: "cover", label: t("settings.background.fit.cover", { defaultValue: "填充" }) },
      { value: "contain", label: t("settings.background.fit.contain", { defaultValue: "完整" }) },
      { value: "repeat", label: t("settings.background.fit.repeat", { defaultValue: "平铺" }) },
    ],
    [t],
  );

  return (
    <ScrollFrame>
      <Card title={t("settings.theme.label", { defaultValue: "主题" })}>
        <SlidingButtonGroup
          options={themeOptions}
          value={config.theme}
          onChange={(v: ThemeOption) => {
            setCfg("theme", v);
            applyTheme(v);
            watchSystemTheme(v);
          }}
        />
      </Card>
      <Card title={t("settings.notesDir", { defaultValue: "笔记目录" })}>
        <div className="flex gap-2">
          <input
            type="text"
            value={config.notesDir}
            readOnly
            className="min-w-0 flex-1 h-8 px-2.5 rounded-lg bg-paper-warm/70 border border-paper-deep/40 text-[11px] font-mono text-ink-faint truncate"
          />
          <button
            type="button"
            onClick={() => {
              invoke("pick_directory").catch(console.error);
            }}
            className="h-8 px-3 rounded-lg border border-paper-deep/45 text-[11px] text-ink-faint hover:text-bamboo hover:bg-bamboo-mist/50 transition-colors cursor-pointer"
          >
            {t("settings.selectFolder", { defaultValue: "选择文件夹" })}
          </button>
        </div>
      </Card>
      <Card title={t("settings.locale.label", { defaultValue: "语言" })}>
        <SlidingButtonGroup
          options={localeOptions}
          value={config.locale}
          onChange={(v) => setCfg("locale", v)}
        />
      </Card>
      <Card>
        <ToggleRow
          label={t("settings.closeToTray", { defaultValue: "关闭到托盘" })}
          checked={config.closeToTray}
          onChange={(v) => setCfg("closeToTray", v)}
        />
        <ToggleRow
          label={t("settings.autostart", { defaultValue: "开机自启" })}
          checked={config.autostart}
          onChange={(v) => setCfg("autostart", v)}
        />
        <ToggleRow
          label={t("settings.autoSave.note", { defaultValue: "自动保存笔记" })}
          checked={config.noteAutoSave}
          onChange={(v) => setCfg("noteAutoSave", v)}
        />
        <ToggleRow
          label={t("settings.autoSave.surface", { defaultValue: "小窗笔记自动保存" })}
          checked={config.noteSurfaceAutoSave}
          onChange={(v) => setCfg("noteSurfaceAutoSave", v)}
        />
        <ToggleRow
          label={t("settings.autoSave.externalFile", { defaultValue: "外部文件自动保存" })}
          checked={config.externalFileAutoSave}
          onChange={(v) => setCfg("externalFileAutoSave", v)}
        />
        <ToggleRow
          label={t("settings.rememberSurfaceSize", { defaultValue: "记住小窗尺寸" })}
          checked={config.rememberSurfaceSize}
          onChange={(v) => setCfg("rememberSurfaceSize", v)}
        />
        <ToggleRow
          label={t("settings.tileRenderMarkdown", { defaultValue: "磁贴渲染 Markdown" })}
          checked={config.tileRenderMarkdown}
          onChange={(v) => setCfg("tileRenderMarkdown", v)}
        />
        <ToggleRow
          label={t("settings.renderHtmlMarkdown", { defaultValue: "允许 HTML 标签渲染" })}
          checked={config.renderHtmlMarkdown}
          onChange={(v) => setCfg("renderHtmlMarkdown", v)}
        />
      </Card>
      <Card title={t("settings.fontSize.editor", { defaultValue: "编辑器字号" })}>
        <RangeRow
          value={config.fontSize ?? 14}
          min={8}
          max={30}
          step={1}
          format={(v) => `${v}px`}
          onChange={(v) => setCfg("fontSize", v)}
        />
      </Card>
      <Card title={t("settings.fontSize.surface", { defaultValue: "小窗/磁贴字号" })}>
        <RangeRow
          value={config.surfaceFontSize ?? 14}
          min={8}
          max={30}
          step={1}
          format={(v) => `${v}px`}
          onChange={(v) => setCfg("surfaceFontSize", v)}
        />
      </Card>
      <Card title={t("settings.tabIndentSize", { defaultValue: "Tab 缩进宽度" })}>
        <RangeRow
          value={config.tabIndentSize ?? 2}
          min={1}
          max={8}
          step={1}
          format={(v) => `${v}`}
          onChange={(v) => setCfg("tabIndentSize", v)}
        />
      </Card>
      <Card title={t("settings.tileColor.label", { defaultValue: "磁贴颜色" })}>
        <SlidingButtonGroup
          options={tileColorModes}
          value={config.tileColorMode}
          onChange={(v: TileColorMode) => setCfg("tileColorMode", v)}
        />
        {config.tileColorMode === "custom" && (
          <div className="flex items-center gap-2 mt-2">
            <input
              type="color"
              value={normalizeTileColor(config.tileColor)}
              onChange={(e) => setCfg("tileColor", e.target.value)}
              className="w-10 h-8 rounded-lg border border-paper-deep/40 bg-paper-warm/70 cursor-pointer"
            />
            <input
              type="text"
              value={config.tileColor}
              onChange={(e) => setCfg("tileColor", e.target.value)}
              placeholder="#f8f8f8"
              spellCheck={false}
              className="min-w-0 flex-1 h-8 px-2.5 rounded-lg bg-paper-warm/70 border border-paper-deep/40 text-[12px] font-mono text-ink-soft outline-none"
            />
            <button
              type="button"
              onClick={() => setCfg("tileColor", DEFAULT_TILE_COLOR)}
              className="h-8 px-2.5 rounded-lg border border-paper-deep/45 text-[11px] text-ink-faint hover:text-bamboo hover:bg-bamboo-mist/50 transition-colors cursor-pointer whitespace-nowrap"
            >
              {t("common.default", { defaultValue: "默认" })}
            </button>
          </div>
        )}
      </Card>
      <Card title={t("settings.background.label", { defaultValue: "背景图片" })}>
        <div className="flex gap-2 mb-2">
          <input
            type="text"
            value={
              (config.backgroundImagePath &&
                (localStorage.getItem("backgroundImageName") ||
                  config.backgroundImagePath.split(/[/\\]/).pop())) ||
              t("settings.background.default", { defaultValue: "默认背景" })
            }
            readOnly
            className="min-w-0 flex-1 h-8 px-2.5 rounded-lg bg-paper-warm/70 border border-paper-deep/40 text-[11px] font-mono text-ink-faint truncate"
          />
          <button
            type="button"
            onClick={() => {
              void chooseBackgroundImage().then(async (path) => {
                if (!path) return;
                const originalName = path.split(/[/\\]/).pop() ?? "";
                const saved = await invoke<string>("copy_background_image", { sourcePath: path });
                localStorage.setItem("backgroundImageName", originalName);
                setCfg("backgroundImagePath", saved);
              });
            }}
            className="h-8 px-3 rounded-lg border border-paper-deep/45 text-[11px] text-ink-faint hover:text-bamboo hover:bg-bamboo-mist/50 transition-colors cursor-pointer"
          >
            {t("settings.background.choose", { defaultValue: "选择" })}
          </button>
          {config.backgroundImagePath && (
            <button
              type="button"
              onClick={() => {
                localStorage.removeItem("backgroundImageName");
                setCfg("backgroundImagePath", "");
              }}
              className="h-8 px-3 rounded-lg border border-red-400/40 text-[11px] text-red-400 hover:bg-red-400/10 transition-colors cursor-pointer"
            >
              {t("settings.background.clear", { defaultValue: "清除" })}
            </button>
          )}
        </div>
        <SlidingButtonGroup
          options={backgroundFits}
          value={config.backgroundFit ?? "cover"}
          onChange={(v: BackgroundFit) => setCfg("backgroundFit", v)}
        />
        <div className="space-y-1 mt-2">
          <RangeRow
            label={t("settings.background.dim", { defaultValue: "遮罩" })}
            value={config.backgroundDim ?? 0.25}
            min={0}
            max={1}
            step={0.01}
            format={(v) => `${Math.round(v * 100)}%`}
            onChange={(v) => setCfg("backgroundDim", v)}
          />
          <RangeRow
            label={t("settings.background.scale", { defaultValue: "缩放" })}
            value={config.backgroundScale ?? 1}
            min={0.5}
            max={2}
            step={0.05}
            format={(v) => `${Math.round(v * 100)}%`}
            onChange={(v) => setCfg("backgroundScale", v)}
          />
          <RangeRow
            label={t("settings.background.positionX", { defaultValue: "横向" })}
            value={config.backgroundPositionX ?? 50}
            min={0}
            max={100}
            step={1}
            format={(v) => `${v}%`}
            onChange={(v) => setCfg("backgroundPositionX", v)}
          />
          <RangeRow
            label={t("settings.background.positionY", { defaultValue: "纵向" })}
            value={config.backgroundPositionY ?? 50}
            min={0}
            max={100}
            step={1}
            format={(v) => `${v}%`}
            onChange={(v) => setCfg("backgroundPositionY", v)}
          />
          <RangeRow
            label={t("settings.background.blur", { defaultValue: "模糊" })}
            value={config.backgroundBlur ?? 0}
            min={0}
            max={20}
            step={1}
            format={(v) => `${v}px`}
            onChange={(v) => setCfg("backgroundBlur", v)}
          />
        </div>
      </Card>
      <Card title={t("settings.defaultView.label", { defaultValue: "默认视图" })}>
        <SlidingButtonGroup
          options={viewModes}
          value={config.defaultViewMode}
          onChange={(v) => setCfg("defaultViewMode", v)}
        />
      </Card>
    </ScrollFrame>
  );
}

/* ══════════════════════════════════════
   2. 供应商 panel
   ══════════════════════════════════════ */
function ProvidersPanel({
  providers,
  onProvidersChange,
}: {
  providers: ProviderConfig[];
  onProvidersChange: (p: ProviderConfig[]) => void;
}) {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(
    providers.length > 0 ? providers[0].id : null,
  );
  const [showAddDialog, setShowAddDialog] = useState(false);

  const selected = useMemo(
    () => providers.find((p) => p.id === selectedId) ?? null,
    [providers, selectedId],
  );
  const filtered = useMemo(
    () => providers.filter((p) => p.name.toLowerCase().includes(searchQuery.toLowerCase())),
    [providers, searchQuery],
  );

  const update = useCallback(
    (updated: ProviderConfig) => {
      onProvidersChange(providers.map((p) => (p.id === updated.id ? updated : p)));
    },
    [providers, onProvidersChange],
  );

  const remove = useCallback(
    (id: string) => {
      const next = providers.filter((p) => p.id !== id);
      onProvidersChange(next);
      if (selectedId === id) setSelectedId(next.length > 0 ? next[0].id : null);
    },
    [providers, onProvidersChange, selectedId],
  );

  const add = useCallback(
    (template: string) => {
      const p = providerTemplate(template);
      onProvidersChange([...providers, p]);
      setSelectedId(p.id);
      setShowAddDialog(false);
    },
    [providers, onProvidersChange],
  );

  const addCustom = useCallback(() => {
    const p: ProviderConfig = {
      id: makeIdState("Custom"),
      enabled: true,
      name: "自定义供应商",
      protocol: "openaiCompatible",
      apiKey: "",
      baseUrl: "",
      apiPath: "/chat/completions",
      models: [],
    };
    onProvidersChange([...providers, p]);
    setSelectedId(p.id);
    setShowAddDialog(false);
  }, [providers, onProvidersChange]);

  return (
    <div className="flex-1 flex min-h-0">
      <div className="w-[240px] shrink-0 border-r border-paper-deep/25 flex flex-col bg-paper/10">
        <div className="p-3 pb-2">
          <div className="flex items-center gap-2 px-2.5 h-8 rounded-lg bg-paper-warm/80 border border-paper-deep/40 focus-within:border-bamboo/30 transition-all">
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              className="text-ink-ghost shrink-0"
            >
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.35-4.35" />
            </svg>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="搜索供应商..."
              className="flex-1 text-[11px] font-body text-ink placeholder:text-ink-ghost/60 bg-transparent"
            />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-0.5">
          {filtered.length === 0 ? (
            <div className="px-3 py-8 text-center text-[11px] text-ink-ghost">
              {searchQuery ? "没有匹配的供应商" : "暂无供应商"}
            </div>
          ) : (
            filtered.map((p) => (
              <button
                key={p.id}
                onClick={() => setSelectedId(p.id)}
                className={`w-full text-left rounded-lg px-3 py-2 transition-all duration-200 cursor-pointer ${p.id === selectedId ? "bg-bamboo-mist/70" : "hover:bg-paper-warm/70"}`}
              >
                <div className="flex items-center gap-2.5">
                  <div
                    className={`w-6 h-6 rounded-lg flex items-center justify-center text-[10px] font-bold shrink-0 ${p.enabled ? "bg-bamboo/10 text-bamboo" : "bg-paper-deep/30 text-ink-ghost"}`}
                  >
                    {p.name.charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-[12px] font-medium text-ink-soft truncate">{p.name}</div>
                    <div className="text-[9px] text-ink-ghost font-mono truncate">
                      {p.models.length} 模型
                    </div>
                  </div>
                </div>
              </button>
            ))
          )}
        </div>
        <div className="p-3 pt-2 border-t border-paper-deep/25">
          <button
            onClick={() => setShowAddDialog(true)}
            className="w-full flex items-center justify-center gap-1.5 h-8 rounded-lg border border-paper-deep/45 text-[11px] text-ink-faint hover:text-bamboo hover:bg-bamboo-mist/50 hover:border-bamboo/30 transition-all cursor-pointer"
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
            >
              <path d="M12 5v14M5 12h14" />
            </svg>
            添加
          </button>
        </div>
      </div>
      <div className="flex-1 flex flex-col min-w-0 min-h-0">
        {selected ? (
          <ProviderDetail provider={selected} onUpdate={update} onDelete={remove} />
        ) : (
          <div className="flex-1 flex items-center justify-center text-[12px] text-ink-ghost">
            选择一个供应商
          </div>
        )}
      </div>
      {showAddDialog && (
        <AddProviderDialog
          onSelect={add}
          onAddCustom={addCustom}
          onClose={() => setShowAddDialog(false)}
        />
      )}
    </div>
  );
}

function makeIdState(name: string): string {
  return `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${Date.now()}`;
}

function providerTemplate(template: string): ProviderConfig {
  const n = template.toLowerCase();
  if (n === "google" || n === "gemini")
    return {
      id: makeIdState("Google"),
      enabled: true,
      name: "Google",
      protocol: "gemini",
      apiKey: "",
      baseUrl: "https://generativelanguage.googleapis.com",
      apiPath: "",
      models: [
        { modelId: "gemini-2.5-flash", displayName: "Gemini 2.5 Flash", modelTypes: ["chat"] },
      ],
    };
  if (n === "claude")
    return {
      id: makeIdState("Claude"),
      enabled: true,
      name: "Claude",
      protocol: "claude",
      apiKey: "",
      baseUrl: "https://api.anthropic.com",
      apiPath: "/v1/messages",
      models: [
        { modelId: "claude-sonnet-4", displayName: "Claude Sonnet 4", modelTypes: ["chat"] },
      ],
    };
  if (n === "deepseek")
    return {
      id: makeIdState("DeepSeek"),
      enabled: true,
      name: "DeepSeek",
      protocol: "deepseek",
      apiKey: "",
      baseUrl: "https://api.deepseek.com",
      apiPath: "/v1/chat/completions",
      models: [
        {
          modelId: "deepseek-v4-flash",
          displayName: "DeepSeek V4 Flash",
          modelTypes: ["chat", "reason"],
        },
        {
          modelId: "deepseek-v4-pro",
          displayName: "DeepSeek V4 Pro",
          modelTypes: ["chat", "reason"],
        },
      ],
    };
  return {
    id: makeIdState("OpenAI"),
    enabled: true,
    name: "OpenAI",
    protocol: "openaiCompatible",
    apiKey: "",
    baseUrl: "https://api.openai.com/v1",
    apiPath: "/chat/completions",
    models: [
      { modelId: "gpt-4.1-mini", displayName: "GPT-4.1 Mini", modelTypes: ["chat"] },
      {
        modelId: "text-embedding-3-small",
        displayName: "text-embedding-3-small",
        modelTypes: ["embedding"],
      },
    ],
  };
}

const PROTOCOL_OPTIONS = [
  { value: "openaiCompatible", label: "OpenAI Compatible" },
  { value: "deepseek", label: "DeepSeek" },
  { value: "claude", label: "Claude (Anthropic)" },
  { value: "gemini", label: "Gemini (Google)" },
];

function defaultBaseUrl(protocol: string): string {
  switch (protocol) {
    case "deepseek":
      return "https://api.deepseek.com";
    case "gemini":
      return "https://generativelanguage.googleapis.com";
    case "claude":
      return "https://api.anthropic.com";
    default:
      return "https://api.openai.com/v1";
  }
}

function defaultApiPath(protocol: string): string {
  switch (protocol) {
    case "deepseek":
      return "/v1/chat/completions";
    case "claude":
      return "/v1/messages";
    case "gemini":
      return "";
    default:
      return "/chat/completions";
  }
}

function ProviderDetail({
  provider,
  onUpdate,
  onDelete,
}: {
  provider: ProviderConfig;
  onUpdate: (p: ProviderConfig) => void;
  onDelete: (id: string) => void;
}) {
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);
  const [showAddModel, setShowAddModel] = useState(false);

  return (
    <div className="flex-1 overflow-y-auto px-5 py-4">
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-bamboo/10 flex items-center justify-center text-[15px] font-bold text-bamboo">
            {provider.name.charAt(0).toUpperCase()}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-[15px] font-display font-bold text-ink">{provider.name}</h3>
              <span className="px-2 py-0.5 rounded-full bg-paper-deep/30 text-[8px] font-mono text-ink-ghost/70">
                {provider.protocol}
              </span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={provider.enabled}
              onChange={(e) => onUpdate({ ...provider, enabled: e.target.checked })}
              className="sr-only peer"
            />
            <div className="w-8 h-[18px] rounded-full transition-colors bg-paper-deep/50 peer-checked:bg-bamboo peer-checked:after:translate-x-[14px] after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:w-[14px] after:h-[14px] after:rounded-full after:bg-white after:shadow after:transition-transform" />
          </label>
          {showDeleteConfirm ? (
            <div className="flex items-center gap-1">
              <button
                onClick={() => {
                  onDelete(provider.id);
                  setShowDeleteConfirm(false);
                }}
                className="px-2.5 h-7 rounded-md text-[11px] text-cloud bg-red-400 hover:bg-red-500 cursor-pointer"
              >
                确认
              </button>
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="px-2.5 h-7 rounded-md text-[11px] text-ink-faint hover:bg-paper-warm cursor-pointer"
              >
                取消
              </button>
            </div>
          ) : (
            <button
              onClick={() => setShowDeleteConfirm(true)}
              className="w-7 h-7 flex items-center justify-center rounded-lg text-ink-ghost hover:text-red-400 hover:bg-danger-bg cursor-pointer"
              title="删除"
            >
              <svg
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              >
                <polyline points="3,6 5,6 21,6" />
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              </svg>
            </button>
          )}
        </div>
      </div>
      <div className="space-y-3 max-w-[600px]">
        <TextField
          label="名称"
          value={provider.name}
          onChange={(v) => onUpdate({ ...provider, name: v })}
        />
        <div>
          <label className="block text-[10px] font-mono text-ink-faint mb-1">协议</label>
          <div className="flex gap-1.5 flex-wrap">
            {PROTOCOL_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() =>
                  onUpdate({
                    ...provider,
                    protocol: opt.value,
                    baseUrl: defaultBaseUrl(opt.value),
                    apiPath: defaultApiPath(opt.value),
                  })
                }
                className={`px-2.5 h-7 rounded-lg text-[10px] font-mono transition-all cursor-pointer ${provider.protocol === opt.value ? "bg-bamboo/10 text-bamboo border border-bamboo/30" : "bg-paper-warm/50 text-ink-faint border border-paper-deep/30 hover:text-ink-soft"}`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
        <TextField
          label="API Key"
          value={provider.apiKey}
          onChange={(v) => onUpdate({ ...provider, apiKey: v })}
          placeholder="sk-..."
          secret={!showApiKey}
          onToggleSecret={() => setShowApiKey(!showApiKey)}
        />
        <TextField
          label="API Base URL"
          value={provider.baseUrl}
          onChange={(v) => onUpdate({ ...provider, baseUrl: v })}
          placeholder="https://api.openai.com/v1"
        />
        <TextField
          label="API 路径"
          value={provider.apiPath}
          onChange={(v) => onUpdate({ ...provider, apiPath: v })}
          placeholder="/chat/completions"
        />
        <div className="pt-3 border-t border-paper-deep/20">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-mono text-ink-faint">
              模型 ({provider.models.length})
            </span>
            <button
              onClick={() => setShowAddModel(true)}
              className="flex items-center gap-1 px-2 h-6 rounded-lg border border-paper-deep/40 text-[10px] text-ink-faint hover:text-bamboo hover:bg-bamboo-mist/50 cursor-pointer"
            >
              <svg
                width="10"
                height="10"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
              >
                <path d="M12 5v14M5 12h14" />
              </svg>
              添加
            </button>
          </div>
          {provider.models.length === 0 ? (
            <div className="px-3 py-5 text-center text-[11px] text-ink-ghost bg-paper-warm/30 rounded-xl border border-dashed border-paper-deep/30">
              暂无模型
            </div>
          ) : (
            <div className="space-y-1">
              {provider.models.map((m, idx) => (
                <ModelRow
                  key={m.modelId}
                  model={m}
                  onUpdate={(upd) => {
                    const ms = [...provider.models];
                    ms[idx] = upd;
                    onUpdate({ ...provider, models: ms });
                  }}
                  onDelete={() => {
                    const ms = provider.models.filter((_, i) => i !== idx);
                    onUpdate({ ...provider, models: ms });
                  }}
                />
              ))}
            </div>
          )}
        </div>
      </div>
      {showAddModel && (
        <AddModelDialog
          onAdd={(m) => {
            onUpdate({ ...provider, models: [...provider.models, m] });
            setShowAddModel(false);
          }}
          onClose={() => setShowAddModel(false)}
        />
      )}
    </div>
  );
}

function TextField({
  label,
  value,
  onChange,
  placeholder,
  secret,
  onToggleSecret,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  secret?: boolean;
  onToggleSecret?: () => void;
}) {
  return (
    <div>
      <label className="block text-[10px] font-mono text-ink-faint mb-1">{label}</label>
      <div className="flex items-center gap-1.5 h-8 px-2.5 rounded-lg bg-paper-warm/50 border border-paper-deep/30 focus-within:border-bamboo/30 transition-all">
        <input
          type={secret ? "password" : "text"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="flex-1 text-[11px] font-mono text-ink placeholder:text-ink-ghost/50 bg-transparent outline-none"
        />
        {onToggleSecret && (
          <button
            onClick={onToggleSecret}
            className="text-ink-ghost hover:text-ink-faint cursor-pointer shrink-0"
          >
            {secret ? (
              <svg
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              >
                <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
                <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
                <line x1="1" y1="1" x2="23" y2="23" />
              </svg>
            ) : (
              <svg
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              >
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            )}
          </button>
        )}
      </div>
    </div>
  );
}

function ModelRow({
  model,
  onUpdate,
  onDelete,
}: {
  model: ModelConfig;
  onUpdate: (m: ModelConfig) => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  if (editing) {
    return (
      <div className="p-2.5 rounded-xl bg-bamboo-mist/40 border border-bamboo/20 space-y-1.5">
        <input
          type="text"
          value={model.modelId}
          onChange={(e) => onUpdate({ ...model, modelId: e.target.value })}
          placeholder="model ID"
          className="w-full h-7 px-2.5 rounded-lg text-[10px] font-mono text-ink bg-paper-warm/80 border border-paper-deep/40 focus:border-bamboo/30"
        />
        <input
          type="text"
          value={model.displayName}
          onChange={(e) => onUpdate({ ...model, displayName: e.target.value })}
          placeholder="显示名称"
          className="w-full h-7 px-2.5 rounded-lg text-[10px] font-mono text-ink bg-paper-warm/80 border border-paper-deep/40 focus:border-bamboo/30"
        />
        {/* 能力标记：勾选"嵌入"后，该模型会被用作 RAG 记忆写入/检索的 embedding 供应商 */}
        <div className="flex flex-wrap gap-1.5">
          {MODEL_TYPE_KEYS.map((type) => {
            const active = (model.modelTypes ?? []).includes(type);
            return (
              <button
                key={type}
                type="button"
                onClick={() => {
                  const current = model.modelTypes ?? [];
                  const next = active ? current.filter((t) => t !== type) : [...current, type];
                  onUpdate({ ...model, modelTypes: next });
                }}
                className={`px-2 h-6 rounded-md text-[10px] border transition-colors cursor-pointer ${
                  active
                    ? "bg-bamboo/15 text-bamboo border-bamboo/30"
                    : "text-ink-ghost border-paper-deep/30 hover:text-ink-soft"
                }`}
              >
                {MODEL_TYPE_LABELS[type] ?? type}
              </button>
            );
          })}
        </div>
        <div className="flex gap-1.5 pt-0.5">
          <button
            onClick={() => setEditing(false)}
            className="px-2.5 h-6 rounded-md text-[10px] text-bamboo bg-bamboo/10 hover:bg-bamboo/20 cursor-pointer"
          >
            完成
          </button>
          <button
            onClick={onDelete}
            className="px-2.5 h-6 rounded-md text-[10px] text-red-400 hover:bg-danger-bg cursor-pointer"
          >
            删除
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className="flex items-center justify-between px-3 py-2 rounded-xl bg-paper-warm/30 border border-paper-deep/20 hover:border-paper-deep/40 transition-all group">
      <div>
        <div className="text-[11px] font-medium text-ink-soft truncate">{model.displayName}</div>
        <div className="text-[9px] font-mono text-ink-ghost truncate">{model.modelId}</div>
        {(model.modelTypes ?? []).length > 0 && (
          <div className="mt-0.5 flex flex-wrap gap-1">
            {(model.modelTypes ?? []).map((type) => (
              <span
                key={type}
                className="px-1.5 py-px rounded bg-bamboo/10 text-[8.5px] text-bamboo"
              >
                {MODEL_TYPE_LABELS[type] ?? type}
              </span>
            ))}
          </div>
        )}
      </div>
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={() => setEditing(true)}
          className="w-5 h-5 flex items-center justify-center rounded-md text-ink-ghost hover:text-ink-soft hover:bg-paper-warm cursor-pointer"
          title="编辑"
        >
          <svg
            width="10"
            height="10"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          >
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
          </svg>
        </button>
        <button
          onClick={onDelete}
          className="w-5 h-5 flex items-center justify-center rounded-md text-ink-ghost hover:text-red-400 hover:bg-danger-bg cursor-pointer"
          title="删除"
        >
          <svg
            width="10"
            height="10"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          >
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>
    </div>
  );
}

function AddProviderDialog({
  onSelect,
  onAddCustom,
  onClose,
}: {
  onSelect: (template: string) => void;
  onAddCustom: () => void;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-[360px] bg-cloud rounded-2xl border border-paper-deep/40 shadow-xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 h-12 border-b border-paper-deep/25">
          <h3 className="text-[13px] font-display font-medium text-ink-soft">添加供应商</h3>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-lg text-ink-ghost hover:text-ink-soft hover:bg-paper-warm cursor-pointer"
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 12 12"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            >
              <path d="M2 2l8 8M10 2l-8 8" />
            </svg>
          </button>
        </div>
        <div className="p-4 space-y-2">
          <p className="text-[11px] text-ink-ghost mb-2">选择预设或自定义</p>
          <PresetBtn
            label="OpenAI"
            desc="api.openai.com · GPT-4.1 Mini"
            onClick={() => onSelect("openai")}
          />
          <PresetBtn
            label="DeepSeek"
            desc="api.deepseek.com · V4 Pro / Flash"
            onClick={() => onSelect("deepseek")}
          />
          <PresetBtn
            label="Claude (Anthropic)"
            desc="api.anthropic.com · Claude Sonnet 4"
            onClick={() => onSelect("claude")}
          />
          <PresetBtn
            label="Google Gemini"
            desc="generativelanguage.googleapis.com · Gemini 2.5 Flash"
            onClick={() => onSelect("gemini")}
          />
          <div className="pt-2 border-t border-paper-deep/20">
            <button
              onClick={onAddCustom}
              className="w-full text-left px-4 py-3 rounded-xl border border-dashed border-paper-deep/40 hover:border-bamboo/30 hover:bg-bamboo-mist/30 transition-all cursor-pointer group"
            >
              <div className="font-medium text-[12px] text-ink-ghost group-hover:text-ink-soft flex items-center gap-2">
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                >
                  <path d="M12 5v14M5 12h14" />
                </svg>
                自定义供应商
              </div>
              <div className="text-[10px] text-ink-ghost/60 mt-0.5 ml-6">
                手动配置 API 地址和模型
              </div>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function PresetBtn({ label, desc, onClick }: { label: string; desc: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="w-full text-left px-4 py-3 rounded-xl border border-paper-deep/30 hover:border-bamboo/30 hover:bg-bamboo-mist/40 transition-all cursor-pointer group"
    >
      <div className="font-medium text-[12px] text-ink-soft group-hover:text-bamboo transition-colors">
        {label}
      </div>
      <div className="text-[10px] text-ink-ghost mt-0.5">{desc}</div>
    </button>
  );
}

function AddModelDialog({
  onAdd,
  onClose,
}: {
  onAdd: (m: ModelConfig) => void;
  onClose: () => void;
}) {
  const [modelId, setModelId] = useState("");
  const [displayName, setDisplayName] = useState("");
  const handleAdd = () => {
    if (!modelId.trim()) return;
    onAdd({ modelId: modelId.trim(), displayName: displayName.trim() || modelId.trim() });
  };
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-[340px] bg-cloud rounded-2xl border border-paper-deep/40 shadow-xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 h-12 border-b border-paper-deep/25">
          <h3 className="text-[13px] font-display font-medium text-ink-soft">添加模型</h3>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-lg text-ink-ghost hover:text-ink-soft hover:bg-paper-warm cursor-pointer"
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 12 12"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            >
              <path d="M2 2l8 8M10 2l-8 8" />
            </svg>
          </button>
        </div>
        <div className="p-4 space-y-3">
          <div>
            <label className="text-[10px] font-mono text-ink-faint block mb-1">Model ID</label>
            <input
              type="text"
              value={modelId}
              onChange={(e) => setModelId(e.target.value)}
              placeholder="gpt-4"
              className="w-full h-8 px-2.5 rounded-lg text-[11px] font-mono text-ink bg-paper-warm/70 border border-paper-deep/40 focus:border-bamboo/30 placeholder:text-ink-ghost/50"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") handleAdd();
              }}
            />
          </div>
          <div>
            <label className="text-[10px] font-mono text-ink-faint block mb-1">显示名称</label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="GPT-4"
              className="w-full h-8 px-2.5 rounded-lg text-[11px] font-mono text-ink bg-paper-warm/70 border border-paper-deep/40 focus:border-bamboo/30 placeholder:text-ink-ghost/50"
              onKeyDown={(e) => {
                if (e.key === "Enter") handleAdd();
              }}
            />
          </div>
          <div className="flex gap-2 pt-1">
            <button
              onClick={onClose}
              className="flex-1 h-8 rounded-lg border border-paper-deep/40 text-[11px] text-ink-faint hover:text-ink-soft hover:bg-paper-warm cursor-pointer"
            >
              取消
            </button>
            <button
              onClick={handleAdd}
              disabled={!modelId.trim()}
              className="flex-1 h-8 rounded-lg bg-bamboo/90 text-cloud text-[11px] hover:bg-bamboo cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            >
              添加
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════
   2.5 AI 集成 panel（Web 搜索 / 知识采集）
   ══════════════════════════════════════ */
function AiIntegrationPanel({
  config,
  onChange,
}: {
  config: AppConfig;
  onChange: (c: AppConfig) => void;
}) {
  const { t } = useTranslation();
  const searxngUrl = config.searxngUrl ?? "";

  return (
    <ScrollFrame>
      <Card title={t("settings.aiIntegration.webSearch", { defaultValue: "Web 搜索（SearXNG）" })}>
        <p className="text-[10px] leading-relaxed text-ink-ghost mb-3">
          {t("settings.aiIntegration.webSearchHint", {
            defaultValue:
              "画布「知识采集」与「联网调研」通过 SearXNG 搜索互联网。留空时自动在多个内置公开实例间切换（paulgo.io / priv.au / searx.tiekoetter.com / search.bus-hit.me / opnxng.com），无需配置即可使用；全不可用时自动回退 DuckDuckGo。想用更稳定的自托管实例，在这里填自己的地址。",
          })}
        </p>
        <TextField
          label="SearXNG URL"
          value={searxngUrl}
          onChange={(v) => onChange({ ...config, searxngUrl: v.trim() })}
          placeholder="留空自动切换内置公开实例"
        />
        <div className="mt-2 flex items-center gap-2">
          <span
            className={`h-1.5 w-1.5 rounded-full ${searxngUrl.trim() ? "bg-bamboo" : "bg-amber-400"}`}
          />
          <span className="text-[10px] text-ink-ghost">
            {searxngUrl.trim()
              ? t("settings.aiIntegration.webSearchReady", { defaultValue: "已配置：知识采集将使用联网搜索结果" })
              : t("settings.aiIntegration.webSearchEmpty", { defaultValue: "未配置：知识采集将离线作答（无来源链接）" })}
          </span>
        </div>
        <p className="mt-3 text-[10px] leading-relaxed text-ink-ghost/70">
          {t("settings.aiIntegration.dockerHint", {
            defaultValue:
              "自托管方案：本仓库提供一键部署 docker/searxng/docker-compose.yml（docker compose up -d 后把地址填到上面）。",
          })}
        </p>
      </Card>
    </ScrollFrame>
  );
}

/* ══════════════════════════════════════
   3. 默认模型 panel
   ══════════════════════════════════════ */
const MODEL_TYPE_LABELS: Record<string, string> = {
  chat: "对话",
  reason: "推理",
  image: "图像",
  embedding: "嵌入",
  tts: "语音",
};

const MODEL_TYPE_KEYS = ["chat", "reason", "image", "embedding", "tts"];

function DefaultModelsPanel({
  config,
  providers,
  onChange,
}: {
  config: AppConfig;
  providers: ProviderConfig[];
  onChange: (c: AppConfig) => void;
}) {
  const defaultModels = config.defaultModels ?? {};

  const changeDefault = (type: string, modelId: string | null) => {
    onChange({ ...config, defaultModels: { ...defaultModels, [type]: modelId } });
  };

  return (
    <ScrollFrame>
      <Card title="默认模型">
        <p className="text-[10px] text-ink-ghost mb-3">为每种用途选择默认使用的模型</p>
        <div className="space-y-2">
          {MODEL_TYPE_KEYS.map((type) => {
            const current = defaultModels[type] ?? null;
            return (
              <div
                key={type}
                className="flex items-center gap-3 h-10 px-3 rounded-xl bg-paper-warm/30 border border-paper-deep/25"
              >
                <span className="w-12 text-[11px] font-medium text-ink-soft">
                  {MODEL_TYPE_LABELS[type] ?? type}
                </span>
                <select
                  value={current ?? ""}
                  onChange={(e) => changeDefault(type, e.target.value || null)}
                  className="flex-1 h-7 px-2 rounded-lg bg-paper-warm/70 border border-paper-deep/40 text-[11px] font-mono text-ink outline-none cursor-pointer"
                >
                  <option value="">未设置</option>
                  {providers
                    .filter((p) => p.enabled)
                    .flatMap((p) =>
                      p.models.map((m) => (
                        <option key={`${p.id}-${m.modelId}`} value={m.modelId}>
                          {p.name} / {m.displayName}
                        </option>
                      )),
                    )}
                </select>
              </div>
            );
          })}
        </div>
        {providers.filter((p) => p.enabled).length === 0 && (
          <div className="mt-3 px-4 py-3 text-center text-[11px] text-ink-ghost bg-danger-bg/40 rounded-xl border border-dashed border-danger/30">
            暂无启用供应商，请先在"供应商"页面添加
          </div>
        )}
      </Card>
    </ScrollFrame>
  );
}

/* ══════════════════════════════════════
   4. 快捷键 panel
   ══════════════════════════════════════ */
function HotkeysPanel({
  config,
  onChange,
}: {
  config: AppConfig;
  onChange: (c: AppConfig) => void;
}) {
  const { t } = useTranslation();
  const setCfg = <K extends keyof AppConfig>(key: K, value: AppConfig[K]) => {
    onChange({ ...config, [key]: value });
  };

  return (
    <ScrollFrame>
      <Card title={t("settings.shortcuts", { defaultValue: "快捷键" })}>
        <ToggleRow
          label={t("settings.tileCtrlClose", { defaultValue: "Ctrl+右键快速关闭磁贴" })}
          checked={config.tileCtrlClose}
          onChange={(v) => setCfg("tileCtrlClose", v)}
        />
        <ToggleRow
          label={t("settings.openAtCursor", { defaultValue: "快捷键打开时跟随鼠标位置" })}
          checked={config.openAtCursor ?? true}
          onChange={(v) => setCfg("openAtCursor", v)}
        />
        <div className="space-y-1.5 pt-2">
          <label className="block text-[11px] font-body text-ink-faint/70">
            {t("settings.quickNoteShortcut", { defaultValue: "快捷记录快捷键" })}
          </label>
          <ShortcutRecorder
            value={config.globalShortcut}
            onChange={(v) => setCfg("globalShortcut", v)}
          />
        </div>
        <div className="space-y-1.5 pt-2">
          <label className="block text-[11px] font-body text-ink-faint/70">
            {t("settings.visibilityShortcut", { defaultValue: "显示/隐藏窗口快捷键" })}
          </label>
          <ShortcutRecorder
            value={config.toggleVisibilityShortcut}
            onChange={(v) => setCfg("toggleVisibilityShortcut", v)}
          />
        </div>
      </Card>
    </ScrollFrame>
  );
}

type ShortcutMsg = { key: string; params?: Record<string, string> } | { raw: string };
type CheckState = "idle" | "checking" | "ok" | "warning" | "error";

function ShortcutRecorder({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { t } = useTranslation();
  const [checkState, setCheckState] = useState<CheckState>("idle");
  const [checkMsg, setCheckMsg] = useState<ShortcutMsg>({ key: "settings.shortcut.forQuickNote" });
  const shortcutCheckRequestId = useRef(0);
  const isMounted = useRef(true);
  const platform = shortcutPlatform();

  const resolveMsg = (msg: ShortcutMsg): string => {
    if ("raw" in msg) return msg.raw;
    const key = msg.key as string;
    const params = (msg.params || {}) as Record<string, string>;
    return t(key, params as any);
  };

  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
      shortcutCheckRequestId.current += 1;
    };
  }, []);
  const isCurrent = (rid: number) => isMounted.current && rid === shortcutCheckRequestId.current;
  const invalidate = () => {
    shortcutCheckRequestId.current += 1;
  };

  const runCheck = async (shortcut: string, saveWhenAvailable: boolean) => {
    const rid = ++shortcutCheckRequestId.current;
    setCheckState("checking");
    setCheckMsg({ key: "settings.shortcut.checking" });
    try {
      const result = await checkGlobalShortcut(shortcut);
      if (!isCurrent(rid)) return;
      const conflictMsg: ShortcutMsg = {
        key: `settings.shortcut.conflict.${result.conflictType}`,
        params: { shortcut },
      };
      if (result.available) {
        setCheckState("ok");
        setCheckMsg(conflictMsg);
        if (saveWhenAvailable) onChange(shortcut);
      } else {
        setCheckState("warning");
        setCheckMsg(conflictMsg);
      }
    } catch (error) {
      if (!isCurrent(rid)) return;
      setCheckState("error");
      setCheckMsg(
        error instanceof Error ? { raw: error.message } : { key: "settings.shortcut.checkFailed" },
      );
    }
  };

  const recorder = useShortcutRecorder({
    onRecord: (shortcut) => {
      if (shortcut === "") {
        invalidate();
        onChange("");
        setCheckState("idle");
        setCheckMsg({ key: "settings.shortcut.cleared" });
      } else if (isValidGlobalShortcut(shortcut)) {
        void runCheck(hotkeyToConfigString(shortcut, platform), true);
      } else {
        invalidate();
        setCheckState("warning");
        setCheckMsg({ key: "settings.shortcut.needsModifier" });
      }
    },
  });
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!recorder.isRecording) return;
    const handleClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node))
        recorder.cancelRecording();
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [recorder.isRecording, recorder.cancelRecording]);

  const liveDisplay =
    recorder.isRecording && recorder.heldKeys.length > 0
      ? formatHeldKeys(recorder.heldKeys, platform)
      : null;
  const statusClass =
    checkState === "ok"
      ? "text-bamboo"
      : checkState === "warning" || checkState === "error"
        ? "text-red-400"
        : "text-ink-ghost";
  const isChecking = checkState === "checking";

  return (
    <div ref={containerRef} className="relative space-y-1.5">
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => recorder.startRecording()}
          className={`min-w-0 flex-1 h-8 px-2.5 rounded-lg border text-[11px] flex items-center gap-2 cursor-pointer transition-colors ${recorder.isRecording ? "bg-bamboo-mist/40 border-bamboo" : "bg-paper-warm/70 border-paper-deep/40 hover:border-paper-deep/60"}`}
        >
          {recorder.isRecording ? (
            <>
              <span className="flex-1 min-w-0 text-left text-bamboo truncate">
                {liveDisplay ||
                  t("settings.shortcut.pressHint", {
                    defaultValue: "按下快捷键；按 Delete 清空。",
                  })}
              </span>
              <span className="text-[10px] text-ink-faint shrink-0">
                {t("settings.shortcut.cancelHint", { defaultValue: "Esc 取消" })}
              </span>
            </>
          ) : (
            <>
              <span
                className={`flex-1 min-w-0 text-left truncate ${value ? "text-ink-soft" : "text-ink-ghost"}`}
              >
                {value || t("settings.shortcut.notSet", { defaultValue: "未设置" })}
              </span>
              <span className="text-[10px] text-ink-ghost shrink-0">
                {t("settings.shortcut.clickToRecord", { defaultValue: "点击录制" })}
              </span>
            </>
          )}
        </button>
        <button
          type="button"
          disabled={isChecking || recorder.isRecording}
          onClick={() => void runCheck(value, false)}
          className="h-8 px-3 rounded-lg border border-paper-deep/45 text-[10px] text-ink-faint hover:text-bamboo hover:bg-bamboo-mist/50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer shrink-0"
        >
          {isChecking
            ? t("settings.shortcut.checkingShort", { defaultValue: "检测中" })
            : t("settings.shortcut.check", { defaultValue: "检测" })}
        </button>
      </div>
      <p className={`min-h-4 text-[10px] ${statusClass}`}>{resolveMsg(checkMsg)}</p>
    </div>
  );
}

/* ══════════════════════════════════════
   6. 关于 panel
   ══════════════════════════════════════ */
function AboutPanel() {
  const [appVersion, setAppVersion] = useState("1.0.0");

  useEffect(() => {
    invoke<string>("get_app_version")
      .then(setAppVersion)
      .catch(() => setAppVersion("1.0.0"));
  }, []);

  return (
    <ScrollFrame center>
      <div className="max-w-[420px] w-full pt-8">
        <div className="rounded-2xl border border-paper-deep/30 bg-paper/40 overflow-hidden">
          <div className="px-6 pt-8 pb-6 flex flex-col items-center text-center border-b border-paper-deep/20">
            <div className="w-16 h-16 rounded-2xl bg-bamboo/90 flex items-center justify-center mb-3 shadow-lg">
              <span className="text-cloud text-[28px] font-display font-bold tracking-wide">
                花
              </span>
            </div>
            <h2 className="text-[18px] font-display font-bold text-ink">Floral Note</h2>
            <p className="text-[11px] text-ink-ghost mt-1 font-mono">v{appVersion}</p>
            <p className="text-[12px] text-ink-faint mt-3 max-w-[280px] leading-relaxed">
              轻量、优雅的本地笔记应用，支持 Markdown 写作、磁贴速记与 AI 辅助。
            </p>
          </div>

          <div className="px-6 py-5 space-y-3">
            <InfoRow
              label="运行环境"
              value={
                navigator.platform.includes("Win")
                  ? "Windows"
                  : navigator.platform.includes("Mac")
                    ? "macOS"
                    : "Linux"
              }
            />
            <InfoRow
              label="笔记存储"
              value={localStorage.getItem("__notes_dir") ? "应用目录" : "数据目录"}
            />
            <InfoRow label="渲染引擎" value="KaTeX · Highlight.js · Marked" />
          </div>

          <div className="px-6 py-4 border-t border-paper-deep/20 text-center">
            <p className="text-[10px] text-ink-ghost/60">Built with Tauri · React · TypeScript</p>
          </div>
        </div>
      </div>
    </ScrollFrame>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between h-8 px-3 rounded-lg bg-paper-warm/40">
      <span className="text-[11px] text-ink-faint">{label}</span>
      <span className="text-[11px] font-mono text-ink-soft">{value}</span>
    </div>
  );
}

/* ─── ScrollFrame ─── */
function ScrollFrame({ children, center }: { children: React.ReactNode; center?: boolean }) {
  return (
    <div className="flex-1 overflow-y-auto min-h-0">
      <div className={`px-6 py-5 ${center ? "flex flex-col items-center" : ""}`}>
        {children}
        <div className="h-8" />
      </div>
    </div>
  );
}

/* ─── Card ─── */
function Card({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <div className="mb-4 px-4 py-3.5 rounded-xl bg-paper/30 border border-paper-deep/25 max-w-[600px]">
      {title && (
        <label className="block text-[11px] font-mono text-ink-faint mb-2.5">{title}</label>
      )}
      {children}
    </div>
  );
}

/* ─── ToggleRow ─── */
function ToggleRow({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between py-1.5 cursor-pointer group">
      <span className="text-[12px] text-ink-soft group-hover:text-ink transition-colors">
        {label}
      </span>
      <div className="relative">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="sr-only peer"
        />
        <div className="w-8 h-[18px] rounded-full transition-colors bg-paper-deep/50 peer-checked:bg-bamboo peer-checked:after:translate-x-[14px] after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:w-[14px] after:h-[14px] after:rounded-full after:bg-white after:shadow after:transition-transform" />
      </div>
    </label>
  );
}

/* ─── RangeRow ─── */
function RangeRow({
  label,
  value,
  min,
  max,
  step,
  format,
  onChange,
}: {
  label?: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex items-center gap-3 py-0.5">
      {label && <span className="text-[11px] text-ink-faint w-12 shrink-0">{label}</span>}
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="flex-1 h-1.5 rounded-full appearance-none cursor-pointer bg-paper-deep/50 accent-bamboo"
      />
      <span className="text-[11px] font-mono text-ink-faint w-10 text-right shrink-0">
        {format(value)}
      </span>
    </div>
  );
}
