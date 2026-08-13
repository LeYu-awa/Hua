use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use std::{fs, path::PathBuf};
use uuid::Uuid;

use super::agent::rag;
use super::agent::vector_store::VectorStore;
use super::notes::AppError;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DiaryEntry {
    pub id: String,
    pub title: String,
    pub content: String,
    pub entry_date: NaiveDate,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub conversation_id: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub source_message_ids: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mood: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tags: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub note_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub canvas_id: Option<String>,
    #[serde(default)]
    pub word_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SaveDiaryEntryRequest {
    pub title: String,
    pub content: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub entry_date: Option<NaiveDate>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub conversation_id: Option<String>,
    #[serde(default)]
    pub source_message_ids: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mood: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub note_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub canvas_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DiaryEntrySummary {
    pub id: String,
    pub title: String,
    pub preview: String,
    pub entry_date: NaiveDate,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub conversation_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mood: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tags: Vec<String>,
    pub word_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DiaryEntryQuery {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub start_date: Option<NaiveDate>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub end_date: Option<NaiveDate>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub conversation_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub limit: Option<usize>,
}

pub struct DiaryStore {
    base_dir: PathBuf,
}

impl DiaryStore {
    pub fn new(base_dir: impl Into<PathBuf>) -> Self {
        Self {
            base_dir: base_dir.into(),
        }
    }

    fn diary_dir(&self) -> PathBuf {
        self.base_dir.join("diary")
    }

    fn entry_path(&self, id: &str) -> PathBuf {
        self.diary_dir()
            .join(format!("{}.json", sanitize_filename(id)))
    }

    pub fn create(&self, request: SaveDiaryEntryRequest) -> Result<DiaryEntry, AppError> {
        let now = Utc::now();
        let content = request.content.trim().to_string();
        if content.is_empty() {
            return Err(AppError::new("diaryContentEmpty", "日记内容不能为空"));
        }

        let title = normalized_title(&request.title, &content);
        let entry = DiaryEntry {
            id: Uuid::new_v4().to_string(),
            title,
            word_count: count_text_chars(&content),
            content,
            entry_date: request.entry_date.unwrap_or_else(|| now.date_naive()),
            created_at: now,
            updated_at: now,
            conversation_id: clean_optional(request.conversation_id),
            source_message_ids: request.source_message_ids,
            mood: clean_optional(request.mood),
            tags: normalize_tags(request.tags),
            note_id: clean_optional(request.note_id),
            canvas_id: clean_optional(request.canvas_id),
        };
        self.save_entry(&entry)?;
        Ok(entry)
    }

    pub fn get(&self, id: &str) -> Result<DiaryEntry, AppError> {
        let path = self.entry_path(id);
        if !path.exists() {
            return Err(AppError::new(
                "diaryEntryNotFound",
                format!("未找到日记: {id}"),
            ));
        }
        read_entry(&path)
    }

    pub fn list(&self, query: DiaryEntryQuery) -> Result<Vec<DiaryEntrySummary>, AppError> {
        let mut entries = self.read_all_entries()?;
        entries.retain(|entry| matches_query(entry, &query));
        entries.sort_by(|a, b| {
            b.entry_date
                .cmp(&a.entry_date)
                .then_with(|| b.created_at.cmp(&a.created_at))
        });
        if let Some(limit) = query.limit {
            entries.truncate(limit.clamp(1, 500));
        }
        Ok(entries.into_iter().map(DiaryEntrySummary::from).collect())
    }

    pub fn update(&self, id: &str, request: SaveDiaryEntryRequest) -> Result<DiaryEntry, AppError> {
        let mut entry = self.get(id)?;
        let content = request.content.trim().to_string();
        if content.is_empty() {
            return Err(AppError::new("diaryContentEmpty", "日记内容不能为空"));
        }
        entry.title = normalized_title(&request.title, &content);
        entry.content = content;
        entry.word_count = count_text_chars(&entry.content);
        if let Some(entry_date) = request.entry_date {
            entry.entry_date = entry_date;
        }
        entry.conversation_id = clean_optional(request.conversation_id);
        entry.source_message_ids = request.source_message_ids;
        entry.mood = clean_optional(request.mood);
        entry.tags = normalize_tags(request.tags);
        entry.note_id = clean_optional(request.note_id);
        entry.canvas_id = clean_optional(request.canvas_id);
        entry.updated_at = Utc::now();
        self.save_entry(&entry)?;
        Ok(entry)
    }

    pub fn delete(&self, id: &str) -> Result<(), AppError> {
        let path = self.entry_path(id);
        if path.exists() {
            fs::remove_file(&path)
                .map_err(|error| AppError::new("io", format!("删除日记失败: {error}")))?;
        }
        Ok(())
    }

    fn save_entry(&self, entry: &DiaryEntry) -> Result<(), AppError> {
        let dir = self.diary_dir();
        fs::create_dir_all(&dir)
            .map_err(|error| AppError::new("io", format!("创建日记目录失败: {error}")))?;
        let json = serde_json::to_string_pretty(entry)
            .map_err(|error| AppError::new("serialization", format!("序列化日记失败: {error}")))?;
        fs::write(self.entry_path(&entry.id), json)
            .map_err(|error| AppError::new("io", format!("写入日记失败: {error}")))
    }

    fn read_all_entries(&self) -> Result<Vec<DiaryEntry>, AppError> {
        let dir = self.diary_dir();
        if !dir.exists() {
            return Ok(Vec::new());
        }

        let mut entries = Vec::new();
        for entry in fs::read_dir(&dir)
            .map_err(|error| AppError::new("io", format!("读取日记目录失败: {error}")))?
        {
            let entry = entry
                .map_err(|error| AppError::new("io", format!("读取日记目录项失败: {error}")))?;
            let path = entry.path();
            if path.extension().and_then(|value| value.to_str()) != Some("json") {
                continue;
            }
            if let Ok(diary_entry) = read_entry(&path) {
                entries.push(diary_entry);
            }
        }
        Ok(entries)
    }
}

impl From<DiaryEntry> for DiaryEntrySummary {
    fn from(entry: DiaryEntry) -> Self {
        Self {
            preview: make_preview(&entry.content),
            id: entry.id,
            title: entry.title,
            entry_date: entry.entry_date,
            created_at: entry.created_at,
            updated_at: entry.updated_at,
            conversation_id: entry.conversation_id,
            mood: entry.mood,
            tags: entry.tags,
            word_count: entry.word_count,
        }
    }
}

fn read_entry(path: &PathBuf) -> Result<DiaryEntry, AppError> {
    let json = fs::read_to_string(path)
        .map_err(|error| AppError::new("io", format!("读取日记失败: {error}")))?;
    serde_json::from_str(&json)
        .map_err(|error| AppError::new("deserialization", format!("解析日记失败: {error}")))
}

fn matches_query(entry: &DiaryEntry, query: &DiaryEntryQuery) -> bool {
    if let Some(start) = query.start_date {
        if entry.entry_date < start {
            return false;
        }
    }
    if let Some(end) = query.end_date {
        if entry.entry_date > end {
            return false;
        }
    }
    if let Some(conversation_id) = &query.conversation_id {
        if entry.conversation_id.as_deref() != Some(conversation_id.as_str()) {
            return false;
        }
    }
    true
}

fn normalized_title(title: &str, content: &str) -> String {
    let trimmed = title.trim();
    if !trimmed.is_empty() {
        return trimmed.chars().take(80).collect();
    }
    content
        .lines()
        .find(|line| !line.trim().is_empty())
        .unwrap_or("今天的记录")
        .trim()
        .chars()
        .take(30)
        .collect()
}

fn make_preview(content: &str) -> String {
    content
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .chars()
        .take(120)
        .collect()
}

fn count_text_chars(content: &str) -> usize {
    content
        .chars()
        .filter(|value| !value.is_whitespace())
        .count()
}

fn clean_optional(value: Option<String>) -> Option<String> {
    value
        .map(|text| text.trim().to_string())
        .filter(|text| !text.is_empty())
}

fn normalize_tags(tags: Vec<String>) -> Vec<String> {
    let mut normalized = Vec::new();
    for tag in tags {
        let clean = tag.trim();
        if !clean.is_empty() && !normalized.iter().any(|item: &String| item == clean) {
            normalized.push(clean.to_string());
        }
    }
    normalized
}

fn sanitize_filename(name: &str) -> String {
    name.chars()
        .map(|value| match value {
            '\\' | '/' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
            _ => value,
        })
        .collect()
}

#[tauri::command]
pub async fn diary_create(
    request: SaveDiaryEntryRequest,
    store: tauri::State<'_, DiaryStore>,
    vectors: tauri::State<'_, VectorStore>,
) -> Result<DiaryEntry, AppError> {
    let entry = store.create(request)?;
    // 记忆写入：日记落盘即入向量库（best-effort，失败不影响落盘）
    if let Err(error) =
        rag::index_source(&vectors, &format!("diary:{}", entry.id), &entry.content).await
    {
        log::debug!("[memory] 索引日记失败: {}", error.message);
    }
    Ok(entry)
}

#[tauri::command]
pub fn diary_get(id: String, store: tauri::State<DiaryStore>) -> Result<DiaryEntry, AppError> {
    store.get(&id)
}

#[tauri::command]
pub fn diary_list(
    query: Option<DiaryEntryQuery>,
    store: tauri::State<DiaryStore>,
) -> Result<Vec<DiaryEntrySummary>, AppError> {
    store.list(query.unwrap_or_default())
}

#[tauri::command]
pub async fn diary_update(
    id: String,
    request: SaveDiaryEntryRequest,
    store: tauri::State<'_, DiaryStore>,
    vectors: tauri::State<'_, VectorStore>,
) -> Result<DiaryEntry, AppError> {
    let entry = store.update(&id, request)?;
    // 记忆更新：内容变更后重索引（先删源再写入）
    if let Err(error) =
        rag::index_source(&vectors, &format!("diary:{}", entry.id), &entry.content).await
    {
        log::debug!("[memory] 重索引日记失败: {}", error.message);
    }
    Ok(entry)
}

#[tauri::command]
pub fn diary_delete(
    id: String,
    store: tauri::State<DiaryStore>,
    vectors: tauri::State<'_, VectorStore>,
) -> Result<(), AppError> {
    store.delete(&id)?;
    let _ = vectors.delete_source_all_models(&format!("diary:{id}"));
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::env;

    fn temp_store(name: &str) -> DiaryStore {
        let dir = env::temp_dir().join(format!("hua-diary-tests-{}-{}", name, Uuid::new_v4()));
        DiaryStore::new(dir)
    }

    fn request(title: &str, content: &str, date: &str) -> SaveDiaryEntryRequest {
        SaveDiaryEntryRequest {
            title: title.into(),
            content: content.into(),
            entry_date: Some(NaiveDate::parse_from_str(date, "%Y-%m-%d").unwrap()),
            conversation_id: Some("conv-1".into()),
            source_message_ids: vec!["m1".into(), "m2".into()],
            mood: Some("curious".into()),
            tags: vec![" 写作 ".into(), "写作".into(), "灵感".into()],
            note_id: None,
            canvas_id: None,
        }
    }

    #[test]
    fn creates_and_reads_diary_entry() {
        let store = temp_store("crud");
        let created = store
            .create(request("", "今天聊到了一个新的角色动机。", "2026-08-09"))
            .unwrap();

        assert_eq!(created.title, "今天聊到了一个新的角色动机。");
        assert_eq!(created.entry_date.to_string(), "2026-08-09");
        assert_eq!(created.word_count, 14);
        assert_eq!(created.tags, vec!["写作", "灵感"]);

        let loaded = store.get(&created.id).unwrap();
        assert_eq!(loaded, created);
    }

    #[test]
    fn lists_by_date_and_conversation() {
        let store = temp_store("query");
        let older = store
            .create(request("旧记录", "旧内容", "2026-08-01"))
            .unwrap();
        let newer = store
            .create(request("新记录", "新内容", "2026-08-09"))
            .unwrap();
        let other = store
            .create(SaveDiaryEntryRequest {
                conversation_id: Some("conv-2".into()),
                ..request("其他对话", "其他内容", "2026-08-09")
            })
            .unwrap();

        let listed = store
            .list(DiaryEntryQuery {
                start_date: Some(NaiveDate::from_ymd_opt(2026, 8, 2).unwrap()),
                end_date: Some(NaiveDate::from_ymd_opt(2026, 8, 9).unwrap()),
                conversation_id: Some("conv-1".into()),
                limit: None,
            })
            .unwrap();

        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].id, newer.id);
        assert_ne!(listed[0].id, older.id);
        assert_ne!(listed[0].id, other.id);
    }

    #[test]
    fn updates_and_deletes_entry() {
        let store = temp_store("update");
        let created = store
            .create(request("原始", "原始内容", "2026-08-09"))
            .unwrap();
        let updated = store
            .update(&created.id, request("更新", "更新后的内容", "2026-08-10"))
            .unwrap();

        assert_eq!(updated.title, "更新");
        assert_eq!(updated.entry_date.to_string(), "2026-08-10");
        assert!(updated.updated_at >= updated.created_at);

        store.delete(&created.id).unwrap();
        assert!(store.get(&created.id).is_err());
    }

    #[test]
    fn rejects_empty_content() {
        let store = temp_store("empty");
        let error = store
            .create(request("空", "   ", "2026-08-09"))
            .unwrap_err();
        assert_eq!(error.code, "diaryContentEmpty");
    }
}
