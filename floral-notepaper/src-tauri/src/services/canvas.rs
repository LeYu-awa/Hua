use serde::{Deserialize, Serialize};
use std::{fs, path::PathBuf};

use super::notes::AppError;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct CanvasNode {
    pub id: String,
    // 前端 CanvasNode 字段名为 `type`，此处显式对齐 IPC 契约（camelCase 会误转成 nodeType）
    #[serde(rename = "type")]
    pub node_type: String,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub text: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
    /// z 序（越大越靠前）；旧数据无此字段时默认 0
    #[serde(default)]
    pub z_index: i32,
    /// 所属分组 id（分组/泳道）；旧数据无此字段时默认 None
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub group: Option<String>,
    /// 卡片颜色标记（card 灵感卡）；默认 None
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    /// 卡片标签（card 灵感卡）；默认空
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tags: Vec<String>,
    /// task 待办卡完成态；默认 None（未设置）
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub done: Option<bool>,
    /// task 待办卡截止日期（YYYY-MM-DD）；默认 None
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub due_date: Option<String>,
    /// resource 资源卡关联笔记 id；双击可打开对应笔记；默认 None
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub note_id: Option<String>,
    /// 成文留痕：参与组卡成文的笔记 id（溯源：哪些卡片 → 哪篇文章）；默认 None
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub drafted_by: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CanvasEdge {
    pub id: String,
    pub from_node_id: String,
    pub to_node_id: String,
    pub style: String,
}

/// 画布分组（P1：图层分组）。旧数据无 groups 时为空。
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CanvasGroup {
    pub id: String,
    pub title: String,
    #[serde(default)]
    pub node_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CanvasDocument {
    pub id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub note_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub co_write_session_id: Option<String>,
    pub nodes: Vec<CanvasNode>,
    pub edges: Vec<CanvasEdge>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub groups: Vec<CanvasGroup>,
}

pub struct CanvasStore {
    base_dir: PathBuf,
}

impl CanvasStore {
    pub fn new(base_dir: impl Into<PathBuf>) -> Self {
        Self {
            base_dir: base_dir.into(),
        }
    }

    fn canvas_dir(&self) -> PathBuf {
        self.base_dir.join("canvas")
    }

    fn doc_path(&self, id: &str) -> PathBuf {
        self.canvas_dir()
            .join(format!("{}.json", sanitize_filename(id)))
    }

    pub fn save(&self, doc: CanvasDocument) -> Result<CanvasDocument, AppError> {
        let dir = self.canvas_dir();
        fs::create_dir_all(&dir)
            .map_err(|e| AppError::new("io", format!("创建 canvas 目录失败: {e}")))?;

        let path = self.doc_path(&doc.id);
        let json = serde_json::to_string_pretty(&doc)
            .map_err(|e| AppError::new("serialization", format!("序列化 canvas 失败: {e}")))?;
        fs::write(&path, json)
            .map_err(|e| AppError::new("io", format!("写入 canvas 失败: {e}")))?;

        Ok(doc)
    }

    pub fn get(&self, id: &str) -> Result<CanvasDocument, AppError> {
        let path = self.doc_path(id);
        if !path.exists() {
            return Err(AppError::new("canvasNotFound", format!("未找到画布: {id}")));
        }
        let json = fs::read_to_string(&path)
            .map_err(|e| AppError::new("io", format!("读取 canvas 失败: {e}")))?;
        serde_json::from_str(&json)
            .map_err(|e| AppError::new("deserialization", format!("解析 canvas 失败: {e}")))
    }

    pub fn delete(&self, id: &str) -> Result<(), AppError> {
        let path = self.doc_path(id);
        if path.exists() {
            fs::remove_file(&path)
                .map_err(|e| AppError::new("io", format!("删除 canvas 失败: {e}")))?;
        }
        Ok(())
    }

    pub fn list(&self) -> Result<Vec<CanvasDocument>, AppError> {
        let dir = self.canvas_dir();
        if !dir.exists() {
            return Ok(Vec::new());
        }

        let mut docs = Vec::new();
        for entry in fs::read_dir(&dir)
            .map_err(|e| AppError::new("io", format!("读取 canvas 目录失败: {e}")))?
        {
            let entry =
                entry.map_err(|e| AppError::new("io", format!("读取 canvas 目录项失败: {e}")))?;
            let path = entry.path();
            if path.extension().and_then(|s| s.to_str()) != Some("json") {
                continue;
            }
            let json = fs::read_to_string(&path)
                .map_err(|e| AppError::new("io", format!("读取 canvas 文件失败: {e}")))?;
            if let Ok(doc) = serde_json::from_str::<CanvasDocument>(&json) {
                docs.push(doc);
            }
        }

        docs.sort_by(|a, b| b.id.cmp(&a.id));
        Ok(docs)
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
pub fn canvas_save(
    doc: CanvasDocument,
    store: tauri::State<CanvasStore>,
) -> Result<CanvasDocument, AppError> {
    store.save(doc)
}

#[tauri::command]
pub fn canvas_get(
    id: String,
    store: tauri::State<CanvasStore>,
) -> Result<CanvasDocument, AppError> {
    store.get(&id)
}

#[tauri::command]
pub fn canvas_delete(id: String, store: tauri::State<CanvasStore>) -> Result<(), AppError> {
    store.delete(&id)
}

#[tauri::command]
pub fn canvas_list(store: tauri::State<CanvasStore>) -> Result<Vec<CanvasDocument>, AppError> {
    store.list()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::env;
    use uuid::Uuid;

    fn temp_store() -> CanvasStore {
        let dir = env::temp_dir().join(format!("hua-canvas-tests-{}", Uuid::new_v4()));
        CanvasStore::new(dir)
    }

    /// 关键契约测试：前端 TS 的 CanvasNode 字段是 `type`，Rust 是 `node_type`
    /// (rename_all=camelCase → `nodeType`)。此测试用「前端真实发送的 JSON 形状」
    /// 反序列化，确认 IPC 契约不会因字段名不一致而在真机上悄悄失败。
    #[test]
    fn deserializes_frontend_shaped_payload() {
        let frontend_json = r#"{
            "id": "canvas-note1",
            "noteId": "note1",
            "nodes": [
                {"id":"a","type":"text","x":0,"y":0,"width":200,"height":80,"text":"节点A","zIndex":1},
                {"id":"b","type":"card","x":700,"y":0,"width":240,"height":120,"text":"沉淀内容\n\n— 来自聊天","source":"agent"}
            ],
            "edges": [
                {"id":"e1","fromNodeId":"a","toNodeId":"b","style":"dashed"}
            ],
            "groups": [
                {"id":"g1","title":"起步","nodeIds":["a","b"]}
            ]
        }"#;
        let doc: CanvasDocument =
            serde_json::from_str(frontend_json).expect("前端形状的 JSON 必须能被 Rust 反序列化");
        assert_eq!(doc.nodes.len(), 2);
        assert_eq!(doc.nodes[0].node_type, "text");
        assert_eq!(doc.nodes[0].z_index, 1);
        assert_eq!(doc.nodes[1].node_type, "card");
        assert_eq!(doc.nodes[1].source.as_deref(), Some("agent"));
        assert_eq!(doc.nodes[1].z_index, 0, "缺省 zIndex 应为 0");
        assert_eq!(doc.edges[0].style, "dashed");
        assert_eq!(doc.groups.len(), 1);
        assert_eq!(doc.groups[0].title, "起步");
        assert_eq!(doc.groups[0].node_ids, vec!["a", "b"]);
    }

    /// P1-1 契约测试：旧数据（无 zIndex/groups 字段）反序列化不失败，缺省值正确。
    #[test]
    fn deserializes_legacy_payload_without_p1_fields() {
        let legacy_json = r#"{
            "id": "canvas-old",
            "nodes": [
                {"id":"a","type":"text","x":0,"y":0,"width":200,"height":80,"text":"老节点"}
            ],
            "edges": []
        }"#;
        let doc: CanvasDocument =
            serde_json::from_str(legacy_json).expect("旧数据必须仍能反序列化");
        assert_eq!(doc.nodes[0].z_index, 0);
        assert!(doc.groups.is_empty());
    }

    /// 场景一：接受隐含连接 → 写入 dashed 连线 → 落盘 → 重新读取仍在。
    #[test]
    fn accept_connection_persists_dashed_edge() {
        let store = temp_store();
        let doc = CanvasDocument {
            id: "canvas-n1".into(),
            note_id: Some("n1".into()),
            co_write_session_id: None,
            nodes: vec![
                CanvasNode {
                    id: "a".into(),
                    node_type: "text".into(),
                    x: 0.0,
                    y: 0.0,
                    width: 200.0,
                    height: 80.0,
                    text: "A".into(),
                    source: None,
                    z_index: 0,
                    ..CanvasNode::default()
                },
                CanvasNode {
                    id: "b".into(),
                    node_type: "text".into(),
                    x: 700.0,
                    y: 0.0,
                    width: 200.0,
                    height: 80.0,
                    text: "B".into(),
                    source: None,
                    z_index: 0,
                    ..CanvasNode::default()
                },
            ],
            edges: vec![],
            groups: vec![],
        };
        store.save(doc.clone()).unwrap();

        // 模拟前端 acceptConnection：追加一条 dashed 连线后再次保存
        let mut updated = store.get("canvas-n1").unwrap();
        updated.edges.push(CanvasEdge {
            id: "e-ab".into(),
            from_node_id: "a".into(),
            to_node_id: "b".into(),
            style: "dashed".into(),
        });
        store.save(updated).unwrap();

        let reloaded = store.get("canvas-n1").unwrap();
        assert_eq!(reloaded.edges.len(), 1);
        assert_eq!(reloaded.edges[0].style, "dashed");
        assert_eq!(reloaded.edges[0].from_node_id, "a");
        assert_eq!(reloaded.edges[0].to_node_id, "b");
    }

    /// 场景九：聊天沉淀 → 写入 source=agent 的卡片节点 → 落盘 → 重新读取仍在。
    #[test]
    fn sink_to_canvas_persists_agent_node() {
        let store = temp_store();
        store
            .save(CanvasDocument {
                id: "canvas-n2".into(),
                note_id: Some("n2".into()),
                co_write_session_id: None,
                nodes: vec![],
                edges: vec![],
                groups: vec![],
            })
            .unwrap();

        let mut doc = store.get("canvas-n2").unwrap();
        doc.nodes.push(CanvasNode {
            id: "sunk-1".into(),
            node_type: "card".into(),
            x: 120.0,
            y: 120.0,
            width: 240.0,
            height: 120.0,
            text: "决定先做实时同步 MVP\n\n— 来自聊天".into(),
            source: Some("agent".into()),
            z_index: 0,
            ..CanvasNode::default()
        });
        store.save(doc).unwrap();

        let reloaded = store.get("canvas-n2").unwrap();
        assert_eq!(reloaded.nodes.len(), 1);
        assert_eq!(reloaded.nodes[0].source.as_deref(), Some("agent"));
        assert!(reloaded.nodes[0].text.contains("来自聊天"));
    }
}
