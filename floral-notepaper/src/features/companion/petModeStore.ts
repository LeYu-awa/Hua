import { setPetMode } from "./petModeApi";

/**
 * 桌宠模式全局状态（模块级 + 全局事件，AppShell / Live2D 层订阅）。
 * 持久化开关：localStorage。
 */

export const PET_MODE_EVENT = "pet-mode-changed";

export interface PetModeState {
  enabled: boolean;
  scale: number;
}

const STORAGE_KEY = "companion_pet_mode";
const PET_MODE_BODY_CLASS = "pet-mode-active";

function readStored(): PetModeState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<PetModeState>;
      return { enabled: Boolean(parsed.enabled), scale: Number(parsed.scale) || 1 };
    }
  } catch {
    // 忽略损坏的存储
  }
  return { enabled: false, scale: 1 };
}

function persist(state: PetModeState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // 存储不可用时忽略
  }
}

function notify(state: PetModeState) {
  window.dispatchEvent(new CustomEvent<PetModeState>(PET_MODE_EVENT, { detail: state }));
  const body = document.body;
  body.classList.toggle(PET_MODE_BODY_CLASS, state.enabled);
  // 气泡定位随缩放同步
  if (state.enabled) {
    document.documentElement.style.setProperty("--pet-scale", String(state.scale));
  } else {
    document.documentElement.style.removeProperty("--pet-scale");
  }
  // 进入桌宠模式时禁用页面滚动，恢复时还原
  if (state.enabled) {
    body.style.overflow = "hidden";
  } else {
    body.style.removeProperty("overflow");
  }
}

export function loadPetMode(): PetModeState {
  return readStored();
}

/** 开启/关闭桌宠模式：同步本地状态并调用后端窗口命令 */
export async function applyPetMode(enabled: boolean, scale?: number): Promise<PetModeState> {
  const next: PetModeState = { enabled, scale: scale ?? readStored().scale };
  persist(next);
  notify(next);
  await setPetMode(enabled, next.scale);
  return next;
}

export function subscribePetMode(callback: (state: PetModeState) => void): () => void {
  const handler = (event: Event) => {
    callback((event as CustomEvent<PetModeState>).detail);
  };
  window.addEventListener(PET_MODE_EVENT, handler);
  return () => window.removeEventListener(PET_MODE_EVENT, handler);
}

/** 应用启动时若存储为开启状态，恢复桌宠模式（设置面板外部调用） */
export function restorePetModeIfNeeded(): void {
  const stored = readStored();
  if (stored.enabled) {
    notify(stored);
    void setPetMode(true, stored.scale);
  }
}
