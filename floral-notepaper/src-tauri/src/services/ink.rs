use serde::{Deserialize, Serialize};
use std::{
    fs::{self, File, OpenOptions},
    io::{BufRead, BufReader, Write},
    path::{Path, PathBuf},
};

use super::notes::AppError;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct InkEvent {
    pub id: String,
    pub session_id: String,
    pub note_id: String,
    pub source: String,
    #[serde(rename = "type")]
    pub event_type: String,
    pub index: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub length: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub selection_start: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub selection_end: Option<i64>,
    pub timestamp: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct InkSessionSummary {
    pub id: String,
    pub note_id: String,
    pub source: String,
    pub started_at: i64,
    pub ended_at: Option<i64>,
    pub event_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct InkSession {
    #[serde(flatten)]
    pub summary: InkSessionSummary,
    pub events: Vec<InkEvent>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AppendInkEventsRequest {
    pub note_id: String,
    pub session_id: String,
    pub source: String,
    pub events: Vec<InkEvent>,
}

pub struct InkStore {
    base_dir: PathBuf,
}

impl InkStore {
    pub fn new(base_dir: impl Into<PathBuf>) -> Self {
        Self {
            base_dir: base_dir.into(),
        }
    }

    fn ink_dir(&self) -> PathBuf {
        self.base_dir.join("ink")
    }

    fn note_ink_dir(&self, note_id: &str) -> PathBuf {
        self.ink_dir().join(sanitize_filename(note_id))
    }

    fn session_path(&self, note_id: &str, session_id: &str) -> PathBuf {
        self.note_ink_dir(note_id)
            .join(format!("{}.jsonl", sanitize_filename(session_id)))
    }

    pub fn append_events(&self, request: AppendInkEventsRequest) -> Result<(), AppError> {
        if request.events.is_empty() {
            return Ok(());
        }

        let dir = self.note_ink_dir(&request.note_id);
        fs::create_dir_all(&dir)
            .map_err(|e| AppError::new("io", format!("创建 ink 目录失败: {e}")))?;

        let path = dir.join(format!("{}.jsonl", sanitize_filename(&request.session_id)));
        let mut file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&path)
            .map_err(|e| AppError::new("io", format!("打开 ink 文件失败: {e}")))?;

        for event in request.events {
            let line = serde_json::to_string(&event)
                .map_err(|e| AppError::new("serialization", format!("序列化 ink 事件失败: {e}")))?;
            writeln!(file, "{line}")
                .map_err(|e| AppError::new("io", format!("写入 ink 事件失败: {e}")))?;
        }

        Ok(())
    }

    pub fn list_sessions(&self, note_id: &str) -> Result<Vec<InkSessionSummary>, AppError> {
        let dir = self.note_ink_dir(note_id);
        if !dir.exists() {
            return Ok(Vec::new());
        }

        let mut summaries = Vec::new();
        for entry in fs::read_dir(&dir)
            .map_err(|e| AppError::new("io", format!("读取 ink 目录失败: {e}")))?
        {
            let entry =
                entry.map_err(|e| AppError::new("io", format!("读取 ink 目录项失败: {e}")))?;
            let path = entry.path();
            if path.extension().and_then(|s| s.to_str()) != Some("jsonl") {
                continue;
            }

            let session_id = path
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("")
                .to_string();
            if session_id.is_empty() {
                continue;
            }

            let (started_at, ended_at, event_count, source) = Self::scan_session_file(&path)?;
            summaries.push(InkSessionSummary {
                id: session_id,
                note_id: note_id.to_string(),
                source: source.unwrap_or_else(|| "main".to_string()),
                started_at,
                ended_at,
                event_count,
            });
        }

        summaries.sort_by_key(|summary| std::cmp::Reverse(summary.started_at));
        Ok(summaries)
    }

    pub fn get_session(&self, note_id: &str, session_id: &str) -> Result<InkSession, AppError> {
        let path = self.session_path(note_id, session_id);
        if !path.exists() {
            return Err(AppError::new(
                "inkSessionNotFound",
                format!("未找到 ink session: {session_id}"),
            ));
        }

        let (started_at, ended_at, event_count, source) = Self::scan_session_file(&path)?;
        let file = File::open(&path)
            .map_err(|e| AppError::new("io", format!("打开 ink 文件失败: {e}")))?;
        let reader = BufReader::new(file);
        let mut events = Vec::with_capacity(event_count);

        for line in reader.lines() {
            let line = line.map_err(|e| AppError::new("io", format!("读取 ink 文件失败: {e}")))?;
            if line.trim().is_empty() {
                continue;
            }
            let event: InkEvent = serde_json::from_str(&line)
                .map_err(|e| AppError::new("deserialization", format!("解析 ink 事件失败: {e}")))?;
            events.push(event);
        }

        Ok(InkSession {
            summary: InkSessionSummary {
                id: session_id.to_string(),
                note_id: note_id.to_string(),
                source: source.unwrap_or_else(|| "main".to_string()),
                started_at,
                ended_at,
                event_count: events.len(),
            },
            events,
        })
    }

    pub fn clear_note_ink(&self, note_id: &str) -> Result<(), AppError> {
        let dir = self.note_ink_dir(note_id);
        if dir.exists() {
            fs::remove_dir_all(&dir)
                .map_err(|e| AppError::new("io", format!("清理 ink 目录失败: {e}")))?;
        }
        Ok(())
    }

    pub fn clear_all_ink(&self) -> Result<(), AppError> {
        let dir = self.ink_dir();
        if dir.exists() {
            fs::remove_dir_all(&dir)
                .map_err(|e| AppError::new("io", format!("清理 ink 目录失败: {e}")))?;
        }
        Ok(())
    }

    fn scan_session_file(
        path: &Path,
    ) -> Result<(i64, Option<i64>, usize, Option<String>), AppError> {
        let file =
            File::open(path).map_err(|e| AppError::new("io", format!("打开 ink 文件失败: {e}")))?;
        let reader = BufReader::new(file);
        let mut started_at: Option<i64> = None;
        let mut ended_at: Option<i64> = None;
        let mut count = 0usize;
        let mut source: Option<String> = None;

        for line in reader.lines() {
            let line = line.map_err(|e| AppError::new("io", format!("读取 ink 文件失败: {e}")))?;
            if line.trim().is_empty() {
                continue;
            }
            let event: InkEvent = serde_json::from_str(&line)
                .map_err(|e| AppError::new("deserialization", format!("解析 ink 事件失败: {e}")))?;

            if started_at.is_none() {
                started_at = Some(event.timestamp);
            }
            ended_at = Some(event.timestamp);
            if source.is_none() {
                source = Some(event.source.clone());
            }
            count += 1;
        }

        Ok((started_at.unwrap_or(0), ended_at, count, source))
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
pub fn ink_append_events(
    request: AppendInkEventsRequest,
    store: tauri::State<InkStore>,
) -> Result<(), AppError> {
    store.append_events(request)
}

#[tauri::command]
pub fn ink_list_sessions(
    note_id: String,
    store: tauri::State<InkStore>,
) -> Result<Vec<InkSessionSummary>, AppError> {
    store.list_sessions(&note_id)
}

#[tauri::command]
pub fn ink_get_session(
    note_id: String,
    session_id: String,
    store: tauri::State<InkStore>,
) -> Result<InkSession, AppError> {
    store.get_session(&note_id, &session_id)
}

#[tauri::command]
pub fn ink_clear(note_id: Option<String>, store: tauri::State<InkStore>) -> Result<(), AppError> {
    match note_id {
        Some(id) => store.clear_note_ink(&id),
        None => store.clear_all_ink(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::env;
    use uuid::Uuid;

    fn temp_store() -> InkStore {
        let dir = env::temp_dir().join(format!("hua-ink-tests-{}", Uuid::new_v4()));
        InkStore::new(dir)
    }

    fn event(id: &str, session_id: &str, note_id: &str, timestamp: i64) -> InkEvent {
        InkEvent {
            id: id.to_string(),
            session_id: session_id.to_string(),
            note_id: note_id.to_string(),
            source: "main".to_string(),
            event_type: "insert".to_string(),
            index: 0,
            text: Some("x".to_string()),
            length: None,
            selection_start: None,
            selection_end: None,
            timestamp,
        }
    }

    #[test]
    fn test_append_and_list_sessions() {
        let store = temp_store();
        let req = AppendInkEventsRequest {
            note_id: "n1".to_string(),
            session_id: "s1".to_string(),
            source: "main".to_string(),
            events: vec![event("e1", "s1", "n1", 1000), event("e2", "s1", "n1", 2000)],
        };
        store.append_events(req).unwrap();

        let sessions = store.list_sessions("n1").unwrap();
        assert_eq!(sessions.len(), 1);
        assert_eq!(sessions[0].event_count, 2);
        assert_eq!(sessions[0].started_at, 1000);
        assert_eq!(sessions[0].ended_at, Some(2000));
    }

    #[test]
    fn test_get_session() {
        let store = temp_store();
        let req = AppendInkEventsRequest {
            note_id: "n1".to_string(),
            session_id: "s1".to_string(),
            source: "main".to_string(),
            events: vec![event("e1", "s1", "n1", 1000)],
        };
        store.append_events(req).unwrap();

        let session = store.get_session("n1", "s1").unwrap();
        assert_eq!(session.events.len(), 1);
        assert_eq!(session.events[0].id, "e1");
    }

    #[test]
    fn test_event_serializes_type_field_for_frontend() {
        let ev = event("e1", "s1", "n1", 1000);
        let json = serde_json::to_string(&ev).unwrap();
        assert!(
            json.contains("\"type\""),
            "InkEvent must serialize event_type as \"type\" for the frontend, got: {json}"
        );
        assert!(
            !json.contains("eventType"),
            "InkEvent must NOT serialize as camelCase \"eventType\", got: {json}"
        );
        // 反向验证：前端发来的 JSON 用 type 字段，Rust 能反序列化
        let front_json = r#"{"id":"e1","sessionId":"s1","noteId":"n1","source":"main","type":"insert","index":0,"timestamp":1000}"#;
        let parsed: InkEvent = serde_json::from_str(front_json).unwrap();
        assert_eq!(parsed.event_type, "insert");
    }

    #[test]
    fn test_clear_note_ink() {
        let store = temp_store();
        store
            .append_events(AppendInkEventsRequest {
                note_id: "n1".to_string(),
                session_id: "s1".to_string(),
                source: "main".to_string(),
                events: vec![event("e1", "s1", "n1", 1000)],
            })
            .unwrap();

        store.clear_note_ink("n1").unwrap();
        assert!(store.list_sessions("n1").unwrap().is_empty());
    }
}
