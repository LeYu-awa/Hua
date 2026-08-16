use chrono::{DateTime, Duration, Utc};
use reqwest::Url;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::sync::Mutex as StdMutex;
use std::{fs, path::Path};
use uuid::Uuid;

use super::notes::{default_store, AppError, Note, NoteMetadata, SaveNoteRequest};

const MAX_LOGS: usize = 500;
const MAX_NOTE_CHANGES: usize = 200;
const SEARCH_LIMIT_DEFAULT: usize = 5;
const SEARCH_LIMIT_MAX: usize = 8;

/// 序列化工具日志 / 笔记变更记录的读-改-写，避免并发（多会话/限流统计）互相覆盖丢记录
static TOOL_STORE_LOCK: StdMutex<()> = StdMutex::new(());

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssistantToolRequest {
    pub tool: String,
    #[serde(default)]
    pub params: Value,
    #[serde(default)]
    pub confirmed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssistantToolResponse {
    pub tool: String,
    pub summary: String,
    pub data: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssistantToolLog {
    pub id: String,
    pub timestamp: DateTime<Utc>,
    pub tool: String,
    pub status: String,
    pub summary: String,
    pub params: Value,
}

/** 笔记变更记录：AI 写回 / 历史恢复 时保存前后内容快照，支持查看与回滚 */
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteChangeRecord {
    pub id: String,
    pub timestamp: DateTime<Utc>,
    pub note_id: String,
    pub title: String,
    pub source: String,
    pub mode: String,
    pub before_content: String,
    pub after_content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssistantAgentConfig {
    pub mode: AssistantAgentMode,
    pub context_policy: AssistantContextPolicy,
    pub tool_policy: AssistantToolPolicy,
    pub permission_policy: AssistantPermissionPolicy,
    pub workflow_policy: AssistantWorkflowPolicy,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum AssistantAgentMode {
    Workflow,
    Autonomous,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssistantContextPolicy {
    pub recent_messages: usize,
    pub allow_local_note_context: bool,
    pub summarize_long_context: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssistantToolPolicy {
    pub allow_note_read: bool,
    pub allow_note_write: bool,
    pub allow_web_search: bool,
    pub allow_external_tools: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssistantPermissionPolicy {
    pub read_without_confirmation: bool,
    pub write_before_confirm: bool,
    pub web_search_before_confirm: bool,
    pub external_before_confirm: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssistantWorkflowPolicy {
    pub note_optimize_review_required: bool,
    pub writeback_review_surface: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SearchResultItem {
    title: String,
    url: String,
    snippet: String,
}

pub async fn execute_tool(
    request: AssistantToolRequest,
) -> Result<AssistantToolResponse, AppError> {
    let tool = request.tool.trim().to_string();
    if tool.is_empty() {
        return Err(AppError::new("invalidTool", "工具名称不能为空"));
    }

    let config = load_agent_config()?;
    enforce_tool_policy(&tool, &config)?;

    if requires_confirmation(&tool, &config) && !request.confirmed {
        let summary = format!("已拦截未确认的工具调用：{}", tool_label(&tool));
        let _ = append_log(&tool, "denied", &summary, &request.params);
        return Err(AppError::new(
            "permissionRequired",
            "该操作需要先由用户确认",
        ));
    }

    if requires_confirmation(&tool, &config) {
        enforce_frequency_limit(&tool)?;
    }

    if is_note_write_tool(&tool) {
        append_log(
            &tool,
            "pending",
            &format!("准备执行：{}", tool_label(&tool)),
            &request.params,
        )?;
    }

    let result = match tool.as_str() {
        "note.list" => execute_note_list(&request.params),
        "note.read" => execute_note_read(&request.params),
        "note.search" => execute_note_search(&request.params),
        "note.create" => execute_note_create(&request.params),
        "note.update" => execute_note_update(&request.params),
        "note.moveCategory" => execute_note_move_category(&request.params),
        "web.search" => execute_web_search(&request.params).await,
        "external.openUrl" => execute_external_open_url(&request.params),
        "external.copyText" => execute_external_copy_text(&request.params),
        _ => Err(AppError::new(
            "unsupportedTool",
            format!("暂不支持工具：{tool}"),
        )),
    };

    match &result {
        Ok(response) => {
            if is_note_write_tool(&tool) {
                append_log(&tool, "success", &response.summary, &request.params)?;
            } else {
                let _ = append_log(&tool, "success", &response.summary, &request.params);
            }
        }
        Err(error) => {
            let _ = append_log(&tool, "error", &error.message, &request.params);
        }
    }

    result
}

pub fn list_logs(limit: usize) -> Result<Vec<AssistantToolLog>, AppError> {
    let path = log_path()?;
    let mut logs = read_logs(&path)?;
    logs.sort_by_key(|log| std::cmp::Reverse(log.timestamp));
    logs.truncate(limit.clamp(1, MAX_LOGS));
    Ok(logs)
}

/** 列出笔记变更历史（倒序，最新的在前） */
pub fn list_note_changes(limit: usize) -> Result<Vec<NoteChangeRecord>, AppError> {
    let path = note_changes_path()?;
    let mut changes = read_note_changes(&path)?;
    changes.sort_by_key(|change| std::cmp::Reverse(change.timestamp));
    changes.truncate(limit.clamp(1, MAX_NOTE_CHANGES));
    Ok(changes)
}

/** 恢复某次变更：把笔记写回该变更发生前的内容，并记录一条 restore 变更 */
pub fn restore_note_change(change_id: &str) -> Result<(Note, NoteChangeRecord), AppError> {
    let _guard = TOOL_STORE_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let path = note_changes_path()?;
    let mut changes = read_note_changes(&path)?;
    let index = changes
        .iter()
        .position(|change| change.id == change_id)
        .ok_or_else(|| AppError::new("changeNotFound", format!("未找到变更记录 {change_id}")))?;
    let record = changes[index].clone();

    let current = resolve_note(&json!({ "id": record.note_id }))?;
    let restored = default_store()?.update_note(
        &record.note_id,
        SaveNoteRequest {
            title: current.title.clone(),
            content: record.before_content.clone(),
            category: current.category.clone(),
        },
    )?;

    let restore_record = NoteChangeRecord {
        id: Uuid::new_v4().to_string(),
        timestamp: Utc::now(),
        note_id: record.note_id.clone(),
        title: record.title.clone(),
        source: "restore".into(),
        mode: "replace".into(),
        before_content: current.content,
        after_content: record.before_content.clone(),
    };
    changes.push(restore_record.clone());
    if changes.len() > MAX_NOTE_CHANGES {
        changes = changes.split_off(changes.len() - MAX_NOTE_CHANGES);
    }
    write_json_atomic(&path, &changes)?;

    Ok((restored, restore_record))
}

fn save_note_change(
    note_id: &str,
    title: &str,
    source: &str,
    mode: &str,
    before_content: &str,
    after_content: &str,
) -> Result<(), AppError> {
    let _guard = TOOL_STORE_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let path = note_changes_path()?;
    let mut changes = read_note_changes(&path)?;
    changes.push(NoteChangeRecord {
        id: Uuid::new_v4().to_string(),
        timestamp: Utc::now(),
        note_id: note_id.to_string(),
        title: title.to_string(),
        source: source.to_string(),
        mode: mode.to_string(),
        before_content: before_content.to_string(),
        after_content: after_content.to_string(),
    });

    if changes.len() > MAX_NOTE_CHANGES {
        changes = changes.split_off(changes.len() - MAX_NOTE_CHANGES);
    }

    write_json_atomic(&path, &changes)
}

fn read_note_changes(path: &Path) -> Result<Vec<NoteChangeRecord>, AppError> {
    if !path.exists() {
        return Ok(Vec::new());
    }
    serde_json::from_str(&fs::read_to_string(path)?).map_err(AppError::from)
}

fn note_changes_path() -> Result<std::path::PathBuf, AppError> {
    Ok(default_store()?.base_dir().join("note_changes.json"))
}

pub fn load_agent_config() -> Result<AssistantAgentConfig, AppError> {
    let path = agent_config_path()?;
    if !path.exists() {
        let config = default_agent_config();
        write_json_atomic(&path, &config)?;
        return Ok(config);
    }

    let config: AssistantAgentConfig = serde_json::from_str(&fs::read_to_string(path)?)?;
    Ok(normalize_agent_config(config))
}

pub fn save_agent_config(config: AssistantAgentConfig) -> Result<AssistantAgentConfig, AppError> {
    let config = normalize_agent_config(config);
    write_json_atomic(&agent_config_path()?, &config)?;
    Ok(config)
}

fn execute_note_list(params: &Value) -> Result<AssistantToolResponse, AppError> {
    let limit = number_param(params, "limit")
        .map(|value| value.clamp(1, 50) as usize)
        .unwrap_or(20);
    let mut notes = default_store()?.list_notes()?;
    notes.truncate(limit);
    Ok(AssistantToolResponse {
        tool: "note.list".into(),
        summary: format!("已读取最近 {} 条笔记。", notes.len()),
        data: json!({ "notes": notes }),
    })
}

fn execute_note_read(params: &Value) -> Result<AssistantToolResponse, AppError> {
    let note = resolve_note(params)?;
    Ok(AssistantToolResponse {
        tool: "note.read".into(),
        summary: format!("已读取笔记「{}」。", note.title),
        data: json!({ "note": note }),
    })
}

fn execute_note_search(params: &Value) -> Result<AssistantToolResponse, AppError> {
    let query = optional_string_param(params, "query").unwrap_or_default();
    let limit = number_param(params, "limit")
        .map(|value| value.clamp(1, 30) as usize)
        .unwrap_or(10);
    let query_lower = query.to_lowercase();
    let mut notes = default_store()?.list_notes()?;

    if !query_lower.is_empty() {
        notes.retain(|note| {
            note.title.to_lowercase().contains(&query_lower)
                || note.category.to_lowercase().contains(&query_lower)
                || note.preview.to_lowercase().contains(&query_lower)
        });
    }

    notes.truncate(limit);
    Ok(AssistantToolResponse {
        tool: "note.search".into(),
        summary: if query_lower.is_empty() {
            format!("已读取 {} 条笔记索引。", notes.len())
        } else {
            format!("已找到 {} 条与「{}」相关的笔记。", notes.len(), query)
        },
        data: json!({ "query": query, "notes": notes }),
    })
}

fn execute_note_create(params: &Value) -> Result<AssistantToolResponse, AppError> {
    let title = optional_string_param(params, "title")
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| "AI 生成笔记".into());
    let content = optional_string_param(params, "content").unwrap_or_default();
    let category = optional_string_param(params, "category").unwrap_or_default();
    validate_category(&category)?;

    if !category.is_empty() {
        default_store()?.create_category(&category)?;
    }

    let note = default_store()?.create_note(SaveNoteRequest {
        title: title.clone(),
        content,
        category,
    })?;

    Ok(AssistantToolResponse {
        tool: "note.create".into(),
        summary: format!("已创建笔记「{}」。", note.title),
        data: json!({ "note": note }),
    })
}

fn execute_note_update(params: &Value) -> Result<AssistantToolResponse, AppError> {
    let note = resolve_note(params)?;
    let mode = optional_string_param(params, "mode").unwrap_or_else(|| "append".into());
    let content = string_param(params, "content")?;
    let title = optional_string_param(params, "title").unwrap_or_else(|| note.title.clone());
    let category =
        optional_string_param(params, "category").unwrap_or_else(|| note.category.clone());
    validate_category(&category)?;

    if !category.is_empty() {
        default_store()?.create_category(&category)?;
    }

    let next_content = if mode == "replace" {
        content
    } else if note.content.trim().is_empty() {
        content
    } else {
        format!("{}\n\n{}", note.content, content)
    };

    let updated = default_store()?.update_note(
        &note.id,
        SaveNoteRequest {
            title,
            content: next_content.clone(),
            category,
        },
    )?;

    // 保存变更快照，供"历史变更"查看与回滚
    let _ = save_note_change(
        &note.id,
        &updated.title,
        "ai",
        &mode,
        &note.content,
        &next_content,
    );

    Ok(AssistantToolResponse {
        tool: "note.update".into(),
        summary: format!(
            "已{}笔记「{}」。",
            if mode == "replace" {
                "更新"
            } else {
                "追加"
            },
            updated.title
        ),
        data: json!({ "note": updated, "mode": mode }),
    })
}

fn execute_note_move_category(params: &Value) -> Result<AssistantToolResponse, AppError> {
    let note = resolve_note(params)?;
    let category = optional_string_param(params, "category").unwrap_or_default();
    validate_category(&category)?;

    if !category.is_empty() {
        default_store()?.create_category(&category)?;
    }

    let moved = default_store()?.move_note_to_category(&note.id, &category)?;
    let category_label = if category.is_empty() {
        "未分类"
    } else {
        &category
    };
    Ok(AssistantToolResponse {
        tool: "note.moveCategory".into(),
        summary: format!("已将笔记「{}」归类到「{}」。", moved.title, category_label),
        data: json!({ "note": moved }),
    })
}

async fn execute_web_search(params: &Value) -> Result<AssistantToolResponse, AppError> {
    let query = string_param(params, "query")?;
    let limit = number_param(params, "limit")
        .map(|value| value.clamp(1, SEARCH_LIMIT_MAX as u64) as usize)
        .unwrap_or(SEARCH_LIMIT_DEFAULT);

    // 优先用 SearXNG（自托管或内置默认实例 paulgo.io）：结果真实、覆盖全站；
    // 不可用（未配置/宕机/无结果）时回退 DuckDuckGo Instant Answer
    let config = default_store()?.load_config()?;
    if !config.searxng_url.trim().is_empty() {
        match crate::services::agent::web_search::searxng_search(
            &config.searxng_url,
            &query,
            limit.max(1),
        )
        .await
        {
            Ok(results) if !results.is_empty() => {
                let items: Vec<SearchResultItem> = results
                    .into_iter()
                    .map(|item| SearchResultItem {
                        title: item.title,
                        url: item.url,
                        snippet: item.content,
                    })
                    .collect();
                let summary = format!(
                    "已检索到 {} 条结果。\n{}",
                    items.len(),
                    items
                        .iter()
                        .take(3)
                        .map(|item| format!("{}：{}", item.title, item.snippet))
                        .collect::<Vec<_>>()
                        .join("\n")
                );
                return Ok(AssistantToolResponse {
                    tool: "web.search".into(),
                    summary,
                    data: json!({ "query": query, "results": items, "provider": "SearXNG" }),
                });
            }
            Ok(_) => {
                log::debug!("[search] SearXNG 无结果，回退 DuckDuckGo");
            }
            Err(error) => {
                log::debug!("[search] SearXNG 不可用，回退 DuckDuckGo: {}", error.message);
            }
        }
    }

    let url = Url::parse_with_params(
        "https://api.duckduckgo.com/",
        &[
            ("q", query.as_str()),
            ("format", "json"),
            ("no_html", "1"),
            ("skip_disambig", "1"),
        ],
    )
    .map_err(|error| AppError::new("searchUrl", error.to_string()))?;

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .user_agent("floral-notepaper/1.0 assistant search")
        .build()
        .map_err(|error| AppError::new("network", error.to_string()))?;

    let response = client
        .get(url)
        .send()
        .await
        .map_err(|error| AppError::new("network", format!("联网搜索失败：{error}")))?;

    if !response.status().is_success() {
        return Err(AppError::new(
            "network",
            format!("搜索接口返回 HTTP {}", response.status()),
        ));
    }

    let payload: Value = response
        .json()
        .await
        .map_err(|error| AppError::new("searchParse", format!("搜索结果解析失败：{error}")))?;

    let mut results = Vec::new();
    if let Some(abstract_text) = payload.get("AbstractText").and_then(Value::as_str) {
        let snippet = clean_text(abstract_text);
        if !snippet.is_empty() {
            results.push(SearchResultItem {
                title: payload
                    .get("Heading")
                    .and_then(Value::as_str)
                    .map(clean_text)
                    .filter(|value| !value.is_empty())
                    .unwrap_or_else(|| query.clone()),
                url: payload
                    .get("AbstractURL")
                    .and_then(Value::as_str)
                    .unwrap_or("https://duckduckgo.com/")
                    .to_string(),
                snippet,
            });
        }
    }
    collect_related_results(payload.get("RelatedTopics"), &mut results, limit);
    results.truncate(limit);

    let summary = if results.is_empty() {
        format!("未检索到「{}」的可用实时结果。", query)
    } else {
        let highlights = results
            .iter()
            .take(3)
            .map(|item| format!("{}：{}", item.title, item.snippet))
            .collect::<Vec<_>>()
            .join("\n");
        format!("已检索到 {} 条结果。\n{}", results.len(), highlights)
    };

    Ok(AssistantToolResponse {
        tool: "web.search".into(),
        summary,
        data: json!({ "query": query, "results": results, "provider": "DuckDuckGo Instant Answer" }),
    })
}

fn execute_external_open_url(params: &Value) -> Result<AssistantToolResponse, AppError> {
    let url = string_param(params, "url")?;
    let parsed = Url::parse(&url).map_err(|_| AppError::new("invalidUrl", "链接格式不合法"))?;
    if parsed.scheme() != "http" && parsed.scheme() != "https" {
        return Err(AppError::new("invalidUrl", "只允许打开 http/https 链接"));
    }

    Ok(AssistantToolResponse {
        tool: "external.openUrl".into(),
        summary: format!("已通过权限校验，可打开链接：{}", parsed.as_str()),
        data: json!({ "action": "openUrl", "url": parsed.as_str() }),
    })
}

fn execute_external_copy_text(params: &Value) -> Result<AssistantToolResponse, AppError> {
    let text = string_param(params, "text")?;
    if text.chars().count() > 20_000 {
        return Err(AppError::new("payloadTooLarge", "复制内容过长"));
    }

    Ok(AssistantToolResponse {
        tool: "external.copyText".into(),
        summary: format!(
            "已通过权限校验，可复制 {} 个字符到剪贴板。",
            text.chars().count()
        ),
        data: json!({ "action": "copyText", "text": text }),
    })
}

fn resolve_note(params: &Value) -> Result<Note, AppError> {
    if let Some(id) = optional_string_param(params, "id") {
        if !id.trim().is_empty() {
            return default_store()?.read_note(&id);
        }
    }

    let query = string_param(params, "query")?;
    let query_lower = query.to_lowercase();
    let notes = default_store()?.list_notes()?;

    if let Some(note) = notes
        .iter()
        .find(|note| note.title.to_lowercase() == query_lower)
    {
        return default_store()?.read_note(&note.id);
    }

    if let Some(note) = notes.iter().find(|note| matches_note(note, &query_lower)) {
        return default_store()?.read_note(&note.id);
    }

    Err(AppError::new(
        "noteNotFound",
        format!("找不到匹配「{}」的笔记", query),
    ))
}

fn matches_note(note: &NoteMetadata, query_lower: &str) -> bool {
    note.title.to_lowercase().contains(query_lower)
        || note.category.to_lowercase().contains(query_lower)
        || note.preview.to_lowercase().contains(query_lower)
}

fn collect_related_results(value: Option<&Value>, out: &mut Vec<SearchResultItem>, limit: usize) {
    if out.len() >= limit {
        return;
    }

    let Some(Value::Array(items)) = value else {
        return;
    };

    for item in items {
        if out.len() >= limit {
            return;
        }
        if item.get("Topics").is_some() {
            collect_related_results(item.get("Topics"), out, limit);
            continue;
        }

        let Some(text) = item.get("Text").and_then(Value::as_str).map(clean_text) else {
            continue;
        };
        if text.is_empty() {
            continue;
        }
        let Some(url) = item.get("FirstURL").and_then(Value::as_str) else {
            continue;
        };
        let title = text
            .split(" - ")
            .next()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or(&text)
            .to_string();

        out.push(SearchResultItem {
            title,
            url: url.to_string(),
            snippet: text,
        });
    }
}

fn string_param(params: &Value, key: &str) -> Result<String, AppError> {
    optional_string_param(params, key)
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| AppError::new("invalidParams", format!("缺少参数：{key}")))
}

fn optional_string_param(params: &Value, key: &str) -> Option<String> {
    params
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .map(str::to_string)
}

fn number_param(params: &Value, key: &str) -> Option<u64> {
    params.get(key).and_then(Value::as_u64)
}

fn validate_category(category: &str) -> Result<(), AppError> {
    if category.contains('/')
        || category.contains('\\')
        || category.contains(':')
        || category.contains("..")
    {
        return Err(AppError::new(
            "categoryNameInvalidChars",
            "分类名不能包含特殊字符",
        ));
    }
    Ok(())
}

fn default_agent_config() -> AssistantAgentConfig {
    AssistantAgentConfig {
        mode: AssistantAgentMode::Workflow,
        context_policy: AssistantContextPolicy {
            recent_messages: 16,
            allow_local_note_context: true,
            summarize_long_context: true,
        },
        tool_policy: AssistantToolPolicy {
            allow_note_read: true,
            allow_note_write: true,
            allow_web_search: true,
            allow_external_tools: true,
        },
        permission_policy: AssistantPermissionPolicy {
            read_without_confirmation: true,
            write_before_confirm: true,
            web_search_before_confirm: true,
            external_before_confirm: true,
        },
        workflow_policy: AssistantWorkflowPolicy {
            note_optimize_review_required: true,
            writeback_review_surface: "inlineDiff".into(),
        },
    }
}

fn normalize_agent_config(mut config: AssistantAgentConfig) -> AssistantAgentConfig {
    config.context_policy.recent_messages = config.context_policy.recent_messages.clamp(4, 40);
    if config.workflow_policy.writeback_review_surface != "inlineDiff" {
        config.workflow_policy.writeback_review_surface = "inlineDiff".into();
    }
    config.workflow_policy.note_optimize_review_required = true;
    config
}

fn enforce_tool_policy(tool: &str, config: &AssistantAgentConfig) -> Result<(), AppError> {
    let allowed = if is_note_read_tool(tool) {
        config.tool_policy.allow_note_read
    } else if is_note_write_tool(tool) {
        config.tool_policy.allow_note_write
    } else if tool == "web.search" {
        config.tool_policy.allow_web_search
    } else if tool.starts_with("external.") {
        config.tool_policy.allow_external_tools
    } else {
        true
    };

    if allowed {
        Ok(())
    } else {
        Err(AppError::new(
            "toolDisabled",
            format!("后端 Agent 策略已禁用：{}", tool_label(tool)),
        ))
    }
}

fn requires_confirmation(tool: &str, config: &AssistantAgentConfig) -> bool {
    if is_note_write_tool(tool) {
        return config.permission_policy.write_before_confirm;
    }
    if tool == "web.search" {
        return config.permission_policy.web_search_before_confirm;
    }
    if tool.starts_with("external.") {
        return config.permission_policy.external_before_confirm;
    }
    if is_note_read_tool(tool) {
        return !config.permission_policy.read_without_confirmation;
    }
    false
}

fn is_note_read_tool(tool: &str) -> bool {
    matches!(tool, "note.list" | "note.read" | "note.search")
}

fn is_note_write_tool(tool: &str) -> bool {
    matches!(tool, "note.create" | "note.update" | "note.moveCategory")
}

fn rate_key(tool: &str) -> Option<&'static str> {
    if tool == "web.search" {
        Some("web.search")
    } else if tool.starts_with("external.") {
        Some("external")
    } else if is_note_write_tool(tool) {
        Some("note.write")
    } else {
        None
    }
}

fn rate_limit_for(tool: &str) -> Option<usize> {
    match rate_key(tool)? {
        "web.search" => Some(30),
        "external" => Some(20),
        "note.write" => Some(80),
        _ => None,
    }
}

fn enforce_frequency_limit(tool: &str) -> Result<(), AppError> {
    let Some(key) = rate_key(tool) else {
        return Ok(());
    };
    let Some(limit) = rate_limit_for(tool) else {
        return Ok(());
    };

    let since = Utc::now() - Duration::hours(1);
    let count = read_logs(&log_path()?)?
        .into_iter()
        .filter(|log| log.timestamp >= since && log.status == "success")
        .filter(|log| rate_key(&log.tool) == Some(key))
        .count();

    if count >= limit {
        return Err(AppError::new(
            "rateLimited",
            format!("{} 调用过于频繁，请稍后再试", tool_label(tool)),
        ));
    }

    Ok(())
}

fn append_log(tool: &str, status: &str, summary: &str, params: &Value) -> Result<(), AppError> {
    let _guard = TOOL_STORE_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let path = log_path()?;
    let mut logs = read_logs(&path)?;
    logs.push(AssistantToolLog {
        id: Uuid::new_v4().to_string(),
        timestamp: Utc::now(),
        tool: tool.to_string(),
        status: status.to_string(),
        summary: summary.to_string(),
        params: summarize_params(tool, params),
    });

    if logs.len() > MAX_LOGS {
        logs = logs.split_off(logs.len() - MAX_LOGS);
    }

    write_json_atomic(&path, &logs)
}

fn read_logs(path: &Path) -> Result<Vec<AssistantToolLog>, AppError> {
    if !path.exists() {
        return Ok(Vec::new());
    }
    serde_json::from_str(&fs::read_to_string(path)?).map_err(AppError::from)
}

fn log_path() -> Result<std::path::PathBuf, AppError> {
    Ok(default_store()?.base_dir().join("assistant_tool_logs.json"))
}

fn agent_config_path() -> Result<std::path::PathBuf, AppError> {
    Ok(default_store()?
        .base_dir()
        .join("assistant_agent_config.json"))
}

fn write_json_atomic<T: Serialize>(path: &Path, value: &T) -> Result<(), AppError> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let temp_path = path.with_extension("json.tmp");
    fs::write(&temp_path, serde_json::to_string_pretty(value)?)?;
    fs::rename(&temp_path, path)?;
    Ok(())
}

fn summarize_params(tool: &str, params: &Value) -> Value {
    match tool {
        "note.create" => json!({
            "title": optional_string_param(params, "title"),
            "category": optional_string_param(params, "category"),
            "contentLength": optional_string_param(params, "content").map(|value| value.chars().count()).unwrap_or(0),
        }),
        "note.update" => json!({
            "id": optional_string_param(params, "id"),
            "query": optional_string_param(params, "query"),
            "mode": optional_string_param(params, "mode"),
            "contentLength": optional_string_param(params, "content").map(|value| value.chars().count()).unwrap_or(0),
        }),
        "external.copyText" => json!({
            "textLength": optional_string_param(params, "text").map(|value| value.chars().count()).unwrap_or(0),
        }),
        _ => params.clone(),
    }
}

fn clean_text(value: &str) -> String {
    value.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn tool_label(tool: &str) -> &'static str {
    match tool {
        "note.list" => "读取笔记列表",
        "note.read" => "读取笔记",
        "note.search" => "搜索笔记",
        "note.create" => "创建笔记",
        "note.update" => "编辑笔记",
        "note.moveCategory" => "移动笔记分类",
        "web.search" => "联网搜索",
        "external.openUrl" => "打开外部链接",
        "external.copyText" => "写入剪贴板",
        _ => "未知工具",
    }
}
