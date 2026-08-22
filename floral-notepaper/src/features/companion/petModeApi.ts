import { invoke } from "@tauri-apps/api/core";

/**
 * 桌宠模式 API（对应后端 services::pet 命令，移植自 LingChat，MIT）。
 */

export interface PetSolidRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/**
 * 切换桌宠模式：
 * - enable=true  → 主窗口缩成无边框置顶小窗（宽 240*scale，高 (240+200+45)*scale）
 * - enable=false → 恢复常规窗口（1500×800，居中）
 */
export async function setPetMode(enable: boolean, scale = 1): Promise<void> {
  if (!isTauri()) return;
  try {
    await invoke("set_pet_mode", { enable, scale });
  } catch (error) {
    console.warn("[pet] 切换桌宠模式失败", error);
  }
}

/** 更新桌宠窗口可点击区域（角色/对话框边界），空白区域点击穿透 */
export async function updateSolidRegions(rects: PetSolidRect[]): Promise<void> {
  if (!isTauri()) return;
  try {
    await invoke("update_solid_regions", { rects });
  } catch (error) {
    console.warn("[pet] 更新点击区域失败", error);
  }
}
