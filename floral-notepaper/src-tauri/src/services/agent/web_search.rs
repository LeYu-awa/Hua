//! Web 搜索：自托管 SearXNG 的 JSON API 客户端
//!
//! SearXNG 提供 `GET {base}/search?q=...&format=json` 的 JSON 端点，
//! 返回 `results[]`（title/url/content/score）。不引入 MCP 也能先落地 web.search 工具，
//! MCP 协议化在工具注册表阶段再包装。

use crate::services::notes::AppError;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WebSearchResult {
    pub title: String,
    pub url: String,
    pub content: String,
    pub score: f32,
}

/// 调用 SearXNG JSON API 搜索
pub async fn searxng_search(
    base_url: &str,
    query: &str,
    limit: usize,
) -> Result<Vec<WebSearchResult>, AppError> {
    let base = base_url.trim_end_matches('/');
    if base.is_empty() {
        return Err(AppError::new(
            "webSearch",
            "未配置 SearXNG 地址（设置 → AI 集成 → Web 搜索）",
        ));
    }
    let client = reqwest::Client::new();
    let response = client
        .get(format!("{base}/search"))
        .query(&[
            ("q", query),
            ("format", "json"),
            ("language", "zh-CN"),
            ("safesearch", "0"),
        ])
        .timeout(std::time::Duration::from_secs(15))
        .send()
        .await
        .map_err(|e| AppError::new("webSearch", format!("SearXNG 请求失败: {e}")))?;
    if !response.status().is_success() {
        return Err(AppError::new(
            "webSearch",
            format!("SearXNG 返回状态 {}", response.status()),
        ));
    }
    let data: serde_json::Value = response
        .json()
        .await
        .map_err(|e| AppError::new("webSearch", format!("SearXNG 响应解析失败: {e}")))?;
    let results = data["results"]
        .as_array()
        .map(|items| {
            items
                .iter()
                .filter_map(|item| {
                    let title = item.get("title").and_then(serde_json::Value::as_str)?;
                    let url = item.get("url").and_then(serde_json::Value::as_str)?;
                    Some(WebSearchResult {
                        title: title.to_string(),
                        url: url.to_string(),
                        content: item
                            .get("content")
                            .and_then(serde_json::Value::as_str)
                            .unwrap_or_default()
                            .to_string(),
                        score: item
                            .get("score")
                            .and_then(serde_json::Value::as_f64)
                            .unwrap_or(0.0) as f32,
                    })
                })
                .take(limit.max(1))
                .collect()
        })
        .unwrap_or_default();
    Ok(results)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::sync::Arc;

    /// 极简 HTTP stub：返回 SearXNG 格式 JSON，校验 query 参数
    #[test]
    fn parses_searxng_json_results() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let queried = Arc::new(std::sync::Mutex::new(String::new()));
        let queried_clone = Arc::clone(&queried);

        let server = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut request = Vec::new();
            let mut buf = [0u8; 2048];
            loop {
                let n = stream.read(&mut buf).unwrap();
                if n == 0 {
                    break;
                }
                request.extend_from_slice(&buf[..n]);
                if request.windows(4).any(|w| w == b"\r\n\r\n") {
                    break;
                }
            }
            let request = String::from_utf8_lossy(&request);
            if let Some(line) = request.lines().next() {
                *queried_clone.lock().unwrap() = line.to_string();
            }
            let body = r#"{
                "results": [
                    {"title": "Rust 入门", "url": "https://example.com/rust", "content": "教程", "score": 0.9},
                    {"title": "Tauri 2", "url": "https://example.com/tauri", "content": "桌面框架", "score": 0.5}
                ]
            }"#;
            let resp = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                body.len(),
                body
            );
            let _ = stream.write_all(resp.as_bytes());
        });

        let results = tauri::async_runtime::block_on(searxng_search(
            &format!("http://127.0.0.1:{port}"),
            "rust 教程",
            10,
        ))
        .unwrap();
        assert_eq!(results.len(), 2);
        assert_eq!(results[0].title, "Rust 入门");
        assert_eq!(results[0].url, "https://example.com/rust");
        assert!(results[0].score > results[1].score);
        assert!(queried.lock().unwrap().contains("q=rust"));
        server.join().unwrap();
    }

    #[test]
    fn rejects_empty_base_url() {
        let err = tauri::async_runtime::block_on(searxng_search("", "q", 5)).unwrap_err();
        assert_eq!(err.code, "webSearch");
    }
}
