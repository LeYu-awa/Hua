//! 桌宠模式（移植自 LingChat `api/pet.rs`，MIT）。
//!
//! 把主窗口切换为无边框、置顶、不可缩放的小尺寸桌宠窗口，
//! 并通过 solid regions 实现"角色区域可交互、空白区域点击穿透"。

use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, LogicalSize, Manager};

#[derive(Clone, Deserialize, Debug, Serialize)]
pub struct PetRect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

/// 桌宠窗口的可点击区域（solid rects）与开关状态。
pub struct PetHitTestState {
    pub solid_rects: Arc<Mutex<Vec<PetRect>>>,
    pub enabled: Arc<Mutex<bool>>,
}

impl Default for PetHitTestState {
    fn default() -> Self {
        Self {
            solid_rects: Arc::new(Mutex::new(Vec::new())),
            enabled: Arc::new(Mutex::new(false)),
        }
    }
}

/// 更新桌宠窗口的可点击区域列表（前端在角色/对话框边界变化时调用）。
#[tauri::command]
pub fn update_solid_regions(rects: Vec<PetRect>, state: tauri::State<'_, PetHitTestState>) {
    if let Ok(mut locked) = state.solid_rects.lock() {
        *locked = rects;
    }
}

/// 切换桌宠模式：true 时把主窗口缩成桌宠小窗（无边框/置顶/不可缩放），
/// false 时恢复为正常窗口。
///
/// 窗口尺寸基于桌宠组件尺寸：BASE_AVATAR_SIZE = 240, CHAT_BASE_H = 45,
/// DIALOG_MAX_BASE = 200 → width = 240*scale, height = (240+200+45)*scale。
#[tauri::command]
pub fn set_pet_mode(
    enable: bool,
    scale: Option<f64>,
    app_handle: AppHandle,
    state: tauri::State<'_, PetHitTestState>,
) -> Result<(), String> {
    if let Ok(mut locked_enabled) = state.enabled.lock() {
        *locked_enabled = enable;
    }

    if let Some(window) = app_handle.get_webview_window("main") {
        if enable {
            let scale_val = scale.unwrap_or(1.0);
            let width = (240.0 * scale_val) as u32;
            let height = ((240.0 + 200.0 + 45.0) * scale_val) as u32;

            let _ = window.set_skip_taskbar(true);
            let _ = window.set_always_on_top(true);
            let _ = window.set_resizable(false);
            let _ = window.set_decorations(false);
            let _ = window.set_maximizable(false);
            let _ = window.set_size(LogicalSize::new(width, height));
        } else {
            // Restore normal window
            let _ = window.set_maximizable(true);
            let _ = window.set_skip_taskbar(false);
            let _ = window.set_always_on_top(false);
            let _ = window.set_resizable(true);
            let _ = window.set_decorations(true);
            let _ = window.set_size(LogicalSize::new(1500, 800));
            // Center the window on screen so it doesn't expand from the pet's top-left corner
            let _ = window.center();
            // Always restore cursor ignore to false
            let _ = window.set_ignore_cursor_events(false);
        }
    }
    Ok(())
}
