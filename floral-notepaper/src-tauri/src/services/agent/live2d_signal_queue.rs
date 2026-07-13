use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::VecDeque;

use super::llm_orchestrator::{InsightLevel, StructuredInsight};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum Live2DState {
    Idle,
    Typing,
    Paused,
    Deleting,
    Saving,
    Completed,
    Hidden,
    Interacting,
    Hinting,
    Warning,
    Disconnected,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Live2DSignal {
    pub signal_id: String,
    pub action: String,
    pub priority: i64,
    pub payload: String,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HeartbeatStatus {
    pub connected: bool,
    pub state: Live2DState,
    pub queued_count: usize,
}

pub struct Live2DSignalQueue {
    state: Live2DState,
    connected: bool,
    queue: VecDeque<Live2DSignal>,
    sent: Vec<Live2DSignal>,
}

impl Default for Live2DSignalQueue {
    fn default() -> Self {
        Self {
            state: Live2DState::Idle,
            connected: true,
            queue: VecDeque::new(),
            sent: Vec::new(),
        }
    }
}

impl Live2DSignalQueue {
    pub fn enqueue(&mut self, signal: Live2DSignal) {
        if signal.priority >= 80 {
            self.queue.push_front(signal);
        } else {
            self.queue.push_back(signal);
        }
    }

    pub fn enqueue_from_insight(&mut self, insight: &StructuredInsight) {
        self.enqueue(Live2DSignal {
            signal_id: format!("live2d:{}", insight.insight_id),
            action: action_for_level(&insight.level).to_string(),
            priority: priority_for_level(&insight.level),
            payload: insight.summary.clone(),
            created_at: Utc::now(),
        });
    }

    pub fn dispatch_next(&mut self) -> Option<Live2DSignal> {
        if !self.connected {
            self.state = Live2DState::Disconnected;
            return None;
        }
        let signal = self.queue.pop_front()?;
        self.state = state_for_action(&signal.action);
        self.sent.push(signal.clone());
        Some(signal)
    }

    pub fn heartbeat(&mut self, connected: bool) -> HeartbeatStatus {
        self.connected = connected;
        if !connected {
            self.state = Live2DState::Disconnected;
        } else if self.state == Live2DState::Disconnected {
            self.state = Live2DState::Idle;
        }
        HeartbeatStatus {
            connected: self.connected,
            state: self.state.clone(),
            queued_count: self.queue.len(),
        }
    }

    pub fn flush_after_reconnect(&mut self) -> Vec<Live2DSignal> {
        self.connected = true;
        self.state = Live2DState::Idle;
        let mut sent = Vec::new();
        while let Some(signal) = self.dispatch_next() {
            sent.push(signal);
        }
        sent
    }

    pub fn queued_count(&self) -> usize {
        self.queue.len()
    }

    pub fn sent(&self) -> &[Live2DSignal] {
        &self.sent
    }
}

fn action_for_level(level: &InsightLevel) -> &'static str {
    match level {
        InsightLevel::Critical | InsightLevel::Warning => "alert",
        InsightLevel::Hint => "guide",
        InsightLevel::Info => "idle",
    }
}

fn priority_for_level(level: &InsightLevel) -> i64 {
    match level {
        InsightLevel::Critical => 100,
        InsightLevel::Warning => 80,
        InsightLevel::Hint => 50,
        InsightLevel::Info => 10,
    }
}

fn state_for_action(action: &str) -> Live2DState {
    match action {
        "typing" | "tap_left" | "tap_right" | "tap_both" => Live2DState::Typing,
        "pause" => Live2DState::Paused,
        "delete" => Live2DState::Deleting,
        "save" => Live2DState::Saving,
        "complete" => Live2DState::Completed,
        "hide" | "hidden" => Live2DState::Hidden,
        "alert" => Live2DState::Warning,
        "guide" => Live2DState::Hinting,
        "interact" => Live2DState::Interacting,
        _ => Live2DState::Idle,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn high_priority_signal_jumps_queue() {
        let mut queue = Live2DSignalQueue::default();
        queue.enqueue(test_signal("low", "guide", 10));
        queue.enqueue(test_signal("high", "alert", 100));
        assert_eq!(queue.dispatch_next().unwrap().signal_id, "high");
    }

    #[test]
    fn caches_signals_when_disconnected_and_flushes() {
        let mut queue = Live2DSignalQueue::default();
        queue.heartbeat(false);
        queue.enqueue(test_signal("s1", "guide", 50));
        assert!(queue.dispatch_next().is_none());
        assert_eq!(queue.queued_count(), 1);
        let flushed = queue.flush_after_reconnect();
        assert_eq!(flushed.len(), 1);
        assert_eq!(queue.sent().len(), 1);
    }

    fn test_signal(id: &str, action: &str, priority: i64) -> Live2DSignal {
        Live2DSignal {
            signal_id: id.to_string(),
            action: action.to_string(),
            priority,
            payload: "payload".to_string(),
            created_at: Utc::now(),
        }
    }
}
