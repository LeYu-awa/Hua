//! 向量存储：SQLite-vec（开源 SQLite 扩展）
//!
//! 嵌入现有 event_store 的 SQLite 模式。个人笔记 + 画布节点量级（几十万向量）完全够用，
//! 不需要 Qdrant/Chroma 等服务。向量存 `vec0` 虚拟表，元数据存普通表，
//! 按 (model, dimension) 分表（不同 Embedding 模型维度不同）。
//!
//! 相似度策略：插入/查询前做 L2 归一化，vec0 的 L2 距离排序与余弦相似度排序等价，
//! 返回时用 `cos = 1 - distance²/2` 还原余弦分数（distance 为归一化向量间的平方距离）。

use crate::services::notes::AppError;
use rusqlite::{params, Connection};
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::Once;

/// 注册 sqlite-vec 扩展（进程级一次，自动对后续所有连接生效）
static VEC_EXT_LOADED: Once = Once::new();

pub fn ensure_vec_loaded() {
    VEC_EXT_LOADED.call_once(|| unsafe {
        let init = sqlite_vec::sqlite3_vec_init as *const ();
        rusqlite::ffi::sqlite3_auto_extension(Some(std::mem::transmute(init)));
    });
}

/// 检索结果块
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RetrievedChunk {
    pub chunk_id: String,
    pub source_id: String,
    pub text: String,
    pub position: usize,
    /// 余弦相似度（-1 ~ 1）
    pub score: f32,
}

/// 待写入的块（由 RAG 分块 + embedding 后构造）
pub struct VectorChunkInput {
    pub chunk_id: String,
    pub source_id: String,
    pub text: String,
    pub position: usize,
    pub vector: Vec<f32>,
}

/// 向量库：每个 VectorStore 对应一个 SQLite 文件
pub struct VectorStore {
    path: PathBuf,
}

fn app_error(message: impl Into<String>) -> AppError {
    AppError::new("dbError", message)
}

fn normalize(v: &[f32]) -> Vec<f32> {
    let norm: f32 = v.iter().map(|x| x * x).sum::<f32>().sqrt();
    if norm <= f32::EPSILON {
        return v.to_vec();
    }
    v.iter().map(|x| x / norm).collect()
}

fn vec_to_blob(v: &[f32]) -> Vec<u8> {
    normalize(v)
        .iter()
        .flat_map(|x| x.to_le_bytes())
        .collect()
}

/// 表名：vec_{sanitized_model}_{dim}（模型名含 `-` 等非法标识符字符时替换为 `_`）
fn vec_table_name(model: &str, dim: usize) -> String {
    let sanitized: String = model
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect();
    format!("vec_{}_{}", sanitized, dim)
}

impl VectorStore {
    pub fn new(path: impl AsRef<Path>) -> Self {
        ensure_vec_loaded();
        let path = path.as_ref().to_path_buf();
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let store = Self { path };
        if store
            .conn()
            .and_then(|c| {
                c.execute_batch(SCHEMA)
                    .map_err(|e| app_error(format!("初始化向量库失败: {e}")))
            })
            .is_err()
        {
            eprintln!("[vector_store] init schema failed");
        }
        store
    }

    fn conn(&self) -> Result<Connection, AppError> {
        let conn = Connection::open(&self.path)
            .map_err(|e| app_error(format!("打开向量库失败: {e}")))?;
        conn.busy_timeout(std::time::Duration::from_secs(5))
            .map_err(|e| app_error(format!("设置 busy_timeout 失败: {e}")))?;
        Ok(conn)
    }

    fn ensure_vec_table(&self, conn: &Connection, model: &str, dim: usize) -> Result<(), AppError> {
        let name = vec_table_name(model, dim);
        conn.execute_batch(&format!(
            "CREATE VIRTUAL TABLE IF NOT EXISTS {name} USING vec0(embedding float[{dim}])"
        ))
        .map_err(|e| app_error(format!("创建向量表失败: {e}")))
    }

    /// 写入/覆盖一个块（同 model+chunk_id 覆盖）
    pub fn upsert_chunk(&self, model: &str, input: &VectorChunkInput) -> Result<(), AppError> {
        let dim = input.vector.len();
        if dim == 0 {
            return Err(app_error("向量为空"));
        }
        let conn = self.conn()?;
        self.ensure_vec_table(&conn, model, dim)?;
        let table = vec_table_name(model, dim);

        conn.execute(
            "BEGIN IMMEDIATE",
            [],
        )
        .map_err(|e| app_error(format!("开启事务失败: {e}")))?;

        // 覆盖旧块：先删旧向量行与元数据行
        let old_id: Option<i64> = conn
            .query_row(
                "SELECT id FROM vector_chunks WHERE model = ?1 AND chunk_id = ?2",
                params![model, input.chunk_id],
                |row| row.get(0),
            )
            .ok();
        if let Some(id) = old_id {
            let _ = conn.execute(&format!("DELETE FROM {table} WHERE rowid = ?1"), params![id]);
            let _ = conn.execute("DELETE FROM vector_chunks WHERE id = ?1", params![id]);
        }

        conn.execute(
            "INSERT INTO vector_chunks (model, chunk_id, source_id, text, position, dimension, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                model,
                input.chunk_id,
                input.source_id,
                input.text,
                input.position as i64,
                dim as i64,
                chrono::Utc::now().to_rfc3339(),
            ],
        )
        .map_err(|e| {
            let _ = conn.execute("ROLLBACK", []);
            app_error(format!("写入向量元数据失败: {e}"))
        })?;
        let row_id = conn.last_insert_rowid();

        let blob = vec_to_blob(&input.vector);
        conn.execute(
            &format!("INSERT INTO {table} (rowid, embedding) VALUES (?1, ?2)"),
            params![row_id, blob.as_slice()],
        )
        .map_err(|e| {
            let _ = conn.execute("ROLLBACK", []);
            app_error(format!("写入向量失败: {e}"))
        })?;

        conn.execute("COMMIT", [])
            .map(|_| ())
            .map_err(|e| app_error(format!("提交事务失败: {e}")))
    }

    pub fn delete_chunk(&self, model: &str, chunk_id: &str) -> Result<(), AppError> {
        let conn = self.conn()?;
        let id: Option<i64> = conn
            .query_row(
                "SELECT id FROM vector_chunks WHERE model = ?1 AND chunk_id = ?2",
                params![model, chunk_id],
                |row| row.get(0),
            )
            .ok();
        if let Some(id) = id {
            if let Ok(dim) = self.chunk_dimension(&conn, id) {
                let table = vec_table_name(model, dim);
                let _ = conn.execute(&format!("DELETE FROM {table} WHERE rowid = ?1"), params![id]);
            }
            conn.execute("DELETE FROM vector_chunks WHERE id = ?1", params![id])
                .map_err(|e| app_error(format!("删除块失败: {e}")))?;
        }
        Ok(())
    }

    pub fn delete_by_source(&self, model: &str, source_id: &str) -> Result<(), AppError> {
        let conn = self.conn()?;
        let ids: Vec<i64> = conn
            .prepare("SELECT id FROM vector_chunks WHERE model = ?1 AND source_id = ?2")
            .map_err(|e| app_error(format!("查询失败: {e}")))?
            .query_map(params![model, source_id], |row| row.get(0))
            .map_err(|e| app_error(format!("查询失败: {e}")))?
            .filter_map(Result::ok)
            .collect();
        for id in ids {
            if let Ok(dim) = self.chunk_dimension(&conn, id) {
                let table = vec_table_name(model, dim);
                let _ = conn.execute(&format!("DELETE FROM {table} WHERE rowid = ?1"), params![id]);
            }
        }
        conn.execute(
            "DELETE FROM vector_chunks WHERE model = ?1 AND source_id = ?2",
            params![model, source_id],
        )
        .map_err(|e| app_error(format!("删除源失败: {e}")))?;
        Ok(())
    }

    /// KNN 检索，按余弦相似度降序返回
    pub fn search(
        &self,
        model: &str,
        query: &[f32],
        top_k: usize,
    ) -> Result<Vec<RetrievedChunk>, AppError> {
        let dim = query.len();
        if dim == 0 {
            return Ok(Vec::new());
        }
        let conn = self.conn()?;
        let table = vec_table_name(model, dim);
        let blob = vec_to_blob(query);

        let stmt_result =
            conn.prepare(&format!(
                "SELECT rowid, distance FROM {table} WHERE embedding MATCH ?1 ORDER BY distance LIMIT ?2"
            ));
        let mut stmt = match stmt_result {
            Ok(stmt) => stmt,
            Err(e) if e.to_string().contains("no such table") => {
                // 该模型还没写入过任何向量
                return Ok(Vec::new());
            }
            Err(e) => return Err(app_error(format!("向量检索失败: {e}"))),
        };
        let rows: Result<Vec<(i64, f32)>, AppError> = stmt
            .query_map(params![blob.as_slice(), top_k as i64], |row| {
                Ok((row.get::<_, i64>(0)?, row.get::<_, f32>(1)?))
            })
            .map_err(|e| app_error(format!("向量检索失败: {e}")))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| app_error(format!("向量检索失败: {e}")));
        drop(stmt);
        let rows = rows?;

        let mut result = Vec::with_capacity(rows.len());
        for (id, distance) in rows {
            let meta = conn
                .query_row(
                    "SELECT chunk_id, source_id, text, position FROM vector_chunks WHERE id = ?1",
                    params![id],
                    |row| {
                        Ok((
                            row.get::<_, String>(0)?,
                            row.get::<_, String>(1)?,
                            row.get::<_, String>(2)?,
                            row.get::<_, i64>(3)?,
                        ))
                    },
                )
                .ok();
            if let Some((chunk_id, source_id, text, position)) = meta {
                // 归一化向量：cos = 1 - distance²/2
                let score = (1.0 - distance * distance / 2.0).clamp(-1.0, 1.0);
                result.push(RetrievedChunk {
                    chunk_id,
                    source_id,
                    text,
                    position: position as usize,
                    score,
                });
            }
        }
        Ok(result)
    }

    /// 某模型已写入的维度（用于检索前确定表名）
    pub fn model_dimension(&self, model: &str) -> Option<usize> {
        let conn = self.conn().ok()?;
        conn.query_row(
            "SELECT dimension FROM vector_chunks WHERE model = ?1 LIMIT 1",
            params![model],
            |row| row.get::<_, i64>(0),
        )
        .ok()
        .map(|d| d as usize)
    }

    pub fn count(&self, model: &str) -> Result<usize, AppError> {
        let conn = self.conn()?;
        let n: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM vector_chunks WHERE model = ?1",
                params![model],
                |row| row.get(0),
            )
            .map_err(|e| app_error(format!("统计失败: {e}")))?;
        Ok(n as usize)
    }

    fn chunk_dimension(&self, conn: &Connection, id: i64) -> Result<usize, AppError> {
        conn.query_row(
            "SELECT dimension FROM vector_chunks WHERE id = ?1",
            params![id],
            |row| row.get::<_, i64>(0),
        )
        .map(|d| d as usize)
        .map_err(|e| app_error(format!("读取维度失败: {e}")))
    }
}

const SCHEMA: &str = "
CREATE TABLE IF NOT EXISTS vector_chunks (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    model       TEXT NOT NULL,
    chunk_id    TEXT NOT NULL,
    source_id   TEXT NOT NULL,
    text        TEXT NOT NULL,
    position    INTEGER NOT NULL DEFAULT 0,
    dimension   INTEGER NOT NULL,
    created_at  TEXT NOT NULL,
    UNIQUE(model, chunk_id)
);
CREATE INDEX IF NOT EXISTS idx_vector_chunks_model_source ON vector_chunks(model, source_id);
";

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_path(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "floral_vec_test_{}_{}.sqlite",
            std::process::id(),
            name
        ))
    }

    fn input(chunk_id: &str, source_id: &str, text: &str, vector: Vec<f32>) -> VectorChunkInput {
        VectorChunkInput {
            chunk_id: chunk_id.to_string(),
            source_id: source_id.to_string(),
            text: text.to_string(),
            position: 0,
            vector,
        }
    }

    #[test]
    fn upsert_search_delete_roundtrip() {
        let path = temp_path("roundtrip");
        let _ = std::fs::remove_file(&path);
        let store = VectorStore::new(&path);

        store
            .upsert_chunk("bge-m3", &input("a", "src1", "苹果的产地在中国", vec![1.0, 0.0, 0.0]))
            .unwrap();
        store
            .upsert_chunk("bge-m3", &input("b", "src2", "香蕉是黄色的", vec![0.0, 1.0, 0.0]))
            .unwrap();
        store
            .upsert_chunk("bge-m3", &input("c", "src3", "汽车需要汽油", vec![0.0, 0.0, 1.0]))
            .unwrap();

        assert_eq!(store.count("bge-m3").unwrap(), 3);
        assert_eq!(store.model_dimension("bge-m3"), Some(3));

        // 查询与 a 完全对齐
        let hits = store.search("bge-m3", &[1.0, 0.0, 0.0], 2).unwrap();
        assert_eq!(hits.len(), 2);
        assert_eq!(hits[0].chunk_id, "a");
        assert!(hits[0].score > 0.999);
        // b、c 与 a 正交，score 约 0
        assert!(hits[1].score.abs() < 1e-3);

        // 覆盖 a → 不产生重复
        store
            .upsert_chunk("bge-m3", &input("a", "src1", "苹果的产地在中国（修订）", vec![0.9, 0.1, 0.0]))
            .unwrap();
        assert_eq!(store.count("bge-m3").unwrap(), 3);
        let hits = store.search("bge-m3", &[1.0, 0.0, 0.0], 3).unwrap();
        assert_eq!(hits[0].chunk_id, "a");
        assert_eq!(hits[0].text, "苹果的产地在中国（修订）");

        // 删除单块
        store.delete_chunk("bge-m3", "b").unwrap();
        assert_eq!(store.count("bge-m3").unwrap(), 2);

        // 按源删除
        store.delete_by_source("bge-m3", "src3").unwrap();
        assert_eq!(store.count("bge-m3").unwrap(), 1);

        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn different_dimensions_use_different_tables() {
        let path = temp_path("dims");
        let _ = std::fs::remove_file(&path);
        let store = VectorStore::new(&path);

        store
            .upsert_chunk("m", &input("a", "s1", "三维", vec![1.0, 0.0, 0.0]))
            .unwrap();
        store
            .upsert_chunk("m", &input("b", "s2", "二维", vec![1.0, 0.0]))
            .unwrap();

        assert_eq!(store.count("m").unwrap(), 2);
        // 各自维度表可独立检索
        let hits3 = store.search("m", &[1.0, 0.0, 0.0], 1).unwrap();
        assert_eq!(hits3.len(), 1);
        assert_eq!(hits3[0].chunk_id, "a");
        let hits2 = store.search("m", &[1.0, 0.0], 1).unwrap();
        assert_eq!(hits2[0].chunk_id, "b");

        let _ = std::fs::remove_file(&path);
    }
}
