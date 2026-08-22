// Local TTS engine module（移植自 LingChat，MIT）。
//
// 保留了 LingChat 本地 TTS 的核心能力：资产目录、按需下载（含进度事件）、
// 本地持久化、删除、以及进程内 SBV2 合成（DeBERTa 语义编码 + Ling-v2 声线）。
// 去掉了与花笺架构无关的部分（设置开关持久化、推理设备热切换、手动导入）。

pub mod download;
pub mod engine;
pub mod model_manager;
pub mod package;
pub mod paths;
pub mod registry;

use std::path::{Path, PathBuf};
use std::sync::Arc;

use serde::Serialize;
use tauri::ipc::Response;
use tauri::{AppHandle, Emitter, State};
use tokio_util::sync::CancellationToken;

pub use engine::{LocalTtsEngine, SynthesizeRequest};
pub use paths::LocalTtsPaths;

use crate::services::notes::AppError;

/// 命令错误统一映射（code=ttsLocal）
fn app_error(message: impl Into<String>) -> AppError {
    AppError::new("ttsLocal", message.into())
}

fn map_string_err(e: String) -> AppError {
    app_error(e)
}

// ---------------------------------------------------------------------------
// LocalTtsState -- Tauri managed state for the local TTS engine
// ---------------------------------------------------------------------------

pub struct LocalTtsState {
    pub paths: LocalTtsPaths,
    pub engine: Arc<LocalTtsEngine>,
    pub cancel: tokio::sync::Mutex<Option<Arc<CancellationToken>>>,
}

impl LocalTtsState {
    pub fn new(paths: LocalTtsPaths) -> Self {
        Self {
            paths,
            engine: Arc::new(LocalTtsEngine::new()),
            cancel: tokio::sync::Mutex::new(None),
        }
    }

    /// 按花笺数据根目录解析路径并确保磁盘布局（setup 阶段调用）。
    pub fn from_app(app: &AppHandle) -> Result<Self, AppError> {
        let paths = LocalTtsPaths::resolve(app).map_err(map_string_err)?;
        paths.ensure().map_err(map_string_err)?;
        Ok(Self::new(paths))
    }
}

#[derive(Debug, Serialize)]
pub struct TtsLocalStatus {
    pub ready: bool,
    pub deberta_installed: bool,
    pub installed_voice_count: usize,
}

#[derive(Debug, Serialize)]
pub struct TtsLocalInstallSnapshot {
    pub assets: Vec<model_manager::AssetRecord>,
    pub voices: Vec<model_manager::VoiceRecord>,
}

#[derive(Debug, Serialize)]
pub struct ImportResult {
    pub asset_id: String,
    pub voice_id: Option<String>,
    pub path: String,
    pub bytes: u64,
    pub message: String,
}

// ---------------------------------------------------------------------------
// Tauri commands -- status / catalog / installed
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn tts_local_status(
    state: State<'_, LocalTtsState>,
) -> Result<TtsLocalStatus, AppError> {
    let deberta_installed = state.paths.asset_present("deberta");
    // 惰性初始化：资产已就位但引擎尚未加载（如 setup 自动导入、历史已下载）
    // 时，首次读取状态即加载引擎，保证选择音色后预览合成立即可用。
    if deberta_installed && !state.engine.is_ready().await {
        match state.engine.init(&state.paths).await {
            Ok(()) => log::info!(
                "[tts-local] 引擎惰性初始化完成（{}）",
                state.paths.root.display()
            ),
            Err(e) => log::warn!("[tts-local] 引擎初始化失败: {e}"),
        }
    }
    let voices = model_manager::list_voices(&state.paths).map_err(map_string_err)?;
    Ok(TtsLocalStatus {
        ready: state.engine.is_ready().await,
        deberta_installed,
        installed_voice_count: voices.len(),
    })
}

#[tauri::command]
pub async fn tts_local_list_catalog() -> Result<Vec<registry::AssetEntry>, AppError> {
    let all = registry::all_assets();
    // 收集所有被其他条目捆绑的资产 ID，在前端列表中隐藏它们
    let bundled: std::collections::HashSet<String> = all
        .iter()
        .flat_map(|a| a.bundled_assets.iter().cloned())
        .collect();
    Ok(all
        .into_iter()
        .filter(|a| !bundled.contains(&a.id))
        .collect())
}

#[tauri::command]
pub async fn tts_local_list_installed(
    state: State<'_, LocalTtsState>,
) -> Result<TtsLocalInstallSnapshot, AppError> {
    Ok(TtsLocalInstallSnapshot {
        assets: model_manager::list_assets(&state.paths).map_err(map_string_err)?,
        voices: model_manager::list_voices(&state.paths).map_err(map_string_err)?,
    })
}

// -- helpers ----------------------------------------------------------------

fn install_style_vectors_for(
    paths: &LocalTtsPaths,
    src: &Path,
    voice_id: &str,
) -> Result<PathBuf, String> {
    paths::copy_with_parent(src, &paths.voice_dir(voice_id).join("style_vectors.json"))
}

fn shared_asset_file_name(asset_id: &str) -> Result<&'static str, String> {
    match asset_id {
        "deberta" => Ok("deberta.onnx"),
        "deberta-tokenizer" => Ok("tokenizer.json"),
        other => Err(format!("unknown BERT asset: {other}")),
    }
}

fn download_temp_path(entry: &registry::AssetEntry, cache: &Path) -> PathBuf {
    let ext = registry::expected_extension(entry);
    cache.join(format!("{}.download.{ext}", entry.id))
}

// -- download / delete ------------------------------------------------------

#[tauri::command]
pub async fn tts_local_download(
    app: AppHandle,
    state: State<'_, LocalTtsState>,
    asset_id: String,
) -> Result<Vec<ImportResult>, AppError> {
    let entry = registry::find(&asset_id).ok_or_else(|| app_error(format!("asset {asset_id} not in catalog")))?;

    let cancel = Arc::new(CancellationToken::new());
    {
        let mut guard = state.cancel.lock().await;
        *guard = Some(cancel.clone());
    }

    // 收集所有需要下载的资产：主资产 + 捆绑资产
    let bundled_ids = entry.bundled_assets.clone();
    let mut to_download: Vec<registry::AssetEntry> = vec![entry];
    for bundled_id in &bundled_ids {
        if let Some(e) = registry::find(bundled_id) {
            to_download.push(e);
        }
    }

    let result = async {
        let mut results: Vec<ImportResult> = Vec::new();
        for entry in &to_download {
            let r = download_single_asset(&app, &state, entry, cancel.clone()).await?;
            results.push(r);
        }
        // DeBERTa 全套就位时初始化引擎（下载后一键启用：引擎即刻可用）
        if state.paths.asset_present("deberta") {
            let _ = state.engine.init(&state.paths).await;
        }
        Ok::<_, String>(results)
    }
    .await;

    {
        let mut guard = state.cancel.lock().await;
        *guard = None;
    }
    let _ = app.emit("tts://download-complete", &asset_id);
    result.map_err(map_string_err)
}

/// 下载单个资产（Bert/Voice/StyleVectors），返回 ImportResult。
async fn download_single_asset(
    app: &AppHandle,
    state: &LocalTtsState,
    entry: &registry::AssetEntry,
    cancel: Arc<CancellationToken>,
) -> Result<ImportResult, String> {
    match entry.kind {
        registry::AssetKind::Bert => {
            let file_name = shared_asset_file_name(&entry.id)?;
            let dst = state.paths.deberta_dir().join(file_name);
            std::fs::create_dir_all(state.paths.deberta_dir())
                .map_err(|e| format!("mkdir deberta: {e}"))?;
            let bytes = download::download_asset(app, entry, &dst, cancel).await?;
            Ok(ImportResult {
                asset_id: entry.id.clone(),
                voice_id: None,
                path: dst.to_string_lossy().into_owned(),
                bytes,
                message: format!("{} downloaded", entry.id),
            })
        }
        registry::AssetKind::Voice => {
            let raw_dst = download_temp_path(entry, &state.paths.cache);
            let bytes = download::download_asset(app, entry, &raw_dst, cancel).await?;
            let inspected = package::inspect_package(&raw_dst)?;
            let installed = package::install_inspected(
                &inspected,
                &raw_dst,
                &state.paths,
                &entry.id,
            )?;
            let _ = tokio::fs::remove_file(&raw_dst).await;
            Ok(ImportResult {
                asset_id: entry.id.clone(),
                voice_id: Some(entry.id.clone()),
                path: installed.to_string_lossy().into_owned(),
                bytes,
                message: "voice downloaded".into(),
            })
        }
        registry::AssetKind::StyleVectors => {
            let voice_id = entry.voice_id.clone().ok_or_else(|| {
                format!("style_vectors asset {} missing voice_id", entry.id)
            })?;
            let raw_dst = download_temp_path(entry, &state.paths.cache);
            let bytes = download::download_asset(app, entry, &raw_dst, cancel).await?;
            let installed =
                install_style_vectors_for(&state.paths, &raw_dst, &voice_id)?;
            let _ = tokio::fs::remove_file(&raw_dst).await;
            Ok(ImportResult {
                asset_id: entry.id.clone(),
                voice_id: Some(voice_id.clone()),
                path: installed.to_string_lossy().into_owned(),
                bytes,
                message: "style vectors downloaded".into(),
            })
        }
    }
}

#[tauri::command]
pub async fn tts_local_delete_voice(
    state: State<'_, LocalTtsState>,
    voice_id: String,
) -> Result<(), AppError> {
    model_manager::delete_voice(&state.paths, &voice_id).map_err(map_string_err)
}

// -- offline import ---------------------------------------------------------

/// 从本地目录离线导入模型资产（跳过网络下载）。
///
/// 源目录结构与本地 TTS 布局一致：
/// ```text
/// source_dir/
///   assets/deberta/deberta.onnx + tokenizer.json
///   voices/<voice_id>/model.onnx + style_vectors.json
/// ```
/// 复制完成后自动初始化引擎。用于把 LingChat 等已下载的资产直接迁移到花笺。
#[tauri::command]
pub async fn tts_local_import_offline(
    state: State<'_, LocalTtsState>,
    source_dir: String,
) -> Result<TtsLocalInstallSnapshot, AppError> {
    let src = PathBuf::from(source_dir.trim());
    if !src.is_dir() {
        return Err(app_error(format!(
            "source dir not found: {}",
            src.display()
        )));
    }
    import_assets_from(&state.paths, &src).map_err(map_string_err)?;
    // DeBERTa 全套就位时初始化引擎（离线导入后一键启用）
    if state.paths.asset_present("deberta") {
        let _ = state.engine.init(&state.paths).await;
    }
    Ok(TtsLocalInstallSnapshot {
        assets: model_manager::list_assets(&state.paths).map_err(map_string_err)?,
        voices: model_manager::list_voices(&state.paths).map_err(map_string_err)?,
    })
}

/// 把源目录下的 deberta 与全部 voices 复制到花笺本地 TTS 目录。
pub fn import_assets_from(paths: &LocalTtsPaths, src: &Path) -> Result<(), String> {
    // DeBERTa 共享资产
    let bert = src.join("assets").join("deberta");
    let onnx_src = bert.join("deberta.onnx");
    let tok_src = bert.join("tokenizer.json");
    if onnx_src.exists() && tok_src.exists() {
        paths::copy_with_parent(&onnx_src, &paths.deberta_dir().join("deberta.onnx"))?;
        paths::copy_with_parent(&tok_src, &paths.deberta_dir().join("tokenizer.json"))?;
    }
    // 音色：voices/<voice_id>/
    let voices_dir = src.join("voices");
    if voices_dir.is_dir() {
        for entry in std::fs::read_dir(&voices_dir)
            .map_err(|e| format!("read_dir voices: {e}"))?
        {
            let entry = entry.map_err(|e| format!("entry: {e}"))?;
            let vdir = entry.path();
            if !vdir.is_dir() {
                continue;
            }
            let voice_id = entry.file_name().to_string_lossy().into_owned();
            let model_src = vdir.join("model.onnx");
            if !model_src.exists() {
                continue;
            }
            let dst_dir = paths.voice_dir(&voice_id);
            paths::copy_with_parent(&model_src, &dst_dir.join("model.onnx"))?;
            let style_src = vdir.join("style_vectors.json");
            if style_src.exists() {
                paths::copy_with_parent(&style_src, &paths.style_vectors_path(&voice_id))?;
            }
        }
    }
    Ok(())
}

// -- synthesis --------------------------------------------------------------

/// 本地 SBV2 引擎合成预览：返回原始 WAV 字节（ipc Response，不落盘）。
#[tauri::command]
pub async fn tts_local_synthesize_preview(
    state: State<'_, LocalTtsState>,
    text: String,
    voice_id: String,
    length_scale: f32,
    sdp_ratio: f32,
) -> Result<Response, AppError> {
    if !state.engine.is_ready().await {
        if state.paths.asset_present("deberta") {
            // 惰性初始化：资产已就位但引擎尚未加载（未打开过资产面板）时，
            // 首次合成直接加载，避免"引擎未初始化"报错。
            state
                .engine
                .init(&state.paths)
                .await
                .map_err(map_string_err)?;
        } else {
            return Err(app_error(
                "local TTS engine not initialized (missing DeBERTa)".to_string(),
            ));
        }
    }
    state
        .engine
        .load_voice(&state.paths, &voice_id)
        .await
        .map_err(map_string_err)?;
    let req = SynthesizeRequest {
        voice_id,
        text,
        style_id: 0,
        speaker_id: 0,
        sdp_ratio,
        length_scale,
    };
    state
        .engine
        .synthesize(req)
        .await
        .map(Response::new)
        .map_err(map_string_err)
}
