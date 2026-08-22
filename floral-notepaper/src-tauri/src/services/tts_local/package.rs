// Inspect + install model packages.
//
// 移植自 LingChat（MIT）。当前资产目录仅包含 .onnx / .json 直链
// （DeBERTa、Ling-v2、style_vectors），因此仅保留原始 SBV2/ONNX 文件
// 的安装路径；zip/7z 压缩包导入暂不移植（避免引入解压依赖）。
//
// 目录内文件名固定为 `model.sbv2` / `model.onnx` / `style_vectors.json`。

use std::path::{Path, PathBuf};
use serde::{Deserialize, Serialize};

use super::paths::LocalTtsPaths;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PackageKind {
    RawSbv2,
    RawOnnx,
    Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InspectedPackage {
    pub kind: PackageKind,
    pub file_name: String,
    pub size_bytes: u64,
}

/// Cheap extension-first sniff.
pub fn detect_by_extension(path: &Path) -> PackageKind {
    let ext = path
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_lowercase();
    match ext.as_str() {
        "sbv2" => PackageKind::RawSbv2,
        "onnx" => PackageKind::RawOnnx,
        _ => PackageKind::Unknown,
    }
}

pub fn inspect_package(path: &Path) -> std::result::Result<InspectedPackage, String> {
    let meta = std::fs::metadata(path).map_err(|e| format!("metadata: {e}"))?;
    let size_bytes = meta.len();
    let file_name = path
        .file_name()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_default();

    let kind = detect_by_extension(path);

    Ok(InspectedPackage {
        kind,
        file_name,
        size_bytes,
    })
}

/// Install inspected package into the voice directory.
pub fn install_inspected(
    inspected: &InspectedPackage,
    src: &Path,
    paths: &LocalTtsPaths,
    voice_id: &str,
) -> std::result::Result<PathBuf, String> {
    let dst = paths.voice_dir(voice_id);
    std::fs::create_dir_all(&dst).map_err(|e| format!("create voice dir: {e}"))?;

    match inspected.kind {
        PackageKind::RawSbv2 => {
            super::paths::copy_with_parent(src, &dst.join("model.sbv2"))
        }
        PackageKind::RawOnnx => {
            super::paths::copy_with_parent(src, &dst.join("model.onnx"))
        }
        PackageKind::Unknown => Err(format!(
            "unsupported package format (only .sbv2 / .onnx): {}",
            inspected.file_name
        )),
    }
}
