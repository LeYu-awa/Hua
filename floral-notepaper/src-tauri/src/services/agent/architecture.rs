use crate::services::canvas::{CanvasDocument, CanvasEdge, CanvasGroup, CanvasNode};
use crate::services::notes::AppError;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashSet;

/// Archify 组件类型（architecture / dataflow 共用）
const COMPONENT_TYPES: &[&str] = &[
    "frontend", "backend", "database", "cloud", "security", "messagebus", "external",
];
/// Archify 生命周期状态类型
const LIFECYCLE_TYPES: &[&str] = &[
    "start", "active", "waiting", "decision", "success", "failure", "neutral", "external",
];
/// 连线样式
const VARIANTS: &[&str] = &["default", "emphasis", "security", "dashed"];

// ── 画布排版常量（与前端 archifyAdapter 保持一致） ───────────────────────────
const GRID_ORIGIN: f64 = 80.0;
const GRID_COLUMN_WIDTH: f64 = 240.0;
const GRID_ROW_HEIGHT: f64 = 150.0;
const DEFAULT_NODE_WIDTH: f64 = 190.0;
const DEFAULT_NODE_HEIGHT: f64 = 100.0;
const LAYOUT_GAP: f64 = 32.0;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct DiagramMeta {
    pub title: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ArchitectureIr {
    pub schema_version: u8,
    pub diagram_type: String,
    pub meta: DiagramMeta,
    pub components: Vec<ArchitectureComponent>,
    #[serde(default)] pub boundaries: Vec<ArchitectureBoundary>,
    #[serde(default)] pub connections: Vec<ArchitectureConnection>,
}
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

// ── Dataflow IR（Archify dataflow.schema.json：stages/nodes/flows） ────────────
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct DataflowIr {
    pub schema_version: u8,
    pub diagram_type: String,
    pub meta: DiagramMeta,
    #[serde(default)] pub stages: Vec<DataflowStage>,
    #[serde(default)] pub nodes: Vec<DataflowNode>,
    #[serde(default)] pub flows: Vec<DataflowFlow>,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct DataflowStage { pub label: String }
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct DataflowNode {
    pub id: String, pub r#type: String, pub label: String,
    #[serde(default)] pub sublabel: Option<String>, #[serde(default)] pub tag: Option<String>,
    #[serde(default)] pub stage: usize, #[serde(default)] pub row: usize,
    #[serde(default)] pub width: Option<f64>, #[serde(default)] pub height: Option<f64>,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct DataflowFlow {
    #[serde(default)] pub id: Option<String>, pub from: String, pub to: String,
    #[serde(default)] pub label: String, #[serde(default)] pub variant: Option<String>,
}

// ── Lifecycle IR（Archify lifecycle.schema.json：lanes/states/transitions） ────
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct LifecycleIr {
    pub schema_version: u8,
    pub diagram_type: String,
    pub meta: DiagramMeta,
    #[serde(default)] pub lanes: Vec<LifecycleLane>,
    #[serde(default)] pub states: Vec<LifecycleState>,
    #[serde(default)] pub transitions: Vec<LifecycleTransition>,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct LifecycleLane { pub id: String, pub label: String }
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct LifecycleState {
    pub id: String, pub r#type: String, pub label: String,
    #[serde(default)] pub sublabel: Option<String>, #[serde(default)] pub tag: Option<String>,
    #[serde(default)] pub lane: String, #[serde(default)] pub col: usize,
    #[serde(default)] pub width: Option<f64>, #[serde(default)] pub height: Option<f64>,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct LifecycleTransition {
    #[serde(default)] pub id: Option<String>, pub from: String, pub to: String,
    #[serde(default)] pub label: Option<String>, #[serde(default)] pub note: Option<String>,
    #[serde(default)] pub variant: Option<String>,
}

// ── 诊断 / 统一 IR ─────────────────────────────────────────────────────────────
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ArchitectureDiagnostic { pub code: String, pub message: String, pub subject: DiagnosticSubject, pub evidence: Value, #[serde(rename = "supportedFixes")] pub supported_fixes: Vec<String> }
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct DiagnosticSubject { pub path: String, #[serde(default, skip_serializing_if = "Option::is_none")] pub identity: Option<String> }

/// 三种图 IR 的统一载体：按 LLM 输出的 `diagram_type` 自动分派到对应严格校验器。
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(untagged)]
pub enum DiagramIr {
    Architecture(ArchitectureIr),
    Dataflow(DataflowIr),
    Lifecycle(LifecycleIr),
}
impl DiagramIr {
    pub fn diagram_type(&self) -> &'static str {
        match self {
            DiagramIr::Architecture(_) => "architecture",
            DiagramIr::Dataflow(_) => "dataflow",
            DiagramIr::Lifecycle(_) => "lifecycle",
        }
    }
    /// 转成对 build_patch 友好的自身类型后建图
    pub fn build_patch(&self, canvas: &CanvasDocument, sources: Vec<String>, source_nodes: Vec<String>) -> Result<Value, AppError> {
        match self {
            DiagramIr::Architecture(ir) => build_architecture_patch(ir, canvas, sources, source_nodes),
            DiagramIr::Dataflow(ir) => build_dataflow_patch(ir, canvas, sources, source_nodes),
            DiagramIr::Lifecycle(ir) => build_lifecycle_patch(ir, canvas, sources, source_nodes),
        }
    }
}

fn reject_unknown(v: &Value, path: &str, allowed: &[&str], out: &mut Vec<ArchitectureDiagnostic>) { if let Some(o) = v.as_object() { for k in o.keys() { if !allowed.contains(&k.as_str()) { out.push(diag("unknownField", "不支持的字段", &format!("{path}/{k}"), None, k.clone())); } } } }
fn diag(code: &str, message: &str, path: &str, identity: Option<String>, evidence: String) -> ArchitectureDiagnostic { ArchitectureDiagnostic { code: code.into(), message: message.into(), subject: DiagnosticSubject { path: path.into(), identity }, evidence: Value::String(evidence), supported_fixes: vec!["删除未知字段或修正引用".into()] } }

/// 统一严格解析入口：读取输出 JSON 的 diagram_type 自动分派。
pub fn parse_strict(value: &str) -> Result<DiagramIr, Vec<ArchitectureDiagnostic>> {
    let raw: Value = serde_json::from_str(value).map_err(|e| vec![diag("invalidJson", "IR 不是合法 JSON", "/", None, e.to_string())])?;
    let kind = raw.get("diagram_type").and_then(Value::as_str).unwrap_or("");
    match kind {
        "architecture" => parse_strict_architecture(value).map(DiagramIr::Architecture),
        "dataflow" => parse_strict_dataflow(value).map(DiagramIr::Dataflow),
        "lifecycle" => parse_strict_lifecycle(value).map(DiagramIr::Lifecycle),
        _ => Err(vec![diag("diagramType", "diagram_type 必须为 architecture / dataflow / lifecycle", "/diagram_type", None, kind.into())]),
    }
}

// ── Architecture 校验与建图 ───────────────────────────────────────────────────
fn parse_strict_architecture(value: &str) -> Result<ArchitectureIr, Vec<ArchitectureDiagnostic>> {
    let raw: Value = serde_json::from_str(value).map_err(|e| vec![diag("invalidJson", "IR 不是合法 JSON", "/", None, e.to_string())])?;
    let mut errors = Vec::new();
    reject_unknown(&raw, "", &["schema_version", "diagram_type", "meta", "components", "boundaries", "connections"], &mut errors);
    let ir: ArchitectureIr = serde_json::from_value(raw).map_err(|e| vec![diag("schema", "Architecture IR 结构无效", "/", None, e.to_string())])?;
    validate_architecture(&ir, &mut errors);
    if errors.is_empty() { Ok(ir) } else { Err(errors) }
}
fn validate_architecture(ir: &ArchitectureIr, out: &mut Vec<ArchitectureDiagnostic>) {
    if ir.schema_version != 1 { out.push(diag("schemaVersion", "schema_version 必须为 1", "/schema_version", None, ir.schema_version.to_string())); }
    if ir.diagram_type != "architecture" { out.push(diag("diagramType", "diagram_type 必须为 architecture", "/diagram_type", None, ir.diagram_type.clone())); }
    if ir.meta.title.trim().is_empty() { out.push(diag("required", "meta.title 不能为空", "/meta/title", None, "".into())); }
    if ir.components.is_empty() { out.push(diag("required", "至少需要一个组件", "/components", None, "".into())); }
    let mut ids = HashSet::new();
    for (i, c) in ir.components.iter().enumerate() { let p = format!("/components/{i}"); check_id(&c.id, &p, &mut ids, out); if !COMPONENT_TYPES.contains(&c.r#type.as_str()) { out.push(diag("invalidType", format!("组件 type 无效（合法值：{}）", COMPONENT_TYPES.join("/")).as_str(), &format!("{p}/type"), Some(c.id.clone()), c.r#type.clone())); } if c.label.trim().is_empty() { out.push(diag("required", "组件 label 不能为空", &format!("{p}/label"), Some(c.id.clone()), "".into())); } if let Some(size) = c.size { if size[0] <= 0.0 || size[1] <= 0.0 || !size.iter().all(|x| x.is_finite()) { out.push(diag("geometry", "组件尺寸必须为正有限数", &format!("{p}/size"), Some(c.id.clone()), format!("{:?}", size))); } } }
    for (i, c) in ir.connections.iter().enumerate() { if let Some(v) = &c.variant { if !VARIANTS.contains(&v.as_str()) { out.push(diag("invalidVariant", "connection.variant 无效", &format!("/connections/{i}/variant"), Some(c.from.clone()), v.clone())); } } for (field, id) in [("from", &c.from), ("to", &c.to)] { if !ids.contains(id) { out.push(diag("missingReference", "连接引用不存在", &format!("/connections/{i}/{field}"), Some(id.clone()), id.clone())); } } }
    for (i, b) in ir.boundaries.iter().enumerate() { if !["region", "security-group"].contains(&b.kind.as_str()) || b.label.trim().is_empty() || b.wraps.is_empty() { out.push(diag("boundary", "边界结构无效", &format!("/boundaries/{i}"), None, b.kind.clone())); } for id in &b.wraps { if !ids.contains(id) { out.push(diag("missingReference", "边界引用不存在", &format!("/boundaries/{i}/wraps"), Some(id.clone()), id.clone())); } } }
}

// ── Dataflow 校验与建图 ───────────────────────────────────────────────────────
fn parse_strict_dataflow(value: &str) -> Result<DataflowIr, Vec<ArchitectureDiagnostic>> {
    let raw: Value = serde_json::from_str(value).map_err(|e| vec![diag("invalidJson", "IR 不是合法 JSON", "/", None, e.to_string())])?;
    let mut errors = Vec::new();
    reject_unknown(&raw, "", &["schema_version", "diagram_type", "meta", "stages", "nodes", "flows"], &mut errors);
    let ir: DataflowIr = serde_json::from_value(raw).map_err(|e| vec![diag("schema", "Dataflow IR 结构无效", "/", None, e.to_string())])?;
    validate_dataflow(&ir, &mut errors);
    if errors.is_empty() { Ok(ir) } else { Err(errors) }
}
fn validate_dataflow(ir: &DataflowIr, out: &mut Vec<ArchitectureDiagnostic>) {
    if ir.schema_version != 1 { out.push(diag("schemaVersion", "schema_version 必须为 1", "/schema_version", None, ir.schema_version.to_string())); }
    if ir.diagram_type != "dataflow" { out.push(diag("diagramType", "diagram_type 必须为 dataflow", "/diagram_type", None, ir.diagram_type.clone())); }
    if ir.meta.title.trim().is_empty() { out.push(diag("required", "meta.title 不能为空", "/meta/title", None, "".into())); }
    if ir.stages.len() < 2 || ir.stages.len() > 5 { out.push(diag("stages", "stages 需要 2-5 个阶段", "/stages", None, ir.stages.len().to_string())); }
    for (i, s) in ir.stages.iter().enumerate() { if s.label.trim().is_empty() { out.push(diag("required", "stage label 不能为空", &format!("/stages/{i}/label"), None, "".into())); } }
    if ir.nodes.len() < 2 { out.push(diag("required", "至少需要两个节点", "/nodes", None, "".into())); }
    let mut ids = HashSet::new();
    for (i, n) in ir.nodes.iter().enumerate() { let p = format!("/nodes/{i}"); check_id(&n.id, &p, &mut ids, out); if !COMPONENT_TYPES.contains(&n.r#type.as_str()) { out.push(diag("invalidType", format!("节点 type 无效（合法值：{}）", COMPONENT_TYPES.join("/")).as_str(), &format!("{p}/type"), Some(n.id.clone()), n.r#type.clone())); } if n.label.trim().is_empty() { out.push(diag("required", "节点 label 不能为空", &format!("{p}/label"), Some(n.id.clone()), "".into())); } if n.stage >= ir.stages.len() { out.push(diag("missingReference", "节点 stage 超出阶段范围", &format!("{p}/stage"), Some(n.id.clone()), n.stage.to_string())); } }
    for (i, f) in ir.flows.iter().enumerate() { let p = format!("/flows/{i}"); if let Some(v) = &f.variant { if !VARIANTS.contains(&v.as_str()) { out.push(diag("invalidVariant", "flow.variant 无效", &format!("{p}/variant"), Some(f.from.clone()), v.clone())); } } if f.label.trim().is_empty() { out.push(diag("required", "flow label 不能为空（描述流经的数据）", &format!("{p}/label"), None, "".into())); } for (field, id) in [("from", &f.from), ("to", &f.to)] { if !ids.contains(id) { out.push(diag("missingReference", "流引用不存在", &format!("{p}/{field}"), Some(id.clone()), id.clone())); } } }
}

// ── Lifecycle 校验与建图 ──────────────────────────────────────────────────────
fn parse_strict_lifecycle(value: &str) -> Result<LifecycleIr, Vec<ArchitectureDiagnostic>> {
    let raw: Value = serde_json::from_str(value).map_err(|e| vec![diag("invalidJson", "IR 不是合法 JSON", "/", None, e.to_string())])?;
    let mut errors = Vec::new();
    reject_unknown(&raw, "", &["schema_version", "diagram_type", "meta", "lanes", "states", "transitions"], &mut errors);
    let ir: LifecycleIr = serde_json::from_value(raw).map_err(|e| vec![diag("schema", "Lifecycle IR 结构无效", "/", None, e.to_string())])?;
    validate_lifecycle(&ir, &mut errors);
    if errors.is_empty() { Ok(ir) } else { Err(errors) }
}
fn validate_lifecycle(ir: &LifecycleIr, out: &mut Vec<ArchitectureDiagnostic>) {
    if ir.schema_version != 1 { out.push(diag("schemaVersion", "schema_version 必须为 1", "/schema_version", None, ir.schema_version.to_string())); }
    if ir.diagram_type != "lifecycle" { out.push(diag("diagramType", "diagram_type 必须为 lifecycle", "/diagram_type", None, ir.diagram_type.clone())); }
    if ir.meta.title.trim().is_empty() { out.push(diag("required", "meta.title 不能为空", "/meta/title", None, "".into())); }
    if ir.lanes.is_empty() || ir.lanes.len() > 4 { out.push(diag("lanes", "lanes 需要 1-4 条泳道", "/lanes", None, ir.lanes.len().to_string())); }
    let mut lane_ids = HashSet::new();
    for (i, l) in ir.lanes.iter().enumerate() { let p = format!("/lanes/{i}"); check_id(&l.id, &p, &mut lane_ids, out); if l.label.trim().is_empty() { out.push(diag("required", "lane label 不能为空", &format!("{p}/label"), None, "".into())); } }
    if ir.states.len() < 2 { out.push(diag("required", "至少需要两个状态", "/states", None, "".into())); }
    let mut ids = HashSet::new();
    for (i, s) in ir.states.iter().enumerate() { let p = format!("/states/{i}"); check_id(&s.id, &p, &mut ids, out); if !LIFECYCLE_TYPES.contains(&s.r#type.as_str()) { out.push(diag("invalidType", format!("状态 type 无效（合法值：{}）", LIFECYCLE_TYPES.join("/")).as_str(), &format!("{p}/type"), Some(s.id.clone()), s.r#type.clone())); } if s.label.trim().is_empty() { out.push(diag("required", "状态 label 不能为空", &format!("{p}/label"), Some(s.id.clone()), "".into())); } if s.col > 4 { out.push(diag("range", "状态 col 需在 0-4", &format!("{p}/col"), Some(s.id.clone()), s.col.to_string())); } if !lane_ids.contains(&s.lane) { out.push(diag("missingReference", "状态 lane 引用不存在", &format!("{p}/lane"), Some(s.id.clone()), s.lane.clone())); } }
    for (i, t) in ir.transitions.iter().enumerate() { let p = format!("/transitions/{i}"); if let Some(v) = &t.variant { if !VARIANTS.contains(&v.as_str()) { out.push(diag("invalidVariant", "transition.variant 无效", &format!("{p}/variant"), Some(t.from.clone()), v.clone())); } } for (field, id) in [("from", &t.from), ("to", &t.to)] { if !ids.contains(id) { out.push(diag("missingReference", "迁移引用不存在", &format!("{p}/{field}"), Some(id.clone()), id.clone())); } } }
}

fn check_id(id: &str, path: &str, ids: &mut HashSet<String>, out: &mut Vec<ArchitectureDiagnostic>) {
    if !ids.insert(id.to_string()) { out.push(diag("duplicateId", "id 必须唯一", &format!("{path}/id"), Some(id.to_string()), id.to_string())); }
    if !id.chars().next().is_some_and(|x| x.is_ascii_alphabetic()) || !id.chars().all(|x| x.is_ascii_alphanumeric() || x == '_' || x == '-') { out.push(diag("invalidId", "id 格式无效", &format!("{path}/id"), Some(id.to_string()), id.to_string())); }
}

// ── 建图：IR → CanvasPatch 的共用几何与字段 ───────────────────────────────────
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
/// 把目标矩形从期望位置开始避让既有/已放置节点（每次斜移一个 LAYOUT_GAP）
fn nudge(x: f64, y: f64, width: f64, height: f64, occupied: &[CanvasNode]) -> (f64, f64) {
    let mut nx = x;
    let mut ny = y;
    while occupied.iter().any(|other| {
        overlaps(&CanvasNode { x: nx, y: ny, width, height, ..other.clone() }, other, LAYOUT_GAP)
    }) {
        nx += LAYOUT_GAP;
        ny += LAYOUT_GAP;
    }
    (nx, ny)
}

/// 节点类型到画布卡片类型的映射（database→resource，external→idea，其余→knowledge）
fn map_node_kind(kind: &str) -> &'static str {
    if kind == "database" { "resource" } else if kind == "external" { "idea" } else { "knowledge" }
}

pub fn build_patch(ir: &DiagramIr, canvas: &CanvasDocument, sources: Vec<String>, source_nodes: Vec<String>) -> Result<Value, AppError> {
    ir.build_patch(canvas, sources, source_nodes)
}

fn build_architecture_patch(ir: &ArchitectureIr, canvas: &CanvasDocument, sources: Vec<String>, source_nodes: Vec<String>) -> Result<Value, AppError> {
    let key = format!("{}|{}|{}|{}", canvas.id, ir.meta.title, ir.components.iter().map(|c| c.id.as_str()).collect::<Vec<_>>().join(","), ir.connections.iter().map(|c| format!("{}:{}->{}", c.id.as_deref().unwrap_or(""), c.from, c.to)).collect::<Vec<_>>().join(","));
    let mut occupied = canvas.nodes.clone();
    let nodes: Vec<CanvasNode> = ir.components.iter().enumerate().map(|(i,c)| {
        let width = c.size.map(|s| s[0]).unwrap_or(DEFAULT_NODE_WIDTH); let height = c.size.map(|s| s[1]).unwrap_or(DEFAULT_NODE_HEIGHT);
        let authored = c.pos.unwrap_or([GRID_ORIGIN+(i%4) as f64*GRID_COLUMN_WIDTH, GRID_ORIGIN+(i/4) as f64*GRID_ROW_HEIGHT]);
        let (x, y) = nudge(authored[0], authored[1], width, height, &occupied);
        let node = CanvasNode { id: format!("arch-{}", c.id), node_type: map_node_kind(&c.r#type).into(), x, y, width, height, text: format!("{}{}",c.label,c.sublabel.as_ref().map(|s|format!("\n{s}")).unwrap_or_default()), source:Some("agent".into()), fields:std::collections::HashMap::from([("architectureKind".into(),c.r#type.clone()),("architectureRole".into(),c.tag.clone().unwrap_or_else(||c.label.clone())),("generatedBy".into(),"archify-agent".into())]), ..CanvasNode::default() };
        occupied.push(node.clone()); node
    }).collect();
    let ids: HashSet<_> = nodes.iter().map(|n| n.id.clone()).collect();
    let edges: Vec<CanvasEdge> = ir.connections.iter().enumerate().map(|(i,c)| CanvasEdge { id: format!("arch-edge-{}", stable_hash(&format!("{}|edge|{}|{}|{}", key, c.id.as_deref().unwrap_or(&format!("{}", i+1)), c.from, c.to))), from_node_id:format!("arch-{}",c.from), to_node_id:format!("arch-{}",c.to), style:if c.variant.as_deref()==Some("dashed"){"dashed"}else{"solid"}.into(), relation_type:"related".into(), label:c.label.clone().unwrap_or_default() }).collect();
    let groups: Vec<CanvasGroup> = ir.boundaries.iter().enumerate().map(|(i,b)| CanvasGroup { id:format!("arch-group-{}", stable_hash(&format!("{}|group|{}|{}|{}", key, i, b.label, b.wraps.join(",")))), title:b.label.clone(), node_ids:b.wraps.iter().map(|x|format!("arch-{x}")).filter(|x|ids.contains(x)).collect() }).collect();
    Ok(serde_json::json!({"id":format!("arch-patch-{}",stable_hash(&key)),"canvasId":canvas.id,"diagramType":"architecture","sourceDocumentIds":sources,"sourceNodeIds":source_nodes,"nodesToAdd":nodes,"edgesToAdd":edges,"groupsToAdd":groups,"generatedAt":"1970-01-01T00:00:00.000Z"}))
}

fn build_dataflow_patch(ir: &DataflowIr, canvas: &CanvasDocument, sources: Vec<String>, source_nodes: Vec<String>) -> Result<Value, AppError> {
    let key = format!("{}|{}|{}|{}", canvas.id, ir.meta.title, ir.nodes.iter().map(|n| format!("{}@{}:{}", n.id, n.stage, n.row)).collect::<Vec<_>>().join(","), ir.flows.iter().map(|f| format!("{}->{}", f.from, f.to)).collect::<Vec<_>>().join(","));
    let mut occupied = canvas.nodes.clone();
    let nodes: Vec<CanvasNode> = ir.nodes.iter().map(|n| {
        let width = n.width.unwrap_or(DEFAULT_NODE_WIDTH); let height = n.height.unwrap_or(DEFAULT_NODE_HEIGHT);
        let authored = [GRID_ORIGIN + n.stage as f64 * GRID_COLUMN_WIDTH, GRID_ORIGIN + n.row as f64 * GRID_ROW_HEIGHT];
        let (x, y) = nudge(authored[0], authored[1], width, height, &occupied);
        let node = CanvasNode { id: format!("df-{}", n.id), node_type: map_node_kind(&n.r#type).into(), x, y, width, height, text: format!("{}{}",n.label,n.sublabel.as_ref().map(|s|format!("\n{s}")).unwrap_or_default()), source:Some("agent".into()), fields:std::collections::HashMap::from([("dataflowKind".into(),n.r#type.clone()),("dataflowRole".into(),n.tag.clone().unwrap_or_else(||n.label.clone())),("diagramType".into(),"dataflow".into()),("generatedBy".into(),"archify-agent".into())]), ..CanvasNode::default() };
        occupied.push(node.clone()); node
    }).collect();
    let edges: Vec<CanvasEdge> = ir.flows.iter().enumerate().map(|(i,f)| CanvasEdge { id: format!("df-edge-{}", stable_hash(&format!("{}|edge|{}|{}|{}", key, f.id.as_deref().unwrap_or(&format!("{}", i+1)), f.from, f.to))), from_node_id:format!("df-{}",f.from), to_node_id:format!("df-{}",f.to), style:if f.variant.as_deref()==Some("dashed"){"dashed"}else{"solid"}.into(), relation_type:"related".into(), label:f.label.clone() }).collect();
    let stage_of: std::collections::HashMap<&str, usize> = ir.nodes.iter().map(|n| (n.id.as_str(), n.stage)).collect();
    let groups: Vec<CanvasGroup> = ir.stages.iter().enumerate().map(|(i,s)| { let node_ids = nodes.iter().filter(|n| stage_of.get(n.id.trim_start_matches("df-")).copied() == Some(i)).map(|n| n.id.clone()).collect::<Vec<_>>(); CanvasGroup { id:format!("df-group-{}", stable_hash(&format!("{}|group|{}|{}", key, i, s.label))), title:s.label.clone(), node_ids } }).collect();
    Ok(serde_json::json!({"id":format!("df-patch-{}",stable_hash(&key)),"canvasId":canvas.id,"diagramType":"dataflow","sourceDocumentIds":sources,"sourceNodeIds":source_nodes,"nodesToAdd":nodes,"edgesToAdd":edges,"groupsToAdd":groups,"generatedAt":"1970-01-01T00:00:00.000Z"}))
}

fn build_lifecycle_patch(ir: &LifecycleIr, canvas: &CanvasDocument, sources: Vec<String>, source_nodes: Vec<String>) -> Result<Value, AppError> {
    let key = format!("{}|{}|{}|{}", canvas.id, ir.meta.title, ir.states.iter().map(|s| format!("{}@{}:{}", s.id, s.lane, s.col)).collect::<Vec<_>>().join(","), ir.transitions.iter().map(|t| format!("{}->{}", t.from, t.to)).collect::<Vec<_>>().join(","));
    let lane_order: std::collections::HashMap<&str, usize> = ir.lanes.iter().enumerate().map(|(i,l)| (l.id.as_str(), i)).collect();
    let mut occupied = canvas.nodes.clone();
    let nodes: Vec<CanvasNode> = ir.states.iter().map(|s| {
        let width = s.width.unwrap_or(DEFAULT_NODE_WIDTH); let height = s.height.unwrap_or(DEFAULT_NODE_HEIGHT);
        let lane_idx = lane_order.get(s.lane.as_str()).copied().unwrap_or(0);
        let authored = [GRID_ORIGIN + s.col as f64 * GRID_COLUMN_WIDTH, GRID_ORIGIN + lane_idx as f64 * GRID_ROW_HEIGHT];
        let (x, y) = nudge(authored[0], authored[1], width, height, &occupied);
        let node = CanvasNode { id: format!("lc-{}", s.id), node_type: map_node_kind(&s.r#type).into(), x, y, width, height, text: format!("{}{}",s.label,s.sublabel.as_ref().map(|x|format!("\n{x}")).unwrap_or_default()), source:Some("agent".into()), fields:std::collections::HashMap::from([("lifecycleKind".into(),s.r#type.clone()),("lifecycleRole".into(),s.tag.clone().unwrap_or_else(||s.label.clone())),("diagramType".into(),"lifecycle".into()),("generatedBy".into(),"archify-agent".into())]), ..CanvasNode::default() };
        occupied.push(node.clone()); node
    }).collect();
    let edges: Vec<CanvasEdge> = ir.transitions.iter().enumerate().map(|(i,t)| CanvasEdge { id: format!("lc-edge-{}", stable_hash(&format!("{}|edge|{}|{}|{}", key, t.id.as_deref().unwrap_or(&format!("{}", i+1)), t.from, t.to))), from_node_id:format!("lc-{}",t.from), to_node_id:format!("lc-{}",t.to), style:if t.variant.as_deref()==Some("dashed"){"dashed"}else{"solid"}.into(), relation_type:"related".into(), label:t.label.clone().or_else(||t.note.clone()).unwrap_or_default() }).collect();
    let groups: Vec<CanvasGroup> = ir.lanes.iter().map(|l| { let node_ids = nodes.iter().filter(|n| n.id.starts_with("lc-")).filter(|n| ir.states.iter().any(|s| format!("lc-{}", s.id)==n.id && s.lane==l.id)).map(|n| n.id.clone()).collect::<Vec<_>>(); CanvasGroup { id:format!("lc-group-{}", stable_hash(&format!("{}|group|{}|{}", key, l.id, l.label))), title:l.label.clone(), node_ids } }).collect();
    Ok(serde_json::json!({"id":format!("lc-patch-{}",stable_hash(&key)),"canvasId":canvas.id,"diagramType":"lifecycle","sourceDocumentIds":sources,"sourceNodeIds":source_nodes,"nodesToAdd":nodes,"edgesToAdd":edges,"groupsToAdd":groups,"generatedAt":"1970-01-01T00:00:00.000Z"}))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn empty_canvas() -> CanvasDocument {
        CanvasDocument { id: "canvas-1".into(), title: String::new(), note_id: None, note_ids: vec![], co_write_session_id: None, nodes: vec![], edges: vec![], groups: vec![] }
    }

    #[test]
    fn strict_architecture_rejects_unknown_and_dangling() {
        let x = r#"{"schema_version":1,"diagram_type":"architecture","meta":{"title":"x"},"components":[{"id":"a","type":"backend","label":"A"}],"bad":1,"connections":[{"from":"a","to":"z"}]}"#;
        let e = parse_strict(x).unwrap_err();
        assert!(e.iter().any(|x| x.code == "unknownField"));
        assert!(e.iter().any(|x| x.code == "missingReference"));
    }

    #[test]
    fn dispatch_rejects_unknown_diagram_type() {
        let x = r#"{"schema_version":1,"diagram_type":"flowchart","meta":{"title":"x"},"components":[{"id":"a","type":"backend","label":"A"}]}"#;
        let e = parse_strict(x).unwrap_err();
        assert!(e.iter().any(|x| x.code == "diagramType"));
    }

    #[test]
    fn dataflow_strict_validates_stage_bounds_and_refs() {
        let good = r#"{"schema_version":1,"diagram_type":"dataflow","meta":{"title":"下单"},"stages":[{"label":"前端"},{"label":"后端"}],"nodes":[{"id":"ui","type":"frontend","label":"下单页","stage":0,"row":0},{"id":"api","type":"backend","label":"订单服务","stage":1,"row":0}],"flows":[{"from":"ui","to":"api","label":"订单数据"}]}"#;
        assert!(parse_strict(good).is_ok());
        let bad = r#"{"schema_version":1,"diagram_type":"dataflow","meta":{"title":"下单"},"stages":[{"label":"前端"}],"nodes":[{"id":"ui","type":"frontend","label":"下单页","stage":0,"row":0},{"id":"api","type":"backend","label":"订单服务","stage":3,"row":0}],"flows":[{"from":"ui","to":"nope","label":"订单数据"}]}"#;
        let e = parse_strict(bad).unwrap_err();
        assert!(e.iter().any(|x| x.code == "missingReference" || x.code == "stages"));
        let bad_flow = r#"{"schema_version":1,"diagram_type":"dataflow","meta":{"title":"x"},"stages":[{"label":"a"},{"label":"b"}],"nodes":[{"id":"a1","type":"backend","label":"A","stage":0,"row":0},{"id":"b1","type":"backend","label":"B","stage":1,"row":0}],"flows":[{"from":"a1","to":"b1","label":""}]}"#;
        let e2 = parse_strict(bad_flow).unwrap_err();
        assert!(e2.iter().any(|x| x.code == "required"));
    }

    #[test]
    fn dataflow_patch_groups_nodes_by_stage() {
        let ir_json = r#"{"schema_version":1,"diagram_type":"dataflow","meta":{"title":"下单"},"stages":[{"label":"端上"},{"label":"服务端"}],"nodes":[{"id":"ui","type":"frontend","label":"下单页","stage":0,"row":0},{"id":"api","type":"backend","label":"订单服务","stage":1,"row":0},{"id":"db","type":"database","label":"订单库","stage":1,"row":1}],"flows":[{"from":"ui","to":"api","label":"订单数据"},{"from":"api","to":"db","label":"落库"}]}"#;
        let ir = parse_strict(ir_json).unwrap();
        let patch = build_patch(&ir, &empty_canvas(), vec![], vec![]).unwrap();
        let nodes = patch["nodesToAdd"].as_array().unwrap();
        let groups = patch["groupsToAdd"].as_array().unwrap();
        assert_eq!(nodes.len(), 3);
        assert!(nodes.iter().all(|n| n["id"].as_str().unwrap().starts_with("df-")));
        assert!(nodes.iter().find(|n| n["id"] == "df-db").unwrap()["type"] == "resource");
        assert_eq!(groups.len(), 2);
        let g1 = groups.iter().find(|g| g["title"] == "端上").unwrap();
        assert_eq!(g1["nodeIds"], serde_json::json!(["df-ui"]));
        let edges = patch["edgesToAdd"].as_array().unwrap();
        assert_eq!(edges.len(), 2);
        assert_eq!(edges[0]["label"], "订单数据");
    }

    #[test]
    fn lifecycle_strict_validates_lane_refs_and_types() {
        let good = r#"{"schema_version":1,"diagram_type":"lifecycle","meta":{"title":"任务状态"},"lanes":[{"id":"owner","label":"负责人"},{"id":"reviewer","label":"复核人"}],"states":[{"id":"todo","type":"waiting","label":"待处理","lane":"owner","col":0},{"id":"done","type":"success","label":"已完成","lane":"owner","col":1},{"id":"check","type":"active","label":"复核中","lane":"reviewer","col":0}],"transitions":[{"from":"todo","to":"check","label":"提交"},{"from":"check","to":"done"}]}"#;
        let ir = parse_strict(good).unwrap();
        assert_eq!(ir.diagram_type(), "lifecycle");
        let bad = r#"{"schema_version":1,"diagram_type":"lifecycle","meta":{"title":"x"},"lanes":[{"id":"owner","label":"负责人"}],"states":[{"id":"todo","type":"waiting","label":"待处理","lane":"ghost","col":0},{"id":"done","type":"bogus","label":"已完成","lane":"owner","col":9}],"transitions":[]}"#;
        let e = parse_strict(bad).unwrap_err();
        assert!(e.iter().any(|x| x.code == "missingReference"));
        assert!(e.iter().any(|x| x.code == "invalidType"));
        assert!(e.iter().any(|x| x.code == "range"));
    }

    #[test]
    fn lifecycle_patch_builds_lane_groups_and_edges() {
        let ir_json = r#"{"schema_version":1,"diagram_type":"lifecycle","meta":{"title":"订单状态"},"lanes":[{"id":"sys","label":"系统"},{"id":"usr","label":"用户"}],"states":[{"id":"created","type":"active","label":"已创建","lane":"sys","col":0},{"id":"paid","type":"waiting","label":"已支付","lane":"sys","col":1},{"id":"refund","type":"failure","label":"已退款","lane":"usr","col":0}],"transitions":[{"from":"created","to":"paid","label":"支付成功"},{"from":"paid","to":"refund","variant":"dashed"}]}"#;
        let ir = parse_strict(ir_json).unwrap();
        let patch = build_patch(&ir, &empty_canvas(), vec![], vec![]).unwrap();
        assert_eq!(patch["diagramType"], "lifecycle");
        let nodes = patch["nodesToAdd"].as_array().unwrap();
        assert_eq!(nodes.len(), 3);
        let groups = patch["groupsToAdd"].as_array().unwrap();
        assert_eq!(groups.len(), 2);
        let sys = groups.iter().find(|g| g["title"] == "系统").unwrap();
        assert_eq!(sys["nodeIds"], serde_json::json!(["lc-created", "lc-paid"]));
        let edges = patch["edgesToAdd"].as_array().unwrap();
        assert_eq!(edges.len(), 2);
        assert_eq!(edges[1]["style"], "dashed");
    }
}