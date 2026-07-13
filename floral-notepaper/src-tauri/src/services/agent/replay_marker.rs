use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;

use super::event_collector::StandardizedEvent;
use super::llm_orchestrator::{InsightLevel, StructuredInsight};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ReplayMarkerConfig {
    pub min_interval_seconds: i64,
    pub min_event_weight: i64,
    pub min_insight_level: InsightLevel,
}

impl Default for ReplayMarkerConfig {
    fn default() -> Self {
        Self {
            min_interval_seconds: 30,
            min_event_weight: 50,
            min_insight_level: InsightLevel::Hint,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ReplayKeyframe {
    pub marker_id: String,
    pub timestamp: DateTime<Utc>,
    pub marker_type: String,
    pub label: String,
    pub context: Value,
    pub manual: bool,
}

#[derive(Default)]
pub struct ReplayMarkerStore {
    markers: BTreeMap<String, ReplayKeyframe>,
}

impl ReplayMarkerStore {
    pub fn generate_from_events_and_insights(
        &mut self,
        events: &[StandardizedEvent],
        insights: &[StructuredInsight],
        config: ReplayMarkerConfig,
    ) -> Vec<ReplayKeyframe> {
        let mut generated = Vec::new();
        let mut last_timestamp: Option<DateTime<Utc>> = None;

        for event in events {
            let weight = event_weight(&event.event_type);
            if weight < config.min_event_weight
                || too_close(last_timestamp, event.timestamp, config.min_interval_seconds)
            {
                continue;
            }
            let marker = ReplayKeyframe {
                marker_id: format!("event:{}", event.event_id),
                timestamp: event.timestamp,
                marker_type: "event".to_string(),
                label: event.event_type.clone(),
                context: event.payload.clone(),
                manual: false,
            };
            last_timestamp = Some(event.timestamp);
            self.markers
                .insert(marker.marker_id.clone(), marker.clone());
            generated.push(marker);
        }

        for insight in insights {
            if insight.level < config.min_insight_level {
                continue;
            }
            let marker = ReplayKeyframe {
                marker_id: format!("insight:{}", insight.insight_id),
                timestamp: insight.created_at,
                marker_type: "insight".to_string(),
                label: insight.title.clone(),
                context: serde_json::json!({ "summary": insight.summary, "actions": insight.actions }),
                manual: false,
            };
            self.markers
                .insert(marker.marker_id.clone(), marker.clone());
            generated.push(marker);
        }
        generated.sort_by_key(|marker| marker.timestamp);
        generated
    }

    pub fn add_manual(&mut self, marker: ReplayKeyframe) {
        self.markers.insert(
            marker.marker_id.clone(),
            ReplayKeyframe {
                manual: true,
                ..marker
            },
        );
    }

    pub fn update(&mut self, marker_id: &str, label: String, context: Value) -> bool {
        if let Some(marker) = self.markers.get_mut(marker_id) {
            marker.label = label;
            marker.context = context;
            return true;
        }
        false
    }

    pub fn delete(&mut self, marker_id: &str) -> bool {
        self.markers.remove(marker_id).is_some()
    }

    pub fn jump_context(&self, marker_id: &str) -> Option<ReplayKeyframe> {
        self.markers.get(marker_id).cloned()
    }

    pub fn list(&self) -> Vec<ReplayKeyframe> {
        let mut markers: Vec<_> = self.markers.values().cloned().collect();
        markers.sort_by_key(|marker| marker.timestamp);
        markers
    }
}

fn event_weight(event_type: &str) -> i64 {
    match event_type {
        "conflict_detected" | "canvas_node_deleted" => 90,
        "handoff_detected" | "consensus_reached" => 80,
        "canvas_shape_added" | "chat_message_sent" => 60,
        _ => 20,
    }
}

fn too_close(last: Option<DateTime<Utc>>, current: DateTime<Utc>, interval_seconds: i64) -> bool {
    last.map(|value| current - value < Duration::seconds(interval_seconds))
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::agent::event_collector::{CollectionProtocol, StandardizedEvent};

    #[test]
    fn generates_markers_from_weighted_events_and_insights() {
        let mut store = ReplayMarkerStore::default();
        let events = vec![
            test_event("e1", "canvas_shape_added", 0),
            test_event("e2", "noise", 60),
        ];
        let insights = vec![test_insight(InsightLevel::Warning)];
        let markers = store.generate_from_events_and_insights(
            &events,
            &insights,
            ReplayMarkerConfig::default(),
        );
        assert_eq!(markers.len(), 2);
        assert!(store.jump_context("event:e1").is_some());
    }

    #[test]
    fn supports_manual_editing() {
        let mut store = ReplayMarkerStore::default();
        let marker = ReplayKeyframe {
            marker_id: "manual-1".to_string(),
            timestamp: Utc::now(),
            marker_type: "manual".to_string(),
            label: "旧标签".to_string(),
            context: serde_json::json!({}),
            manual: false,
        };
        store.add_manual(marker);
        assert!(store.update(
            "manual-1",
            "新标签".to_string(),
            serde_json::json!({ "a": 1 })
        ));
        assert_eq!(store.jump_context("manual-1").unwrap().label, "新标签");
        assert!(store.delete("manual-1"));
    }

    fn test_event(id: &str, event_type: &str, seconds: i64) -> StandardizedEvent {
        StandardizedEvent {
            event_id: id.to_string(),
            event_type: event_type.to_string(),
            timestamp: Utc::now() + Duration::seconds(seconds),
            source_id: "ui".to_string(),
            source_address: "local".to_string(),
            protocol: CollectionProtocol::Local,
            payload: serde_json::json!({ "nodeId": "n1" }),
        }
    }

    fn test_insight(level: InsightLevel) -> StructuredInsight {
        StructuredInsight {
            insight_id: "i1".to_string(),
            event_type: "chat_message_sent".to_string(),
            level,
            title: "洞察".to_string(),
            summary: "关键节点".to_string(),
            actions: vec![],
            created_at: Utc::now() + Duration::seconds(120),
            metadata: serde_json::json!({}),
        }
    }
}
