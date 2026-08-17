//! Web 搜索：自托管 SearXNG 的 JSON API 客户端
//!
//! SearXNG 提供 `GET {base}/search?q=...&format=json` 的 JSON 端点，
//! 返回 `results[]`（title/url/content/score）。不引入 MCP 也能先落地 web.search 工具，
//! MCP 协议化在工具注册表阶段再包装。

use crate::services::notes::{AppError, DEFAULT_SEARXNG_URL};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WebSearchResult {
    pub title: String,
    pub url: String,
    pub content: String,
    pub score: f32,
    /// 结果缩略图（SearXNG 提供；DDG HTML 回退无）
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub thumbnail: Option<String>,
}

/// 内置的公开 SearXNG 实例（无需配置即可用）。公共实例会随时上下线，
/// 因此逐个尝试、谁先返回结果用谁；全部失败由调用方回退 DuckDuckGo。
const PUBLIC_SEARXNG_INSTANCES: &[&str] = &[
    "https://paulgo.io",
    "https://priv.au",
    "https://searx.tiekoetter.com",
    "https://search.bus-hit.me",
    "https://opnxng.com",
];

/// 解析候选实例：
/// - 用户显式配置了非默认自托管地址 → 只用该地址；
/// - 地址为空或仍为内置默认（paulgo.io）→ 依次尝试所有公共实例。
fn searxng_candidates(base_url: &str) -> Vec<String> {
    let trimmed = base_url.trim().trim_end_matches('/');
    if !trimmed.is_empty() && trimmed != DEFAULT_SEARXNG_URL {
        vec![trimmed.to_string()]
    } else {
        PUBLIC_SEARXNG_INSTANCES
            .iter()
            .map(|url| url.to_string())
            .collect()
    }
}

/// 调用 SearXNG JSON API 搜索（自动在公共实例间回退）
pub async fn searxng_search(
    base_url: &str,
    query: &str,
    limit: usize,
) -> Result<Vec<WebSearchResult>, AppError> {
    let candidates = searxng_candidates(base_url);
    let mut last_error: Option<AppError> = None;

    for base in candidates {
        match search_instance(&base, query, limit).await {
            Ok(results) if !results.is_empty() => return Ok(results),
            Ok(_) => {
                log::debug!("[search] SearXNG 实例 {base} 无结果，尝试下一个");
            }
            Err(error) => {
                log::debug!("[search] SearXNG 实例 {base} 不可用: {}", error.message);
                last_error = Some(error);
            }
        }
    }

    Err(last_error.unwrap_or_else(|| {
        AppError::new("webSearch", "所有 SearXNG 实例均未返回结果，请检查网络或配置自托管实例")
    }))
}

/// 请求单个 SearXNG 实例
async fn search_instance(
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
        .timeout(std::time::Duration::from_secs(8))
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
                        thumbnail: item
                            .get("thumbnail")
                            .and_then(serde_json::Value::as_str)
                            .and_then(|t| normalize_thumbnail(t, base)),
                    })
                })
                .take(limit.max(1))
                .collect()
        })
        .unwrap_or_default();
    Ok(results)
}

/// 归一化 SearXNG 缩略图地址为前端 webview 可直接加载的绝对 URL：
/// - `/path` 相对路径 → 拼上实例 origin（SearXNG 常见 `/image_proxy?url=...` 输出）。
///   若原样拼接进 markdown，会被按应用自身 origin（tauri://localhost）解析而 404/403。
/// - `//host/path` 协议相对 → 补 `https:`。
/// - 已是 `http(s)://` 绝对地址 → 原样返回。
/// - 其它非法值（data:/javascript:/空）→ `None`，丢弃以免污染 markdown 渲染。
fn normalize_thumbnail(thumbnail: &str, base_url: &str) -> Option<String> {
    let trimmed = thumbnail.trim();
    if trimmed.is_empty() {
        return None;
    }
    if let Some(rest) = trimmed.strip_prefix("//") {
        return Some(format!("https://{rest}"));
    }
    if let Some(path) = trimmed.strip_prefix('/') {
        return Some(format!("{base_url}/{path}"));
    }
    if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
        return Some(trimmed.to_string());
    }
    None
}

/// 结果项链接标记（DDG HTML 结构：`<a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=...">标题</a>`）
const DDG_LINK_MARKER: &str = "class=\"result__a\" href=\"";
const DDG_SNIPPET_MARKER: &str = "class=\"result__snippet\"";

/// DuckDuckGo HTML 网页搜索。
///
/// 与 Instant Answer 不同：HTML 端点对普通搜索词（如「樱花的图片」）也能返回真实网页结果，
/// 作为 SearXNG 不可用时的可靠回退。不引入第三方解析库，按 DDG 稳定 HTML 结构轻量解析。
pub async fn duckduckgo_search(query: &str, limit: usize) -> Result<Vec<WebSearchResult>, AppError> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(12))
        .user_agent(
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
        )
        .build()
        .map_err(|e| AppError::new("webSearch", format!("DuckDuckGo 客户端构建失败: {e}")))?;

    let response = client
        .get("https://html.duckduckgo.com/html/")
        .query(&[("q", query)])
        .send()
        .await
        .map_err(|e| AppError::new("webSearch", format!("DuckDuckGo 请求失败: {e}")))?;
    if !response.status().is_success() {
        return Err(AppError::new(
            "webSearch",
            format!("DuckDuckGo 返回状态 {}", response.status()),
        ));
    }

    let html = response
        .text()
        .await
        .map_err(|e| AppError::new("webSearch", format!("DuckDuckGo 响应读取失败: {e}")))?;
    Ok(parse_duckduckgo_html(&html, limit))
}

/// 从 DDG HTML 响应中提取结果（标题 + 解码后的跳转目标 + 摘要）
fn parse_duckduckgo_html(html: &str, limit: usize) -> Vec<WebSearchResult> {
    let mut results = Vec::new();
    let mut search_from = 0;

    while results.len() < limit.max(1) {
        let Some(marker_start) = html[search_from..].find(DDG_LINK_MARKER) else {
            break;
        };
        let link_start = search_from + marker_start + DDG_LINK_MARKER.len();
        let Some(url_end) = html[link_start..].find('"').map(|i| i + link_start) else {
            break;
        };
        let raw_url = &html[link_start..url_end];
        let Some(title_tag_end) = html[url_end..].find('>').map(|i| i + url_end) else {
            break;
        };
        let title_start = title_tag_end + 1;
        let Some(title_end) = html[title_start..].find("</a>").map(|i| i + title_start) else {
            break;
        };

        let title = strip_html(&html[title_start..title_end]);
        let url = extract_uddg(raw_url);
        if !title.is_empty() && !url.is_empty() {
            results.push(WebSearchResult {
                title: html_unescape(&title),
                url,
                content: find_ddg_snippet(html, title_end),
                score: 1.0 - results.len() as f32 * 0.01,
                thumbnail: None,
            });
        }
        search_from = title_end + 4;
    }

    results
}

/// 提取结果摘要（`class="result__snippet"` 到 `</a>`），最多 240 字符
fn find_ddg_snippet(html: &str, from: usize) -> String {
    let Some(marker_start) = html[from..].find(DDG_SNIPPET_MARKER) else {
        return String::new();
    };
    let content_start = from + marker_start + DDG_SNIPPET_MARKER.len();
    let Some(tag_end) = html[content_start..].find('>').map(|i| i + content_start) else {
        return String::new();
    };
    let snippet_start = tag_end + 1;
    let Some(snippet_end) = html[snippet_start..].find("</a>").map(|i| i + snippet_start) else {
        return String::new();
    };
    let snippet = strip_html(&html[snippet_start..snippet_end]);
    if snippet.is_empty() {
        return String::new();
    }
    let mut unescaped = html_unescape(&snippet);
    if unescaped.chars().count() > 240 {
        unescaped = unescaped.chars().take(240).collect();
    }
    unescaped
}

/// 提取 DDG 跳转链接里的真实目标：`//duckduckgo.com/l/?uddg=<percent-encoded>&rut=...`
fn extract_uddg(raw_url: &str) -> String {
    if let Some(idx) = raw_url.find("uddg=") {
        let mut value = &raw_url[idx + 5..];
        if let Some(amp) = value.find('&') {
            value = &value[..amp];
        }
        return percent_decode(value);
    }
    html_unescape(raw_url)
}

/// 极简 percent-decode（覆盖 %XX 与 +）
fn percent_decode(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'%' if i + 2 < bytes.len() => {
                let hi = hex_value(bytes[i + 1]);
                let lo = hex_value(bytes[i + 2]);
                if let (Some(hi), Some(lo)) = (hi, lo) {
                    out.push(hi * 16 + lo);
                    i += 3;
                    continue;
                }
                out.push(b'%');
                i += 1;
            }
            b'+' => {
                out.push(b' ');
                i += 1;
            }
            byte => {
                out.push(byte);
                i += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn hex_value(byte: u8) -> Option<u8> {
    match byte {
        b'0'..=b'9' => Some(byte - b'0'),
        b'a'..=b'f' => Some(byte - b'a' + 10),
        b'A'..=b'F' => Some(byte - b'A' + 10),
        _ => None,
    }
}

/// 去掉 HTML 标签并把连续空白压成单个空格
fn strip_html(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut in_tag = false;
    for ch in input.chars() {
        match ch {
            '<' => in_tag = true,
            '>' => in_tag = false,
            _ if !in_tag => out.push(ch),
            _ => {}
        }
    }
    out.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// 常见 HTML 实体反转义
fn html_unescape(input: &str) -> String {
    input
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#x27;", "'")
        .replace("&#39;", "'")
        .replace("&nbsp;", " ")
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
                    {"title": "Rust 入门", "url": "https://example.com/rust", "content": "教程", "score": 0.9, "thumbnail": "/image_proxy?url=https%3A%2F%2Fexample.com%2Frust.png&h=100&w=100"},
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
        // 相对路径 thumbnail 被归一化为实例 origin 下的绝对 URL
        assert_eq!(
            results[0].thumbnail,
            Some(format!(
                "http://127.0.0.1:{port}/image_proxy?url=https%3A%2F%2Fexample.com%2Frust.png&h=100&w=100"
            ))
        );
        assert_eq!(results[1].thumbnail, None);
        assert!(queried.lock().unwrap().contains("q=rust"));
        server.join().unwrap();
    }

    #[test]
    fn normalizes_thumbnail_urls() {
        let base = "https://paulgo.io";
        // 相对路径（SearXNG image_proxy 常见输出）→ 拼实例 origin
        assert_eq!(
            normalize_thumbnail("/image_proxy?url=x&h=100&w=100", base),
            Some("https://paulgo.io/image_proxy?url=x&h=100&w=100".to_string())
        );
        // 协议相对 → 补 https:
        assert_eq!(
            normalize_thumbnail("//cdn.example.com/img.jpg", base),
            Some("https://cdn.example.com/img.jpg".to_string())
        );
        // 已绝对 → 原样
        assert_eq!(
            normalize_thumbnail("http://cdn.example.com/img.jpg", base),
            Some("http://cdn.example.com/img.jpg".to_string())
        );
        assert_eq!(
            normalize_thumbnail("https://cdn.example.com/img.jpg", base),
            Some("https://cdn.example.com/img.jpg".to_string())
        );
        // 非法/空 → 丢弃
        assert_eq!(normalize_thumbnail("", base), None);
        assert_eq!(normalize_thumbnail("   ", base), None);
        assert_eq!(normalize_thumbnail("data:image/png;base64,AAAA", base), None);
        assert_eq!(normalize_thumbnail("javascript:alert(1)", base), None);
        assert_eq!(normalize_thumbnail("ftp://example.com/img.jpg", base), None);
    }

    #[test]
    fn searxng_candidates_fall_back_to_public_instances() {
        // 空地址 → 公共实例列表
        let empty = searxng_candidates("");
        assert!(empty.len() >= 3);
        assert_eq!(empty[0], "https://paulgo.io");
        // 内置默认地址 → 同样走公共实例列表
        let default = searxng_candidates(DEFAULT_SEARXNG_URL);
        assert_eq!(default.len(), PUBLIC_SEARXNG_INSTANCES.len());
        // 用户自定义自托管 → 单实例
        let custom = searxng_candidates("http://127.0.0.1:8080/");
        assert_eq!(custom, vec!["http://127.0.0.1:8080"]);
    }

    #[test]
    fn parses_duckduckgo_html_results() {
        let html = r#"<!DOCTYPE html><html><body>
            <div class="result results_links results_links_deep web-result ">
                <h2 class="result__title">
                    <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fsakura&amp;rut=abc">樱花图片 壁纸</a>
                </h2>
                <a class="result__snippet" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fsakura">高清<b>樱花</b>壁纸免费下载，&amp;nbsp; 精选 4K。</a>
            </div>
            <div class="result">
                <h2 class="result__title">
                    <a rel="nofollow" class="result__a" href="https://example.org/direct">直接链接结果</a>
                </h2>
            </div>
            <div class="no-results">无更多结果</div>
        </body></html>"#;

        let results = parse_duckduckgo_html(html, 10);
        assert_eq!(results.len(), 2);
        assert_eq!(results[0].title, "樱花图片 壁纸");
        assert_eq!(results[0].url, "https://example.com/sakura");
        assert!(results[0].content.contains("高清"));
        assert!(results[0].content.contains("樱花壁纸免费下载"));
        assert!(!results[0].content.contains("<b>"));
        assert!(!results[0].content.contains("&amp;"));
        assert_eq!(results[1].url, "https://example.org/direct");
    }

    #[test]
    fn ddg_limit_respects_upper_bound() {
        let html = (0..6)
            .map(|i| {
                format!(
                    r#"<a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2F{i}">结果 {i}</a>"#
                )
            })
            .collect::<Vec<_>>()
            .join("\n");
        let results = parse_duckduckgo_html(&html, 3);
        assert_eq!(results.len(), 3);
        assert_eq!(results[2].url, "https://example.com/2");
    }

    #[test]
    fn percent_decode_handles_utf8_and_plus() {
        assert_eq!(percent_decode("https%3A%2F%2Fexample.com%2F%E6%A8%B1"), "https://example.com/樱");
        assert_eq!(percent_decode("a+b"), "a b");
        assert_eq!(percent_decode("plain"), "plain");
    }
}
