import type { ProviderConfig } from "../settings/types";
import type {
  ArchitectureConnection,
  ArchitectureIR,
  CanvasDocument,
  CanvasGroup,
  CanvasNode,
  CanvasPatch,
  DataflowIR,
  DiagramIR,
  LifecycleIR,
} from "./types";

const COMPONENT_TYPES = new Set(["frontend", "backend", "database", "cloud", "security", "messagebus", "external"]);
const LIFECYCLE_TYPES = new Set(["start", "active", "waiting", "decision", "success", "failure", "neutral", "external"]);
const VARIANTS = new Set(["default", "emphasis", "security", "dashed"]);
const GRID_ORIGIN = 80;
const GRID_COLUMN_WIDTH = 240;
const GRID_ROW_HEIGHT = 150;
const DEFAULT_NODE_WIDTH = 190;
const DEFAULT_NODE_HEIGHT = 100;
const LAYOUT_GAP = 32;

function stableHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function rectanglesOverlap(a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

function nextFreePosition(candidate: { x: number; y: number; width: number; height: number }, occupied: CanvasNode[]): { x: number; y: number } {
  let x = candidate.x;
  let y = candidate.y;
  while (occupied.some((node) => rectanglesOverlap({ x, y, width: candidate.width, height: candidate.height }, { x: node.x - LAYOUT_GAP, y: node.y - LAYOUT_GAP, width: node.width + LAYOUT_GAP * 2, height: node.height + LAYOUT_GAP * 2 }))) {
    x += LAYOUT_GAP;
    y += LAYOUT_GAP;
  }
  return { x, y };
}

export function validateArchitecture(ir: unknown): string[] {
  const errors: string[] = [];
  if (!isRecord(ir)) return ["根对象必须是 JSON 对象"];
  const allowed = new Set(["schema_version", "diagram_type", "meta", "components", "boundaries", "connections"]);
  for (const key of Object.keys(ir)) if (!allowed.has(key)) errors.push(`不支持的字段: /${key}`);
  if (ir.schema_version !== 1) errors.push("/schema_version 必须为 1");
  if (ir.diagram_type !== "architecture") errors.push("/diagram_type 必须为 architecture");
  if (!isRecord(ir.meta) || typeof ir.meta.title !== "string" || !ir.meta.title.trim()) errors.push("/meta/title 必须为非空字符串");
  if (!Array.isArray(ir.components) || ir.components.length === 0) errors.push("/components 至少需要一个组件");
  const ids = new Set<string>();
  if (Array.isArray(ir.components)) ir.components.forEach((component, index) => {
    const path = `/components/${index}`;
    if (!isRecord(component)) return errors.push(`${path} 必须为对象`);
    for (const key of Object.keys(component)) if (!["id", "type", "label", "sublabel", "tag", "sources", "pos", "size"].includes(key)) errors.push(`${path}/${key} 不受支持`);
    if (typeof component.id !== "string" || !/^[A-Za-z][A-Za-z0-9_-]*$/.test(component.id)) errors.push(`${path}/id 格式无效`);
    else if (!ids.has(component.id)) ids.add(component.id); else errors.push(`${path}/id 必须唯一`);
    if (typeof component.type !== "string" || !COMPONENT_TYPES.has(component.type)) errors.push(`${path}/type 无效`);
    if (typeof component.label !== "string" || !component.label.trim()) errors.push(`${path}/label 必须为非空字符串`);
    for (const field of ["pos", "size"]) if (component[field] !== undefined && (!Array.isArray(component[field]) || component[field].length !== 2 || component[field].some((v) => typeof v !== "number" || !Number.isFinite(v)))) errors.push(`${path}/${field} 必须为两个有限数字`);
  });
  if (Array.isArray(ir.connections)) ir.connections.forEach((connection, index) => {
    const path = `/connections/${index}`;
    if (!isRecord(connection)) return errors.push(`${path} 必须为对象`);
    if (typeof connection.from !== "string" || !ids.has(connection.from)) errors.push(`${path}/from 引用不存在`);
    if (typeof connection.to !== "string" || !ids.has(connection.to)) errors.push(`${path}/to 引用不存在`);
    if (connection.variant !== undefined && (typeof connection.variant !== "string" || !VARIANTS.has(connection.variant))) errors.push(`${path}/variant 无效`);
  });
  if (Array.isArray(ir.boundaries)) ir.boundaries.forEach((boundary, index) => {
    const path = `/boundaries/${index}`;
    if (!isRecord(boundary) || (boundary.kind !== "region" && boundary.kind !== "security-group") || typeof boundary.label !== "string" || !Array.isArray(boundary.wraps) || boundary.wraps.length === 0) return errors.push(`${path} 结构无效`);
    for (const id of boundary.wraps) if (typeof id !== "string" || !ids.has(id)) errors.push(`${path}/wraps 引用不存在: ${String(id)}`);
  });
  return errors;
}

export function buildArchitecturePatch(ir: ArchitectureIR, canvas: CanvasDocument, sourceDocumentIds: string[] = [], sourceNodeIds: string[] = []): CanvasPatch {
  const errors = validateArchitecture(ir);
  if (errors.length) throw new Error(`Architecture 校验失败: ${errors.join("；")}`);
  const occupied = [...canvas.nodes];
  const patchKey = `${canvas.id}|${ir.meta.title}|${ir.components.map((component) => component.id).join(",")}|${ir.connections?.map((connection) => `${connection.id ?? ""}:${connection.from}->${connection.to}`).join(",") ?? ""}`;
  const patchId = `arch-patch-${stableHash(patchKey)}`;
  const nodesToAdd: CanvasNode[] = ir.components.map((component, index) => {
    const width = component.size?.[0] ?? DEFAULT_NODE_WIDTH;
    const height = component.size?.[1] ?? DEFAULT_NODE_HEIGHT;
    const authored = component.pos;
    const position = nextFreePosition({ x: authored?.[0] ?? GRID_ORIGIN + (index % 4) * GRID_COLUMN_WIDTH, y: authored?.[1] ?? GRID_ORIGIN + Math.floor(index / 4) * GRID_ROW_HEIGHT, width, height }, occupied);
    const node = {
      id: `arch-${component.id}`,
      type: (component.type === "database" ? "resource" : component.type === "external" ? "idea" : "knowledge") as CanvasNode["type"],
      x: position.x, y: position.y, width, height,
      text: component.sublabel ? `${component.label}\n${component.sublabel}` : component.label,
      source: "agent" as const,
      fields: { architectureKind: component.type, architectureRole: component.tag ?? component.label, generatedBy: "archify-agent", ...(component.sources?.length ? { sourcePaths: component.sources.map((source) => source.path).join("\n") } : {}) },
    };
    occupied.push(node);
    return node;
  });
  const nodeId = (id: string) => `arch-${id}`;
  const edgesToAdd = (ir.connections ?? []).map((connection: ArchitectureConnection, index) => ({
    id: `arch-edge-${stableHash(`${patchKey}|edge|${connection.id ?? index + 1}|${connection.from}|${connection.to}`)}`, 
    fromNodeId: nodeId(connection.from), toNodeId: nodeId(connection.to),
    style: connection.variant === "dashed" ? ("dashed" as const) : ("solid" as const),
    relationType: "related" as const, label: connection.label,
  }));
  const groupsToAdd: CanvasGroup[] = (ir.boundaries ?? []).map((boundary, index) => ({
    id: `arch-group-${stableHash(`${patchKey}|group|${index}|${boundary.label}|${boundary.wraps.join(",")}`)}`, title: boundary.label, nodeIds: boundary.wraps.map(nodeId),
  }));
  return { id: patchId, canvasId: canvas.id, diagramType: "architecture", sourceDocumentIds, sourceNodeIds, nodesToAdd, edgesToAdd, groupsToAdd, generatedAt: new Date(0).toISOString() };
}

const ID_PATTERN = /^[A-Za-z][A-Za-z0-9_-]*$/;

/** Dataflow IR 严格校验（与 Rust parse_strict_dataflow 语义一致） */
export function validateDataflow(ir: unknown): string[] {
  const errors: string[] = [];
  if (!isRecord(ir)) return ["根对象必须是 JSON 对象"];
  const allowed = new Set(["schema_version", "diagram_type", "meta", "stages", "nodes", "flows"]);
  for (const key of Object.keys(ir)) if (!allowed.has(key)) errors.push(`不支持的字段: /${key}`);
  if (ir.schema_version !== 1) errors.push("/schema_version 必须为 1");
  if (ir.diagram_type !== "dataflow") errors.push("/diagram_type 必须为 dataflow");
  if (!isRecord(ir.meta) || typeof ir.meta.title !== "string" || !ir.meta.title.trim()) errors.push("/meta/title 必须为非空字符串");
  const stageCount = Array.isArray(ir.stages) ? ir.stages.length : 0;
  if (stageCount < 2 || stageCount > 5) errors.push("/stages 需要 2-5 个阶段");
  if (Array.isArray(ir.stages)) ir.stages.forEach((stage, index) => {
    if (!isRecord(stage) || typeof stage.label !== "string" || !stage.label.trim()) errors.push(`/stages/${index}/label 必须为非空字符串`);
  });
  if (!Array.isArray(ir.nodes) || ir.nodes.length < 2) errors.push("/nodes 至少需要两个节点");
  const ids = new Set<string>();
  if (Array.isArray(ir.nodes)) ir.nodes.forEach((node, index) => {
    const path = `/nodes/${index}`;
    if (!isRecord(node)) return errors.push(`${path} 必须为对象`);
    if (typeof node.id !== "string" || !ID_PATTERN.test(node.id)) errors.push(`${path}/id 格式无效`);
    else if (!ids.has(node.id)) ids.add(node.id); else errors.push(`${path}/id 必须唯一`);
    if (typeof node.type !== "string" || !COMPONENT_TYPES.has(node.type)) errors.push(`${path}/type 无效`);
    if (typeof node.label !== "string" || !node.label.trim()) errors.push(`${path}/label 必须为非空字符串`);
    if (typeof node.stage !== "number" || !Number.isInteger(node.stage) || node.stage < 0 || node.stage >= stageCount) errors.push(`${path}/stage 超出阶段范围`);
    if (typeof node.row !== "number" || !Number.isInteger(node.row) || node.row < 0) errors.push(`${path}/row 必须为非负整数`);
  });
  if (Array.isArray(ir.flows)) ir.flows.forEach((flow, index) => {
    const path = `/flows/${index}`;
    if (!isRecord(flow)) return errors.push(`${path} 必须为对象`);
    if (typeof flow.from !== "string" || !ids.has(flow.from)) errors.push(`${path}/from 引用不存在`);
    if (typeof flow.to !== "string" || !ids.has(flow.to)) errors.push(`${path}/to 引用不存在`);
    if (typeof flow.label !== "string" || !flow.label.trim()) errors.push(`${path}/label 必须为非空字符串`);
    if (flow.variant !== undefined && (typeof flow.variant !== "string" || !VARIANTS.has(flow.variant))) errors.push(`${path}/variant 无效`);
  });
  return errors;
}

/** Lifecycle IR 严格校验（与 Rust parse_strict_lifecycle 语义一致） */
export function validateLifecycle(ir: unknown): string[] {
  const errors: string[] = [];
  if (!isRecord(ir)) return ["根对象必须是 JSON 对象"];
  const allowed = new Set(["schema_version", "diagram_type", "meta", "lanes", "states", "transitions"]);
  for (const key of Object.keys(ir)) if (!allowed.has(key)) errors.push(`不支持的字段: /${key}`);
  if (ir.schema_version !== 1) errors.push("/schema_version 必须为 1");
  if (ir.diagram_type !== "lifecycle") errors.push("/diagram_type 必须为 lifecycle");
  if (!isRecord(ir.meta) || typeof ir.meta.title !== "string" || !ir.meta.title.trim()) errors.push("/meta/title 必须为非空字符串");
  const laneCount = Array.isArray(ir.lanes) ? ir.lanes.length : 0;
  if (laneCount < 1 || laneCount > 4) errors.push("/lanes 需要 1-4 条泳道");
  const laneIds = new Set<string>();
  if (Array.isArray(ir.lanes)) ir.lanes.forEach((lane, index) => {
    const path = `/lanes/${index}`;
    if (!isRecord(lane)) return errors.push(`${path} 必须为对象`);
    if (typeof lane.id !== "string" || !ID_PATTERN.test(lane.id)) errors.push(`${path}/id 格式无效`);
    else if (!laneIds.has(lane.id)) laneIds.add(lane.id); else errors.push(`${path}/id 必须唯一`);
    if (typeof lane.label !== "string" || !lane.label.trim()) errors.push(`${path}/label 必须为非空字符串`);
  });
  if (!Array.isArray(ir.states) || ir.states.length < 2) errors.push("/states 至少需要两个状态");
  const ids = new Set<string>();
  if (Array.isArray(ir.states)) ir.states.forEach((state, index) => {
    const path = `/states/${index}`;
    if (!isRecord(state)) return errors.push(`${path} 必须为对象`);
    if (typeof state.id !== "string" || !ID_PATTERN.test(state.id)) errors.push(`${path}/id 格式无效`);
    else if (!ids.has(state.id)) ids.add(state.id); else errors.push(`${path}/id 必须唯一`);
    if (typeof state.type !== "string" || !LIFECYCLE_TYPES.has(state.type)) errors.push(`${path}/type 无效`);
    if (typeof state.label !== "string" || !state.label.trim()) errors.push(`${path}/label 必须为非空字符串`);
    if (typeof state.col !== "number" || !Number.isInteger(state.col) || state.col < 0 || state.col > 4) errors.push(`${path}/col 需在 0-4`);
    if (typeof state.lane !== "string" || !laneIds.has(state.lane)) errors.push(`${path}/lane 引用不存在`);
  });
  if (Array.isArray(ir.transitions)) ir.transitions.forEach((transition, index) => {
    const path = `/transitions/${index}`;
    if (!isRecord(transition)) return errors.push(`${path} 必须为对象`);
    if (typeof transition.from !== "string" || !ids.has(transition.from)) errors.push(`${path}/from 引用不存在`);
    if (typeof transition.to !== "string" || !ids.has(transition.to)) errors.push(`${path}/to 引用不存在`);
    if (transition.variant !== undefined && (typeof transition.variant !== "string" || !VARIANTS.has(transition.variant))) errors.push(`${path}/variant 无效`);
  });
  return errors;
}

/** Dataflow IR → CanvasPatch（与 Rust build_dataflow_patch 一致：stage 分列、row 分行、df- 前缀） */
export function buildDataflowPatch(ir: DataflowIR, canvas: CanvasDocument, sourceDocumentIds: string[] = [], sourceNodeIds: string[] = []): CanvasPatch {
  const errors = validateDataflow(ir);
  if (errors.length) throw new Error(`Dataflow 校验失败: ${errors.join("；")}`);
  const occupied = [...canvas.nodes];
  const patchKey = `${canvas.id}|${ir.meta.title}|${ir.nodes.map((node) => `${node.id}@${node.stage}:${node.row}`).join(",")}|${ir.flows.map((flow) => `${flow.from}->${flow.to}`).join(",")}`;
  const patchId = `df-patch-${stableHash(patchKey)}`;
  const stageOf = new Map(ir.nodes.map((node) => [node.id, node.stage]));
  const nodesToAdd: CanvasNode[] = ir.nodes.map((node) => {
    const width = node.width ?? DEFAULT_NODE_WIDTH;
    const height = node.height ?? DEFAULT_NODE_HEIGHT;
    const authored = { x: GRID_ORIGIN + node.stage * GRID_COLUMN_WIDTH, y: GRID_ORIGIN + node.row * GRID_ROW_HEIGHT };
    const position = nextFreePosition({ ...authored, width, height }, occupied);
    const created = {
      id: `df-${node.id}`,
      type: (node.type === "database" ? "resource" : node.type === "external" ? "idea" : "knowledge") as CanvasNode["type"],
      x: position.x, y: position.y, width, height,
      text: node.sublabel ? `${node.label}\n${node.sublabel}` : node.label,
      source: "agent" as const,
      fields: { dataflowKind: node.type, dataflowRole: node.tag ?? node.label, diagramType: "dataflow", generatedBy: "archify-agent" },
    };
    occupied.push(created);
    return created;
  });
  const nodeId = (id: string) => `df-${id}`;
  const edgesToAdd: CanvasPatch["edgesToAdd"] = ir.flows.map((flow, index) => ({
    id: `df-edge-${stableHash(`${patchKey}|edge|${flow.id ?? index + 1}|${flow.from}|${flow.to}`)}`,
    fromNodeId: nodeId(flow.from), toNodeId: nodeId(flow.to),
    style: flow.variant === "dashed" ? ("dashed" as const) : ("solid" as const),
    relationType: "related" as const, label: flow.label,
  }));
  const groupsToAdd: CanvasGroup[] = ir.stages.map((stage, index) => ({
    id: `df-group-${stableHash(`${patchKey}|group|${index}|${stage.label}`)}`,
    title: stage.label,
    nodeIds: ir.nodes.filter((node) => stageOf.get(node.id) === index).map((node) => nodeId(node.id)),
  }));
  return { id: patchId, canvasId: canvas.id, diagramType: "dataflow", sourceDocumentIds, sourceNodeIds, nodesToAdd, edgesToAdd, groupsToAdd, generatedAt: new Date(0).toISOString() };
}

/** Lifecycle IR → CanvasPatch（与 Rust build_lifecycle_patch 一致：col 分列、lane 分行、lc- 前缀、泳道分组） */
export function buildLifecyclePatch(ir: LifecycleIR, canvas: CanvasDocument, sourceDocumentIds: string[] = [], sourceNodeIds: string[] = []): CanvasPatch {
  const errors = validateLifecycle(ir);
  if (errors.length) throw new Error(`Lifecycle 校验失败: ${errors.join("；")}`);
  const occupied = [...canvas.nodes];
  const patchKey = `${canvas.id}|${ir.meta.title}|${ir.states.map((state) => `${state.id}@${state.lane}:${state.col}`).join(",")}|${ir.transitions.map((transition) => `${transition.from}->${transition.to}`).join(",")}`;
  const patchId = `lc-patch-${stableHash(patchKey)}`;
  const laneOrder = new Map(ir.lanes.map((lane, index) => [lane.id, index]));
  const nodesToAdd: CanvasNode[] = ir.states.map((state) => {
    const width = state.width ?? DEFAULT_NODE_WIDTH;
    const height = state.height ?? DEFAULT_NODE_HEIGHT;
    const laneIndex = laneOrder.get(state.lane) ?? 0;
    const authored = { x: GRID_ORIGIN + state.col * GRID_COLUMN_WIDTH, y: GRID_ORIGIN + laneIndex * GRID_ROW_HEIGHT };
    const position = nextFreePosition({ ...authored, width, height }, occupied);
    const created = {
      id: `lc-${state.id}`,
      type: (state.type === "external" ? "idea" : "knowledge") as CanvasNode["type"],
      x: position.x, y: position.y, width, height,
      text: state.sublabel ? `${state.label}\n${state.sublabel}` : state.label,
      source: "agent" as const,
      fields: { lifecycleKind: state.type, lifecycleRole: state.tag ?? state.label, diagramType: "lifecycle", generatedBy: "archify-agent" },
    };
    occupied.push(created);
    return created;
  });
  const nodeId = (id: string) => `lc-${id}`;
  const edgesToAdd: CanvasPatch["edgesToAdd"] = ir.transitions.map((transition, index) => ({
    id: `lc-edge-${stableHash(`${patchKey}|edge|${transition.id ?? index + 1}|${transition.from}|${transition.to}`)}`,
    fromNodeId: nodeId(transition.from), toNodeId: nodeId(transition.to),
    style: transition.variant === "dashed" ? ("dashed" as const) : ("solid" as const),
    relationType: "related" as const, label: transition.label ?? transition.note ?? "",
  }));
  const groupsToAdd: CanvasGroup[] = ir.lanes.map((lane) => ({
    id: `lc-group-${stableHash(`${patchKey}|group|${lane.id}|${lane.label}`)}`,
    title: lane.label,
    nodeIds: ir.states.filter((state) => state.lane === lane.id).map((state) => nodeId(state.id)),
  }));
  return { id: patchId, canvasId: canvas.id, diagramType: "lifecycle", sourceDocumentIds, sourceNodeIds, nodesToAdd, edgesToAdd, groupsToAdd, generatedAt: new Date(0).toISOString() };
}

/** 按 diagram_type 分派的统一校验入口（与 Rust parse_strict 一致） */
export function validateDiagram(ir: unknown): string[] {
  if (!isRecord(ir)) return ["根对象必须是 JSON 对象"];
  switch (ir.diagram_type) {
    case "architecture": return validateArchitecture(ir);
    case "dataflow": return validateDataflow(ir);
    case "lifecycle": return validateLifecycle(ir);
    default: return [`/diagram_type 必须为 architecture / dataflow / lifecycle，收到 ${String(ir.diagram_type)}`];
  }
}

/** 按 diagram_type 分派的统一建图入口（与 Rust build_patch 一致） */
export function buildDiagramPatch(ir: DiagramIR, canvas: CanvasDocument, sourceDocumentIds: string[] = [], sourceNodeIds: string[] = []): CanvasPatch {
  switch (ir.diagram_type) {
    case "architecture": return buildArchitecturePatch(ir, canvas, sourceDocumentIds, sourceNodeIds);
    case "dataflow": return buildDataflowPatch(ir, canvas, sourceDocumentIds, sourceNodeIds);
    case "lifecycle": return buildLifecyclePatch(ir, canvas, sourceDocumentIds, sourceNodeIds);
  }
}

export function validateCanvasPatch(patch: CanvasPatch, canvas: CanvasDocument): string[] {
  const errors: string[] = [];
  if (patch.canvasId !== canvas.id) errors.push("Patch 不属于当前画布");
  const existing = new Set(canvas.nodes.map((node) => node.id));
  const added = new Set<string>();
  for (const node of patch.nodesToAdd) {
    if (existing.has(node.id) || added.has(node.id)) errors.push(`节点 ID 冲突: ${node.id}`);
    added.add(node.id);
    if (![node.x, node.y, node.width, node.height].every(Number.isFinite) || node.width <= 0 || node.height <= 0) errors.push(`节点几何数据无效: ${node.id}`);
  }
  const allNodes = [...canvas.nodes, ...patch.nodesToAdd];
  for (let index = 0; index < patch.nodesToAdd.length; index += 1) {
    const node = patch.nodesToAdd[index];
    if (allNodes.some((other, otherIndex) => otherIndex !== canvas.nodes.length + index && rectanglesOverlap(node, other))) errors.push(`节点矩形冲突: ${node.id}`);
  }
  const all = new Set([...existing, ...added]);
  const edgeIds = new Set(canvas.edges.map((edge) => edge.id));
  for (const edge of patch.edgesToAdd) {
    if (edgeIds.has(edge.id)) errors.push(`边 ID 冲突: ${edge.id}`);
    edgeIds.add(edge.id);
    if (!all.has(edge.fromNodeId) || !all.has(edge.toNodeId)) errors.push(`边端点不存在: ${edge.id}`);
  }
  const groupIds = new Set((canvas.groups ?? []).map((group) => group.id));
  for (const group of patch.groupsToAdd) {
    if (groupIds.has(group.id)) errors.push(`分组 ID 冲突: ${group.id}`);
    groupIds.add(group.id);
    if (group.nodeIds.some((id) => !added.has(id) && !existing.has(id))) errors.push(`分组成员不存在: ${group.id}`);
  }
  return errors;
}

export async function requestArchitecture(
  providers: ProviderConfig[],
  intent: string,
  sourceNodes: CanvasNode[],
): Promise<ArchitectureIR> {
  const provider = providers.find((item) => item.enabled && item.models.length > 0);
  const model = provider?.models[0];
  if (!provider || !model) throw new Error("没有可用的 AI 供应商，请先在设置中配置");

  const response = await fetch(provider.baseUrl.replace(/\/+$/, "") + provider.apiPath, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(provider.apiKey ? { Authorization: `Bearer ${provider.apiKey}` } : {}),
    },
    body: JSON.stringify({
      model: model.modelId,
      stream: false,
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content:
            "你是架构图生成器。只输出 JSON，不要 Markdown。根字段只能是 schema_version、diagram_type、meta、components、boundaries、connections。schema_version=1，diagram_type=architecture。组件 type 只能是 frontend/backend/database/cloud/security/messagebus/external，组件 id 必须以英文字母开头且仅含字母数字下划线或连字符。",
        },
        {
          role: "user",
          content: JSON.stringify({
            intent: intent.trim() || "根据上下文生成清晰的系统架构",
            selected_nodes: sourceNodes.map(({ id, type, text, fields }) => ({ id, type, text, fields })),
          }),
        },
      ],
    }),
  });
  if (!response.ok) throw new Error(`AI 架构请求失败 (${response.status}): ${await response.text()}`);
  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;
  if (typeof content !== "string") throw new Error("AI 未返回架构 JSON");
  const ir = JSON.parse(content.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")) as unknown;
  const errors = validateArchitecture(ir);
  if (errors.length) throw new Error(`Architecture 校验失败: ${errors.join("；")}`);
  return ir as ArchitectureIR;
}

export function applyCanvasPatch(canvas: CanvasDocument, patch: CanvasPatch): CanvasDocument {
  const errors = validateCanvasPatch(patch, canvas);
  if (errors.length) throw new Error(`Patch 校验失败: ${errors.join("；")}`);
  return {
    ...canvas,
    nodes: [...canvas.nodes, ...patch.nodesToAdd],
    edges: [...canvas.edges, ...patch.edgesToAdd],
    groups: [...(canvas.groups ?? []), ...patch.groupsToAdd],
  };
}

function isRecord(value: unknown): value is Record<string, any> { return typeof value === "object" && value !== null && !Array.isArray(value); }
