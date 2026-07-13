use super::event_collector::{CollectionProtocol, StandardizedEvent};
use chrono::{DateTime, Duration, Utc};
use rusqlite::{params, Connection, ErrorCode, OptionalExtension};
use serde_json::Value;
use std::{path::PathBuf, thread, time::Duration as StdDuration};

#[derive(Debug)]
pub enum EventStoreError {
    Sqlite(String),
    Json(String),
}

pub type EventStoreResult<T> = Result<T, EventStoreError>;

#[derive(Debug, Clone, Default)]
pub struct EventQuery {
    pub start: Option<DateTime<Utc>>,
    pub end: Option<DateTime<Utc>>,
    pub event_type: Option<String>,
    pub source_id: Option<String>,
    pub limit: u32,
    pub offset: u32,
}

pub struct AgentEventStore {
    path: PathBuf,
    max_retries: usize,
}

impl AgentEventStore {
    pub fn new(path: impl Into<PathBuf>) -> EventStoreResult<Self> {
        let store = Self {
            path: path.into(),
            max_retries: 3,
        };
        store.init_schema()?;
        Ok(store)
    }

    pub fn insert(&self, event: &StandardizedEvent) -> EventStoreResult<()> {
        let conn = self.connection()?;
        self.with_retry(|| {
            conn.execute(
                "INSERT OR REPLACE INTO agent_event_sources
                    (source_id, source_address, protocol, updated_at)
                 VALUES (?1, ?2, ?3, ?4)",
                params![
                    event.source_id,
                    event.source_address,
                    protocol_to_str(&event.protocol),
                    Utc::now().to_rfc3339()
                ],
            )?;
            conn.execute(
                "INSERT OR REPLACE INTO agent_events
                    (event_id, event_type, timestamp, source_id, payload)
                 VALUES (?1, ?2, ?3, ?4, ?5)",
                params![
                    event.event_id,
                    event.event_type,
                    event.timestamp.to_rfc3339(),
                    event.source_id,
                    serde_json::to_string(&event.payload).map_err(|error| {
                        rusqlite::Error::ToSqlConversionFailure(Box::new(error))
                    })?
                ],
            )?;
            Ok(())
        })
    }

    pub fn get(&self, event_id: &str) -> EventStoreResult<Option<StandardizedEvent>> {
        let conn = self.connection()?;
        self.with_retry(|| {
            conn.query_row(
                "SELECT e.event_id, e.event_type, e.timestamp, s.source_id, s.source_address, s.protocol, e.payload
                 FROM agent_events e
                 JOIN agent_event_sources s ON s.source_id = e.source_id
                 WHERE e.event_id = ?1",
                params![event_id],
                event_from_row,
            )
            .optional()
        })
    }

    pub fn update_payload(&self, event_id: &str, payload: Value) -> EventStoreResult<bool> {
        let conn = self.connection()?;
        self.with_retry(|| {
            let changed = conn.execute(
                "UPDATE agent_events SET payload = ?2 WHERE event_id = ?1",
                params![
                    event_id,
                    serde_json::to_string(&payload).map_err(|error| {
                        rusqlite::Error::ToSqlConversionFailure(Box::new(error))
                    })?
                ],
            )?;
            Ok(changed > 0)
        })
    }

    pub fn delete(&self, event_id: &str) -> EventStoreResult<bool> {
        let conn = self.connection()?;
        self.with_retry(|| {
            let changed = conn.execute(
                "DELETE FROM agent_events WHERE event_id = ?1",
                params![event_id],
            )?;
            Ok(changed > 0)
        })
    }

    pub fn query(&self, query: EventQuery) -> EventStoreResult<Vec<StandardizedEvent>> {
        let conn = self.connection()?;
        let limit = query.limit.clamp(1, 500);
        let offset = query.offset;
        let start = query.start.map(|value| value.to_rfc3339());
        let end = query.end.map(|value| value.to_rfc3339());
        self.with_retry(|| {
            let mut stmt = conn.prepare(
                "SELECT e.event_id, e.event_type, e.timestamp, s.source_id, s.source_address, s.protocol, e.payload
                 FROM agent_events e
                 JOIN agent_event_sources s ON s.source_id = e.source_id
                 WHERE (?1 IS NULL OR e.timestamp >= ?1)
                   AND (?2 IS NULL OR e.timestamp <= ?2)
                   AND (?3 IS NULL OR e.event_type = ?3)
                   AND (?4 IS NULL OR e.source_id = ?4)
                 ORDER BY e.timestamp ASC
                 LIMIT ?5 OFFSET ?6",
            )?;
            let rows = stmt.query_map(
                params![start, end, query.event_type, query.source_id, limit, offset],
                event_from_row,
            )?;
            rows.collect()
        })
    }

    pub fn purge_older_than_days(&self, days: i64) -> EventStoreResult<usize> {
        let conn = self.connection()?;
        let cutoff = (Utc::now() - Duration::days(days)).to_rfc3339();
        self.with_retry(|| {
            conn.execute(
                "DELETE FROM agent_events WHERE timestamp < ?1",
                params![cutoff],
            )
        })
    }

    fn init_schema(&self) -> EventStoreResult<()> {
        let conn = self.connection()?;
        self.with_retry(|| {
            conn.pragma_update(None, "journal_mode", "WAL")?;
            conn.execute_batch(
                "CREATE TABLE IF NOT EXISTS agent_event_sources (
                    source_id TEXT PRIMARY KEY,
                    source_address TEXT NOT NULL,
                    protocol TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS agent_events (
                    event_id TEXT PRIMARY KEY,
                    event_type TEXT NOT NULL,
                    timestamp TEXT NOT NULL,
                    source_id TEXT NOT NULL,
                    payload TEXT NOT NULL,
                    FOREIGN KEY(source_id) REFERENCES agent_event_sources(source_id)
                );

                CREATE INDEX IF NOT EXISTS idx_agent_events_time_type
                    ON agent_events(timestamp ASC, event_type);
                CREATE INDEX IF NOT EXISTS idx_agent_events_source
                    ON agent_events(source_id, timestamp ASC);",
            )?;
            Ok(())
        })
    }

    fn connection(&self) -> EventStoreResult<Connection> {
        Connection::open(&self.path).map_err(sqlite_error)
    }

    fn with_retry<T>(&self, mut op: impl FnMut() -> rusqlite::Result<T>) -> EventStoreResult<T> {
        let mut last_error = None;
        for attempt in 0..=self.max_retries {
            match op() {
                Ok(value) => return Ok(value),
                Err(error) if is_retryable(&error) && attempt < self.max_retries => {
                    last_error = Some(error);
                    thread::sleep(StdDuration::from_millis(25 * (attempt as u64 + 1)));
                }
                Err(error) => return Err(sqlite_error(error)),
            }
        }
        Err(sqlite_error(
            last_error.expect("retry loop stores an error"),
        ))
    }
}

fn event_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<StandardizedEvent> {
    let timestamp: String = row.get(2)?;
    let payload: String = row.get(6)?;
    let protocol: String = row.get(5)?;
    Ok(StandardizedEvent {
        event_id: row.get(0)?,
        event_type: row.get(1)?,
        timestamp: DateTime::parse_from_rfc3339(&timestamp)
            .map(|value| value.with_timezone(&Utc))
            .unwrap_or_else(|_| Utc::now()),
        source_id: row.get(3)?,
        source_address: row.get(4)?,
        protocol: str_to_protocol(&protocol),
        payload: serde_json::from_str(&payload).unwrap_or(Value::Null),
    })
}

fn protocol_to_str(protocol: &CollectionProtocol) -> &'static str {
    match protocol {
        CollectionProtocol::Http => "http",
        CollectionProtocol::WebSocket => "webSocket",
        CollectionProtocol::Local => "local",
    }
}

fn str_to_protocol(value: &str) -> CollectionProtocol {
    match value {
        "http" => CollectionProtocol::Http,
        "webSocket" => CollectionProtocol::WebSocket,
        _ => CollectionProtocol::Local,
    }
}

fn is_retryable(error: &rusqlite::Error) -> bool {
    matches!(
        error,
        rusqlite::Error::SqliteFailure(err, _)
            if err.code == ErrorCode::DatabaseBusy || err.code == ErrorCode::DatabaseLocked
    )
}

fn sqlite_error(error: rusqlite::Error) -> EventStoreError {
    EventStoreError::Sqlite(error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::agent::event_collector::{CollectionProtocol, StandardizedEvent};
    use serde_json::json;
    use uuid::Uuid;

    #[test]
    fn stores_and_queries_events() {
        let store = AgentEventStore::new(temp_db()).unwrap();
        let event = test_event("canvas_shape_added", Utc::now());
        store.insert(&event).unwrap();

        assert_eq!(
            store.get(&event.event_id).unwrap().unwrap().event_id,
            event.event_id
        );
        let events = store
            .query(EventQuery {
                event_type: Some("canvas_shape_added".to_string()),
                limit: 10,
                ..EventQuery::default()
            })
            .unwrap();
        assert_eq!(events.len(), 1);
    }

    #[test]
    fn updates_and_deletes_events() {
        let store = AgentEventStore::new(temp_db()).unwrap();
        let event = test_event("chat_message_sent", Utc::now());
        store.insert(&event).unwrap();
        assert!(store
            .update_payload(&event.event_id, json!({ "content": "updated" }))
            .unwrap());
        assert_eq!(
            store.get(&event.event_id).unwrap().unwrap().payload["content"],
            "updated"
        );
        assert!(store.delete(&event.event_id).unwrap());
        assert!(store.get(&event.event_id).unwrap().is_none());
    }

    #[test]
    fn purges_old_events() {
        let store = AgentEventStore::new(temp_db()).unwrap();
        store
            .insert(&test_event("old", Utc::now() - Duration::days(31)))
            .unwrap();
        store.insert(&test_event("new", Utc::now())).unwrap();
        assert_eq!(store.purge_older_than_days(30).unwrap(), 1);
        assert_eq!(
            store
                .query(EventQuery {
                    limit: 10,
                    ..EventQuery::default()
                })
                .unwrap()
                .len(),
            1
        );
    }

    fn test_event(event_type: &str, timestamp: DateTime<Utc>) -> StandardizedEvent {
        StandardizedEvent {
            event_id: Uuid::new_v4().to_string(),
            event_type: event_type.to_string(),
            timestamp,
            source_id: "ui".to_string(),
            source_address: "local".to_string(),
            protocol: CollectionProtocol::Local,
            payload: json!({ "nodeId": "n1" }),
        }
    }

    fn temp_db() -> PathBuf {
        std::env::temp_dir().join(format!("agent-event-store-{}.sqlite", Uuid::new_v4()))
    }
}
