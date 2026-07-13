use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::collections::{BTreeMap, VecDeque};
use std::time::Duration;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum LlmResponseMode {
    Full,
    Stream,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PromptTemplate {
    pub template_id: String,
    pub scene: String,
    pub content: String,
    pub variables: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LlmRequest {
    pub request_id: String,
    pub scene: String,
    pub event_type: String,
    pub variables: BTreeMap<String, String>,
    pub mode: LlmResponseMode,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StructuredInsight {
    pub insight_id: String,
    pub event_type: String,
    pub level: InsightLevel,
    pub title: String,
    pub summary: String,
    pub actions: Vec<String>,
    pub created_at: DateTime<Utc>,
    pub metadata: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "camelCase")]
pub enum InsightLevel {
    Info,
    Hint,
    Warning,
    Critical,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LlmError {
    TemplateMissing,
    SensitiveContent,
    ProviderFailed,
    RateLimited,
}

pub trait LlmProvider {
    fn name(&self) -> &str;
    fn complete(
        &self,
        prompt: &str,
        mode: &LlmResponseMode,
        timeout: Duration,
    ) -> Result<String, LlmError>;
}

pub struct StubLlmProvider {
    name: String,
    fail: bool,
}

impl StubLlmProvider {
    pub fn new(name: impl Into<String>) -> Self {
        Self {
            name: name.into(),
            fail: false,
        }
    }

    pub fn failing(name: impl Into<String>) -> Self {
        Self {
            name: name.into(),
            fail: true,
        }
    }
}

impl LlmProvider for StubLlmProvider {
    fn name(&self) -> &str {
        &self.name
    }

    fn complete(
        &self,
        prompt: &str,
        _mode: &LlmResponseMode,
        _timeout: Duration,
    ) -> Result<String, LlmError> {
        if self.fail {
            return Err(LlmError::ProviderFailed);
        }
        Ok(format!("{{\"title\":\"协作洞察\",\"summary\":\"{}\",\"level\":\"hint\",\"actions\":[\"沉淀下一步\"]}}", prompt.chars().take(48).collect::<String>()))
    }
}

pub struct LlmOrchestrator<P: LlmProvider, F: LlmProvider> {
    templates: BTreeMap<String, PromptTemplate>,
    primary: P,
    fallback: F,
    max_requests_per_minute: usize,
    recent_requests: VecDeque<DateTime<Utc>>,
    pub total_cost_units: usize,
}

impl<P: LlmProvider, F: LlmProvider> LlmOrchestrator<P, F> {
    pub fn new(primary: P, fallback: F, templates: Vec<PromptTemplate>) -> Self {
        Self {
            templates: templates
                .into_iter()
                .map(|template| (template.scene.clone(), template))
                .collect(),
            primary,
            fallback,
            max_requests_per_minute: 60,
            recent_requests: VecDeque::new(),
            total_cost_units: 0,
        }
    }

    pub fn assemble_prompt(&self, request: &LlmRequest) -> Result<String, LlmError> {
        let template = self
            .templates
            .get(&request.scene)
            .ok_or(LlmError::TemplateMissing)?;
        let mut prompt = template.content.clone();
        for variable in &template.variables {
            let value = request.variables.get(variable).cloned().unwrap_or_default();
            prompt = prompt.replace(&format!("{{{{{variable}}}}}"), &value);
        }
        if contains_sensitive_content(&prompt) {
            return Err(LlmError::SensitiveContent);
        }
        Ok(prompt)
    }

    pub fn invoke(&mut self, request: LlmRequest) -> Result<StructuredInsight, LlmError> {
        self.check_rate_limit()?;
        let prompt = self.assemble_prompt(&request)?;
        let timeout = Duration::from_secs(30);
        let raw = match self.primary.complete(&prompt, &request.mode, timeout) {
            Ok(value) => value,
            Err(_) => self.fallback.complete(&prompt, &request.mode, timeout)?,
        };
        self.total_cost_units += prompt.chars().count() + raw.chars().count();
        Ok(parse_insight(&request, &raw))
    }

    fn check_rate_limit(&mut self) -> Result<(), LlmError> {
        let now = Utc::now();
        while self
            .recent_requests
            .front()
            .map(|time| now.signed_duration_since(*time).num_seconds() > 60)
            .unwrap_or(false)
        {
            self.recent_requests.pop_front();
        }
        if self.recent_requests.len() >= self.max_requests_per_minute {
            return Err(LlmError::RateLimited);
        }
        self.recent_requests.push_back(now);
        Ok(())
    }
}

fn contains_sensitive_content(prompt: &str) -> bool {
    ["违法", "暴力", "隐私泄露", "password", "secret"]
        .iter()
        .any(|word| prompt.to_lowercase().contains(&word.to_lowercase()))
}

fn parse_insight(request: &LlmRequest, raw: &str) -> StructuredInsight {
    let value: Value =
        serde_json::from_str(raw).unwrap_or_else(|_| serde_json::json!({ "summary": raw }));
    let title = value
        .get("title")
        .and_then(Value::as_str)
        .unwrap_or("协作洞察")
        .to_string();
    let summary = value
        .get("summary")
        .and_then(Value::as_str)
        .unwrap_or(raw)
        .to_string();
    let level = match value.get("level").and_then(Value::as_str).unwrap_or("info") {
        "critical" => InsightLevel::Critical,
        "warning" => InsightLevel::Warning,
        "hint" => InsightLevel::Hint,
        _ => InsightLevel::Info,
    };
    let actions = value
        .get("actions")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default();
    let mut metadata = Map::new();
    metadata.insert("scene".to_string(), Value::String(request.scene.clone()));
    metadata.insert(
        "mode".to_string(),
        Value::String(format!("{:?}", request.mode)),
    );

    StructuredInsight {
        insight_id: request.request_id.clone(),
        event_type: request.event_type.clone(),
        level,
        title,
        summary,
        actions,
        created_at: Utc::now(),
        metadata: Value::Object(metadata),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn assembles_prompt_and_invokes_fallback() {
        let template = PromptTemplate {
            template_id: "t1".to_string(),
            scene: "review".to_string(),
            content: "事件 {{event}} 上下文 {{context}}".to_string(),
            variables: vec!["event".to_string(), "context".to_string()],
        };
        let mut orchestrator = LlmOrchestrator::new(
            StubLlmProvider::failing("primary"),
            StubLlmProvider::new("fallback"),
            vec![template],
        );
        let insight = orchestrator.invoke(test_request()).unwrap();
        assert_eq!(insight.level, InsightLevel::Hint);
        assert!(insight.summary.contains("事件"));
    }

    #[test]
    fn blocks_sensitive_prompt() {
        let template = PromptTemplate {
            template_id: "t1".to_string(),
            scene: "review".to_string(),
            content: "{{context}}".to_string(),
            variables: vec!["context".to_string()],
        };
        let orchestrator = LlmOrchestrator::new(
            StubLlmProvider::new("p"),
            StubLlmProvider::new("f"),
            vec![template],
        );
        let mut request = test_request();
        request
            .variables
            .insert("context".to_string(), "password=123".to_string());
        assert_eq!(
            orchestrator.assemble_prompt(&request).unwrap_err(),
            LlmError::SensitiveContent
        );
    }

    fn test_request() -> LlmRequest {
        let mut variables = BTreeMap::new();
        variables.insert("event".to_string(), "chat_message_sent".to_string());
        variables.insert("context".to_string(), "画布讨论".to_string());
        LlmRequest {
            request_id: "insight-1".to_string(),
            scene: "review".to_string(),
            event_type: "chat_message_sent".to_string(),
            variables,
            mode: LlmResponseMode::Full,
        }
    }
}
