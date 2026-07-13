use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

use super::event_collector::StandardizedEvent;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct UserProfile {
    pub user_id: String,
    pub encrypted_basic_attributes: String,
    pub behavior_tags: Vec<String>,
    pub preferences: BTreeMap<String, String>,
    pub capability_baseline: BTreeMap<String, f64>,
    pub trends: Vec<BehaviorTrend>,
    pub last_active_at: DateTime<Utc>,
    pub archived: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BehaviorTrend {
    pub metric: String,
    pub value: f64,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ProfileStoreError {
    NotFound,
    EmptyUserId,
}

#[derive(Default)]
pub struct ProfileStore {
    profiles: BTreeMap<String, UserProfile>,
    encryption_key: u8,
}

impl ProfileStore {
    pub fn new(encryption_key: u8) -> Self {
        Self {
            profiles: BTreeMap::new(),
            encryption_key,
        }
    }

    pub fn upsert_profile(
        &mut self,
        user_id: impl Into<String>,
        basic_attributes: &str,
        preferences: BTreeMap<String, String>,
    ) -> Result<UserProfile, ProfileStoreError> {
        let user_id = user_id.into();
        if user_id.trim().is_empty() {
            return Err(ProfileStoreError::EmptyUserId);
        }
        let profile = UserProfile {
            user_id: user_id.clone(),
            encrypted_basic_attributes: encrypt(basic_attributes, self.encryption_key),
            behavior_tags: Vec::new(),
            preferences,
            capability_baseline: BTreeMap::new(),
            trends: Vec::new(),
            last_active_at: Utc::now(),
            archived: false,
        };
        self.profiles.insert(user_id, profile.clone());
        Ok(profile)
    }

    pub fn get_profile(&self, user_id: &str) -> Option<UserProfile> {
        self.profiles
            .get(user_id)
            .filter(|profile| !profile.archived)
            .cloned()
    }

    pub fn delete_profile(&mut self, user_id: &str) -> bool {
        self.profiles.remove(user_id).is_some()
    }

    pub fn decrypt_basic_attributes(&self, profile: &UserProfile) -> String {
        decrypt(&profile.encrypted_basic_attributes, self.encryption_key)
    }

    pub fn update_baseline_from_events(
        &mut self,
        user_id: &str,
        events: &[StandardizedEvent],
    ) -> Result<UserProfile, ProfileStoreError> {
        let profile = self
            .profiles
            .get_mut(user_id)
            .ok_or(ProfileStoreError::NotFound)?;
        let mut counts: BTreeMap<String, f64> = BTreeMap::new();
        for event in events {
            *counts.entry(event.event_type.clone()).or_insert(0.0) += 1.0;
            if let Some(tag) = event.payload.get("tag").and_then(|value| value.as_str()) {
                let tag = tag.to_string();
                if !profile.behavior_tags.contains(&tag) {
                    profile.behavior_tags.push(tag);
                }
            }
        }
        for (metric, value) in counts {
            profile.capability_baseline.insert(metric.clone(), value);
            profile.trends.push(BehaviorTrend {
                metric,
                value,
                updated_at: Utc::now(),
            });
        }
        profile.last_active_at = Utc::now();
        Ok(profile.clone())
    }

    pub fn archive_inactive_profiles(&mut self, inactive_days: i64) -> Vec<String> {
        let cutoff = Utc::now() - Duration::days(inactive_days);
        let mut archived = Vec::new();
        for profile in self.profiles.values_mut() {
            if profile.last_active_at < cutoff {
                profile.archived = true;
                archived.push(profile.user_id.clone());
            }
        }
        archived
    }
}

fn encrypt(value: &str, key: u8) -> String {
    value
        .as_bytes()
        .iter()
        .map(|byte| format!("{:02x}", byte ^ key))
        .collect()
}

fn decrypt(value: &str, key: u8) -> String {
    let bytes: Vec<u8> = value
        .as_bytes()
        .chunks(2)
        .filter_map(|chunk| std::str::from_utf8(chunk).ok())
        .filter_map(|hex| u8::from_str_radix(hex, 16).ok())
        .map(|byte| byte ^ key)
        .collect();
    String::from_utf8(bytes).unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::agent::event_collector::{CollectionProtocol, StandardizedEvent};
    use serde_json::json;

    #[test]
    fn stores_encrypted_profile() {
        let mut store = ProfileStore::new(42);
        let profile = store
            .upsert_profile("u1", "name=花箴", BTreeMap::new())
            .unwrap();
        assert_ne!(profile.encrypted_basic_attributes, "name=花箴");
        assert_eq!(store.decrypt_basic_attributes(&profile), "name=花箴");
    }

    #[test]
    fn updates_baseline_from_events() {
        let mut store = ProfileStore::new(42);
        store
            .upsert_profile("u1", "name=花箴", BTreeMap::new())
            .unwrap();
        let profile = store
            .update_baseline_from_events("u1", &[test_event("chat_message_sent")])
            .unwrap();
        assert_eq!(profile.capability_baseline["chat_message_sent"], 1.0);
        assert!(profile.behavior_tags.contains(&"创作".to_string()));
    }

    #[test]
    fn archives_inactive_profiles() {
        let mut store = ProfileStore::new(42);
        store
            .upsert_profile("u1", "name=花箴", BTreeMap::new())
            .unwrap();
        store.profiles.get_mut("u1").unwrap().last_active_at = Utc::now() - Duration::days(181);
        assert_eq!(store.archive_inactive_profiles(180), vec!["u1".to_string()]);
        assert!(store.get_profile("u1").is_none());
    }

    fn test_event(event_type: &str) -> StandardizedEvent {
        StandardizedEvent {
            event_id: "e1".to_string(),
            event_type: event_type.to_string(),
            timestamp: Utc::now(),
            source_id: "ui".to_string(),
            source_address: "local".to_string(),
            protocol: CollectionProtocol::Local,
            payload: json!({ "tag": "创作" }),
        }
    }
}
