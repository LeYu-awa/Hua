use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::collections::BTreeSet;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum CollectionProtocol {
    Http,
    WebSocket,
    Local,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct EventSource {
    pub source_id: String,
    pub source_address: String,
    pub protocol: CollectionProtocol,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RawEvent {
    pub event_type: String,
    #[serde(default)]
    pub timestamp: Option<DateTime<Utc>>,
    pub source: EventSource,
    #[serde(default)]
    pub payload: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StandardizedEvent {
    pub event_id: String,
    pub event_type: String,
    pub timestamp: DateTime<Utc>,
    pub source_id: String,
    pub source_address: String,
    pub protocol: CollectionProtocol,
    pub payload: Value,
}

#[derive(Debug, Clone, Default)]
pub struct EventFilter {
    pub allow_event_types: BTreeSet<String>,
    pub deny_event_types: BTreeSet<String>,
    pub allow_sources: BTreeSet<String>,
    pub deny_sources: BTreeSet<String>,
}

impl EventFilter {
    pub fn allows(&self, event_type: &str, source_id: &str) -> bool {
        if self.deny_event_types.contains(event_type) || self.deny_sources.contains(source_id) {
            return false;
        }
        if !self.allow_event_types.is_empty() && !self.allow_event_types.contains(event_type) {
            return false;
        }
        if !self.allow_sources.is_empty() && !self.allow_sources.contains(source_id) {
            return false;
        }
        true
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum EventCollectorError {
    MissingEventType,
    MissingSourceId,
    MissingSourceAddress,
}

pub struct EventCollector {
    filter: EventFilter,
}

impl EventCollector {
    pub fn new(filter: EventFilter) -> Self {
        Self { filter }
    }

    pub fn collect(&self, raw: RawEvent) -> Result<Option<StandardizedEvent>, EventCollectorError> {
        let event_type = raw.event_type.trim();
        if event_type.is_empty() {
            return Err(EventCollectorError::MissingEventType);
        }
        let source_id = raw.source.source_id.trim();
        if source_id.is_empty() {
            return Err(EventCollectorError::MissingSourceId);
        }
        let source_address = raw.source.source_address.trim();
        if source_address.is_empty() {
            return Err(EventCollectorError::MissingSourceAddress);
        }
        if !self.filter.allows(event_type, source_id) {
            return Ok(None);
        }

        Ok(Some(StandardizedEvent {
            event_id: Uuid::new_v4().to_string(),
            event_type: event_type.to_string(),
            timestamp: raw.timestamp.unwrap_or_else(Utc::now),
            source_id: source_id.to_string(),
            source_address: source_address.to_string(),
            protocol: raw.source.protocol,
            payload: clean_payload(raw.payload),
        }))
    }

    pub fn collect_http(
        &self,
        source_id: impl Into<String>,
        source_address: impl Into<String>,
        event_type: impl Into<String>,
        payload: Value,
    ) -> Result<Option<StandardizedEvent>, EventCollectorError> {
        self.collect(RawEvent {
            event_type: event_type.into(),
            timestamp: None,
            source: EventSource {
                source_id: source_id.into(),
                source_address: source_address.into(),
                protocol: CollectionProtocol::Http,
            },
            payload,
        })
    }

    pub fn collect_websocket(
        &self,
        source_id: impl Into<String>,
        source_address: impl Into<String>,
        event_type: impl Into<String>,
        payload: Value,
    ) -> Result<Option<StandardizedEvent>, EventCollectorError> {
        self.collect(RawEvent {
            event_type: event_type.into(),
            timestamp: None,
            source: EventSource {
                source_id: source_id.into(),
                source_address: source_address.into(),
                protocol: CollectionProtocol::WebSocket,
            },
            payload,
        })
    }
}

fn clean_payload(payload: Value) -> Value {
    match payload {
        Value::Object(map) => Value::Object(clean_object(map)),
        Value::Null => Value::Object(Map::new()),
        other => serde_json::json!({ "value": other }),
    }
}

fn clean_object(map: Map<String, Value>) -> Map<String, Value> {
    map.into_iter()
        .filter_map(|(key, value)| {
            let key = key.trim();
            if key.is_empty() || key.starts_with('_') || value.is_null() {
                return None;
            }
            Some((key.to_string(), value))
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn standardizes_http_event() {
        let collector = EventCollector::new(EventFilter::default());
        let event = collector
            .collect_http(
                "ui",
                "127.0.0.1",
                "canvas_shape_added",
                json!({ "nodeId": "n1", "_debug": true, "empty": null }),
            )
            .unwrap()
            .unwrap();

        assert_eq!(event.event_type, "canvas_shape_added");
        assert_eq!(event.source_id, "ui");
        assert_eq!(event.protocol, CollectionProtocol::Http);
        assert!(event.payload.get("nodeId").is_some());
        assert!(event.payload.get("_debug").is_none());
    }

    #[test]
    fn rejects_missing_core_fields() {
        let collector = EventCollector::new(EventFilter::default());
        let error = collector
            .collect_http("", "127.0.0.1", "canvas_shape_added", json!({}))
            .unwrap_err();
        assert_eq!(error, EventCollectorError::MissingSourceId);
    }

    #[test]
    fn filters_by_type_and_source() {
        let mut filter = EventFilter::default();
        filter
            .allow_event_types
            .insert("chat_message_sent".to_string());
        filter.deny_sources.insert("noise".to_string());
        let collector = EventCollector::new(filter);

        assert!(collector
            .collect_http("ui", "127.0.0.1", "canvas_shape_added", json!({}))
            .unwrap()
            .is_none());
        assert!(collector
            .collect_http("noise", "127.0.0.1", "chat_message_sent", json!({}))
            .unwrap()
            .is_none());
        assert!(collector
            .collect_http("ui", "127.0.0.1", "chat_message_sent", json!({}))
            .unwrap()
            .is_some());
    }
}
