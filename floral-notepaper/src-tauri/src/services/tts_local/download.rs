//! TTS 资产下载器（移植自 LingChat，MIT）。
//!
//! 流式 HTTP 下载 + 进度回调 + 取消令牌 + 原子写入：
//! 写入 `.part` 临时文件后原子 `rename` 到目标路径，避免半成品文件被误用。

use std::path::Path;
use std::sync::Arc;
use std::time::{Duration, Instant};

use futures_util::StreamExt;
use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tokio_util::sync::CancellationToken;

use super::registry::AssetEntry;

/// TTS 专用的下载进度结构（包含 `asset_id` 供前端识别）。
#[derive(Debug, Clone, Serialize)]
pub struct DownloadProgress {
    pub asset_id: String,
    pub bytes_done: u64,
    pub total_bytes: u64,
    pub percent: f32,
}

/// 通用下载进度快照，由 `download_to_file` 通过回调推送。
#[derive(Debug, Clone)]
pub struct CoreProgress {
    pub bytes_done: u64,
    pub total_bytes: u64,
    pub percent: f32,
}

impl CoreProgress {
    fn new(bytes_done: u64, total_bytes: u64) -> Self {
        let percent = if total_bytes > 0 {
            (bytes_done as f64 * 100.0 / total_bytes as f64).min(100.0) as f32
        } else {
            0.0
        };
        Self { bytes_done, total_bytes, percent }
    }

    fn finished(total_bytes: u64) -> Self {
        Self { bytes_done: total_bytes, total_bytes, percent: 100.0 }
    }
}

/// 进度回调节流常量：200ms 或 1MB，避免高频事件淹没前端。
const PROGRESS_EMIT_INTERVAL: Duration = Duration::from_millis(200);
const PROGRESS_EMIT_BYTES: u64 = 1024 * 1024;

fn progress_update_due(elapsed: Duration, bytes_since_last: u64) -> bool {
    elapsed >= PROGRESS_EMIT_INTERVAL || bytes_since_last >= PROGRESS_EMIT_BYTES
}

/// 懒加载的 HTTP 客户端，避免每次下载都重建连接池。
fn download_client() -> &'static reqwest::Client {
    use std::sync::OnceLock;
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .timeout(Duration::from_secs(600))
            .user_agent("floral-notepaper/1.0")
            .redirect(reqwest::redirect::Policy::limited(10))
            .build()
            .expect("build download client")
    })
}

/// 流式下载文件到磁盘，写入 `.part` 临时文件后原子 rename 到 `dest`。
async fn download_to_file(
    url: &str,
    dest: &Path,
    cancel: Option<Arc<CancellationToken>>,
    progress: Option<Arc<dyn Fn(CoreProgress) + Send + Sync>>,
    expected_size: u64,
) -> Result<u64, String> {
    if let Some(parent) = dest.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| format!("mkdir: {e}"))?;
    }

    let tmp = dest.with_extension("part");

    let resp = download_client()
        .get(url)
        .header(reqwest::header::ACCEPT, "*/*")
        .send()
        .await
        .map_err(|e| format!("request: {e}"))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let final_url = resp.url().to_string();
        let body = resp
            .text()
            .await
            .unwrap_or_else(|_| "<unreadable response body>".into());
        let body = body.trim();
        let snippet = if body.len() > 512 {
            format!("{}...", &body[..512])
        } else {
            body.to_string()
        };
        return Err(format!("HTTP {status} from {final_url}: {snippet}"));
    }

    let total = resp.content_length().unwrap_or(expected_size);
    let mut stream = resp.bytes_stream();
    let mut file = tokio::fs::File::create(&tmp)
        .await
        .map_err(|e| format!("create tmp: {e}"))?;

    let mut bytes_done: u64 = 0;
    let mut last_emit = Instant::now();
    let mut last_emitted_bytes: u64 = 0;

    while let Some(chunk) = stream.next().await {
        if let Some(ref token) = cancel {
            if token.is_cancelled() {
                let _ = tokio::fs::remove_file(&tmp).await;
                return Err("download cancelled".into());
            }
        }

        let chunk = chunk.map_err(|e| format!("chunk: {e}"))?;
        tokio::io::AsyncWriteExt::write_all(&mut file, &chunk)
            .await
            .map_err(|e| format!("write: {e}"))?;
        bytes_done += chunk.len() as u64;

        let now = Instant::now();
        if progress_update_due(
            now.duration_since(last_emit),
            bytes_done.saturating_sub(last_emitted_bytes),
        ) {
            if let Some(ref cb) = progress {
                cb(CoreProgress::new(bytes_done, total));
            }
            last_emit = now;
            last_emitted_bytes = bytes_done;
        }
    }

    tokio::io::AsyncWriteExt::shutdown(&mut file)
        .await
        .map_err(|e| format!("shutdown: {e}"))?;
    tokio::fs::rename(&tmp, dest)
        .await
        .map_err(|e| format!("rename: {e}"))?;

    if let Some(ref cb) = progress {
        cb(CoreProgress::finished(bytes_done));
    }

    Ok(bytes_done)
}

/// 下载一个 TTS 资产到磁盘，向 Tauri 前端发射进度事件。
pub async fn download_asset(
    app: &AppHandle,
    entry: &AssetEntry,
    dst: &Path,
    cancel: Arc<CancellationToken>,
) -> Result<u64, String> {
    let asset_id = entry.id.clone();

    // 通过 Arc 闭包将通用进度转为 Tauri 事件（Arc 保证 Send + Sync）
    let app_for_progress = app.clone();
    let entry_id = asset_id.clone();
    let on_progress: Arc<dyn Fn(CoreProgress) + Send + Sync> = Arc::new(move |p| {
        let _ = app_for_progress.emit(
            "tts://download-progress",
            DownloadProgress {
                asset_id: entry_id.clone(),
                bytes_done: p.bytes_done,
                total_bytes: p.total_bytes,
                percent: p.percent,
            },
        );
    });

    download_to_file(
        &entry.download_url,
        dst,
        Some(cancel),
        Some(on_progress),
        entry.size_bytes,
    )
    .await
}
