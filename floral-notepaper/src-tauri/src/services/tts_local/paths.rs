// Filesystem layout for local TTS assets.
//
// - `<models_root>/tts-local/`       root（默认 D:\花箴\models\tts-local）
// - `<models_root>/tts-local/assets/` DeBerta + tokenizer shared assets
// - `<models_root>/tts-local/voices/` one subdir per voice
// - `<models_root>/tts-local/cache/`  temp (decompression, downloads)
//
// 移植自 LingChat（MIT）。按用户要求，TTS 资产与缓存全部放 D 盘，
// 避免占用 C 盘空间；可通过 FLORAL_NOTEPAPER_TTS_DIR 环境变量覆盖根目录。

use std::path::{Path, PathBuf};
use tauri::AppHandle;

#[allow(dead_code)] // reserved for callers that validate all required local assets
pub const REQUIRED_ASSETS: &[&str] = &["deberta"];

#[derive(Debug, Clone)]
pub struct LocalTtsPaths {
    pub root: PathBuf,
    pub assets: PathBuf,
    pub voices: PathBuf,
    pub cache: PathBuf,
}

impl LocalTtsPaths {
    pub fn resolve(_app: &AppHandle) -> std::result::Result<Self, String> {
        // resolve_models_root 返回模型资产根（如 D:\花箴\models）
        let models_root = resolve_models_root()?;
        let root = models_root.join("tts-local");
        let assets = root.join("assets");
        let voices = root.join("voices");
        let cache = root.join("cache");
        Ok(Self { root, assets, voices, cache })
    }

    pub fn ensure(&self) -> std::result::Result<(), String> {
        ensure_dirs(&[&self.root, &self.assets, &self.voices, &self.cache])
    }

    pub fn deberta_dir(&self) -> PathBuf {
        self.assets.join("deberta")
    }

    pub fn voice_dir(&self, voice_id: &str) -> PathBuf {
        self.voices.join(voice_id)
    }

    pub fn style_vectors_path(&self, voice_id: &str) -> PathBuf {
        self.voices.join(voice_id).join("style_vectors.json")
    }

    pub fn asset_present(&self, asset_id: &str) -> bool {
        match asset_id {
            "deberta" => {
                let d = self.deberta_dir();
                d.join("deberta.onnx").exists() && d.join("tokenizer.json").exists()
            }
            _ => false,
        }
    }
}

/// 模型资产根目录（默认 D:\花箴\models，可用 FLORAL_NOTEPAPER_TTS_DIR 覆盖）。
/// emotion 等模型目录复用它，保证所有大体积模型资产都在 D 盘。
pub fn resolve_models_root() -> std::result::Result<PathBuf, String> {
    // 1) 环境变量显式指定根目录
    if let Ok(dir) = std::env::var("FLORAL_NOTEPAPER_TTS_DIR") {
        let trimmed = dir.trim();
        if !trimmed.is_empty() {
            return Ok(PathBuf::from(trimmed));
        }
    }
    // 2) 默认放 D 盘：D:\花箴\models（日语模型体积大，避免占用 C 盘空间）
    Ok(PathBuf::from(r"D:\花箴\models"))
}

/// 批量创建目录，任一失败返回错误。
pub fn ensure_dirs(dirs: &[&Path]) -> std::result::Result<(), String> {
    for dir in dirs {
        std::fs::create_dir_all(dir).map_err(|e| format!("mkdir {}: {e}", dir.display()))?;
    }
    Ok(())
}

/// 复制文件并自动创建父目录。
pub fn copy_with_parent(src: &Path, dst: &Path) -> std::result::Result<PathBuf, String> {
    if let Some(parent) = dst.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("mkdir {}: {e}", parent.display()))?;
    }
    std::fs::copy(src, dst).map_err(|e| format!("copy {} -> {}: {e}", src.display(), dst.display()))?;
    Ok(dst.to_path_buf())
}
