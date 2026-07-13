// Embedding 向量本地缓存
// 支撑前端 embeddingService 的持久化缓存需求（issue 第 3 节"Embedding 调用频率
// 和本地缓存策略"）。前端算好文本的缓存 key（modelId + 文本哈希）后，
// 通过 IPC 读写本地向量，避免进程重启后缓存失效、重复调用 Embedding API。
//
// 存储布局：<base_dir>/embedding_cache/<sanitized_model>.json
//   文件内容为 { "<key>": [f32, ...], ... }

use serde::{Deserialize, Serialize};
use std::{collections::HashMap, fs, path::PathBuf};

use super::notes::AppError;

/// 一条缓存条目：key 由前端计算（modelId 已在文件名中区分，这里 key 是文本哈希）
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct EmbeddingCacheEntry {
    pub key: String,
    pub vector: Vec<f32>,
}

pub struct EmbeddingCacheStore {
    base_dir: PathBuf,
}

impl EmbeddingCacheStore {
    pub fn new(base_dir: impl Into<PathBuf>) -> Self {
        Self {
            base_dir: base_dir.into(),
        }
    }

    fn cache_dir(&self) -> PathBuf {
        self.base_dir.join("embedding_cache")
    }

    fn model_path(&self, model: &str) -> PathBuf {
        self.cache_dir()
            .join(format!("{}.json", sanitize_filename(model)))
    }

    fn load_model(&self, model: &str) -> Result<HashMap<String, Vec<f32>>, AppError> {
        let path = self.model_path(model);
        if !path.exists() {
            return Ok(HashMap::new());
        }
        let content = fs::read_to_string(&path)
            .map_err(|e| AppError::new("io", format!("读取 embedding 缓存失败: {e}")))?;
        if content.trim().is_empty() {
            return Ok(HashMap::new());
        }
        serde_json::from_str(&content)
            .map_err(|e| AppError::new("deserialization", format!("解析 embedding 缓存失败: {e}")))
    }

    /// 按 key 读取缓存向量，未命中的位置为 None。顺序与入参 keys 对应。
    pub fn get(&self, model: &str, keys: &[String]) -> Result<Vec<Option<Vec<f32>>>, AppError> {
        let map = self.load_model(model)?;
        Ok(keys.iter().map(|k| map.get(k).cloned()).collect())
    }

    /// 写入若干缓存条目（合并进已有缓存后整体写回）。
    pub fn put(&self, model: &str, entries: Vec<EmbeddingCacheEntry>) -> Result<(), AppError> {
        if entries.is_empty() {
            return Ok(());
        }
        let dir = self.cache_dir();
        fs::create_dir_all(&dir)
            .map_err(|e| AppError::new("io", format!("创建 embedding 缓存目录失败: {e}")))?;

        let mut map = self.load_model(model)?;
        for entry in entries {
            map.insert(entry.key, entry.vector);
        }

        let json = serde_json::to_string(&map)
            .map_err(|e| AppError::new("serialization", format!("序列化 embedding 缓存失败: {e}")))?;
        fs::write(self.model_path(model), json)
            .map_err(|e| AppError::new("io", format!("写入 embedding 缓存失败: {e}")))?;
        Ok(())
    }

    /// 清空全部缓存。
    pub fn clear(&self) -> Result<(), AppError> {
        let dir = self.cache_dir();
        if dir.exists() {
            fs::remove_dir_all(&dir)
                .map_err(|e| AppError::new("io", format!("清理 embedding 缓存失败: {e}")))?;
        }
        Ok(())
    }
}

fn sanitize_filename(name: &str) -> String {
    name.chars()
        .map(|c| match c {
            '\\' | '/' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
            _ => c,
        })
        .collect()
}

#[tauri::command]
pub fn embedding_cache_get(
    model: String,
    keys: Vec<String>,
    store: tauri::State<EmbeddingCacheStore>,
) -> Result<Vec<Option<Vec<f32>>>, AppError> {
    store.get(&model, &keys)
}

#[tauri::command]
pub fn embedding_cache_put(
    model: String,
    entries: Vec<EmbeddingCacheEntry>,
    store: tauri::State<EmbeddingCacheStore>,
) -> Result<(), AppError> {
    store.put(&model, entries)
}

#[tauri::command]
pub fn embedding_cache_clear(store: tauri::State<EmbeddingCacheStore>) -> Result<(), AppError> {
    store.clear()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::env;
    use uuid::Uuid;

    fn temp_store() -> EmbeddingCacheStore {
        let dir = env::temp_dir().join(format!("hua-emb-tests-{}", Uuid::new_v4()));
        EmbeddingCacheStore::new(dir)
    }

    /// IPC 契约：前端发送 {key, vector} 形状必须能反序列化。
    #[test]
    fn deserializes_frontend_entry_shape() {
        let json = r#"{"key":"abc","vector":[0.1,0.2,0.3]}"#;
        let entry: EmbeddingCacheEntry = serde_json::from_str(json).expect("前端条目形状应可反序列化");
        assert_eq!(entry.key, "abc");
        assert_eq!(entry.vector.len(), 3);
    }

    #[test]
    fn test_put_and_get() {
        let store = temp_store();
        store
            .put(
                "model-a",
                vec![
                    EmbeddingCacheEntry {
                        key: "k1".into(),
                        vector: vec![1.0, 2.0, 3.0],
                    },
                    EmbeddingCacheEntry {
                        key: "k2".into(),
                        vector: vec![4.0, 5.0],
                    },
                ],
            )
            .unwrap();

        let got = store
            .get("model-a", &["k1".into(), "missing".into(), "k2".into()])
            .unwrap();
        assert_eq!(got[0], Some(vec![1.0, 2.0, 3.0]));
        assert_eq!(got[1], None);
        assert_eq!(got[2], Some(vec![4.0, 5.0]));
    }

    #[test]
    fn test_put_merges_existing() {
        let store = temp_store();
        store
            .put(
                "m",
                vec![EmbeddingCacheEntry {
                    key: "k1".into(),
                    vector: vec![1.0],
                }],
            )
            .unwrap();
        store
            .put(
                "m",
                vec![EmbeddingCacheEntry {
                    key: "k2".into(),
                    vector: vec![2.0],
                }],
            )
            .unwrap();
        let got = store.get("m", &["k1".into(), "k2".into()]).unwrap();
        assert_eq!(got[0], Some(vec![1.0]));
        assert_eq!(got[1], Some(vec![2.0]));
    }

    #[test]
    fn test_models_are_isolated() {
        let store = temp_store();
        store
            .put(
                "model-a",
                vec![EmbeddingCacheEntry {
                    key: "k".into(),
                    vector: vec![1.0],
                }],
            )
            .unwrap();
        let got = store.get("model-b", &["k".into()]).unwrap();
        assert_eq!(got[0], None);
    }

    #[test]
    fn test_clear() {
        let store = temp_store();
        store
            .put(
                "m",
                vec![EmbeddingCacheEntry {
                    key: "k".into(),
                    vector: vec![1.0],
                }],
            )
            .unwrap();
        store.clear().unwrap();
        let got = store.get("m", &["k".into()]).unwrap();
        assert_eq!(got[0], None);
    }

    #[test]
    fn test_empty_put_is_noop() {
        let store = temp_store();
        store.put("m", vec![]).unwrap();
        // 目录不应被创建
        let got = store.get("m", &["k".into()]).unwrap();
        assert_eq!(got[0], None);
    }
}
