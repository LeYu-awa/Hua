//! 情绪识别子系统（ONNX 推理，移植自 LingChat，MIT）。
//!
//! 提供 19 类情绪的文本分类器，供对话流/桌宠驱动 Live2D 表情。
//! 模型资产从 ModelScope `Emotion_model_19emo_small_onnx`（model_int8_o2）按需下载，
//! 存放于花笺数据根目录 `models/emotion/`。

pub mod classifier;

use std::path::{Path, PathBuf};
use std::sync::Arc;

use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

pub use classifier::{EmotionClassifier, EmotionPrediction};

use crate::services::notes::AppError;

/// 命令错误统一映射（code=emotion）
fn app_error(message: impl Into<String>) -> AppError {
    AppError::new("emotion", message.into())
}

// ---------------------------------------------------------------------------
// 资产目录：ModelScope 上的文件名 → 本地文件名（分类器只依赖 3 个必需文件）
// ---------------------------------------------------------------------------

const MODEL_BASE_URL: &str =
    "https://www.modelscope.cn/models/lingchat-research-studio/Emotion_model_19emo_small_onnx/resolve/master/model_int8_o2";

/// 需要下载的文件：远程文件名（本地同名）。
const MODEL_FILES: &[&str] = &[
    "model.onnx",
    "vocab.txt",
    "label_mapping.json",
    "config.json",
];

// ---------------------------------------------------------------------------
// EmotionState -- Tauri managed state
// ---------------------------------------------------------------------------

pub struct EmotionState {
    pub model_dir: PathBuf,
    pub classifier: tokio::sync::Mutex<Option<Arc<EmotionClassifier>>>,
}

impl EmotionState {
    /// 按 D 盘模型根目录解析路径并尝试加载已就位的模型（setup 阶段调用）。
    pub fn from_app() -> Result<Self, AppError> {
        let base = crate::services::tts_local::paths::resolve_models_root()
            .map_err(|e| app_error(format!("resolve models root: {e}")))?;
        let model_dir = base.join("emotion");
        let _ = std::fs::create_dir_all(&model_dir);

        let classifier = Self::try_load(&model_dir)?;
        Ok(Self {
            model_dir,
            classifier: tokio::sync::Mutex::new(classifier),
        })
    }

    fn try_load(model_dir: &Path) -> Result<Option<Arc<EmotionClassifier>>, AppError> {
        if model_dir.join("model.onnx").exists() {
            match EmotionClassifier::load(model_dir) {
                Ok(c) => Ok(Some(Arc::new(c))),
                Err(e) => {
                    log::warn!("情绪模型加载失败（降级为 passthrough）: {e}");
                    Ok(None)
                }
            }
        } else {
            Ok(None)
        }
    }

    pub async fn ensure_loaded(&self) -> Option<Arc<EmotionClassifier>> {
        let mut guard = self.classifier.lock().await;
        if guard.is_none() {
            *guard = Self::try_load(&self.model_dir).ok().flatten();
        }
        guard.clone()
    }
}

// ---------------------------------------------------------------------------
// DTO
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize)]
pub struct EmotionStatus {
    /// 模型目录是否存在 model.onnx（资产已下载）
    pub installed: bool,
    /// 分类器已加载并可推理
    pub loaded: bool,
    /// 标签数量（0 表示未加载）
    pub label_count: usize,
}

#[derive(Debug, Serialize)]
pub struct EmotionDownloadResult {
    pub file: String,
    pub bytes: u64,
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn emotion_status(state: State<'_, EmotionState>) -> Result<EmotionStatus, AppError> {
    let installed = state.model_dir.join("model.onnx").exists();
    let classifier = state.classifier.lock().await.clone();
    Ok(EmotionStatus {
        installed,
        loaded: classifier.as_ref().is_some_and(|c| c.is_enabled()),
        label_count: classifier.as_ref().map_or(0, |c| c.label_count()),
    })
}

/// 预测文本情绪。模型未安装/未加载时返回 passthrough（label=输入文本，disabled=true）。
#[tauri::command]
pub async fn emotion_predict(
    state: State<'_, EmotionState>,
    text: String,
    threshold: Option<f32>,
) -> Result<EmotionPrediction, AppError> {
    let classifier = state.ensure_loaded().await;
    Ok(classifier.map_or_else(
        || EmotionPrediction::passthrough(&text, true),
        |c| c.predict(&text, threshold),
    ))
}

/// 下载 19 类情绪模型资产（顺序下载 4 个文件，完成后自动加载）。
#[tauri::command]
pub async fn emotion_download(
    app: AppHandle,
    state: State<'_, EmotionState>,
) -> Result<Vec<EmotionDownloadResult>, AppError> {
    std::fs::create_dir_all(&state.model_dir)
        .map_err(|e| app_error(format!("mkdir: {e}")))?;

    let mut results = Vec::new();
    for file_name in MODEL_FILES {
        let url = format!("{MODEL_BASE_URL}/{file_name}");
        let dst = state.model_dir.join(file_name);
        let bytes = download_to_file(&url, &dst)
            .await
            .map_err(|e| app_error(format!("下载 {file_name} 失败: {e}")))?;
        results.push(EmotionDownloadResult {
            file: (*file_name).to_string(),
            bytes,
        });
    }

    // 模型就位后加载，供后续 emotion_predict 直接推理
    if let Ok(Some(c)) = EmotionState::try_load(&state.model_dir) {
        *state.classifier.lock().await = Some(c);
    }

    let _ = app.emit("emotion://download-complete", ());
    Ok(results)
}

// ---------------------------------------------------------------------------
// 轻量下载：流式写入 .part 后原子 rename（复用 TTS 下载器的模式）
// ---------------------------------------------------------------------------

async fn download_to_file(url: &str, dest: &Path) -> Result<u64, String> {
    if let Some(parent) = dest.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| format!("mkdir: {e}"))?;
    }
    let tmp = dest.with_extension("part");

    let resp = reqwest::Client::new()
        .get(url)
        .timeout(std::time::Duration::from_secs(600))
        .header(reqwest::header::ACCEPT, "*/*")
        .send()
        .await
        .map_err(|e| format!("request: {e}"))?;

    if !resp.status().is_success() {
        return Err(format!(
            "HTTP {} from {}",
            resp.status(),
            resp.url().to_string()
        ));
    }

    let bytes = resp.bytes().await.map_err(|e| format!("body: {e}"))?;
    tokio::fs::write(&tmp, &bytes)
        .await
        .map_err(|e| format!("write: {e}"))?;
    tokio::fs::rename(&tmp, dest)
        .await
        .map_err(|e| format!("rename: {e}"))?;

    Ok(bytes.len() as u64)
}
