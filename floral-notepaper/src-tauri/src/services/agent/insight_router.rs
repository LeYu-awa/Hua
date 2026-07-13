use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;

use super::llm_orchestrator::{InsightLevel, StructuredInsight};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "camelCase")]
pub enum InsightChannel {
    UiRealtime,
    Live2DSignal,
    ReplayLibrary,
    ReviewReport,
    FallbackLog,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ChannelStatus {
    Healthy,
    Degraded,
    Unavailable,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RoutedInsightPayload {
    pub channel: InsightChannel,
    pub content: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DispatchLog {
    pub insight_id: String,
    pub channel: InsightChannel,
    pub status: ChannelStatus,
    pub message: String,
    pub dispatched_at: DateTime<Utc>,
}

#[derive(Default)]
pub struct InsightRouter {
    channel_health: BTreeMap<InsightChannel, ChannelStatus>,
    logs: Vec<DispatchLog>,
}

impl InsightRouter {
    pub fn new() -> Self {
        let mut router = Self::default();
        for channel in [
            InsightChannel::UiRealtime,
            InsightChannel::Live2DSignal,
            InsightChannel::ReplayLibrary,
            InsightChannel::ReviewReport,
        ] {
            router
                .channel_health
                .insert(channel, ChannelStatus::Healthy);
        }
        router
    }

    pub fn set_channel_status(&mut self, channel: InsightChannel, status: ChannelStatus) {
        self.channel_health.insert(channel, status);
    }

    pub fn dispatch(&mut self, insight: &StructuredInsight) -> Vec<RoutedInsightPayload> {
        let mut routed = Vec::new();
        for channel in [
            InsightChannel::UiRealtime,
            InsightChannel::Live2DSignal,
            InsightChannel::ReplayLibrary,
            InsightChannel::ReviewReport,
        ] {
            let status = self
                .channel_health
                .get(&channel)
                .cloned()
                .unwrap_or(ChannelStatus::Unavailable);
            if status == ChannelStatus::Healthy {
                routed.push(RoutedInsightPayload {
                    channel: channel.clone(),
                    content: adapt_for_channel(insight, &channel),
                });
                self.logs.push(DispatchLog {
                    insight_id: insight.insight_id.clone(),
                    channel,
                    status,
                    message: "dispatched".to_string(),
                    dispatched_at: Utc::now(),
                });
            } else {
                self.logs.push(DispatchLog {
                    insight_id: insight.insight_id.clone(),
                    channel: channel.clone(),
                    status,
                    message: "fallback to log".to_string(),
                    dispatched_at: Utc::now(),
                });
                routed.push(RoutedInsightPayload {
                    channel: InsightChannel::FallbackLog,
                    content: fallback_payload(insight, &channel),
                });
            }
        }
        routed
    }

    pub fn logs(&self) -> &[DispatchLog] {
        &self.logs
    }

    pub fn logs_for(&self, insight_id: &str) -> Vec<DispatchLog> {
        self.logs
            .iter()
            .filter(|log| log.insight_id == insight_id)
            .cloned()
            .collect()
    }
}

fn adapt_for_channel(insight: &StructuredInsight, channel: &InsightChannel) -> Value {
    match channel {
        InsightChannel::UiRealtime => serde_json::json!({
            "id": insight.insight_id,
            "title": insight.title,
            "summary": insight.summary,
            "level": insight.level,
            "actions": insight.actions,
        }),
        InsightChannel::Live2DSignal => serde_json::json!({
            "signalType": live2d_signal_type(&insight.level),
            "priority": level_priority(&insight.level),
            "text": insight.summary,
        }),
        InsightChannel::ReplayLibrary => serde_json::json!({
            "markerType": replay_marker_type(&insight.level),
            "label": insight.title,
            "context": insight.summary,
        }),
        InsightChannel::ReviewReport => serde_json::json!({
            "section": report_section(&insight.level),
            "title": insight.title,
            "body": insight.summary,
            "nextSteps": insight.actions,
        }),
        InsightChannel::FallbackLog => fallback_payload(insight, channel),
    }
}

fn fallback_payload(insight: &StructuredInsight, failed_channel: &InsightChannel) -> Value {
    serde_json::json!({
        "failedChannel": failed_channel,
        "insightId": insight.insight_id,
        "payload": insight,
    })
}

fn live2d_signal_type(level: &InsightLevel) -> &'static str {
    match level {
        InsightLevel::Critical | InsightLevel::Warning => "alert",
        InsightLevel::Hint => "guide",
        InsightLevel::Info => "idle",
    }
}

fn replay_marker_type(level: &InsightLevel) -> &'static str {
    match level {
        InsightLevel::Critical | InsightLevel::Warning => "risk",
        InsightLevel::Hint => "hint",
        InsightLevel::Info => "info",
    }
}

fn report_section(level: &InsightLevel) -> &'static str {
    match level {
        InsightLevel::Critical | InsightLevel::Warning => "risks",
        InsightLevel::Hint => "nextSteps",
        InsightLevel::Info => "highlights",
    }
}

fn level_priority(level: &InsightLevel) -> i64 {
    match level {
        InsightLevel::Critical => 100,
        InsightLevel::Warning => 80,
        InsightLevel::Hint => 50,
        InsightLevel::Info => 20,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn routes_to_all_healthy_channels() {
        let mut router = InsightRouter::new();
        let outputs = router.dispatch(&test_insight(InsightLevel::Hint));
        assert_eq!(outputs.len(), 4);
        assert!(outputs
            .iter()
            .any(|output| output.channel == InsightChannel::UiRealtime));
        assert_eq!(router.logs().len(), 4);
    }

    #[test]
    fn falls_back_when_channel_unavailable() {
        let mut router = InsightRouter::new();
        router.set_channel_status(InsightChannel::Live2DSignal, ChannelStatus::Unavailable);
        let outputs = router.dispatch(&test_insight(InsightLevel::Warning));
        assert!(outputs
            .iter()
            .any(|output| output.channel == InsightChannel::FallbackLog));
        assert!(router
            .logs()
            .iter()
            .any(|log| log.message == "fallback to log"));
    }

    fn test_insight(level: InsightLevel) -> StructuredInsight {
        StructuredInsight {
            insight_id: "insight-1".to_string(),
            event_type: "chat_message_sent".to_string(),
            level,
            title: "洞察".to_string(),
            summary: "需要继续推进".to_string(),
            actions: vec!["沉淀下一步".to_string()],
            created_at: Utc::now(),
            metadata: serde_json::json!({}),
        }
    }
}
