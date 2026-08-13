//! MCP stdio 服务器：把 orchestrator 工具注册表暴露为 MCP 工具（rmcp 官方 SDK）
//!
//! 启动方式：`floral-notepaper --mcp`。检测到该参数后跳过 Tauri 初始化，
//! 直接以 stdio 传输运行 MCP 服务器——任何 MCP 客户端（Claude Desktop、Cursor 等）
//! 都能通过标准协议调用笔记检索/读写、画布读写、Web 搜索、LLM 生成工具。
//!
//! 工具语义与 orchestrator 的工具注册表（`tool_registry_json`）保持一致，
//! 写工具（note.create / canvas.node.create）直接落盘，确认逻辑由 MCP 客户端自行把握。

use crate::services::agent::llm_provider::{resolve_endpoint, HttpLlmProvider};
use crate::services::agent::orchestrator;
use crate::services::agent::web_search::searxng_search;
use crate::services::canvas::{CanvasDocument, CanvasNode, CanvasStore};
use crate::services::notes::{default_store, NoteStore, SaveNoteRequest};
use rmcp::{
    handler::server::tool::ToolRouter,
    handler::server::wrapper::Parameters,
    model::{ServerCapabilities, ServerInfo},
    schemars, tool, tool_handler, tool_router, ServerHandler, ServiceExt,
};
use serde::Deserialize;
use std::path::PathBuf;

// ---------- 工具入参（schema 由字段 + 字段文档自动生成） ----------

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct NoteSearchParams {
    /// 搜索关键词（标题/内容模糊匹配）
    pub query: String,
    /// 返回条数，默认 5
    pub limit: Option<usize>,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct NoteReadParams {
    /// 笔记 id（note.search 命中列表中的 id）
    pub id: String,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct NoteCreateParams {
    /// 笔记标题
    pub title: String,
    /// 笔记正文（Markdown）
    pub content: String,
    /// 分类，默认"未分类"
    pub category: Option<String>,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct CanvasReadParams {
    /// 画布 id；省略或 "first" 表示读取第一张画布
    pub canvas_id: Option<String>,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct CanvasNodeCreateParams {
    /// 目标画布 id；省略或 "first" 表示第一张画布（不存在则自动创建）
    pub canvas_id: Option<String>,
    /// 节点文本内容
    pub content: String,
    /// 节点位置/尺寸（可选，默认贴第一张画布空白处）
    pub x: Option<f64>,
    pub y: Option<f64>,
    pub width: Option<f64>,
    pub height: Option<f64>,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct WebSearchParams {
    /// 搜索关键词
    pub query: String,
    /// 返回条数，默认 5
    pub limit: Option<usize>,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct LlmGenerateParams {
    /// 生成指令/提示词
    pub prompt: String,
    /// 最大生成 token 数，默认 1024
    pub max_tokens: Option<u32>,
}

// ---------- 服务器 ----------

#[derive(Clone)]
pub struct FloralMcp {
    base_dir: PathBuf,
    tool_router: ToolRouter<Self>,
}

#[tool_router]
impl FloralMcp {
    fn new(base_dir: PathBuf) -> Self {
        Self {
            base_dir,
            tool_router: Self::tool_router(),
        }
    }

    fn stores(&self) -> Result<(NoteStore, CanvasStore), String> {
        Ok((
            NoteStore::new(self.base_dir.clone()),
            CanvasStore::new(self.base_dir.clone()),
        ))
    }

    #[tool(description = "搜索笔记：按关键词模糊匹配标题与内容，返回命中列表（id/title/preview/category）")]
    async fn note_search(
        &self,
        Parameters(params): Parameters<NoteSearchParams>,
    ) -> Result<String, String> {
        let (notes, _) = self.stores()?;
        let hits = orchestrator::note_search(&notes, &params.query, params.limit.unwrap_or(5))
            .map_err(|e| e.to_string())?;
        serde_json::to_string_pretty(&hits).map_err(|e| e.to_string())
    }

    #[tool(description = "按 id 读取笔记正文")]
    async fn note_read(
        &self,
        Parameters(params): Parameters<NoteReadParams>,
    ) -> Result<String, String> {
        let (notes, _) = self.stores()?;
        let note = orchestrator::note_read(&notes, &params.id).map_err(|e| e.to_string())?;
        serde_json::to_string_pretty(&note).map_err(|e| e.to_string())
    }

    #[tool(description = "新建笔记（写入笔记库）")]
    async fn note_create(
        &self,
        Parameters(params): Parameters<NoteCreateParams>,
    ) -> Result<String, String> {
        let (notes, _) = self.stores()?;
        let note = notes
            .create_note(SaveNoteRequest {
                title: params.title,
                content: params.content,
                category: params.category.unwrap_or_else(|| "未分类".to_string()),
            })
            .map_err(|e| e.to_string())?;
        serde_json::to_string_pretty(&note).map_err(|e| e.to_string())
    }

    #[tool(description = "读取画布文档（默认第一张画布，或指定 canvasId）")]
    async fn canvas_read(
        &self,
        Parameters(params): Parameters<CanvasReadParams>,
    ) -> Result<String, String> {
        let (_, canvas) = self.stores()?;
        let id = params.canvas_id.unwrap_or_else(|| "first".to_string());
        let doc = if id == "first" {
            canvas
                .list()
                .map_err(|e| e.to_string())?
                .into_iter()
                .next()
                .ok_or_else(|| "没有可读取的画布".to_string())?
        } else {
            canvas.get(&id).map_err(|e| e.to_string())?
        };
        serde_json::to_string_pretty(&doc).map_err(|e| e.to_string())
    }

    #[tool(description = "在画布上创建文本节点（source=agent，写入画布文档）")]
    async fn canvas_node_create(
        &self,
        Parameters(params): Parameters<CanvasNodeCreateParams>,
    ) -> Result<String, String> {
        let (_, canvas) = self.stores()?;
        let id = params.canvas_id.unwrap_or_else(|| "first".to_string());
        let mut doc = if id == "first" {
            canvas
                .list()
                .map_err(|e| e.to_string())?
                .into_iter()
                .next()
                .unwrap_or_else(|| CanvasDocument {
                    id: format!("canvas-{}", chrono::Utc::now().timestamp_millis()),
                    note_id: None,
                    co_write_session_id: None,
                    nodes: Vec::new(),
                    edges: Vec::new(),
                    groups: Vec::new(),
                })
        } else {
            canvas.get(&id).map_err(|e| e.to_string())?
        };
        let node = CanvasNode {
            id: format!("node-{}", chrono::Utc::now().timestamp_millis()),
            node_type: "text".to_string(),
            x: params.x.unwrap_or(0.0),
            y: params.y.unwrap_or(0.0),
            width: params.width.unwrap_or(240.0),
            height: params.height.unwrap_or(80.0),
            text: params.content,
            source: Some("agent".to_string()),
            z_index: 0,
            ..CanvasNode::default()
        };
        doc.nodes.push(node.clone());
        canvas.save(doc).map_err(|e| e.to_string())?;
        serde_json::to_string_pretty(&node).map_err(|e| e.to_string())
    }

    #[tool(description = "通过自托管 SearXNG 搜索网页，返回标题/链接/摘要")]
    async fn web_search(
        &self,
        Parameters(params): Parameters<WebSearchParams>,
    ) -> Result<String, String> {
        let (notes, _) = self.stores()?;
        let config = notes.load_config().map_err(|e| e.to_string())?;
        if config.searxng_url.trim().is_empty() {
            return Err("未配置 SearXNG 地址（设置 → AI 集成 → Web 搜索）".to_string());
        }
        let results = searxng_search(&config.searxng_url, &params.query, params.limit.unwrap_or(5))
            .await
            .map_err(|e| e.to_string())?;
        serde_json::to_string_pretty(&results).map_err(|e| e.to_string())
    }

    #[tool(description = "调用 LLM 生成文本（OpenAI 兼容端点，取配置的 chat 模型）")]
    async fn llm_generate(
        &self,
        Parameters(params): Parameters<LlmGenerateParams>,
    ) -> Result<String, String> {
        let (notes, _) = self.stores()?;
        let config = notes.load_config().map_err(|e| e.to_string())?;
        let endpoint = resolve_endpoint(&config).map_err(|e| e.to_string())?;
        let provider = HttpLlmProvider::new(endpoint);
        provider
            .complete_prompt("", &params.prompt, params.max_tokens.unwrap_or(1024))
            .await
            .map_err(|e| e.to_string())
    }
}

#[tool_handler]
impl ServerHandler for FloralMcp {
    fn get_info(&self) -> ServerInfo {
        ServerInfo {
            instructions: Some(
                "花箴个人知识库工具：笔记检索/读写、画布读写、Web 搜索（SearXNG）、LLM 生成"
                    .to_string(),
            ),
            capabilities: ServerCapabilities::builder().enable_tools().build(),
            ..Default::default()
        }
    }
}

/// 命令行是否带 `--mcp`（进入 MCP stdio 服务器模式，跳过 Tauri 初始化）
pub fn is_mcp_mode() -> bool {
    std::env::args().any(|arg| arg == "--mcp")
}

/// 以 stdio 传输运行 MCP 服务器，直到客户端断开
pub fn run_stdio() -> Result<(), Box<dyn std::error::Error>> {
    let base_dir = default_store()
        .map_err(|e| e.to_string())?
        .base_dir()
        .to_path_buf();
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()?;
    runtime.block_on(async {
        let service = FloralMcp::new(base_dir)
            .serve(rmcp::transport::stdio())
            .await
            .inspect_err(|e| eprintln!("[mcp] 服务器启动失败: {e}"))?;
        service.waiting().await?;
        Ok::<(), Box<dyn std::error::Error>>(())
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::env;
    use uuid::Uuid;

    fn temp_server() -> FloralMcp {
        let dir = env::temp_dir().join(format!("floral-mcp-tests-{}", Uuid::new_v4()));
        FloralMcp::new(dir)
    }

    #[tokio::test]
    async fn note_search_and_read_roundtrip() {
        let server = temp_server();
        let (notes, _) = server.stores().unwrap();

        let created = notes
            .create_note(SaveNoteRequest {
                title: "RAG 笔记".into(),
                content: "用 SQLite-vec 做向量检索".into(),
                category: "AI".into(),
            })
            .unwrap();

        // 搜索命中
        let hit_text = server
            .note_search(Parameters(NoteSearchParams {
                query: "向量检索".into(),
                limit: Some(10),
            }))
            .await
            .unwrap();
        assert!(hit_text.contains("RAG 笔记"));

        // 按 id 读取
        let read_text = server
            .note_read(Parameters(NoteReadParams { id: created.id }))
            .await
            .unwrap();
        assert!(read_text.contains("SQLite-vec"));
    }

    #[tokio::test]
    async fn note_create_persists() {
        let server = temp_server();
        let text = server
            .note_create(Parameters(NoteCreateParams {
                title: "MCP 落地".into(),
                content: "用官方 SDK 复用协议标准".into(),
                category: Some("架构".into()),
            }))
            .await
            .unwrap();
        let note: serde_json::Value = serde_json::from_str(&text).unwrap();
        assert_eq!(note["title"], "MCP 落地");

        // 重新读取确认已落盘
        let (notes, _) = server.stores().unwrap();
        assert_eq!(notes.list_notes().unwrap().len(), 1);
    }

    #[tokio::test]
    async fn canvas_node_create_writes_agent_node() {
        let server = temp_server();
        let text = server
            .canvas_node_create(Parameters(CanvasNodeCreateParams {
                canvas_id: Some("first".into()),
                content: "沉淀：MCP 方案".into(),
                x: None,
                y: None,
                width: None,
                height: None,
            }))
            .await
            .unwrap();
        let node: serde_json::Value = serde_json::from_str(&text).unwrap();
        assert_eq!(node["source"], "agent");

        // 画布可读回，节点存在
        let read = server
            .canvas_read(Parameters(CanvasReadParams {
                canvas_id: Some("first".into()),
            }))
            .await
            .unwrap();
        assert!(read.contains("沉淀：MCP 方案"));
    }

    #[tokio::test]
    async fn web_search_reports_missing_config() {
        let server = temp_server();
        let err = server
            .web_search(Parameters(WebSearchParams {
                query: "rust".into(),
                limit: Some(3),
            }))
            .await
            .unwrap_err();
        assert!(err.contains("SearXNG"));
    }

    #[tokio::test]
    async fn llm_generate_reports_missing_provider() {
        let server = temp_server();
        let err = server
            .llm_generate(Parameters(LlmGenerateParams {
                prompt: "你好".into(),
                max_tokens: None,
            }))
            .await
            .unwrap_err();
        assert!(err.contains("AI 供应商") || err.contains("供应商"));
    }
}
