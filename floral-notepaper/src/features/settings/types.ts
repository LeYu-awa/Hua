export type ViewMode = "edit" | "split" | "preview";

export type ThemeOption = "light" | "dark" | "system";

export type TileColorMode = "system" | "custom";
export type BackgroundFit = "cover" | "contain" | "repeat";

export interface ModelConfig {
  modelId: string;
  displayName: string;
  modelTypes?: string[];
  inputModes?: string[];
  capabilities?: string[];
}

export interface ProviderConfig {
  id: string;
  enabled: boolean;
  name: string;
  protocol: string;
  apiKey: string;
  baseUrl: string;
  apiPath: string;
  models: ModelConfig[];
}

export interface AppConfig {
  locale: string;
  notesDir: string;
  globalShortcut: string;
  closeToTray: boolean;
  autostart: boolean;
  defaultViewMode: string;
  noteAutoSave: boolean;
  noteSurfaceAutoSave: boolean;
  tileColor: string;
  tileColorMode: TileColorMode;
  theme: ThemeOption;
  fontSize: number;
  surfaceFontSize: number;
  tabIndentSize: number;
  externalFileAutoSave: boolean;
  rememberSurfaceSize: boolean;
  tileCtrlClose: boolean;
  tileRenderMarkdown: boolean;
  renderHtmlMarkdown: boolean;
  surfaceWidth?: number;
  surfaceHeight?: number;
  toggleVisibilityShortcut: string;
  openAtCursor: boolean;
  backgroundImagePath?: string;
  backgroundFit?: BackgroundFit;
  backgroundDim?: number;
  backgroundBlur?: number;
  backgroundScale?: number;
  backgroundPositionX?: number;
  backgroundPositionY?: number;
  providers?: ProviderConfig[];
  defaultModels?: Record<string, string | null>;
  /** Agent 总开关，默认关闭 */
  agentEnabled?: boolean;
  /** 停顿提示阈值，单位毫秒，默认 20000 */
  agentNudgeThresholdMs?: number;
  /** Agent 数据保留天数，默认 30 */
  agentDataRetentionDays?: number;
}
