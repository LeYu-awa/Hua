//! RAG 检索：自拼流程（分块 → embedding → 余弦 top-k → 拼 context）
//!
//! 个人笔记 + 画布节点量级，自拼足够，不上 LlamaIndex/LangChain。
//! embedding 通过注入的异步闭包解耦：生产环境传 HttpEmbeddingProvider，测试传确定性实现。

use crate::services::agent::llm_provider::{resolve_endpoint, HttpEmbeddingProvider};
use crate::services::agent::vector_store::{RetrievedChunk, VectorChunkInput, VectorStore};
use crate::services::notes::{default_store, AppError};
use std::future::Future;

/// 默认分块参数
pub const DEFAULT_MAX_CHARS: usize = 512;
pub const DEFAULT_OVERLAP_CHARS: usize = 64;

/// 一个文本块
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Chunk {
    pub text: String,
    pub position: usize,
}

/// 分块：先按空行分段落；段落超长再按句子边界滑窗切，窗口带 overlap。
/// CJK 友好（按字符计数，句号/分号处断句）。
pub fn chunk_text(text: &str, max_chars: usize, overlap_chars: usize) -> Vec<Chunk> {
    let normalized = text.replace("\r\n", "\n");
    let max = max_chars.max(64);
    let overlap = overlap_chars.min(max / 2);
    let mut chunks = Vec::new();

    for paragraph in normalized.split("\n\n") {
        let paragraph = paragraph.trim();
        if paragraph.is_empty() {
            continue;
        }
        let chars: Vec<char> = paragraph.chars().collect();
        if chars.len() <= max {
            chunks.push(Chunk {
                text: paragraph.to_string(),
                position: chunks.len(),
            });
            continue;
        }
        // 长段落：滑窗 + 句号边界
        let mut start = 0usize;
        while start < chars.len() {
            let mut end = (start + max).min(chars.len());
            if end < chars.len() {
                let boundary = chars[start..end].iter().rposition(|&c| {
                    matches!(c, '。' | '！' | '？' | '?' | ';' | '；')
                });
                if let Some(rel) = boundary {
                    let abs = start + rel + 1;
                    if abs - start >= max / 3 {
                        end = abs;
                    }
                }
            }
            chunks.push(Chunk {
                text: chars[start..end].iter().collect(),
                position: chunks.len(),
            });
            if end >= chars.len() {
                break;
            }
            start = end.saturating_sub(overlap);
        }
    }
    chunks
}

/// 由 source + position 生成稳定 chunk_id（同源重索引可覆盖）
pub fn chunk_id_for(source_id: &str, position: usize) -> String {
    format!("{source_id}#{position}")
}

/// 索引一段文本：分块 → 逐块 embedding → 写入向量库。返回写入的 chunk_id 列表。
pub async fn index_text<F, Fut>(
    store: &VectorStore,
    model: &str,
    source_id: &str,
    text: &str,
    embed: F,
) -> Result<Vec<String>, AppError>
where
    F: Fn(String) -> Fut,
    Fut: Future<Output = Result<Vec<f32>, AppError>>,
{
    let chunks = chunk_text(text, DEFAULT_MAX_CHARS, DEFAULT_OVERLAP_CHARS);
    let mut ids = Vec::with_capacity(chunks.len());
    for chunk in &chunks {
        let vector = embed(chunk.text.clone()).await?;
        let chunk_id = chunk_id_for(source_id, chunk.position);
        store.upsert_chunk(
            model,
            &VectorChunkInput {
                chunk_id: chunk_id.clone(),
                source_id: source_id.to_string(),
                text: chunk.text.clone(),
                position: chunk.position,
                vector,
            },
        )?;
        ids.push(chunk_id);
    }
    Ok(ids)
}

/// 检索：embedding 查询 → KNN → 按余弦降序返回
pub async fn retrieve<F, Fut>(
    store: &VectorStore,
    model: &str,
    query: &str,
    top_k: usize,
    embed: F,
) -> Result<Vec<RetrievedChunk>, AppError>
where
    F: Fn(String) -> Fut,
    Fut: Future<Output = Result<Vec<f32>, AppError>>,
{
    let query_vec = embed(query.to_string()).await?;
    store.search(model, &query_vec, top_k)
}

/// 把检索结果拼成 prompt context（受 max_chars 限制）
pub fn build_context(chunks: &[RetrievedChunk], max_chars: usize) -> String {
    let mut parts = Vec::new();
    let mut used = 0usize;
    for c in chunks {
        let len = c.text.chars().count() + 2; // 「」
        if used + len > max_chars {
            break;
        }
        parts.push(format!("「{}」", c.text));
        used += len;
    }
    parts.join("\n")
}

/// 解析 embedding 端点并构造 provider（生产路径共用）
fn embedding_provider() -> Result<HttpEmbeddingProvider, AppError> {
    let config = default_store()?.load_config()?;
    let endpoint = resolve_endpoint(&config)?;
    HttpEmbeddingProvider::new(endpoint)
}

/// IPC：索引一段文本（笔记/画布节点内容）到向量库，返回 chunk_id 列表
#[tauri::command]
pub async fn agent_rag_index(
    store: tauri::State<'_, VectorStore>,
    source_id: String,
    text: String,
) -> Result<Vec<String>, AppError> {
    let provider = embedding_provider()?;
    let model = provider.model().to_string();
    index_text(&store, &model, &source_id, &text, |t| provider.embed(t)).await
}

/// IPC：检索与 query 最相关的 top_k 块
#[tauri::command]
pub async fn agent_rag_retrieve(
    store: tauri::State<'_, VectorStore>,
    query: String,
    top_k: Option<usize>,
) -> Result<Vec<RetrievedChunk>, AppError> {
    let provider = embedding_provider()?;
    let model = provider.model().to_string();
    retrieve(&store, &model, &query, top_k.unwrap_or(5), |t| provider.embed(t)).await
}

/// IPC：删除某个来源的全部块（源内容变更后重索引前调用）
#[tauri::command]
pub async fn agent_rag_delete_source(
    store: tauri::State<'_, VectorStore>,
    source_id: String,
) -> Result<(), AppError> {
    let provider = embedding_provider()?;
    let model = provider.model().to_string();
    store.delete_by_source(&model, &source_id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::agent::vector_store::VectorStore;
    use std::path::PathBuf;

    /// 确定性 embedding：字符袋模型，同字越多相似度越高
    fn char_embed(text: &str, dim: usize) -> Vec<f32> {
        let mut v = vec![0f32; dim];
        for c in text.chars() {
            let idx = (c as u32 as usize) % dim;
            v[idx] += 1.0;
        }
        v
    }

    fn temp_path(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "floral_rag_test_{}_{}.sqlite",
            std::process::id(),
            name
        ))
    }

    #[test]
    fn chunk_short_text_keeps_whole() {
        let chunks = chunk_text("这是一段短文本。", 512, 64);
        assert_eq!(chunks.len(), 1);
        assert_eq!(chunks[0].text, "这是一段短文本。");
        assert_eq!(chunks[0].position, 0);
    }

    #[test]
    fn chunk_splits_long_paragraph_with_overlap() {
        // 200 个汉字，max=64 → 至少 4 段
        let long: String = (0..200).map(|i| {
            if i % 20 == 19 { '。' } else { char::from_u32('中' as u32).unwrap() }
        }).collect();
        let chunks = chunk_text(&long, 64, 12);
        assert!(chunks.len() >= 4);
        for c in &chunks {
            assert!(c.text.chars().count() <= 65);
            assert!(!c.text.is_empty());
        }
        // 相邻块带 overlap：后一块前 12 字符 == 前一块尾部 12 字符
        let a: Vec<char> = chunks[0].text.chars().collect();
        let b: Vec<char> = chunks[1].text.chars().collect();
        assert_eq!(a[a.len() - 12..], b[..12]);
        // position 连续
        for (i, c) in chunks.iter().enumerate() {
            assert_eq!(c.position, i);
        }
    }

    #[test]
    fn chunk_splits_paragraphs() {
        let chunks = chunk_text("第一段。\n\n第二段。", 512, 64);
        assert_eq!(chunks.len(), 2);
        assert_eq!(chunks[0].text, "第一段。");
        assert_eq!(chunks[1].text, "第二段。");
    }

    #[test]
    fn chunk_empty_returns_empty() {
        assert!(chunk_text("", 512, 64).is_empty());
    }

    #[test]
    fn index_and_retrieve_finds_related_document() {
        let path = temp_path("retrieve");
        let _ = std::fs::remove_file(&path);
        let store = VectorStore::new(&path);
        let model = "test-embed";

        let index = |source: &str, text: &str| {
            tauri::async_runtime::block_on(index_text(&store, model, source, text, |t| {
                let text = t.to_string();
                async move { Ok(char_embed(&text, 8)) }
            }))
            .unwrap()
        };
        let search = |query: &str| {
            tauri::async_runtime::block_on(retrieve(&store, model, query, 3, |t| {
                let text = t.to_string();
                async move { Ok(char_embed(&text, 8)) }
            }))
            .unwrap()
        };

        index("note-fruit", "苹果的产地在中国，冬天适合吃苹果。");
        index("note-car", "汽车需要汽油和机油，日常要保养。");
        index("note-flower", "花箴是桌面笔记应用，画布用来整理想法。");

        let hits = search("汽车油耗怎么省");
        assert!(!hits.is_empty());
        assert_eq!(hits[0].source_id, "note-car");
        assert!(hits[0].score > hits[1].score);

        // 重索引同源 → 数量不膨胀
        index("note-fruit", "苹果的产地在中国，修订后内容更长一些。");
        let all = store.search(model, &char_embed("苹果", 8), 10).unwrap();
        assert_eq!(all.len(), 3);

        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn build_context_respects_limit_and_format() {
        let chunks = vec![
            RetrievedChunk {
                chunk_id: "a#0".into(),
                source_id: "a".into(),
                text: "苹果的产地在中国。".into(),
                position: 0,
                score: 0.9,
            },
            RetrievedChunk {
                chunk_id: "b#0".into(),
                source_id: "b".into(),
                text: "汽车需要汽油。".into(),
                position: 0,
                score: 0.8,
            },
        ];
        let context = build_context(&chunks, 12);
        assert!(context.contains("苹果的产地在中国"));
        // 第一个块 9+2=11 ≤ 12，加第二个 7+2 超 12 → 只保留第一个
        assert!(!context.contains("汽车"));

        let context_all = build_context(&chunks, 200);
        assert!(context_all.contains("汽车"));
        assert!(context_all.lines().count() == 2);
    }
}
