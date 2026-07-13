use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CanvasPosition {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CanvasRelation {
    pub target_node_id: String,
    pub relation_type: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CanvasNodeInput {
    pub node_id: String,
    pub node_type: String,
    pub position: CanvasPosition,
    #[serde(default)]
    pub rich_text: String,
    #[serde(default)]
    pub annotation: String,
    #[serde(default)]
    pub note: String,
    #[serde(default)]
    pub ocr_text: String,
    #[serde(default)]
    pub relations: Vec<CanvasRelation>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CanvasNodeIndex {
    pub node_id: String,
    pub node_type: String,
    pub position: CanvasPosition,
    pub relations: Vec<CanvasRelation>,
    pub text: String,
    pub keywords: Vec<String>,
    pub deleted: bool,
}

#[derive(Debug, Clone)]
pub enum CanvasChange {
    Upsert(CanvasNodeInput),
    Delete { node_id: String },
}

#[derive(Debug, Clone, Default)]
pub struct CanvasNodeQuery {
    pub keyword: Option<String>,
    pub node_type: Option<String>,
    pub bounds: Option<CanvasPosition>,
}

#[derive(Default)]
pub struct CanvasIndexer {
    nodes: BTreeMap<String, CanvasNodeIndex>,
}

impl CanvasIndexer {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn rebuild(&mut self, nodes: Vec<CanvasNodeInput>) {
        self.nodes = nodes
            .into_iter()
            .map(|node| {
                let indexed = index_node(node);
                (indexed.node_id.clone(), indexed)
            })
            .collect();
    }

    pub fn apply_change(&mut self, change: CanvasChange) {
        match change {
            CanvasChange::Upsert(node) => {
                let indexed = index_node(node);
                self.nodes.insert(indexed.node_id.clone(), indexed);
            }
            CanvasChange::Delete { node_id } => {
                if let Some(node) = self.nodes.get_mut(&node_id) {
                    node.deleted = true;
                }
            }
        }
    }

    pub fn get(&self, node_id: &str) -> Option<&CanvasNodeIndex> {
        self.nodes.get(node_id).filter(|node| !node.deleted)
    }

    pub fn query(&self, query: CanvasNodeQuery) -> Vec<CanvasNodeIndex> {
        self.nodes
            .values()
            .filter(|node| !node.deleted)
            .filter(|node| {
                query
                    .node_type
                    .as_ref()
                    .map(|node_type| &node.node_type == node_type)
                    .unwrap_or(true)
            })
            .filter(|node| {
                query
                    .keyword
                    .as_ref()
                    .map(|keyword| node.text.contains(keyword) || node.keywords.contains(keyword))
                    .unwrap_or(true)
            })
            .filter(|node| {
                query
                    .bounds
                    .as_ref()
                    .map(|bounds| intersects(&node.position, bounds))
                    .unwrap_or(true)
            })
            .cloned()
            .collect()
    }
}

fn index_node(input: CanvasNodeInput) -> CanvasNodeIndex {
    let text = extract_text(&input);
    CanvasNodeIndex {
        node_id: input.node_id,
        node_type: input.node_type,
        position: input.position,
        relations: input.relations,
        keywords: keywords(&text),
        text,
        deleted: false,
    }
}

fn extract_text(input: &CanvasNodeInput) -> String {
    [
        &input.rich_text,
        &input.annotation,
        &input.note,
        &input.ocr_text,
    ]
    .into_iter()
    .map(|value| value.trim())
    .filter(|value| !value.is_empty())
    .collect::<Vec<_>>()
    .join("\n")
}

fn keywords(text: &str) -> Vec<String> {
    text.split(|ch: char| ch.is_whitespace() || ch.is_ascii_punctuation())
        .filter(|word| word.chars().count() >= 2)
        .fold(Vec::new(), |mut acc, word| {
            let word = word.to_string();
            if !acc.contains(&word) {
                acc.push(word);
            }
            acc
        })
}

fn intersects(left: &CanvasPosition, right: &CanvasPosition) -> bool {
    left.x < right.x + right.width
        && left.x + left.width > right.x
        && left.y < right.y + right.height
        && left.y + left.height > right.y
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn indexes_text_and_queries_by_keyword() {
        let mut indexer = CanvasIndexer::new();
        indexer.apply_change(CanvasChange::Upsert(test_node(
            "n1",
            "note",
            10.0,
            "栀子花 夏天",
        )));
        indexer.apply_change(CanvasChange::Upsert(test_node(
            "n2", "image", 500.0, "海边",
        )));

        let found = indexer.query(CanvasNodeQuery {
            keyword: Some("栀子花".to_string()),
            ..CanvasNodeQuery::default()
        });
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].node_id, "n1");
    }

    #[test]
    fn updates_incrementally_and_deletes() {
        let mut indexer = CanvasIndexer::new();
        indexer.apply_change(CanvasChange::Upsert(test_node(
            "n1",
            "note",
            10.0,
            "旧文本",
        )));
        indexer.apply_change(CanvasChange::Upsert(test_node(
            "n1",
            "note",
            10.0,
            "新文本",
        )));
        assert!(indexer.get("n1").unwrap().text.contains("新文本"));
        indexer.apply_change(CanvasChange::Delete {
            node_id: "n1".to_string(),
        });
        assert!(indexer.get("n1").is_none());
    }

    #[test]
    fn filters_by_type_and_position() {
        let mut indexer = CanvasIndexer::new();
        indexer.apply_change(CanvasChange::Upsert(test_node("n1", "note", 10.0, "文本")));
        indexer.apply_change(CanvasChange::Upsert(test_node("n2", "note", 500.0, "文本")));
        let found = indexer.query(CanvasNodeQuery {
            node_type: Some("note".to_string()),
            bounds: Some(CanvasPosition {
                x: 0.0,
                y: 0.0,
                width: 100.0,
                height: 100.0,
            }),
            ..CanvasNodeQuery::default()
        });
        assert_eq!(found.len(), 1);
    }

    fn test_node(id: &str, node_type: &str, x: f64, text: &str) -> CanvasNodeInput {
        CanvasNodeInput {
            node_id: id.to_string(),
            node_type: node_type.to_string(),
            position: CanvasPosition {
                x,
                y: 10.0,
                width: 80.0,
                height: 50.0,
            },
            rich_text: text.to_string(),
            annotation: "标注".to_string(),
            note: String::new(),
            ocr_text: String::new(),
            relations: vec![],
        }
    }
}
