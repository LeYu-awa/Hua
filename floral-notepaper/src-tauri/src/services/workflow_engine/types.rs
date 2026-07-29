use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowDocument {
    pub id: String,
    #[serde(default)]
    pub note_id: Option<String>,
    #[serde(default)]
    pub conversation_id: Option<String>,
    pub graph: LiteGraphPayload,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LiteGraphPayload {
    #[serde(default)]
    pub nodes: Vec<LiteGraphNode>,
    #[serde(default)]
    pub links: Vec<LiteGraphLink>,
    #[serde(flatten)]
    pub extra: serde_json::Map<String, Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LiteGraphNode {
    pub id: NodeId,
    #[serde(rename = "type")]
    pub node_type: String,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub inputs: Vec<LiteGraphSlot>,
    #[serde(default)]
    pub outputs: Vec<LiteGraphSlot>,
    #[serde(default)]
    pub properties: serde_json::Map<String, Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LiteGraphSlot {
    pub name: String,
    #[serde(rename = "type")]
    pub slot_type: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LiteGraphLink {
    pub id: LinkId,
    pub origin_id: NodeId,
    pub origin_slot: usize,
    pub target_id: NodeId,
    pub target_slot: usize,
    #[serde(rename = "type")]
    pub link_type: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord, Hash)]
#[serde(untagged)]
pub enum NodeId {
    String(String),
    Number(i64),
}

impl NodeId {
    pub fn as_key(&self) -> String {
        match self {
            Self::String(value) => value.clone(),
            Self::Number(value) => value.to_string(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum LinkId {
    String(String),
    Number(i64),
}

impl LinkId {
    pub fn as_key(&self) -> String {
        match self {
            Self::String(value) => value.clone(),
            Self::Number(value) => value.to_string(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowDag {
    pub workflow_id: String,
    pub nodes: Vec<DagNode>,
    pub links: Vec<DagLink>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DagNode {
    pub id: String,
    pub node_type: String,
    pub title: String,
    pub properties: serde_json::Map<String, Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DagLink {
    pub id: String,
    pub from_node_id: String,
    pub from_slot: usize,
    pub from_type: String,
    pub to_node_id: String,
    pub to_slot: usize,
    pub to_type: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowValidationResult {
    pub valid: bool,
    pub issues: Vec<WorkflowValidationIssue>,
    pub execution_order: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowValidationIssue {
    pub code: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub node_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub link_id: Option<String>,
}

pub fn slot_type_to_string(value: &Value) -> String {
    match value {
        Value::String(text) if !text.is_empty() => text.clone(),
        Value::Number(number) => number.to_string(),
        Value::Null => "any".to_string(),
        _ => "any".to_string(),
    }
}
