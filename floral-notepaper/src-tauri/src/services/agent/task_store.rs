//! 任务持久化：Task/Step 协议 + SQLite（rusqlite）
//!
//! 复用 event_store 的 SQLite/JSON 模式，任务状态以 Rust 侧为准，前端只做镜像展示。
//! 协议字段与架构文档 §4.1 保持一致。

use crate::services::notes::AppError;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

/// 任务状态机：Created → Planned → Running → Done/Failed/Cancelled，
/// Running ↔ AwaitingConfirm（危险/产出步骤等用户确认）。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TaskStatus {
    Planned,
    Running,
    AwaitingConfirm,
    Done,
    Failed,
    Cancelled,
}

impl TaskStatus {
    pub fn parse(value: &str) -> Result<Self, AppError> {
        match value {
            "planned" => Ok(Self::Planned),
            "running" => Ok(Self::Running),
            "awaitingConfirm" => Ok(Self::AwaitingConfirm),
            "done" => Ok(Self::Done),
            "failed" => Ok(Self::Failed),
            "cancelled" => Ok(Self::Cancelled),
            other => Err(AppError::new(
                "invalidTaskStatus",
                format!("未知任务状态: {other}"),
            )),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum StepKind {
    Tool,
    Llm,
    Confirm,
    Output,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum StepStatus {
    Pending,
    Running,
    Done,
    Failed,
    Cancelled,
}

/// 单步（规划产物，也是执行单元）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Step {
    pub step_id: String,
    pub kind: StepKind,
    /// Tool 步骤的工具名（组合/产出型工具）
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tool: Option<String>,
    pub input: serde_json::Value,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub output: Option<serde_json::Value>,
    #[serde(default = "default_step_status")]
    pub status: StepStatus,
    #[serde(default)]
    pub required_confirm: bool,
    /// 用户已确认（AwaitingConfirm 恢复后置 true，随后才执行）
    #[serde(default)]
    pub confirmed: bool,
}

fn default_step_status() -> StepStatus {
    StepStatus::Pending
}

/// 步骤执行日志（供 UI 进度面板）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StepLog {
    pub step_id: String,
    pub message: String,
    pub timestamp: String,
}

/// 任务
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Task {
    pub task_id: String,
    pub goal: String,
    #[serde(default)]
    pub plan: Vec<Step>,
    #[serde(default = "default_task_status")]
    pub status: TaskStatus,
    /// 记忆/检索注入的上下文（JSON 自由结构）
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub context: Option<serde_json::Value>,
    pub created_at: String,
    pub updated_at: String,
    #[serde(default)]
    pub logs: Vec<StepLog>,
}

fn default_task_status() -> TaskStatus {
    TaskStatus::Planned
}

impl Task {
    pub fn new(task_id: impl Into<String>, goal: impl Into<String>) -> Self {
        let now = chrono::Utc::now().to_rfc3339();
        Self {
            task_id: task_id.into(),
            goal: goal.into(),
            plan: Vec::new(),
            status: TaskStatus::Planned,
            context: None,
            created_at: now.clone(),
            updated_at: now,
            logs: Vec::new(),
        }
    }
}

/// 任务持久化（rusqlite，仿 event_store 模式）
pub struct AgentTaskStore {
    path: PathBuf,
}

fn app_error(message: impl Into<String>) -> AppError {
    AppError::new("dbError", message)
}

impl AgentTaskStore {
    pub fn new(path: impl AsRef<Path>) -> Self {
        let path = path.as_ref().to_path_buf();
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let store = Self { path };
        if store
            .conn()
            .and_then(|c| {
                c.execute_batch(SCHEMA)
                    .map_err(|e| app_error(format!("初始化任务库失败: {e}")))
            })
            .is_err()
        {
            eprintln!("[task_store] init schema failed");
        }
        store
    }

    fn conn(&self) -> Result<Connection, AppError> {
        let conn = Connection::open(&self.path)
            .map_err(|e| app_error(format!("打开任务库失败: {e}")))?;
        conn.busy_timeout(std::time::Duration::from_secs(5))
            .map_err(|e| app_error(format!("设置 busy_timeout 失败: {e}")))?;
        Ok(conn)
    }

    pub fn create(&self, task: &Task) -> Result<(), AppError> {
        let conn = self.conn()?;
        conn.execute(
            "INSERT INTO agent_tasks (task_id, goal, plan, status, context, created_at, updated_at, logs)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                task.task_id,
                task.goal,
                serde_json::to_string(&task.plan).map_err(|e| app_error(format!("序列化 plan 失败: {e}")))?,
                serde_json::to_string(&task.status).map_err(|e| app_error(format!("序列化 status 失败: {e}")))?,
                task.context
                    .as_ref()
                    .map(|c| c.to_string())
                    .unwrap_or_else(|| "null".to_string()),
                task.created_at,
                task.updated_at,
                serde_json::to_string(&task.logs).map_err(|e| app_error(format!("序列化 logs 失败: {e}")))?,
            ],
        )
        .map_err(|e| app_error(format!("创建任务失败: {e}")))?;
        Ok(())
    }

    pub fn get(&self, task_id: &str) -> Result<Option<Task>, AppError> {
        let conn = self.conn()?;
        let result = conn
            .query_row(
                "SELECT task_id, goal, plan, status, context, created_at, updated_at, logs
                 FROM agent_tasks WHERE task_id = ?1",
                params![task_id],
                map_row,
            );
        match result {
            Ok(task) => Ok(Some(task)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(app_error(format!("读取任务失败: {e}"))),
        }
    }

    pub fn list(
        &self,
        limit: usize,
        status: Option<TaskStatus>,
    ) -> Result<Vec<Task>, AppError> {
        let conn = self.conn()?;
        let mut tasks = Vec::new();
        if let Some(status) = status {
            let status_json = serde_json::to_string(&status)
                .map_err(|e| app_error(format!("序列化 status 失败: {e}")))?;
            let mut stmt = conn
                .prepare(
                    "SELECT task_id, goal, plan, status, context, created_at, updated_at, logs
                     FROM agent_tasks WHERE status = ?1 ORDER BY created_at DESC LIMIT ?2",
                )
                .map_err(|e| app_error(format!("查询任务失败: {e}")))?;
            let rows = stmt
                .query_map(params![status_json, limit as i64], map_row)
                .map_err(|e| app_error(format!("查询任务失败: {e}")))?;
            for row in rows {
                tasks.push(row.map_err(|e| app_error(format!("读取任务失败: {e}")))?);
            }
        } else {
            let mut stmt = conn
                .prepare(
                    "SELECT task_id, goal, plan, status, context, created_at, updated_at, logs
                     FROM agent_tasks ORDER BY created_at DESC LIMIT ?1",
                )
                .map_err(|e| app_error(format!("查询任务失败: {e}")))?;
            let rows = stmt
                .query_map(params![limit as i64], map_row)
                .map_err(|e| app_error(format!("查询任务失败: {e}")))?;
            for row in rows {
                tasks.push(row.map_err(|e| app_error(format!("读取任务失败: {e}")))?);
            }
        }
        Ok(tasks)
    }

    /// 全量覆盖（Planner 写回 plan / 执行器写回 logs / 状态更新都用它）
    pub fn update(&self, task: &Task) -> Result<(), AppError> {
        let conn = self.conn()?;
        let updated = chrono::Utc::now().to_rfc3339();
        conn.execute(
            "UPDATE agent_tasks SET goal = ?2, plan = ?3, status = ?4, context = ?5, updated_at = ?6, logs = ?7
             WHERE task_id = ?1",
            params![
                task.task_id,
                task.goal,
                serde_json::to_string(&task.plan).map_err(|e| app_error(format!("序列化 plan 失败: {e}")))?,
                serde_json::to_string(&task.status).map_err(|e| app_error(format!("序列化 status 失败: {e}")))?,
                task.context
                    .as_ref()
                    .map(|c| c.to_string())
                    .unwrap_or_else(|| "null".to_string()),
                updated,
                serde_json::to_string(&task.logs).map_err(|e| app_error(format!("序列化 logs 失败: {e}")))?,
            ],
        )
        .map_err(|e| app_error(format!("更新任务失败: {e}")))?;
        Ok(())
    }

    pub fn update_status(
        &self,
        task_id: &str,
        status: TaskStatus,
    ) -> Result<Option<Task>, AppError> {
        let conn = self.conn()?;
        let updated = chrono::Utc::now().to_rfc3339();
        let status_json = serde_json::to_string(&status)
            .map_err(|e| app_error(format!("序列化 status 失败: {e}")))?;
        let affected = conn
            .execute(
                "UPDATE agent_tasks SET status = ?2, updated_at = ?3 WHERE task_id = ?1",
                params![task_id, status_json, updated],
            )
            .map_err(|e| app_error(format!("更新状态失败: {e}")))?;
        if affected == 0 {
            return Ok(None);
        }
        self.get(task_id)
    }

    pub fn delete(&self, task_id: &str) -> Result<bool, AppError> {
        let conn = self.conn()?;
        let affected = conn
            .execute("DELETE FROM agent_tasks WHERE task_id = ?1", params![task_id])
            .map_err(|e| app_error(format!("删除任务失败: {e}")))?;
        Ok(affected > 0)
    }
}

fn map_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<Task> {
    let plan: String = row.get(2)?;
    let status: String = row.get(3)?;
    let context: String = row.get(4)?;
    let logs: String = row.get(7)?;
    Ok(Task {
        task_id: row.get(0)?,
        goal: row.get(1)?,
        plan: serde_json::from_str(&plan).unwrap_or_default(),
        status: serde_json::from_str(&status).unwrap_or(TaskStatus::Planned),
        context: serde_json::from_str(&context)
            .ok()
            .filter(|v: &serde_json::Value| !v.is_null()),
        created_at: row.get(5)?,
        updated_at: row.get(6)?,
        logs: serde_json::from_str(&logs).unwrap_or_default(),
    })
}

const SCHEMA: &str = "
CREATE TABLE IF NOT EXISTS agent_tasks (
    task_id    TEXT PRIMARY KEY,
    goal       TEXT NOT NULL,
    plan       TEXT NOT NULL,
    status     TEXT NOT NULL,
    context    TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    logs       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_agent_tasks_status ON agent_tasks(status);
";

/// IPC：创建任务（Plan 阶段由 Planner 回写 plan）
#[tauri::command]
pub fn agent_task_create(
    store: tauri::State<'_, AgentTaskStore>,
    goal: String,
) -> Result<Task, AppError> {
    let task = Task::new(format!("task-{}", chrono::Utc::now().timestamp_millis()), goal);
    store.create(&task)?;
    Ok(task)
}

/// IPC：查询任务
#[tauri::command]
pub fn agent_task_get(
    store: tauri::State<'_, AgentTaskStore>,
    task_id: String,
) -> Result<Option<Task>, AppError> {
    store.get(&task_id)
}

/// IPC：任务列表（可选按状态过滤）
#[tauri::command]
pub fn agent_task_list(
    store: tauri::State<'_, AgentTaskStore>,
    limit: Option<usize>,
    status: Option<String>,
) -> Result<Vec<Task>, AppError> {
    let status = match status {
        Some(s) => Some(TaskStatus::parse(&s)?),
        None => None,
    };
    store.list(limit.unwrap_or(50), status)
}

/// IPC：更新任务状态。状态机转移由 Rust 编排侧（runner.transition）负责，
/// 外部只允许把非终态任务置为 Cancelled（如手动取消卡住的任务），避免任意改状态破坏编排。
#[tauri::command]
pub fn agent_task_update_status(
    store: tauri::State<'_, AgentTaskStore>,
    task_id: String,
    status: String,
) -> Result<Option<Task>, AppError> {
    let status = TaskStatus::parse(&status)?;
    let existing = store.get(&task_id)?;
    let Some(task) = existing else {
        return Ok(None);
    };
    if status != TaskStatus::Cancelled {
        return Err(AppError::new(
            "statusNotAllowed",
            format!("外部仅允许将任务置为取消（当前 {:?}）", task.status),
        ));
    }
    if matches!(
        task.status,
        TaskStatus::Done | TaskStatus::Failed | TaskStatus::Cancelled
    ) {
        return Err(AppError::new(
            "statusNotAllowed",
            format!("任务已处于终态 {:?}，无法取消", task.status),
        ));
    }
    store.update_status(&task_id, status)
}

/// IPC：删除任务
#[tauri::command]
pub fn agent_task_delete(
    store: tauri::State<'_, AgentTaskStore>,
    task_id: String,
) -> Result<bool, AppError> {
    store.delete(&task_id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn temp_path(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "floral_task_test_{}_{}.sqlite",
            std::process::id(),
            name
        ))
    }

    fn test_task(id: &str, goal: &str) -> Task {
        let mut task = Task::new(id, goal);
        task.plan.push(Step {
            step_id: "s1".into(),
            kind: StepKind::Tool,
            tool: Some("note.search".into()),
            input: serde_json::json!({"query": goal}),
            output: None,
            status: StepStatus::Pending,
            required_confirm: false,
            confirmed: false,
        });
        task
    }

    #[test]
    fn create_get_update_status_roundtrip() {
        let path = temp_path("roundtrip");
        let _ = std::fs::remove_file(&path);
        let store = AgentTaskStore::new(&path);

        store.create(&test_task("t1", "整理画布思路")).unwrap();
        let task = store.get("t1").unwrap().unwrap();
        assert_eq!(task.goal, "整理画布思路");
        assert_eq!(task.status, TaskStatus::Planned);
        assert_eq!(task.plan.len(), 1);
        assert_eq!(task.plan[0].tool.as_deref(), Some("note.search"));

        let updated = store.update_status("t1", TaskStatus::Running).unwrap().unwrap();
        assert_eq!(updated.status, TaskStatus::Running);
        assert!(updated.updated_at >= task.updated_at);

        // 未知状态解析报错
        let parse_err = TaskStatus::parse("xxx").unwrap_err();
        assert_eq!(parse_err.code, "invalidTaskStatus");
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn update_persists_plan_and_context() {
        let path = temp_path("update");
        let _ = std::fs::remove_file(&path);
        let store = AgentTaskStore::new(&path);

        let mut task = test_task("t2", "写周报");
        task.context = Some(serde_json::json!({"memory": "上周完成 RAG 落地"}));
        store.create(&task).unwrap();

        task.plan.push(Step {
            step_id: "s2".into(),
            kind: StepKind::Llm,
            tool: None,
            input: serde_json::json!({"prompt": "汇总"}),
            output: None,
            status: StepStatus::Pending,
            required_confirm: false,
            confirmed: false,
        });
        task.status = TaskStatus::Done;
        store.update(&task).unwrap();

        let loaded = store.get("t2").unwrap().unwrap();
        assert_eq!(loaded.plan.len(), 2);
        assert_eq!(loaded.status, TaskStatus::Done);
        assert_eq!(loaded.context.unwrap()["memory"], "上周完成 RAG 落地");

        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn list_filters_by_status() {
        let path = temp_path("list");
        let _ = std::fs::remove_file(&path);
        let store = AgentTaskStore::new(&path);

        store.create(&test_task("a", "任务A")).unwrap();
        let mut b = test_task("b", "任务B");
        b.status = TaskStatus::Done;
        store.create(&b).unwrap();

        let all = store.list(10, None).unwrap();
        assert_eq!(all.len(), 2);

        let done = store.list(10, Some(TaskStatus::Done)).unwrap();
        assert_eq!(done.len(), 1);
        assert_eq!(done[0].task_id, "b");

        // 删除
        assert!(store.delete("a").unwrap());
        assert!(store.get("a").unwrap().is_none());

        let _ = std::fs::remove_file(&path);
    }
}
