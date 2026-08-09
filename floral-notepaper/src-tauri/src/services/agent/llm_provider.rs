//! LLM / Embedding 供应商（OpenAI 兼容协议）
//!
//! Ollama / vLLM / 云端 DeepSeek 等本地或云端端点都是同一套 OpenAI 兼容协议，
//! 这里直接用 reqwest 调用，不引入任何 Agent 框架、也不自己解析协议。
//!
//! 端点解析与前端 `embeddingService` 保持一致：
//! - chat（对话）：`base_url + api_path`，模型取 `defaultModels[providerId]` 或第一个模型（同 cowrite）
//! - embedding：`base_url + "/embeddings"`，模型取 `modelTypes` 含 `embedding` 的模型
//!
//! 后续 MCP 工具协议化时，把这里的 HTTP 调用包装/替换为官方 SDK 客户端即可，
//! 本模块对外只暴露 async 方法，接口留作替换点。

use crate::services::notes::{default_store, AppConfig, AppError, ProviderConfig};
use serde::{Deserialize, Serialize};
use std::time::Duration;

const REQUEST_TIMEOUT: Duration = Duration::from_secs(60);

/// 从 AppConfig 解析出的 LLM/Embedding 端点
#[derive(Debug, Clone)]
pub struct LlmEndpoint {
    pub chat_url: String,
    pub chat_model: String,
    pub chat_api_key: String,
    pub embedding_url: Option<String>,
    pub embedding_model: Option<String>,
    pub embedding_api_key: Option<String>,
}

impl LlmEndpoint {
    /// 无 embedding 端点时返回错误，供需要 embedding 的调用方使用
    pub fn require_embedding(&self) -> Result<(String, String, String), AppError> {
        match (
            &self.embedding_url,
            &self.embedding_model,
            &self.embedding_api_key,
        ) {
            (Some(url), Some(model), Some(key)) => Ok((url.clone(), model.clone(), key.clone())),
            _ => Err(AppError::new(
                "noEmbeddingProvider",
                "没有可用的 Embedding 供应商，请在设置中配置 modelTypes 含 embedding 的模型",
            )),
        }
    }
}

/// 从配置解析端点。chat 必须可用；embedding 按 modelTypes 约定可选。
pub fn resolve_endpoint(config: &AppConfig) -> Result<LlmEndpoint, AppError> {
    let enabled: Vec<&ProviderConfig> = config
        .providers
        .iter()
        .filter(|p| p.enabled && !p.models.is_empty())
        .collect();
    if enabled.is_empty() {
        return Err(AppError::new(
            "noProvider",
            "没有可用的 AI 供应商，请先在设置中配置",
        ));
    }

    // chat：优先 DeepSeek，否则第一个启用的供应商（与 cowrite 一致）
    let chat_provider = enabled
        .iter()
        .find(|p| p.name.to_lowercase().contains("deepseek"))
        .copied()
        .unwrap_or(enabled[0]);
    let chat_model = config
        .default_models
        .get(&chat_provider.id)
        .and_then(|v| v.as_ref())
        .and_then(|preferred| {
            chat_provider
                .models
                .iter()
                .find(|m| &m.model_id == preferred)
                .map(|m| m.model_id.clone())
        })
        .unwrap_or_else(|| chat_provider.models[0].model_id.clone());
    let chat_url = format!(
        "{}{}",
        chat_provider.base_url.trim_end_matches('/'),
        chat_provider.api_path
    );

    // embedding：modelTypes 含 "embedding" 的模型，URL = base_url + "/embeddings"
    let embedding = enabled.iter().find_map(|p| {
        p.models
            .iter()
            .find(|m| {
                m.model_types
                    .iter()
                    .any(|t| t.eq_ignore_ascii_case("embedding"))
            })
            .map(|m| (p, m.model_id.clone()))
    });

    Ok(match embedding {
        Some((provider, model)) => LlmEndpoint {
            embedding_url: Some(format!("{}/embeddings", provider.base_url.trim_end_matches('/'))),
            embedding_model: Some(model),
            embedding_api_key: Some(provider.api_key.clone()),
            chat_url,
            chat_model,
            chat_api_key: chat_provider.api_key.clone(),
        },
        None => LlmEndpoint {
            chat_url,
            chat_model,
            chat_api_key: chat_provider.api_key.clone(),
            embedding_url: None,
            embedding_model: None,
            embedding_api_key: None,
        },
    })
}

/// 对话消息（OpenAI 兼容消息体）
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

fn http_client() -> reqwest::Client {
    reqwest::Client::builder()
        .timeout(REQUEST_TIMEOUT)
        .build()
        .unwrap_or_else(|_| reqwest::Client::new())
}

fn app_error(code: &str, message: impl Into<String>) -> AppError {
    AppError::new(code, message)
}

/// LLM 对话客户端：POST {chat_url}，body = {model, messages, stream:false, ...}
pub struct HttpLlmProvider {
    endpoint: LlmEndpoint,
    client: reqwest::Client,
}

impl HttpLlmProvider {
    pub fn new(endpoint: LlmEndpoint) -> Self {
        Self {
            endpoint,
            client: http_client(),
        }
    }

    pub fn endpoint(&self) -> &LlmEndpoint {
        &self.endpoint
    }

    /// 单轮对话（system + user）
    pub async fn complete_prompt(
        &self,
        system: &str,
        user: &str,
        max_tokens: u32,
    ) -> Result<String, AppError> {
        self.complete(
            vec![
                ChatMessage {
                    role: "system".to_string(),
                    content: system.to_string(),
                },
                ChatMessage {
                    role: "user".to_string(),
                    content: user.to_string(),
                },
            ],
            max_tokens,
        )
        .await
    }

    pub async fn complete(
        &self,
        messages: Vec<ChatMessage>,
        max_tokens: u32,
    ) -> Result<String, AppError> {
        let body = serde_json::json!({
            "model": self.endpoint.chat_model,
            "messages": messages,
            "stream": false,
            "max_tokens": max_tokens,
        });
        let response = self
            .client
            .post(&self.endpoint.chat_url)
            .header("Content-Type", "application/json")
            .bearer_auth_if_any(&self.endpoint.chat_api_key)
            .json(&body)
            .send()
            .await
            .map_err(|e| {
                eprintln!("[llm_provider] chat request error | {}", e);
                app_error("aiRequestFailed", format!("AI 请求失败: {e}"))
            })?;

        if !response.status().is_success() {
            let status = response.status().as_u16();
            let text = response.text().await.unwrap_or_default();
            eprintln!("[llm_provider] chat failed | status={} | body={}", status, text);
            return Err(app_error(
                "aiResponseError",
                format!("AI 响应错误 ({status}): {text}"),
            ));
        }

        let data: serde_json::Value = response.json().await.map_err(|e| {
            app_error("aiParseError", format!("解析 AI 响应失败: {e}"))
        })?;
        data.get("choices")
            .and_then(|c| c.get(0))
            .and_then(|c| c.get("message"))
            .and_then(|m| m.get("content"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
            .ok_or_else(|| app_error("aiParseError", "AI 响应缺少 choices[0].message.content"))
    }
}

/// Embedding 客户端：POST {embedding_url}，body = {model, input:[...]}
pub struct HttpEmbeddingProvider {
    url: String,
    model: String,
    api_key: String,
    client: reqwest::Client,
}

impl HttpEmbeddingProvider {
    pub fn new(endpoint: LlmEndpoint) -> Result<Self, AppError> {
        let (url, model, api_key) = endpoint.require_embedding()?;
        Ok(Self {
            url,
            model,
            api_key,
            client: http_client(),
        })
    }

    pub fn model(&self) -> &str {
        &self.model
    }

    pub async fn embed_batch(&self, texts: &[String]) -> Result<Vec<Vec<f32>>, AppError> {
        if texts.is_empty() {
            return Ok(Vec::new());
        }
        let body = serde_json::json!({ "model": self.model, "input": texts });
        let response = self
            .client
            .post(&self.url)
            .header("Content-Type", "application/json")
            .bearer_auth_if_any(&self.api_key)
            .json(&body)
            .send()
            .await
            .map_err(|e| {
                eprintln!("[llm_provider] embedding request error | {}", e);
                app_error("aiRequestFailed", format!("Embedding 请求失败: {e}"))
            })?;

        if !response.status().is_success() {
            let status = response.status().as_u16();
            let text = response.text().await.unwrap_or_default();
            eprintln!("[llm_provider] embedding failed | status={} | body={}", status, text);
            return Err(app_error(
                "aiResponseError",
                format!("Embedding 响应错误 ({status}): {text}"),
            ));
        }

        let data: serde_json::Value = response.json().await.map_err(|e| {
            app_error("aiParseError", format!("解析 Embedding 响应失败: {e}"))
        })?;
        let items = data.get("data").and_then(|d| d.as_array()).ok_or_else(|| {
            app_error("aiParseError", "Embedding 响应缺少 data 数组")
        })?;
        if items.len() != texts.len() {
            return Err(app_error(
                "aiParseError",
                format!(
                    "Embedding 返回数量不符：期望 {} 条，实际 {} 条",
                    texts.len(),
                    items.len()
                ),
            ));
        }
        items
            .iter()
            .map(|item| {
                item.get("embedding")
                    .and_then(|v| v.as_array())
                    .map(|arr| {
                        arr.iter()
                            .filter_map(|x| x.as_f64())
                            .map(|x| x as f32)
                            .collect::<Vec<f32>>()
                    })
                    .ok_or_else(|| app_error("aiParseError", "Embedding 项缺少 embedding 数组"))
            })
            .collect()
    }

    pub async fn embed(&self, text: String) -> Result<Vec<f32>, AppError> {
        let mut result = self.embed_batch(std::slice::from_ref(&text)).await?;
        result
            .pop()
            .ok_or_else(|| app_error("aiParseError", "Embedding 返回为空"))
    }
}

/// 扩展方法：有 key 才带 Authorization 头
trait BearerAuthExt {
    fn bearer_auth_if_any(self, key: &str) -> Self;
}

impl BearerAuthExt for reqwest::RequestBuilder {
    fn bearer_auth_if_any(self, key: &str) -> Self {
        if key.is_empty() {
            self
        } else {
            self.bearer_auth(key)
        }
    }
}

/// IPC：单条文本转向量（供前端 embeddingService 复用 Rust 端协议客户端）
#[tauri::command]
pub async fn agent_embed_text(text: String) -> Result<Vec<f32>, AppError> {
    let config = default_store()?.load_config()?;
    let endpoint = resolve_endpoint(&config)?;
    HttpEmbeddingProvider::new(endpoint)?.embed(text).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::io::{Read, Write};
    use std::net::{SocketAddr, TcpListener};
    use std::sync::mpsc;
    use std::thread;

    fn test_config(providers: serde_json::Value) -> AppConfig {
        serde_json::from_value(json!({
            "notesDir": "",
            "globalShortcut": "",
            "closeToTray": false,
            "autostart": false,
            "defaultViewMode": "edit",
            "providers": providers,
        }))
        .expect("config 应可反序列化")
    }

    fn provider(id: &str, base: &str, api_path: &str, model_types: Vec<&str>) -> serde_json::Value {
        json!({
            "id": id,
            "enabled": true,
            "name": id,
            "protocol": "openai",
            "apiKey": "sk-test",
            "baseUrl": base,
            "apiPath": api_path,
            "models": [{
                "modelId": format!("{}-model", id),
                "displayName": id,
                "modelTypes": model_types,
            }]
        })
    }

    #[test]
    fn resolves_chat_and_embedding_endpoints() {
        let config = test_config(json!([
            provider("deepseek", "https://api.deepseek.com", "/v1/chat/completions", vec!["chat", "text"]),
            provider("siliconflow", "https://api.siliconflow.cn/v1", "/chat/completions", vec!["embedding"]),
        ]));
        let endpoint = resolve_endpoint(&config).unwrap();

        assert_eq!(
            endpoint.chat_url,
            "https://api.deepseek.com/v1/chat/completions"
        );
        assert_eq!(endpoint.chat_model, "deepseek-model");
        assert_eq!(
            endpoint.embedding_url.as_deref(),
            Some("https://api.siliconflow.cn/v1/embeddings")
        );
        assert_eq!(endpoint.embedding_model.as_deref(), Some("siliconflow-model"));
    }

    #[test]
    fn embedding_endpoint_missing_when_no_embedding_model() {
        let config = test_config(json!([
            provider("deepseek", "https://api.deepseek.com", "/v1/chat/completions", vec!["chat"]),
        ]));
        let endpoint = resolve_endpoint(&config).unwrap();
        assert!(endpoint.embedding_url.is_none());
        assert!(endpoint.embedding_model.is_none());
        assert!(endpoint.require_embedding().is_err());
    }

    /// 在字节切片中查找子串位置
    fn find_subslice(haystack: &[u8], needle: &[u8]) -> Option<usize> {
        if needle.is_empty() {
            return Some(0);
        }
        haystack.windows(needle.len()).position(|w| w == needle)
    }

    /// 起一个本地 TCP 桩服务，返回 (地址, 收到的请求体)
    fn spawn_stub_server(response_body: &'static str) -> (SocketAddr, mpsc::Receiver<String>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        let (tx, rx) = mpsc::channel();
        thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut buf = Vec::new();
            let mut tmp = [0u8; 2048];
            // 读 header，按 Content-Length 确定 body 长度
            let mut body_len = None;
            loop {
                let n = stream.read(&mut tmp).unwrap();
                if n == 0 {
                    break;
                }
                buf.extend_from_slice(&tmp[..n]);
                if let Some(pos) = find_subslice(&buf, b"\r\n\r\n") {
                    let head = &buf[..pos];
                    body_len = head
                        .split(|b| *b == b'\n')
                        .map(|line| line.strip_suffix(b"\r").unwrap_or(line))
                        .find_map(|line| {
                            line.to_ascii_lowercase()
                                .strip_prefix(b"content-length:")
                                .and_then(|v| std::str::from_utf8(v).ok())
                                .and_then(|v| v.trim().parse::<usize>().ok())
                        });
                    break;
                }
            }
            // 读 body
            let header_end = find_subslice(&buf, b"\r\n\r\n").map(|p| p + 4).unwrap_or(0);
            if let Some(len) = body_len {
                while buf.len() - header_end < len {
                    let n = stream.read(&mut tmp).unwrap();
                    if n == 0 {
                        break;
                    }
                    buf.extend_from_slice(&tmp[..n]);
                }
            }
            let _ = tx.send(String::from_utf8_lossy(&buf).into_owned());
            let response = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                response_body.len(),
                response_body
            );
            let _ = stream.write_all(response.as_bytes());
        });
        (addr, rx)
    }

    #[test]
    fn embeds_text_via_openai_compatible_endpoint() {
        let (addr, rx) = spawn_stub_server(
            r#"{"object":"list","data":[{"object":"embedding","index":0,"embedding":[0.1,0.2,0.3]}]}"#,
        );
        let endpoint = resolve_endpoint(&test_config(json!([
            provider("siliconflow", &format!("http://{addr}"), "/chat/completions", vec!["embedding"]),
        ])))
        .unwrap();

        let vector = tauri::async_runtime::block_on(async {
            HttpEmbeddingProvider::new(endpoint)
                .unwrap()
                .embed("你好".to_string())
                .await
        })
        .unwrap();

        assert_eq!(vector.len(), 3);
        assert!((vector[1] - 0.2).abs() < 1e-6);
        let request = rx.recv_timeout(Duration::from_secs(5)).unwrap();
        assert!(request.contains("\"model\":\"siliconflow-model\""));
        assert!(request.contains("\"input\":[\"你好\"]"));
    }

    #[test]
    fn chat_completion_parses_content() {
        let (addr, rx) = spawn_stub_server(
            r#"{"choices":[{"index":0,"message":{"role":"assistant","content":"你好，花箴"}}]}"#,
        );
        let endpoint = resolve_endpoint(&test_config(json!([
            provider("deepseek", &format!("http://{addr}"), "/v1/chat/completions", vec!["chat"]),
        ])))
        .unwrap();

        let content = tauri::async_runtime::block_on(async {
            HttpLlmProvider::new(endpoint)
                .complete_prompt("你是助手", "讲个笑话", 128)
                .await
        })
        .unwrap();

        assert_eq!(content, "你好，花箴");
        let request = rx.recv_timeout(Duration::from_secs(5)).unwrap();
        assert!(request.contains("\"stream\":false"));
        assert!(request.contains("讲个笑话"));
    }
}
