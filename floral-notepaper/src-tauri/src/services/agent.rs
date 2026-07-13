use chrono::{DateTime, Duration, Utc};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{collections::BTreeMap, fs, path::PathBuf};
use uuid::Uuid;

pub mod canvas_indexer;
pub mod embedding_service;
pub mod event_collector;
pub mod event_store;
pub mod insight_router;
pub mod live2d_signal_queue;
pub mod llm_orchestrator;
pub mod profile_store;
pub mod replay_marker;
pub mod rule_engine;

use super::notes::{default_store, AppError};

const IDLE_THRESHOLD_MINUTES: i64 = 10;
const HANDOFF_THRESHOLD_MINUTES: i64 = 15;
const SUGGESTION_PENDING: &str = "pending";
const SUGGESTION_DISMISSED: &str = "dismissed";
const SUGGESTION_ACCEPTED: &str = "accepted";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentEventInput {
    pub conversation_id: String,
    pub user_id: String,
    pub event_type: String,
    #[serde(default)]
    pub timestamp: Option<DateTime<Utc>>,
    #[serde(default)]
    pub payload: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentEvent {
    pub id: String,
    pub conversation_id: String,
    pub user_id: String,
    pub event_type: String,
    pub timestamp: DateTime<Utc>,
    pub payload: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentCanvasNode {
    pub conversation_id: String,
    pub node_id: String,
    pub text: String,
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
    pub author_id: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub deleted_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentSuggestion {
    pub id: String,
    pub conversation_id: String,
    pub suggestion_type: String,
    pub title: String,
    pub message: String,
    pub status: String,
    pub priority: i64,
    pub source_event_ids: Vec<String>,
    pub related_node_ids: Vec<String>,
    pub payload: Value,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentReplayMarker {
    pub id: String,
    pub conversation_id: String,
    pub time: i64,
    pub marker_type: String,
    pub title: String,
    pub summary: String,
    pub related_event_ids: Vec<String>,
    pub related_node_ids: Vec<String>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentCollaborationSegment {
    pub id: String,
    pub conversation_id: String,
    pub from_user_id: String,
    pub to_user_id: String,
    pub started_at: DateTime<Utc>,
    pub ended_at: DateTime<Utc>,
    pub event_count: i64,
    pub related_event_ids: Vec<String>,
    pub related_node_ids: Vec<String>,
    pub summary: String,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentReviewReport {
    pub conversation_id: String,
    pub title: String,
    pub summary: String,
    pub health_score: i64,
    pub marker_counts: BTreeMap<String, i64>,
    pub highlights: Vec<String>,
    pub risks: Vec<String>,
    pub next_steps: Vec<String>,
    pub generated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentAnalysisResult {
    pub suggestions: Vec<AgentSuggestion>,
    pub replay_markers: Vec<AgentReplayMarker>,
    pub collaboration_segments: Vec<AgentCollaborationSegment>,
}

fn app_error(code: impl Into<String>, message: impl Into<String>) -> AppError {
    AppError {
        code: code.into(),
        message: message.into(),
        details: BTreeMap::new(),
    }
}

fn sqlite_error(error: rusqlite::Error) -> AppError {
    app_error("agentSqlite", error.to_string())
}

fn agent_dir() -> Result<PathBuf, AppError> {
    let dir = default_store()?.base_dir().join("agent");
    fs::create_dir_all(&dir)?;
    Ok(dir)
}

fn db_path() -> Result<PathBuf, AppError> {
    Ok(agent_dir()?.join("agent-events.sqlite"))
}

fn open_connection() -> Result<Connection, AppError> {
    let conn = Connection::open(db_path()?).map_err(sqlite_error)?;
    init_schema(&conn)?;
    Ok(conn)
}

fn init_schema(conn: &Connection) -> Result<(), AppError> {
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS agent_events (
            id TEXT PRIMARY KEY,
            conversation_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            event_type TEXT NOT NULL,
            timestamp TEXT NOT NULL,
            payload TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_agent_events_conversation_timestamp
            ON agent_events(conversation_id, timestamp DESC);

        CREATE TABLE IF NOT EXISTS agent_canvas_nodes (
            conversation_id TEXT NOT NULL,
            node_id TEXT NOT NULL,
            text TEXT NOT NULL,
            x REAL NOT NULL,
            y REAL NOT NULL,
            w REAL NOT NULL,
            h REAL NOT NULL,
            author_id TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            deleted_at TEXT,
            PRIMARY KEY (conversation_id, node_id)
        );

        CREATE INDEX IF NOT EXISTS idx_agent_canvas_nodes_conversation_updated
            ON agent_canvas_nodes(conversation_id, updated_at DESC);

        CREATE TABLE IF NOT EXISTS agent_suggestions (
            id TEXT PRIMARY KEY,
            conversation_id TEXT NOT NULL,
            suggestion_type TEXT NOT NULL,
            title TEXT NOT NULL,
            message TEXT NOT NULL,
            status TEXT NOT NULL,
            priority INTEGER NOT NULL,
            source_event_ids TEXT NOT NULL,
            related_node_ids TEXT NOT NULL,
            payload TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_agent_suggestions_conversation_status
            ON agent_suggestions(conversation_id, status, created_at DESC);

        CREATE TABLE IF NOT EXISTS agent_replay_markers (
            id TEXT PRIMARY KEY,
            conversation_id TEXT NOT NULL,
            time INTEGER NOT NULL,
            marker_type TEXT NOT NULL,
            title TEXT NOT NULL,
            summary TEXT NOT NULL,
            related_event_ids TEXT NOT NULL,
            related_node_ids TEXT NOT NULL,
            created_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_agent_replay_markers_conversation_time
            ON agent_replay_markers(conversation_id, time ASC);

        CREATE TABLE IF NOT EXISTS agent_collaboration_segments (
            id TEXT PRIMARY KEY,
            conversation_id TEXT NOT NULL,
            from_user_id TEXT NOT NULL,
            to_user_id TEXT NOT NULL,
            started_at TEXT NOT NULL,
            ended_at TEXT NOT NULL,
            event_count INTEGER NOT NULL,
            related_event_ids TEXT NOT NULL,
            related_node_ids TEXT NOT NULL,
            summary TEXT NOT NULL,
            created_at TEXT NOT NULL,
            payload TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_agent_collaboration_segments_conversation_started
            ON agent_collaboration_segments(conversation_id, started_at ASC);
        ",
    )
    .map_err(sqlite_error)
}

pub fn record_event(input: AgentEventInput) -> Result<AgentEvent, AppError> {
    let events = record_events(vec![input])?;
    events
        .into_iter()
        .next()
        .ok_or_else(|| app_error("agentEventEmpty", "agent event was not recorded"))
}

pub fn record_events(inputs: Vec<AgentEventInput>) -> Result<Vec<AgentEvent>, AppError> {
    let mut conn = open_connection()?;
    let tx = conn.transaction().map_err(sqlite_error)?;
    let mut recorded = Vec::with_capacity(inputs.len());

    for input in inputs {
        let event = normalize_event(input)?;
        insert_event(&tx, &event)?;
        update_canvas_node_index(&tx, &event)?;
        recorded.push(event);
    }

    tx.commit().map_err(sqlite_error)?;
    Ok(recorded)
}

pub fn list_events(
    conversation_id: String,
    limit: Option<u32>,
) -> Result<Vec<AgentEvent>, AppError> {
    let conn = open_connection()?;
    let limit = limit.unwrap_or(100).clamp(1, 500);
    let mut stmt = conn
        .prepare(
            "SELECT id, conversation_id, user_id, event_type, timestamp, payload
             FROM agent_events
             WHERE conversation_id = ?1
             ORDER BY timestamp DESC
             LIMIT ?2",
        )
        .map_err(sqlite_error)?;

    let rows = stmt
        .query_map(params![conversation_id, limit], event_from_row)
        .map_err(sqlite_error)?;

    rows.collect::<Result<Vec<_>, _>>().map_err(sqlite_error)
}

pub fn list_canvas_nodes(conversation_id: String) -> Result<Vec<AgentCanvasNode>, AppError> {
    let conn = open_connection()?;
    list_canvas_nodes_with_conn(&conn, &conversation_id)
}

pub fn analyze_conversation(conversation_id: String) -> Result<AgentAnalysisResult, AppError> {
    let conn = open_connection()?;
    let events = list_events_with_conn(&conn, &conversation_id, 500)?;
    let nodes = list_canvas_nodes_with_conn(&conn, &conversation_id)?;

    create_idle_suggestion(&conn, &conversation_id, &events)?;
    create_chat_suggestions(&conn, &conversation_id, &events)?;
    create_connection_suggestions(&conn, &conversation_id, &nodes)?;
    create_replay_markers(&conn, &conversation_id, &events)?;
    create_collaboration_signal_markers(&conn, &conversation_id, &events)?;
    create_handoff_segments(&conn, &conversation_id, &events)?;

    Ok(AgentAnalysisResult {
        suggestions: list_suggestions_with_conn(&conn, &conversation_id, Some(SUGGESTION_PENDING))?,
        replay_markers: list_replay_markers_with_conn(&conn, &conversation_id)?,
        collaboration_segments: list_collaboration_segments_with_conn(&conn, &conversation_id)?,
    })
}

pub fn list_suggestions(
    conversation_id: String,
    status: Option<String>,
) -> Result<Vec<AgentSuggestion>, AppError> {
    let conn = open_connection()?;
    list_suggestions_with_conn(&conn, &conversation_id, status.as_deref())
}

pub fn dismiss_suggestion(suggestion_id: String) -> Result<AgentSuggestion, AppError> {
    update_suggestion_status(suggestion_id, SUGGESTION_DISMISSED)
}

pub fn accept_suggestion(suggestion_id: String) -> Result<AgentSuggestion, AppError> {
    update_suggestion_status(suggestion_id, SUGGESTION_ACCEPTED)
}

pub fn list_replay_markers(conversation_id: String) -> Result<Vec<AgentReplayMarker>, AppError> {
    let conn = open_connection()?;
    list_replay_markers_with_conn(&conn, &conversation_id)
}

pub fn list_collaboration_segments(
    conversation_id: String,
) -> Result<Vec<AgentCollaborationSegment>, AppError> {
    let conn = open_connection()?;
    list_collaboration_segments_with_conn(&conn, &conversation_id)
}

pub fn generate_review_report(conversation_id: String) -> Result<AgentReviewReport, AppError> {
    let conn = open_connection()?;
    let events = list_events_with_conn(&conn, &conversation_id, 500)?;
    let nodes = list_canvas_nodes_with_conn(&conn, &conversation_id)?;

    create_replay_markers(&conn, &conversation_id, &events)?;
    create_collaboration_signal_markers(&conn, &conversation_id, &events)?;
    create_handoff_segments(&conn, &conversation_id, &events)?;

    let markers = list_replay_markers_with_conn(&conn, &conversation_id)?;
    let segments = list_collaboration_segments_with_conn(&conn, &conversation_id)?;
    let mut report = build_review_report(&conversation_id, &markers, &segments);
    if nodes.iter().any(|node| node.deleted_at.is_none()) {
        report.highlights.push(format!(
            "画布保留了 {} 个可继续推进的灵感节点。",
            nodes
                .iter()
                .filter(|node| node.deleted_at.is_none())
                .count()
        ));
    }
    Ok(report)
}

fn build_review_report(
    conversation_id: &str,
    markers: &[AgentReplayMarker],
    segments: &[AgentCollaborationSegment],
) -> AgentReviewReport {
    let mut marker_counts = BTreeMap::new();
    for marker_type in ["flow", "stuck", "handoff", "consensus", "conflict"] {
        marker_counts.insert(marker_type.to_string(), 0);
    }
    for marker in markers {
        *marker_counts.entry(marker.marker_type.clone()).or_insert(0) += 1;
    }

    let count = |marker_type: &str| *marker_counts.get(marker_type).unwrap_or(&0);
    let flow_count = count("flow");
    let stuck_count = count("stuck");
    let handoff_count = count("handoff");
    let consensus_count = count("consensus");
    let conflict_count = count("conflict");

    let collaboration_bonus: i64 =
        flow_count.min(4) * 3 + consensus_count.min(3) * 5 + handoff_count.min(3) * 4;
    let risk_penalty: i64 = stuck_count * 12 + conflict_count * 18;
    let health_score = (78_i64 + collaboration_bonus - risk_penalty).clamp(20, 100);

    let mut highlights = Vec::new();
    if flow_count > 0 {
        highlights.push(format!(
            "识别到 {flow_count} 个创作推进节点，内容延展较清晰。"
        ));
    }
    if handoff_count > 0 {
        let segment_count = segments.len().max(handoff_count as usize);
        highlights.push(format!("多人接力活跃，识别到 {segment_count} 次协作切换。"));
    }
    if consensus_count > 0 {
        highlights.push(format!(
            "形成 {consensus_count} 次明确共识，团队方向正在收敛。"
        ));
    }
    if highlights.is_empty() {
        highlights.push("暂未识别到明显亮点，可以继续沉淀画布操作和聊天结论。".to_string());
    }

    let mut risks = Vec::new();
    if conflict_count > 0 {
        risks.push(format!(
            "存在 {conflict_count} 个分歧或风险节点，需要尽快对齐。"
        ));
    }
    if stuck_count > 0 {
        risks.push(format!(
            "出现 {stuck_count} 次停顿或删改，可能需要拆小下一步。"
        ));
    }
    if risks.is_empty() {
        risks.push("暂未发现明显协作风险。".to_string());
    }

    let mut next_steps = Vec::new();
    if conflict_count > 0 {
        next_steps.push("先回到分歧标记，明确取舍标准和负责人。".to_string());
    }
    if stuck_count > 0 {
        next_steps.push("把停顿处拆成一个可执行的小任务再继续。".to_string());
    }
    if consensus_count > 0 {
        next_steps.push("将已达成共识沉淀为画布节点或待办。".to_string());
    }
    if handoff_count > 0 {
        next_steps.push("确认接力后的负责人、边界和下一次交付。".to_string());
    }
    if next_steps.is_empty() {
        next_steps.push("继续记录关键节点，等待更多协作事件形成复盘。".to_string());
    }

    let summary =
        if markers.is_empty() {
            "暂未识别到可复盘的协作关键帧，可先继续收集画布操作和聊天事件。".to_string()
        } else {
            format!(
            "本次复盘聚合了 {} 个关键帧：{} 个推进、{} 个停顿、{} 次接力、{} 次共识、{} 次分歧。",
            markers.len(), flow_count, stuck_count, handoff_count, consensus_count, conflict_count
        )
        };

    AgentReviewReport {
        conversation_id: conversation_id.to_string(),
        title: "Agent 协作复盘报告".to_string(),
        summary,
        health_score,
        marker_counts,
        highlights,
        risks,
        next_steps,
        generated_at: Utc::now(),
    }
}

pub fn record_chat_message_event(
    conversation_id: String,
    message_id: String,
    user_id: String,
    content: String,
    timestamp: Option<DateTime<Utc>>,
) -> Result<AgentEvent, AppError> {
    let event = record_event(AgentEventInput {
        conversation_id: conversation_id.clone(),
        user_id,
        event_type: "chat_message_sent".to_string(),
        timestamp,
        payload: json!({
            "messageId": message_id,
            "content": content,
        }),
    })?;
    let _ = analyze_conversation(conversation_id);
    Ok(event)
}

fn list_events_with_conn(
    conn: &Connection,
    conversation_id: &str,
    limit: u32,
) -> Result<Vec<AgentEvent>, AppError> {
    let mut stmt = conn
        .prepare(
            "SELECT id, conversation_id, user_id, event_type, timestamp, payload
             FROM agent_events
             WHERE conversation_id = ?1
             ORDER BY timestamp DESC
             LIMIT ?2",
        )
        .map_err(sqlite_error)?;
    let rows = stmt
        .query_map(
            params![conversation_id, limit.clamp(1, 500)],
            event_from_row,
        )
        .map_err(sqlite_error)?;
    rows.collect::<Result<Vec<_>, _>>().map_err(sqlite_error)
}

fn list_canvas_nodes_with_conn(
    conn: &Connection,
    conversation_id: &str,
) -> Result<Vec<AgentCanvasNode>, AppError> {
    let mut stmt = conn
        .prepare(
            "SELECT conversation_id, node_id, text, x, y, w, h, author_id, created_at, updated_at, deleted_at
             FROM agent_canvas_nodes
             WHERE conversation_id = ?1
             ORDER BY updated_at DESC",
        )
        .map_err(sqlite_error)?;

    let rows = stmt
        .query_map(params![conversation_id], canvas_node_from_row)
        .map_err(sqlite_error)?;

    rows.collect::<Result<Vec<_>, _>>().map_err(sqlite_error)
}

fn list_suggestions_with_conn(
    conn: &Connection,
    conversation_id: &str,
    status: Option<&str>,
) -> Result<Vec<AgentSuggestion>, AppError> {
    let (sql, values): (&str, Vec<String>) = if let Some(status) = status {
        (
            "SELECT id, conversation_id, suggestion_type, title, message, status, priority, source_event_ids, related_node_ids, payload, created_at, updated_at
             FROM agent_suggestions
             WHERE conversation_id = ?1 AND status = ?2
             ORDER BY priority DESC, created_at DESC",
            vec![conversation_id.to_string(), status.to_string()],
        )
    } else {
        (
            "SELECT id, conversation_id, suggestion_type, title, message, status, priority, source_event_ids, related_node_ids, payload, created_at, updated_at
             FROM agent_suggestions
             WHERE conversation_id = ?1
             ORDER BY priority DESC, created_at DESC",
            vec![conversation_id.to_string()],
        )
    };

    let mut stmt = conn.prepare(sql).map_err(sqlite_error)?;
    let rows = if values.len() == 2 {
        stmt.query_map(params![values[0], values[1]], suggestion_from_row)
            .map_err(sqlite_error)?
    } else {
        stmt.query_map(params![values[0]], suggestion_from_row)
            .map_err(sqlite_error)?
    };
    rows.collect::<Result<Vec<_>, _>>().map_err(sqlite_error)
}

fn list_replay_markers_with_conn(
    conn: &Connection,
    conversation_id: &str,
) -> Result<Vec<AgentReplayMarker>, AppError> {
    let mut stmt = conn
        .prepare(
            "SELECT id, conversation_id, time, marker_type, title, summary, related_event_ids, related_node_ids, created_at
             FROM agent_replay_markers
             WHERE conversation_id = ?1
             ORDER BY time ASC",
        )
        .map_err(sqlite_error)?;
    let rows = stmt
        .query_map(params![conversation_id], replay_marker_from_row)
        .map_err(sqlite_error)?;
    rows.collect::<Result<Vec<_>, _>>().map_err(sqlite_error)
}

fn list_collaboration_segments_with_conn(
    conn: &Connection,
    conversation_id: &str,
) -> Result<Vec<AgentCollaborationSegment>, AppError> {
    let mut stmt = conn
        .prepare(
            "SELECT id, conversation_id, from_user_id, to_user_id, started_at, ended_at, event_count, related_event_ids, related_node_ids, summary, created_at
             FROM agent_collaboration_segments
             WHERE conversation_id = ?1
             ORDER BY started_at ASC",
        )
        .map_err(sqlite_error)?;
    let rows = stmt
        .query_map(params![conversation_id], collaboration_segment_from_row)
        .map_err(sqlite_error)?;
    rows.collect::<Result<Vec<_>, _>>().map_err(sqlite_error)
}

fn normalize_event(input: AgentEventInput) -> Result<AgentEvent, AppError> {
    let conversation_id = input.conversation_id.trim();
    if conversation_id.is_empty() {
        return Err(app_error(
            "agentConversationEmpty",
            "conversationId is required",
        ));
    }

    let user_id = input.user_id.trim();
    if user_id.is_empty() {
        return Err(app_error("agentUserEmpty", "userId is required"));
    }

    let event_type = input.event_type.trim();
    if event_type.is_empty() {
        return Err(app_error("agentEventTypeEmpty", "eventType is required"));
    }

    Ok(AgentEvent {
        id: Uuid::new_v4().to_string(),
        conversation_id: conversation_id.to_string(),
        user_id: user_id.to_string(),
        event_type: event_type.to_string(),
        timestamp: input.timestamp.unwrap_or_else(Utc::now),
        payload: input.payload,
    })
}

fn insert_event(conn: &Connection, event: &AgentEvent) -> Result<(), AppError> {
    conn.execute(
        "INSERT INTO agent_events (id, conversation_id, user_id, event_type, timestamp, payload)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![
            event.id,
            event.conversation_id,
            event.user_id,
            event.event_type,
            event.timestamp.to_rfc3339(),
            serde_json::to_string(&event.payload)?,
        ],
    )
    .map_err(sqlite_error)?;
    Ok(())
}

fn update_canvas_node_index(conn: &Connection, event: &AgentEvent) -> Result<(), AppError> {
    match event.event_type.as_str() {
        "canvas_shape_added" | "canvas_shape_updated" => upsert_canvas_node(conn, event),
        "canvas_shape_removed" => mark_canvas_node_deleted(conn, event),
        _ => Ok(()),
    }
}

fn upsert_canvas_node(conn: &Connection, event: &AgentEvent) -> Result<(), AppError> {
    let Some(node_id) = event.payload.get("nodeId").and_then(Value::as_str) else {
        return Ok(());
    };

    let text = event
        .payload
        .get("text")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .trim();
    if text.is_empty() {
        return Ok(());
    }

    let x = json_f64(&event.payload, "x");
    let y = json_f64(&event.payload, "y");
    let w = json_f64(&event.payload, "w");
    let h = json_f64(&event.payload, "h");
    let author_id = event
        .payload
        .get("authorId")
        .and_then(Value::as_str)
        .unwrap_or(&event.user_id);
    let now = event.timestamp.to_rfc3339();

    let existing_created_at: Option<String> = conn
        .query_row(
            "SELECT created_at FROM agent_canvas_nodes WHERE conversation_id = ?1 AND node_id = ?2",
            params![event.conversation_id, node_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(sqlite_error)?;
    let created_at = existing_created_at.as_deref().unwrap_or(&now);

    conn.execute(
        "INSERT INTO agent_canvas_nodes
            (conversation_id, node_id, text, x, y, w, h, author_id, created_at, updated_at, deleted_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, NULL)
         ON CONFLICT(conversation_id, node_id) DO UPDATE SET
            text = excluded.text,
            x = excluded.x,
            y = excluded.y,
            w = excluded.w,
            h = excluded.h,
            author_id = excluded.author_id,
            updated_at = excluded.updated_at,
            deleted_at = NULL",
        params![
            event.conversation_id,
            node_id,
            text,
            x,
            y,
            w,
            h,
            author_id,
            created_at,
            now,
        ],
    )
    .map_err(sqlite_error)?;

    Ok(())
}

fn mark_canvas_node_deleted(conn: &Connection, event: &AgentEvent) -> Result<(), AppError> {
    let Some(node_id) = event.payload.get("nodeId").and_then(Value::as_str) else {
        return Ok(());
    };

    conn.execute(
        "UPDATE agent_canvas_nodes
         SET deleted_at = ?3, updated_at = ?3
         WHERE conversation_id = ?1 AND node_id = ?2",
        params![event.conversation_id, node_id, event.timestamp.to_rfc3339()],
    )
    .map_err(sqlite_error)?;

    Ok(())
}

fn create_idle_suggestion(
    conn: &Connection,
    conversation_id: &str,
    events: &[AgentEvent],
) -> Result<(), AppError> {
    let Some(last_event) = events.first() else {
        return Ok(());
    };
    let idle_for = Utc::now() - last_event.timestamp;
    if idle_for < Duration::minutes(IDLE_THRESHOLD_MINUTES) {
        return Ok(());
    }

    let dedupe_key = format!("idle:{}", last_event.id);
    insert_suggestion_if_missing(
        conn,
        conversation_id,
        "idle_prompt",
        &dedupe_key,
        "先写下一小步",
        "卡在这里了？可以先写一句最想保留的话，后面再慢慢整理。",
        30,
        &[last_event.id.clone()],
        &[],
        json!({ "idleMinutes": idle_for.num_minutes() }),
    )
}

fn create_chat_suggestions(
    conn: &Connection,
    conversation_id: &str,
    events: &[AgentEvent],
) -> Result<(), AppError> {
    for event in events
        .iter()
        .filter(|event| event.event_type == "chat_message_sent")
    {
        let content = event
            .payload
            .get("content")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let Some(kind) = classify_chat_content(content) else {
            continue;
        };
        let dedupe_key = format!("chat:{}", event.id);
        insert_suggestion_if_missing(
            conn,
            conversation_id,
            "chat_to_canvas_node",
            &dedupe_key,
            "沉淀这条聊天",
            "这条聊天像是一个决定、待办或风险点，可以沉淀成画布节点。",
            60,
            &[event.id.clone()],
            &[],
            json!({ "messageId": event.payload.get("messageId"), "content": content, "kind": kind }),
        )?;
    }
    Ok(())
}

fn create_connection_suggestions(
    conn: &Connection,
    conversation_id: &str,
    nodes: &[AgentCanvasNode],
) -> Result<(), AppError> {
    let active_nodes: Vec<&AgentCanvasNode> = nodes
        .iter()
        .filter(|node| node.deleted_at.is_none() && node.text.trim().chars().count() >= 2)
        .collect();

    for (index, left) in active_nodes.iter().enumerate() {
        for right in active_nodes.iter().skip(index + 1) {
            if distance(left, right) < 360.0 {
                continue;
            }
            let keywords = shared_keywords(&left.text, &right.text);
            if keywords.is_empty() {
                continue;
            }
            if binding_exists(conn, conversation_id, &left.node_id, &right.node_id)? {
                continue;
            }

            let mut ids = vec![left.node_id.clone(), right.node_id.clone()];
            ids.sort();
            let dedupe_key = format!("connection:{}:{}", ids[0], ids[1]);
            insert_suggestion_if_missing(
                conn,
                conversation_id,
                "suggest_connection",
                &dedupe_key,
                "可能有关联",
                "这两个画布节点有相似关键词，可以考虑连起来看看。",
                45,
                &[],
                &ids,
                json!({ "keywords": keywords }),
            )?;
        }
    }
    Ok(())
}

fn create_replay_markers(
    conn: &Connection,
    conversation_id: &str,
    events: &[AgentEvent],
) -> Result<(), AppError> {
    let mut sorted = events.to_vec();
    sorted.sort_by_key(|event| event.timestamp);

    for event in &sorted {
        match event.event_type.as_str() {
            "canvas_shape_added" => insert_replay_marker_if_missing(
                conn,
                conversation_id,
                &format!("marker:{}", event.id),
                event.timestamp.timestamp_millis(),
                "flow",
                "新增灵感节点",
                "画布新增了一个节点，创作内容开始延展。",
                &[event.id.clone()],
                &payload_node_ids(event),
            )?,
            "canvas_shape_removed" => insert_replay_marker_if_missing(
                conn,
                conversation_id,
                &format!("marker:{}", event.id),
                event.timestamp.timestamp_millis(),
                "stuck",
                "删除了一个节点",
                "这里出现了一次内容删改，可能是结构调整。",
                &[event.id.clone()],
                &payload_node_ids(event),
            )?,
            "canvas_binding_added" => insert_replay_marker_if_missing(
                conn,
                conversation_id,
                &format!("marker:{}", event.id),
                event.timestamp.timestamp_millis(),
                "flow",
                "建立了一个连接",
                "两个画布元素在这里被连接起来。",
                &[event.id.clone()],
                &[],
            )?,
            _ => {}
        }
    }

    for pair in sorted.windows(2) {
        let gap = pair[1].timestamp - pair[0].timestamp;
        if gap >= Duration::minutes(IDLE_THRESHOLD_MINUTES) {
            insert_replay_marker_if_missing(
                conn,
                conversation_id,
                &format!("idle-marker:{}:{}", pair[0].id, pair[1].id),
                pair[1].timestamp.timestamp_millis(),
                "stuck",
                "停顿后继续创作",
                "这里经历了一段停顿，然后重新开始操作。",
                &[pair[0].id.clone(), pair[1].id.clone()],
                &[],
            )?;
        }
    }

    Ok(())
}

fn create_collaboration_signal_markers(
    conn: &Connection,
    conversation_id: &str,
    events: &[AgentEvent],
) -> Result<(), AppError> {
    for event in events
        .iter()
        .filter(|event| event.event_type == "chat_message_sent")
    {
        let content = event
            .payload
            .get("content")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let Some(signal) = classify_collaboration_signal(content) else {
            continue;
        };
        let (title, summary) = match signal {
            "consensus" => ("达成共识", "这条聊天显示协作进入收敛状态。"),
            "conflict" => ("出现分歧", "这条聊天暴露了风险、阻塞或不同意见。"),
            _ => continue,
        };

        insert_replay_marker_if_missing(
            conn,
            conversation_id,
            &format!("collab-signal:{}:{}", event.id, signal),
            event.timestamp.timestamp_millis(),
            signal,
            title,
            summary,
            &[event.id.clone()],
            &payload_node_ids(event),
        )?;
    }

    Ok(())
}

fn create_handoff_segments(
    conn: &Connection,
    conversation_id: &str,
    events: &[AgentEvent],
) -> Result<(), AppError> {
    let mut sorted = events.to_vec();
    sorted.sort_by_key(|event| event.timestamp);

    for pair in sorted.windows(2) {
        let from_event = &pair[0];
        let to_event = &pair[1];
        if !is_handoff_pair(from_event, to_event) {
            continue;
        }

        let related_event_ids = vec![from_event.id.clone(), to_event.id.clone()];
        let related_node_ids = related_node_ids_from_events(&[from_event, to_event]);
        let summary = format!("{} 将创作接力给 {}", from_event.user_id, to_event.user_id);
        let dedupe_key = format!("handoff:{}:{}", from_event.id, to_event.id);

        insert_collaboration_segment_if_missing(
            conn,
            conversation_id,
            &dedupe_key,
            &from_event.user_id,
            &to_event.user_id,
            from_event.timestamp,
            to_event.timestamp,
            2,
            &related_event_ids,
            &related_node_ids,
            &summary,
        )?;
        insert_replay_marker_if_missing(
            conn,
            conversation_id,
            &format!("handoff-marker:{}:{}", from_event.id, to_event.id),
            to_event.timestamp.timestamp_millis(),
            "handoff",
            "接力创作",
            &summary,
            &related_event_ids,
            &related_node_ids,
        )?;
    }

    Ok(())
}

fn insert_suggestion_if_missing(
    conn: &Connection,
    conversation_id: &str,
    suggestion_type: &str,
    dedupe_key: &str,
    title: &str,
    message: &str,
    priority: i64,
    source_event_ids: &[String],
    related_node_ids: &[String],
    payload: Value,
) -> Result<(), AppError> {
    if suggestion_exists(conn, conversation_id, suggestion_type, dedupe_key)? {
        return Ok(());
    }

    let now = Utc::now().to_rfc3339();
    let payload = merge_payload(payload, dedupe_key);
    conn.execute(
        "INSERT INTO agent_suggestions
            (id, conversation_id, suggestion_type, title, message, status, priority, source_event_ids, related_node_ids, payload, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
        params![
            Uuid::new_v4().to_string(),
            conversation_id,
            suggestion_type,
            title,
            message,
            SUGGESTION_PENDING,
            priority,
            serde_json::to_string(source_event_ids)?,
            serde_json::to_string(related_node_ids)?,
            serde_json::to_string(&payload)?,
            now,
            now,
        ],
    )
    .map_err(sqlite_error)?;
    Ok(())
}

fn suggestion_exists(
    conn: &Connection,
    conversation_id: &str,
    suggestion_type: &str,
    dedupe_key: &str,
) -> Result<bool, AppError> {
    let count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM agent_suggestions
             WHERE conversation_id = ?1 AND suggestion_type = ?2 AND json_extract(payload, '$.dedupeKey') = ?3",
            params![conversation_id, suggestion_type, dedupe_key],
            |row| row.get(0),
        )
        .map_err(sqlite_error)?;
    Ok(count > 0)
}

fn insert_collaboration_segment_if_missing(
    conn: &Connection,
    conversation_id: &str,
    dedupe_key: &str,
    from_user_id: &str,
    to_user_id: &str,
    started_at: DateTime<Utc>,
    ended_at: DateTime<Utc>,
    event_count: i64,
    related_event_ids: &[String],
    related_node_ids: &[String],
    summary: &str,
) -> Result<(), AppError> {
    let exists: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM agent_collaboration_segments WHERE conversation_id = ?1 AND id = ?2",
            params![conversation_id, dedupe_key],
            |row| row.get(0),
        )
        .map_err(sqlite_error)?;
    if exists > 0 {
        return Ok(());
    }

    conn.execute(
        "INSERT INTO agent_collaboration_segments
            (id, conversation_id, from_user_id, to_user_id, started_at, ended_at, event_count, related_event_ids, related_node_ids, summary, created_at, payload)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
        params![
            dedupe_key,
            conversation_id,
            from_user_id,
            to_user_id,
            started_at.to_rfc3339(),
            ended_at.to_rfc3339(),
            event_count,
            serde_json::to_string(related_event_ids)?,
            serde_json::to_string(related_node_ids)?,
            summary,
            Utc::now().to_rfc3339(),
            serde_json::to_string(&json!({ "dedupeKey": dedupe_key }))?,
        ],
    )
    .map_err(sqlite_error)?;
    Ok(())
}

fn insert_replay_marker_if_missing(
    conn: &Connection,
    conversation_id: &str,
    dedupe_key: &str,
    time: i64,
    marker_type: &str,
    title: &str,
    summary: &str,
    related_event_ids: &[String],
    related_node_ids: &[String],
) -> Result<(), AppError> {
    let exists: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM agent_replay_markers WHERE conversation_id = ?1 AND id = ?2",
            params![conversation_id, dedupe_key],
            |row| row.get(0),
        )
        .map_err(sqlite_error)?;
    if exists > 0 {
        return Ok(());
    }

    conn.execute(
        "INSERT INTO agent_replay_markers
            (id, conversation_id, time, marker_type, title, summary, related_event_ids, related_node_ids, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        params![
            dedupe_key,
            conversation_id,
            time,
            marker_type,
            title,
            summary,
            serde_json::to_string(related_event_ids)?,
            serde_json::to_string(related_node_ids)?,
            Utc::now().to_rfc3339(),
        ],
    )
    .map_err(sqlite_error)?;
    Ok(())
}

fn update_suggestion_status(
    suggestion_id: String,
    status: &str,
) -> Result<AgentSuggestion, AppError> {
    let conn = open_connection()?;
    conn.execute(
        "UPDATE agent_suggestions SET status = ?2, updated_at = ?3 WHERE id = ?1",
        params![suggestion_id, status, Utc::now().to_rfc3339()],
    )
    .map_err(sqlite_error)?;

    conn.query_row(
        "SELECT id, conversation_id, suggestion_type, title, message, status, priority, source_event_ids, related_node_ids, payload, created_at, updated_at
         FROM agent_suggestions
         WHERE id = ?1",
        params![suggestion_id],
        suggestion_from_row,
    )
    .optional()
    .map_err(sqlite_error)?
    .ok_or_else(|| app_error("agentSuggestionNotFound", "agent suggestion not found"))
}

fn merge_payload(mut payload: Value, dedupe_key: &str) -> Value {
    if let Value::Object(ref mut map) = payload {
        map.insert(
            "dedupeKey".to_string(),
            Value::String(dedupe_key.to_string()),
        );
        payload
    } else {
        json!({ "dedupeKey": dedupe_key, "value": payload })
    }
}

fn classify_chat_content(content: &str) -> Option<&'static str> {
    let content = content.trim();
    if content.is_empty() {
        return None;
    }
    if contains_any(content, &["决定", "结论", "确定", "就这样", "方案"]) {
        return Some("decision");
    }
    if contains_any(content, &["TODO", "todo", "待办", "先做", "下一步", "记得"]) {
        return Some("todo");
    }
    if contains_any(content, &["风险", "阻塞", "问题", "卡住", "担心"]) {
        return Some("risk");
    }
    None
}

fn classify_collaboration_signal(content: &str) -> Option<&'static str> {
    let content = content.trim();
    if content.is_empty() {
        return None;
    }
    if contains_any(
        content,
        &[
            "不同意",
            "但是",
            "不过",
            "冲突",
            "分歧",
            "风险",
            "阻塞",
            "卡住",
            "担心",
        ],
    ) || (content.contains("问题") && !content.contains("没问题"))
    {
        return Some("conflict");
    }
    if contains_any(
        content,
        &[
            "同意",
            "赞成",
            "确认",
            "确定",
            "结论",
            "就这样",
            "达成一致",
            "没问题",
            "可以",
        ],
    ) {
        return Some("consensus");
    }
    None
}

fn contains_any(content: &str, needles: &[&str]) -> bool {
    needles.iter().any(|needle| content.contains(needle))
}

fn is_handoff_pair(from_event: &AgentEvent, to_event: &AgentEvent) -> bool {
    from_event.user_id != to_event.user_id
        && to_event.timestamp - from_event.timestamp <= Duration::minutes(HANDOFF_THRESHOLD_MINUTES)
        && is_handoff_event_type(&to_event.event_type)
}

fn is_handoff_event_type(event_type: &str) -> bool {
    matches!(
        event_type,
        "canvas_shape_added"
            | "canvas_shape_updated"
            | "canvas_binding_added"
            | "chat_message_sent"
    )
}

fn shared_keywords(left: &str, right: &str) -> Vec<String> {
    let left_keywords = keywords(left);
    let right_keywords = keywords(right);
    left_keywords
        .into_iter()
        .filter(|word| right_keywords.contains(word))
        .take(5)
        .collect()
}

fn keywords(text: &str) -> Vec<String> {
    text.split(|ch: char| ch.is_whitespace() || ch.is_ascii_punctuation())
        .flat_map(split_cjk_chunks)
        .filter(|word| word.chars().count() >= 2)
        .fold(Vec::new(), |mut acc, word| {
            if !acc.contains(&word) {
                acc.push(word);
            }
            acc
        })
}

fn split_cjk_chunks(value: &str) -> Vec<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Vec::new();
    }
    if trimmed.chars().count() <= 4 {
        return vec![trimmed.to_string()];
    }
    trimmed
        .chars()
        .collect::<Vec<_>>()
        .windows(2)
        .map(|chars| chars.iter().collect())
        .collect()
}

fn distance(left: &AgentCanvasNode, right: &AgentCanvasNode) -> f64 {
    let dx = left.x - right.x;
    let dy = left.y - right.y;
    (dx * dx + dy * dy).sqrt()
}

fn binding_exists(
    conn: &Connection,
    conversation_id: &str,
    left_node_id: &str,
    right_node_id: &str,
) -> Result<bool, AppError> {
    let count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM agent_events
             WHERE conversation_id = ?1
               AND event_type = 'canvas_binding_added'
               AND (
                    (json_extract(payload, '$.fromId') = ?2 AND json_extract(payload, '$.toId') = ?3)
                 OR (json_extract(payload, '$.fromId') = ?3 AND json_extract(payload, '$.toId') = ?2)
               )",
            params![conversation_id, left_node_id, right_node_id],
            |row| row.get(0),
        )
        .map_err(sqlite_error)?;
    Ok(count > 0)
}

fn payload_node_ids(event: &AgentEvent) -> Vec<String> {
    event
        .payload
        .get("nodeId")
        .and_then(Value::as_str)
        .map(|value| vec![value.to_string()])
        .unwrap_or_default()
}

fn related_node_ids_from_events(events: &[&AgentEvent]) -> Vec<String> {
    let mut ids = Vec::new();
    for event in events {
        for key in ["nodeId", "fromId", "toId"] {
            if let Some(id) = event.payload.get(key).and_then(Value::as_str) {
                let id = id.to_string();
                if !ids.contains(&id) {
                    ids.push(id);
                }
            }
        }
    }
    ids
}

fn json_f64(value: &Value, key: &str) -> f64 {
    value.get(key).and_then(Value::as_f64).unwrap_or_default()
}

fn event_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<AgentEvent> {
    let timestamp: String = row.get(4)?;
    let payload: String = row.get(5)?;

    Ok(AgentEvent {
        id: row.get(0)?,
        conversation_id: row.get(1)?,
        user_id: row.get(2)?,
        event_type: row.get(3)?,
        timestamp: parse_datetime(&timestamp),
        payload: serde_json::from_str(&payload).unwrap_or(Value::Null),
    })
}

fn canvas_node_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<AgentCanvasNode> {
    let created_at: String = row.get(8)?;
    let updated_at: String = row.get(9)?;
    let deleted_at: Option<String> = row.get(10)?;

    Ok(AgentCanvasNode {
        conversation_id: row.get(0)?,
        node_id: row.get(1)?,
        text: row.get(2)?,
        x: row.get(3)?,
        y: row.get(4)?,
        w: row.get(5)?,
        h: row.get(6)?,
        author_id: row.get(7)?,
        created_at: parse_datetime(&created_at),
        updated_at: parse_datetime(&updated_at),
        deleted_at: deleted_at.as_deref().map(parse_datetime),
    })
}

fn suggestion_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<AgentSuggestion> {
    let source_event_ids: String = row.get(7)?;
    let related_node_ids: String = row.get(8)?;
    let payload: String = row.get(9)?;
    let created_at: String = row.get(10)?;
    let updated_at: String = row.get(11)?;

    Ok(AgentSuggestion {
        id: row.get(0)?,
        conversation_id: row.get(1)?,
        suggestion_type: row.get(2)?,
        title: row.get(3)?,
        message: row.get(4)?,
        status: row.get(5)?,
        priority: row.get(6)?,
        source_event_ids: serde_json::from_str(&source_event_ids).unwrap_or_default(),
        related_node_ids: serde_json::from_str(&related_node_ids).unwrap_or_default(),
        payload: serde_json::from_str(&payload).unwrap_or(Value::Null),
        created_at: parse_datetime(&created_at),
        updated_at: parse_datetime(&updated_at),
    })
}

fn replay_marker_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<AgentReplayMarker> {
    let related_event_ids: String = row.get(6)?;
    let related_node_ids: String = row.get(7)?;
    let created_at: String = row.get(8)?;

    Ok(AgentReplayMarker {
        id: row.get(0)?,
        conversation_id: row.get(1)?,
        time: row.get(2)?,
        marker_type: row.get(3)?,
        title: row.get(4)?,
        summary: row.get(5)?,
        related_event_ids: serde_json::from_str(&related_event_ids).unwrap_or_default(),
        related_node_ids: serde_json::from_str(&related_node_ids).unwrap_or_default(),
        created_at: parse_datetime(&created_at),
    })
}

fn collaboration_segment_from_row(
    row: &rusqlite::Row<'_>,
) -> rusqlite::Result<AgentCollaborationSegment> {
    let started_at: String = row.get(4)?;
    let ended_at: String = row.get(5)?;
    let related_event_ids: String = row.get(7)?;
    let related_node_ids: String = row.get(8)?;
    let created_at: String = row.get(10)?;

    Ok(AgentCollaborationSegment {
        id: row.get(0)?,
        conversation_id: row.get(1)?,
        from_user_id: row.get(2)?,
        to_user_id: row.get(3)?,
        started_at: parse_datetime(&started_at),
        ended_at: parse_datetime(&ended_at),
        event_count: row.get(6)?,
        related_event_ids: serde_json::from_str(&related_event_ids).unwrap_or_default(),
        related_node_ids: serde_json::from_str(&related_node_ids).unwrap_or_default(),
        summary: row.get(9)?,
        created_at: parse_datetime(&created_at),
    })
}

fn parse_datetime(value: &str) -> DateTime<Utc> {
    DateTime::parse_from_rfc3339(value)
        .map(|value| value.with_timezone(&Utc))
        .unwrap_or_else(|_| Utc::now())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classifies_chat_content() {
        assert_eq!(classify_chat_content("结论：先做回放"), Some("decision"));
        assert_eq!(classify_chat_content("TODO 补测试"), Some("todo"));
        assert_eq!(classify_chat_content("这里有风险"), Some("risk"));
        assert_eq!(classify_chat_content("普通闲聊"), None);
    }

    #[test]
    fn classifies_collaboration_signal() {
        assert_eq!(
            classify_collaboration_signal("我同意这个方案"),
            Some("consensus")
        );
        assert_eq!(
            classify_collaboration_signal("但是这里有风险"),
            Some("conflict")
        );
        assert_eq!(
            classify_collaboration_signal("没问题，可以继续"),
            Some("consensus")
        );
        assert_eq!(
            classify_collaboration_signal("同意，但是这里有风险"),
            Some("conflict")
        );
        assert_eq!(classify_collaboration_signal("普通闲聊"), None);
    }

    #[test]
    fn extracts_shared_keywords() {
        let shared = shared_keywords("栀子花 夏天 香气", "夏天 的 栀子花 很香");
        assert!(!shared.is_empty());
    }

    #[test]
    fn calculates_distance() {
        let left = test_node("a", 0.0, 0.0, "写作");
        let right = test_node("b", 3.0, 4.0, "写作");
        assert_eq!(distance(&left, &right), 5.0);
    }

    #[test]
    fn detects_handoff_pair() {
        let start = Utc::now();
        let from = test_event("a", "u1", "canvas_shape_added", start);
        let to = test_event(
            "b",
            "u2",
            "canvas_shape_updated",
            start + Duration::minutes(5),
        );
        assert!(is_handoff_pair(&from, &to));
    }

    #[test]
    fn ignores_same_user_handoff_pair() {
        let start = Utc::now();
        let from = test_event("a", "u1", "canvas_shape_added", start);
        let to = test_event(
            "b",
            "u1",
            "canvas_shape_updated",
            start + Duration::minutes(5),
        );
        assert!(!is_handoff_pair(&from, &to));
    }

    #[test]
    fn ignores_late_handoff_pair() {
        let start = Utc::now();
        let from = test_event("a", "u1", "canvas_shape_added", start);
        let to = test_event(
            "b",
            "u2",
            "canvas_shape_updated",
            start + Duration::minutes(16),
        );
        assert!(!is_handoff_pair(&from, &to));
    }

    #[test]
    fn ignores_invalid_handoff_event_type() {
        let start = Utc::now();
        let from = test_event("a", "u1", "canvas_shape_added", start);
        let to = test_event(
            "b",
            "u2",
            "canvas_shape_removed",
            start + Duration::minutes(5),
        );
        assert!(!is_handoff_pair(&from, &to));
    }

    #[test]
    fn extracts_related_node_ids_from_events() {
        let start = Utc::now();
        let from = test_event("a", "u1", "canvas_shape_added", start);
        let to = test_event(
            "b",
            "u2",
            "canvas_binding_added",
            start + Duration::minutes(5),
        );
        let ids = related_node_ids_from_events(&[&from, &to]);
        assert!(ids.contains(&"node-a".to_string()));
        assert!(ids.contains(&"node-b".to_string()));
        assert!(ids.contains(&"node-c".to_string()));
    }

    #[test]
    fn builds_review_report_from_markers() {
        let markers = vec![
            test_marker("m1", "flow"),
            test_marker("m2", "handoff"),
            test_marker("m3", "consensus"),
            test_marker("m4", "conflict"),
        ];
        let report = build_review_report("c", &markers, &[]);

        assert_eq!(report.marker_counts.get("conflict"), Some(&1));
        assert_eq!(report.marker_counts.get("consensus"), Some(&1));
        assert!(report.health_score < 100);
        assert!(report.highlights.iter().any(|item| item.contains("共识")));
        assert!(report.risks.iter().any(|item| item.contains("分歧")));
        assert!(report.next_steps.iter().any(|item| item.contains("分歧")));
    }

    #[test]
    fn runs_agent_core_pipeline_end_to_end() {
        let collector =
            event_collector::EventCollector::new(event_collector::EventFilter::default());
        let event = collector
            .collect_http(
                "ui",
                "local",
                "chat_message_sent",
                json!({ "content": "同意继续推进", "tag": "创作", "nodeId": "node-1" }),
            )
            .unwrap()
            .unwrap();

        let event_db =
            std::env::temp_dir().join(format!("agent-core-pipeline-{}.sqlite", Uuid::new_v4()));
        let store = event_store::AgentEventStore::new(event_db).unwrap();
        store.insert(&event).unwrap();
        let stored_events = store
            .query(event_store::EventQuery {
                event_type: Some("chat_message_sent".to_string()),
                limit: 10,
                ..event_store::EventQuery::default()
            })
            .unwrap();

        let mut indexer = canvas_indexer::CanvasIndexer::new();
        indexer.apply_change(canvas_indexer::CanvasChange::Upsert(
            canvas_indexer::CanvasNodeInput {
                node_id: "node-1".to_string(),
                node_type: "note".to_string(),
                position: canvas_indexer::CanvasPosition {
                    x: 0.0,
                    y: 0.0,
                    width: 120.0,
                    height: 80.0,
                },
                rich_text: "同意继续推进".to_string(),
                annotation: "协作结论".to_string(),
                note: String::new(),
                ocr_text: String::new(),
                relations: vec![],
            },
        ));
        let indexed_nodes = indexer.query(canvas_indexer::CanvasNodeQuery {
            keyword: Some("推进".to_string()),
            ..canvas_indexer::CanvasNodeQuery::default()
        });

        let mut embeddings = embedding_service::EmbeddingService::new(
            embedding_service::DeterministicEmbeddingProvider::new("primary"),
            embedding_service::DeterministicEmbeddingProvider::new("fallback"),
            8,
        );
        let embedding = embeddings.embed(&indexed_nodes[0].text).unwrap();
        let similar = embeddings.similar(&embedding.vector, 1);

        let mut rules = rule_engine::RuleEngine::new(vec![rule_engine::AgentRule {
            rule_id: "chat-frequency".to_string(),
            event_type: Some("chat_message_sent".to_string()),
            min_count: 1,
            window_minutes: 60,
            cooldown_minutes: 60,
            priority: 10,
            action: rule_engine::RuleActionKind::UiHint,
            enabled: true,
        }]);
        let instructions = rules.evaluate(&stored_events);

        let template = llm_orchestrator::PromptTemplate {
            template_id: "review".to_string(),
            scene: "review".to_string(),
            content: "事件 {{event}} 节点 {{node}}".to_string(),
            variables: vec!["event".to_string(), "node".to_string()],
        };
        let mut llm = llm_orchestrator::LlmOrchestrator::new(
            llm_orchestrator::StubLlmProvider::new("primary"),
            llm_orchestrator::StubLlmProvider::new("fallback"),
            vec![template],
        );
        let mut variables = BTreeMap::new();
        variables.insert("event".to_string(), event.event_type.clone());
        variables.insert("node".to_string(), indexed_nodes[0].text.clone());
        let insight = llm
            .invoke(llm_orchestrator::LlmRequest {
                request_id: "insight-1".to_string(),
                scene: "review".to_string(),
                event_type: event.event_type.clone(),
                variables,
                mode: llm_orchestrator::LlmResponseMode::Full,
            })
            .unwrap();

        let mut router = insight_router::InsightRouter::new();
        let routed = router.dispatch(&insight);

        let mut profile_store = profile_store::ProfileStore::new(42);
        profile_store
            .upsert_profile("u1", "name=花箴", BTreeMap::new())
            .unwrap();
        let profile = profile_store
            .update_baseline_from_events("u1", &stored_events)
            .unwrap();

        let mut replay_store = replay_marker::ReplayMarkerStore::default();
        let keyframes = replay_store.generate_from_events_and_insights(
            &stored_events,
            &[insight.clone()],
            replay_marker::ReplayMarkerConfig::default(),
        );

        let mut live2d = live2d_signal_queue::Live2DSignalQueue::default();
        live2d.enqueue_from_insight(&insight);
        let signal = live2d.dispatch_next().unwrap();

        assert_eq!(stored_events.len(), 1);
        assert_eq!(indexed_nodes.len(), 1);
        assert_eq!(similar[0].text_hash, embedding.text_hash);
        assert_eq!(instructions.len(), 1);
        assert!(routed
            .iter()
            .any(|item| item.channel == insight_router::InsightChannel::UiRealtime));
        assert_eq!(profile.capability_baseline["chat_message_sent"], 1.0);
        assert!(!keyframes.is_empty());
        assert!(signal.signal_id.starts_with("live2d:"));
    }

    fn test_marker(id: &str, marker_type: &str) -> AgentReplayMarker {
        AgentReplayMarker {
            id: id.to_string(),
            conversation_id: "c".to_string(),
            time: 0,
            marker_type: marker_type.to_string(),
            title: marker_type.to_string(),
            summary: marker_type.to_string(),
            related_event_ids: vec![],
            related_node_ids: vec![],
            created_at: Utc::now(),
        }
    }

    fn test_event(
        id: &str,
        user_id: &str,
        event_type: &str,
        timestamp: DateTime<Utc>,
    ) -> AgentEvent {
        AgentEvent {
            id: id.to_string(),
            conversation_id: "c".to_string(),
            user_id: user_id.to_string(),
            event_type: event_type.to_string(),
            timestamp,
            payload: json!({
                "nodeId": format!("node-{id}"),
                "fromId": "node-b",
                "toId": "node-c",
            }),
        }
    }

    fn test_node(id: &str, x: f64, y: f64, text: &str) -> AgentCanvasNode {
        AgentCanvasNode {
            conversation_id: "c".to_string(),
            node_id: id.to_string(),
            text: text.to_string(),
            x,
            y,
            w: 100.0,
            h: 80.0,
            author_id: "u".to_string(),
            created_at: Utc::now(),
            updated_at: Utc::now(),
            deleted_at: None,
        }
    }
}
