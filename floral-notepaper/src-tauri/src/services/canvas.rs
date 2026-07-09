use serde::{Deserialize, Serialize};
use std::{fs, path::PathBuf};

use super::notes::AppError;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CanvasNode {
    pub id: String,
    pub node_type: String,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub text: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CanvasEdge {
    pub id: String,
    pub from_node_id: String,
    pub to_node_id: String,
    pub style: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CanvasDocument {
    pub id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub note_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub co_write_session_id: Option<String>,
    pub nodes: Vec<CanvasNode>,
    pub edges: Vec<CanvasEdge>,
}

pub struct CanvasStore {
    base_dir: PathBuf,
}

impl CanvasStore {
    pub fn new(base_dir: impl Into<PathBuf>) -> Self {
        Self {
            base_dir: base_dir.into(),
        }
    }

    fn canvas_dir(&self) -> PathBuf {
        self.base_dir.join("canvas")
    }

    fn doc_path(&self, id: &str) -> PathBuf {
        self.canvas_dir()
            .join(format!("{}.json", sanitize_filename(id)))
    }

    pub fn save(&self, doc: CanvasDocument) -> Result<CanvasDocument, AppError> {
        let dir = self.canvas_dir();
        fs::create_dir_all(&dir)
            .map_err(|e| AppError::new("io", format!("创建 canvas 目录失败: {e}")))?;

        let path = self.doc_path(&doc.id);
        let json = serde_json::to_string_pretty(&doc)
            .map_err(|e| AppError::new("serialization", format!("序列化 canvas 失败: {e}")))?;
        fs::write(&path, json)
            .map_err(|e| AppError::new("io", format!("写入 canvas 失败: {e}")))?;

        Ok(doc)
    }

    pub fn get(&self, id: &str) -> Result<CanvasDocument, AppError> {
        let path = self.doc_path(id);
        if !path.exists() {
            return Err(AppError::new("canvasNotFound", format!("未找到画布: {id}")));
        }
        let json = fs::read_to_string(&path)
            .map_err(|e| AppError::new("io", format!("读取 canvas 失败: {e}")))?;
        serde_json::from_str(&json)
            .map_err(|e| AppError::new("deserialization", format!("解析 canvas 失败: {e}")))
    }

    pub fn delete(&self, id: &str) -> Result<(), AppError> {
        let path = self.doc_path(id);
        if path.exists() {
            fs::remove_file(&path)
                .map_err(|e| AppError::new("io", format!("删除 canvas 失败: {e}")))?;
        }
        Ok(())
    }

    pub fn list(&self) -> Result<Vec<CanvasDocument>, AppError> {
        let dir = self.canvas_dir();
        if !dir.exists() {
            return Ok(Vec::new());
        }

        let mut docs = Vec::new();
        for entry in fs::read_dir(&dir)
            .map_err(|e| AppError::new("io", format!("读取 canvas 目录失败: {e}")))?
        {
            let entry =
                entry.map_err(|e| AppError::new("io", format!("读取 canvas 目录项失败: {e}")))?;
            let path = entry.path();
            if path.extension().and_then(|s| s.to_str()) != Some("json") {
                continue;
            }
            let json = fs::read_to_string(&path)
                .map_err(|e| AppError::new("io", format!("读取 canvas 文件失败: {e}")))?;
            if let Ok(doc) = serde_json::from_str::<CanvasDocument>(&json) {
                docs.push(doc);
            }
        }

        docs.sort_by(|a, b| b.id.cmp(&a.id));
        Ok(docs)
    }
}

fn sanitize_filename(name: &str) -> String {
    name.chars()
        .map(|c| match c {
            '\\' | '/' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
            _ => c,
        })
        .collect()
}

#[tauri::command]
pub fn canvas_save(
    doc: CanvasDocument,
    store: tauri::State<CanvasStore>,
) -> Result<CanvasDocument, AppError> {
    store.save(doc)
}

#[tauri::command]
pub fn canvas_get(
    id: String,
    store: tauri::State<CanvasStore>,
) -> Result<CanvasDocument, AppError> {
    store.get(&id)
}

#[tauri::command]
pub fn canvas_delete(id: String, store: tauri::State<CanvasStore>) -> Result<(), AppError> {
    store.delete(&id)
}

#[tauri::command]
pub fn canvas_list(store: tauri::State<CanvasStore>) -> Result<Vec<CanvasDocument>, AppError> {
    store.list()
}
