use std::collections::BTreeMap;

use crate::services::notes::{default_store, AppConfig, AppError, ProviderConfig};

use super::prompts::build_co_write_messages;
use super::{append_ai_text, get_session, CoWriteSession};

fn active_api_config(config: &AppConfig) -> Result<(String, String, String), AppError> {
    let enabled: Vec<&ProviderConfig> = config
        .providers
        .iter()
        .filter(|p| p.enabled && !p.models.is_empty())
        .collect();

    if enabled.is_empty() {
        return Err(AppError {
            code: "noProvider".into(),
            message: "没有可用的 AI 供应商，请先在设置中配置".into(),
            details: BTreeMap::new(),
        });
    }

    let provider = enabled
        .iter()
        .find(|p| p.name.to_lowercase().contains("deepseek"))
        .copied()
        .unwrap_or(enabled[0]);

    let model_id = config
        .default_models
        .get(&provider.id)
        .and_then(|value| value.as_ref())
        .and_then(|preferred| {
            provider
                .models
                .iter()
                .find(|m| &m.model_id == preferred)
                .map(|m| m.model_id.clone())
        })
        .unwrap_or_else(|| provider.models[0].model_id.clone());

    let api_url = format!(
        "{}{}",
        provider.base_url.trim_end_matches('/'),
        provider.api_path
    );

    Ok((api_url, provider.api_key.clone(), model_id))
}

pub async fn request_ai_turn(
    session_id: &str,
    runtime_config: Option<AppConfig>,
) -> Result<CoWriteSession, AppError> {
    let session = get_session(session_id)?;
    let store = default_store()?;
    let config = match runtime_config {
        Some(config) => config,
        None => store.load_config()?,
    };
    let (api_url, api_key, model_id) = active_api_config(&config)?;

    eprintln!(
        "[cowrite] requesting AI turn | provider={} | model={} | url={}",
        config
            .providers
            .iter()
            .find(|p| p.enabled
                && (p.name.to_lowercase().contains("deepseek")
                    || p.models.iter().any(|m| m.model_id == model_id)))
            .map(|p| p.name.as_str())
            .unwrap_or("default"),
        model_id,
        api_url
    );

    let client = reqwest::Client::new();
    let mut request = client
        .post(&api_url)
        .header("Content-Type", "application/json");

    if !api_key.is_empty() {
        request = request.header("Authorization", format!("Bearer {}", api_key));
    }

    let body = serde_json::json!({
        "model": model_id,
        "messages": build_co_write_messages(&session),
        "stream": false,
        "temperature": 0.8,
        "max_tokens": 500,
    });

    let response = request.json(&body).send().await.map_err(|error| {
        eprintln!("[cowrite] AI request error | {}", error);
        AppError {
            code: "aiRequestFailed".into(),
            message: format!("AI 请求失败: {}", error),
            details: BTreeMap::new(),
        }
    })?;

    if !response.status().is_success() {
        let status = response.status().as_u16();
        let text = response.text().await.unwrap_or_default();
        eprintln!(
            "[cowrite] AI request failed | status={} | body={}",
            status, text
        );
        return Err(AppError {
            code: "aiResponseError".into(),
            message: format!("AI 响应错误 ({}): {}", status, text),
            details: BTreeMap::new(),
        });
    }

    let data: serde_json::Value = response.json().await.map_err(|error| AppError {
        code: "aiParseError".into(),
        message: format!("解析 AI 响应失败: {}", error),
        details: BTreeMap::new(),
    })?;

    let content = data
        .get("choices")
        .and_then(|choices| choices.get(0))
        .and_then(|choice| choice.get("message"))
        .and_then(|message| message.get("content"))
        .and_then(|value| value.as_str())
        .unwrap_or("（未收到回复）")
        .trim();

    append_ai_text(session_id, content)
}
