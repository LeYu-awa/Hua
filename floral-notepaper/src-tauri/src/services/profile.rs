// 用户画像存储：写作基线 + 历史文档档案
// 支撑前端两处已完成逻辑（issue 第 2.1 节"用户档案 baseline / historyStats"）：
//   - moodDetector 的个人焦虑基线（WritingBaseline）
//   - writingReport 复盘 RAG 的历史同类文档档案（HistoricalDoc）
//
// 存储布局：
//   <base_dir>/profile/baseline.json         单个 WritingBaseline
//   <base_dir>/profile/historical_docs.json  Vec<HistoricalDoc>（按 noteId 去重）

use serde::{Deserialize, Serialize};
use std::{fs, path::PathBuf};

use super::notes::AppError;

/// 个人写作基线，字段与前端 moodDetector.WritingBaseline 对应
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WritingBaseline {
    pub delete_ratio: f64,
    pub cursor_per_min: f64,
    pub pause_per_min: f64,
}

/// 历史文档档案，字段与前端 writingReport.HistoricalDoc 对应
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct HistoricalDoc {
    pub note_id: String,
    pub title: String,
    pub summary: String,
    pub delete_ratio: f64,
}

pub struct ProfileStore {
    base_dir: PathBuf,
}

impl ProfileStore {
    pub fn new(base_dir: impl Into<PathBuf>) -> Self {
        Self {
            base_dir: base_dir.into(),
        }
    }

    fn profile_dir(&self) -> PathBuf {
        self.base_dir.join("profile")
    }

    fn baseline_path(&self) -> PathBuf {
        self.profile_dir().join("baseline.json")
    }

    fn docs_path(&self) -> PathBuf {
        self.profile_dir().join("historical_docs.json")
    }

    fn ensure_dir(&self) -> Result<(), AppError> {
        fs::create_dir_all(self.profile_dir())
            .map_err(|e| AppError::new("io", format!("创建 profile 目录失败: {e}")))
    }

    pub fn get_baseline(&self) -> Result<Option<WritingBaseline>, AppError> {
        let path = self.baseline_path();
        if !path.exists() {
            return Ok(None);
        }
        let content = fs::read_to_string(&path)
            .map_err(|e| AppError::new("io", format!("读取 baseline 失败: {e}")))?;
        if content.trim().is_empty() {
            return Ok(None);
        }
        serde_json::from_str(&content)
            .map(Some)
            .map_err(|e| AppError::new("deserialization", format!("解析 baseline 失败: {e}")))
    }

    pub fn save_baseline(&self, baseline: &WritingBaseline) -> Result<(), AppError> {
        self.ensure_dir()?;
        let json = serde_json::to_string_pretty(baseline)
            .map_err(|e| AppError::new("serialization", format!("序列化 baseline 失败: {e}")))?;
        fs::write(self.baseline_path(), json)
            .map_err(|e| AppError::new("io", format!("写入 baseline 失败: {e}")))
    }

    pub fn list_historical_docs(&self) -> Result<Vec<HistoricalDoc>, AppError> {
        let path = self.docs_path();
        if !path.exists() {
            return Ok(Vec::new());
        }
        let content = fs::read_to_string(&path)
            .map_err(|e| AppError::new("io", format!("读取历史文档失败: {e}")))?;
        if content.trim().is_empty() {
            return Ok(Vec::new());
        }
        serde_json::from_str(&content)
            .map_err(|e| AppError::new("deserialization", format!("解析历史文档失败: {e}")))
    }

    /// 追加或替换一条历史文档档案（按 noteId 去重，保留最新）。
    pub fn add_historical_doc(&self, doc: HistoricalDoc) -> Result<(), AppError> {
        self.ensure_dir()?;
        let mut docs = self.list_historical_docs()?;
        docs.retain(|d| d.note_id != doc.note_id);
        docs.push(doc);
        let json = serde_json::to_string_pretty(&docs)
            .map_err(|e| AppError::new("serialization", format!("序列化历史文档失败: {e}")))?;
        fs::write(self.docs_path(), json)
            .map_err(|e| AppError::new("io", format!("写入历史文档失败: {e}")))
    }

    pub fn clear(&self) -> Result<(), AppError> {
        let dir = self.profile_dir();
        if dir.exists() {
            fs::remove_dir_all(&dir)
                .map_err(|e| AppError::new("io", format!("清理 profile 失败: {e}")))?;
        }
        Ok(())
    }
}

#[tauri::command]
pub fn profile_get_baseline(
    store: tauri::State<ProfileStore>,
) -> Result<Option<WritingBaseline>, AppError> {
    store.get_baseline()
}

#[tauri::command]
pub fn profile_save_baseline(
    baseline: WritingBaseline,
    store: tauri::State<ProfileStore>,
) -> Result<(), AppError> {
    store.save_baseline(&baseline)
}

#[tauri::command]
pub fn profile_list_historical_docs(
    store: tauri::State<ProfileStore>,
) -> Result<Vec<HistoricalDoc>, AppError> {
    store.list_historical_docs()
}

#[tauri::command]
pub fn profile_add_historical_doc(
    doc: HistoricalDoc,
    store: tauri::State<ProfileStore>,
) -> Result<(), AppError> {
    store.add_historical_doc(doc)
}

#[tauri::command]
pub fn profile_clear(store: tauri::State<ProfileStore>) -> Result<(), AppError> {
    store.clear()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::env;
    use uuid::Uuid;

    fn temp_store() -> ProfileStore {
        let dir = env::temp_dir().join(format!("hua-profile-tests-{}", Uuid::new_v4()));
        ProfileStore::new(dir)
    }

    /// IPC 契约：前端 StoredHistoricalDoc / StoredWritingBaseline 形状必须能反序列化。
    #[test]
    fn deserializes_frontend_shapes() {
        let doc_json = r#"{"noteId":"n1","title":"标题","summary":"摘要","deleteRatio":52}"#;
        let doc: HistoricalDoc = serde_json::from_str(doc_json).expect("历史文档形状应可反序列化");
        assert_eq!(doc.note_id, "n1");
        assert_eq!(doc.delete_ratio, 52.0);

        let base_json = r#"{"deleteRatio":0.3,"cursorPerMin":5,"pausePerMin":2}"#;
        let base: WritingBaseline = serde_json::from_str(base_json).expect("基线形状应可反序列化");
        assert_eq!(base.cursor_per_min, 5.0);
    }

    #[test]
    fn test_baseline_roundtrip() {
        let store = temp_store();
        assert_eq!(store.get_baseline().unwrap(), None);

        let baseline = WritingBaseline {
            delete_ratio: 0.3,
            cursor_per_min: 5.0,
            pause_per_min: 2.0,
        };
        store.save_baseline(&baseline).unwrap();
        assert_eq!(store.get_baseline().unwrap(), Some(baseline));
    }

    #[test]
    fn test_historical_docs_dedupe_by_note_id() {
        let store = temp_store();
        store
            .add_historical_doc(HistoricalDoc {
                note_id: "n1".into(),
                title: "旧标题".into(),
                summary: "s".into(),
                delete_ratio: 50.0,
            })
            .unwrap();
        store
            .add_historical_doc(HistoricalDoc {
                note_id: "n1".into(),
                title: "新标题".into(),
                summary: "s2".into(),
                delete_ratio: 40.0,
            })
            .unwrap();
        store
            .add_historical_doc(HistoricalDoc {
                note_id: "n2".into(),
                title: "另一篇".into(),
                summary: "s3".into(),
                delete_ratio: 30.0,
            })
            .unwrap();

        let docs = store.list_historical_docs().unwrap();
        assert_eq!(docs.len(), 2);
        let n1 = docs.iter().find(|d| d.note_id == "n1").unwrap();
        assert_eq!(n1.title, "新标题");
    }

    #[test]
    fn test_clear() {
        let store = temp_store();
        store
            .save_baseline(&WritingBaseline {
                delete_ratio: 0.1,
                cursor_per_min: 1.0,
                pause_per_min: 1.0,
            })
            .unwrap();
        store.clear().unwrap();
        assert_eq!(store.get_baseline().unwrap(), None);
        assert!(store.list_historical_docs().unwrap().is_empty());
    }

    #[test]
    fn test_serialize_camel_case() {
        let doc = HistoricalDoc {
            note_id: "n1".into(),
            title: "t".into(),
            summary: "s".into(),
            delete_ratio: 20.0,
        };
        let json = serde_json::to_string(&doc).unwrap();
        assert!(
            json.contains("noteId"),
            "expected camelCase noteId, got: {json}"
        );
        assert!(
            json.contains("deleteRatio"),
            "expected camelCase deleteRatio, got: {json}"
        );
    }
}
