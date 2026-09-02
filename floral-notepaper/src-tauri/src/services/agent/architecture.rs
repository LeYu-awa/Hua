use crate::services::canvas::{CanvasDocument, CanvasEdge, CanvasGroup, CanvasNode};
use crate::services::notes::AppError;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashSet;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ArchitectureIr {
    pub schema_version: u8,
    pub diagram_type: String,
    pub meta: ArchitectureMeta,
    pub components: Vec<ArchitectureComponent>,
    #[serde(default)] pub boundaries: Vec<ArchitectureBoundary>,
    #[serde(default)] pub connections: Vec<ArchitectureConnection>,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ArchitectureMeta { pub title: String }
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ArchitectureComponent {
    pub id: String, pub r#type: String, pub label: String,
    #[serde(default)] pub sublabel: Option<String>, #[serde(default)] pub tag: Option<String>,
    #[serde(default)] pub sources: Vec<ArchitectureSource>, #[serde(default)] pub pos: Option<[f64; 2]>, #[serde(default)] pub size: Option<[f64; 2]>,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ArchitectureSource { pub path: String, #[serde(default)] pub line: Option<u32>, #[serde(default)] pub end_line: Option<u32>, #[serde(default)] pub label: Option<String> }
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ArchitectureBoundary { pub kind: String, pub label: String, pub wraps: Vec<String>, #[serde(default)] pub pad: Option<f64> }
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ArchitectureConnection { #[serde(default)] pub id: Option<String>, pub from: String, pub to: String, #[serde(default)] pub label: Option<String>, #[serde(default)] pub variant: Option<String> }
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ArchitectureDiagnostic { pub code: String, pub message: String, pub subject: DiagnosticSubject, pub evidence: Value, #[serde(rename = "supportedFixes")] pub supported_fixes: Vec<String> }
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct DiagnosticSubject { pub path: String, #[serde(default, skip_serializing_if = "Option::is_none")] pub identity: Option<String> }

pub fn parse_strict(value: &str) -> Result<ArchitectureIr, Vec<ArchitectureDiagnostic>> {
    let raw: Value = serde_json::from_str(value).map_err(|e| vec![diag("invalidJson", "IR 不是合法 JSON", "/", None, e.to_string())])?;
    let mut errors = Vec::new();
    reject_unknown(&raw, "", &["schema_version", "diagram_type", "meta", "components", "boundaries", "connections"], &mut errors);
    let ir: ArchitectureIr = serde_json::from_value(raw).map_err(|e| vec![diag("schema", "Architecture IR 结构无效", "/", None, e.to_string())])?;
    validate(&ir, &mut errors);
    if errors.is_empty() { Ok(ir) } else { Err(errors) }
}
fn reject_unknown(v: &Value, path: &str, allowed: &[&str], out: &mut Vec<ArchitectureDiagnostic>) { if let Some(o) = v.as_object() { for k in o.keys() { if !allowed.contains(&k.as_str()) { out.push(diag("unknownField", "不支持的字段", &format!("{path}/{k}"), None, k.clone())); } } } }
fn diag(code: &str, message: &str, path: &str, identity: Option<String>, evidence: String) -> ArchitectureDiagnostic { ArchitectureDiagnostic { code: code.into(), message: message.into(), subject: DiagnosticSubject { path: path.into(), identity }, evidence: Value::String(evidence), supported_fixes: vec!["删除未知字段或修正引用".into()] } }
fn validate(ir: &ArchitectureIr, out: &mut Vec<ArchitectureDiagnostic>) {
    if ir.schema_version != 1 { out.push(diag("schemaVersion", "schema_version 必须为 1", "/schema_version", None, ir.schema_version.to_string())); }
    if ir.diagram_type != "architecture" { out.push(diag("diagramType", "diagram_type 必须为 architecture", "/diagram_type", None, ir.diagram_type.clone())); }
    if ir.meta.title.trim().is_empty() { out.push(diag("required", "meta.title 不能为空", "/meta/title", None, "".into())); }
    if ir.components.is_empty() { out.push(diag("required", "至少需要一个组件", "/components", None, "".into())); }
    let mut ids = HashSet::new();
    for (i, c) in ir.components.iter().enumerate() { let p = format!("/components/{i}"); if !ids.insert(c.id.clone()) { out.push(diag("duplicateId", "组件 id 必须唯一", &format!("{p}/id"), Some(c.id.clone()), c.id.clone())); } if !c.id.chars().next().is_some_and(|x| x.is_ascii_alphabetic()) || !c.id.chars().all(|x| x.is_ascii_alphanumeric() || x == '_' || x == '-') { out.push(diag("invalidId", "组件 id 格式无效", &format!("{p}/id"), Some(c.id.clone()), c.id.clone())); } if c.label.trim().is_empty() { out.push(diag("required", "组件 label 不能为空", &format!("{p}/label"), Some(c.id.clone()), "".into())); } if let Some(size) = c.size { if size[0] <= 0.0 || size[1] <= 0.0 || !size.iter().all(|x| x.is_finite()) { out.push(diag("geometry", "组件尺寸必须为正有限数", &format!("{p}/size"), Some(c.id.clone()), format!("{:?}", size))); } } }
    for (i, c) in ir.connections.iter().enumerate() { for (field, id) in [("from", &c.from), ("to", &c.to)] { if !ids.contains(id) { out.push(diag("missingReference", "连接引用不存在", &format!("/connections/{i}/{field}"), Some(id.clone()), id.clone())); } } }
    for (i, b) in ir.boundaries.iter().enumerate() { if !["region", "security-group"].contains(&b.kind.as_str()) || b.label.trim().is_empty() || b.wraps.is_empty() { out.push(diag("boundary", "边界结构无效", &format!("/boundaries/{i}"), None, b.kind.clone())); } for id in &b.wraps { if !ids.contains(id) { out.push(diag("missingReference", "边界引用不存在", &format!("/boundaries/{i}/wraps"), Some(id.clone()), id.clone())); } } }
}

fn stable_hash(value: &str) -> String {
    let mut hash: u32 = 2_166_136_261;
    for byte in value.bytes() { hash = (hash ^ byte as u32).wrapping_mul(16_777_619); }
    format_radix(hash as u64, 36)
}

fn format_radix(mut value: u64, radix: u64) -> String {
    let chars = b"0123456789abcdefghijklmnopqrstuvwxyz";
    let mut output = Vec::new();
    loop { output.push(chars[(value % radix) as usize] as char); value /= radix; if value == 0 { break; } }
    output.into_iter().rev().collect()
}

fn overlaps(a: &CanvasNode, b: &CanvasNode, gap: f64) -> bool {
    a.x < b.x + b.width + gap && a.x + a.width + gap > b.x && a.y < b.y + b.height + gap && a.y + a.height + gap > b.y
}

pub fn build_patch(ir: &ArchitectureIr, canvas: &CanvasDocument, sources: Vec<String>, source_nodes: Vec<String>) -> Result<Value, AppError> {
    let key = format!("{}|{}|{}|{}", canvas.id, ir.meta.title, ir.components.iter().map(|c| c.id.as_str()).collect::<Vec<_>>().join(","), ir.connections.iter().map(|c| format!("{}:{}->{}", c.id.as_deref().unwrap_or(""), c.from, c.to)).collect::<Vec<_>>().join(","));
    let mut occupied = canvas.nodes.clone();
    let nodes: Vec<CanvasNode> = ir.components.iter().enumerate().map(|(i,c)| {
        let width = c.size.map(|s| s[0]).unwrap_or(190.0); let height = c.size.map(|s| s[1]).unwrap_or(100.0);
        let authored = c.pos.unwrap_or([80.0+(i%4) as f64*240.0,80.0+(i/4) as f64*150.0]);
        let mut node = CanvasNode { id: format!("arch-{}", c.id), node_type: if c.r#type=="database" { "resource".into() } else if c.r#type=="external" { "idea".into() } else { "knowledge".into() }, x: authored[0], y: authored[1], width, height, text: format!("{}{}",c.label,c.sublabel.as_ref().map(|s|format!("\n{s}")).unwrap_or_default()), source:Some("agent".into()), fields:std::collections::HashMap::from([("architectureKind".into(),c.r#type.clone()),("architectureRole".into(),c.tag.clone().unwrap_or_else(||c.label.clone())),("generatedBy".into(),"archify-agent".into())]), ..CanvasNode::default() };
        while occupied.iter().any(|other| overlaps(&node, other, 32.0)) { node.x += 32.0; node.y += 32.0; }
        occupied.push(node.clone()); node
    }).collect();
    let ids: HashSet<_> = nodes.iter().map(|n| n.id.clone()).collect();
    let edges: Vec<CanvasEdge> = ir.connections.iter().enumerate().map(|(i,c)| CanvasEdge { id: format!("arch-edge-{}", stable_hash(&format!("{}|edge|{}|{}|{}", key, c.id.as_deref().unwrap_or(&format!("{}", i+1)), c.from, c.to))), from_node_id:format!("arch-{}",c.from), to_node_id:format!("arch-{}",c.to), style:if c.variant.as_deref()==Some("dashed"){"dashed"}else{"solid"}.into(), relation_type:"related".into(), label:c.label.clone().unwrap_or_default() }).collect();
    let groups: Vec<CanvasGroup> = ir.boundaries.iter().enumerate().map(|(i,b)| CanvasGroup { id:format!("arch-group-{}", stable_hash(&format!("{}|group|{}|{}|{}", key, i, b.label, b.wraps.join(",")))), title:b.label.clone(), node_ids:b.wraps.iter().map(|x|format!("arch-{x}")).filter(|x|ids.contains(x)).collect() }).collect();
    Ok(serde_json::json!({"id":format!("arch-patch-{}",stable_hash(&key)),"canvasId":canvas.id,"diagramType":"architecture","sourceDocumentIds":sources,"sourceNodeIds":source_nodes,"nodesToAdd":nodes,"edgesToAdd":edges,"groupsToAdd":groups,"generatedAt":"1970-01-01T00:00:00.000Z"}))
}

#[cfg(test)] mod tests { use super::*; #[test] fn strict_rejects_unknown_and_dangling(){let x=r#"{"schema_version":1,"diagram_type":"architecture","meta":{"title":"x"},"components":[{"id":"a","type":"backend","label":"A"}],"bad":1,"connections":[{"from":"a","to":"z"}]}"#; let e=parse_strict(x).unwrap_err(); assert!(e.iter().any(|x|x.code=="unknownField")); assert!(e.iter().any(|x|x.code=="missingReference"));} }
