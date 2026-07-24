use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

use super::event_collector::StandardizedEvent;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum RuleActionKind {
    UiHint,
    Live2DSignal,
    ReplayMarker,
    ReviewReport,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AgentRule {
    pub rule_id: String,
    pub event_type: Option<String>,
    pub min_count: usize,
    pub window_minutes: i64,
    pub cooldown_minutes: i64,
    pub priority: i64,
    pub action: RuleActionKind,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TriggerInstruction {
    pub instruction_id: String,
    pub rule_id: String,
    pub action: RuleActionKind,
    pub event_ids: Vec<String>,
    pub priority: i64,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RuleExecutionLog {
    pub rule_id: String,
    pub matched: bool,
    pub message: String,
    pub created_at: DateTime<Utc>,
}

#[derive(Default)]
pub struct RuleEngine {
    rules: BTreeMap<String, AgentRule>,
    last_triggered_at: BTreeMap<String, DateTime<Utc>>,
    logs: Vec<RuleExecutionLog>,
}

impl RuleEngine {
    pub fn new(rules: Vec<AgentRule>) -> Self {
        let mut engine = Self::default();
        engine.hot_update(rules);
        engine
    }

    pub fn hot_update(&mut self, rules: Vec<AgentRule>) {
        self.rules = rules
            .into_iter()
            .map(|rule| (rule.rule_id.clone(), rule))
            .collect();
    }

    pub fn detect_conflicts(&self) -> Vec<(String, String)> {
        let rules: Vec<_> = self.rules.values().filter(|rule| rule.enabled).collect();
        let mut conflicts = Vec::new();
        for (left_index, left) in rules.iter().enumerate() {
            for right in rules.iter().skip(left_index + 1) {
                if left.event_type == right.event_type && left.action == right.action {
                    conflicts.push((left.rule_id.clone(), right.rule_id.clone()));
                }
            }
        }
        conflicts
    }

    pub fn evaluate(&mut self, events: &[StandardizedEvent]) -> Vec<TriggerInstruction> {
        let now = Utc::now();
        let mut instructions = Vec::new();
        let conflicts = self.detect_conflicts();
        let conflicted: Vec<String> = conflicts
            .into_iter()
            .flat_map(|(left, right)| [left, right])
            .collect();

        let rules: Vec<AgentRule> = self.rules.values().cloned().collect();
        for rule in rules {
            if !rule.enabled {
                self.log(rule.rule_id.clone(), false, "rule disabled".to_string());
                continue;
            }
            if conflicted.contains(&rule.rule_id) {
                self.log(
                    rule.rule_id.clone(),
                    false,
                    "rule conflict skipped".to_string(),
                );
                continue;
            }
            if self.in_cooldown(&rule, now) {
                self.log(rule.rule_id.clone(), false, "cooldown active".to_string());
                continue;
            }
            let matched_events = matching_events(&rule, events, now);
            if matched_events.len() >= rule.min_count.max(1) {
                let event_ids = matched_events
                    .iter()
                    .map(|event| event.event_id.clone())
                    .collect();
                self.last_triggered_at.insert(rule.rule_id.clone(), now);
                self.log(rule.rule_id.clone(), true, "rule matched".to_string());
                instructions.push(TriggerInstruction {
                    instruction_id: format!("{}:{}", rule.rule_id, now.timestamp_millis()),
                    rule_id: rule.rule_id.clone(),
                    action: rule.action.clone(),
                    event_ids,
                    priority: rule.priority,
                    created_at: now,
                });
            } else {
                self.log(rule.rule_id.clone(), false, "threshold not met".to_string());
            }
        }
        instructions.sort_by_key(|instruction| std::cmp::Reverse(instruction.priority));
        instructions
    }

    pub fn logs(&self) -> &[RuleExecutionLog] {
        &self.logs
    }

    fn in_cooldown(&self, rule: &AgentRule, now: DateTime<Utc>) -> bool {
        self.last_triggered_at
            .get(&rule.rule_id)
            .map(|last| now - *last < Duration::minutes(rule.cooldown_minutes))
            .unwrap_or(false)
    }

    fn log(&mut self, rule_id: String, matched: bool, message: String) {
        self.logs.push(RuleExecutionLog {
            rule_id,
            matched,
            message,
            created_at: Utc::now(),
        });
    }
}

fn matching_events<'a>(
    rule: &AgentRule,
    events: &'a [StandardizedEvent],
    now: DateTime<Utc>,
) -> Vec<&'a StandardizedEvent> {
    let window_start = now - Duration::minutes(rule.window_minutes.max(1));
    events
        .iter()
        .filter(|event| event.timestamp >= window_start)
        .filter(|event| {
            rule.event_type
                .as_ref()
                .map(|value| &event.event_type == value)
                .unwrap_or(true)
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::agent::event_collector::{CollectionProtocol, StandardizedEvent};
    use serde_json::json;

    #[test]
    fn triggers_when_threshold_met() {
        let mut engine = RuleEngine::new(vec![test_rule("r1", "chat_message_sent", 2)]);
        let events = vec![
            test_event("e1", "chat_message_sent"),
            test_event("e2", "chat_message_sent"),
        ];
        let instructions = engine.evaluate(&events);
        assert_eq!(instructions.len(), 1);
        assert_eq!(instructions[0].rule_id, "r1");
    }

    #[test]
    fn applies_cooldown() {
        let mut rule = test_rule("r1", "chat_message_sent", 1);
        rule.cooldown_minutes = 60;
        let mut engine = RuleEngine::new(vec![rule]);
        let events = vec![test_event("e1", "chat_message_sent")];
        assert_eq!(engine.evaluate(&events).len(), 1);
        assert!(engine.evaluate(&events).is_empty());
    }

    #[test]
    fn detects_conflicts() {
        let rule = test_rule("r1", "chat_message_sent", 1);
        let mut duplicate = test_rule("r2", "chat_message_sent", 1);
        duplicate.action = rule.action.clone();
        let engine = RuleEngine::new(vec![rule, duplicate]);
        assert_eq!(engine.detect_conflicts().len(), 1);
    }

    fn test_rule(id: &str, event_type: &str, min_count: usize) -> AgentRule {
        AgentRule {
            rule_id: id.to_string(),
            event_type: Some(event_type.to_string()),
            min_count,
            window_minutes: 60,
            cooldown_minutes: 0,
            priority: 10,
            action: RuleActionKind::UiHint,
            enabled: true,
        }
    }

    fn test_event(id: &str, event_type: &str) -> StandardizedEvent {
        StandardizedEvent {
            event_id: id.to_string(),
            event_type: event_type.to_string(),
            timestamp: Utc::now(),
            source_id: "ui".to_string(),
            source_address: "local".to_string(),
            protocol: CollectionProtocol::Local,
            payload: json!({}),
        }
    }
}
