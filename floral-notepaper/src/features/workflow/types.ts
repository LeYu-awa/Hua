import type { SerialisableGraph } from "@comfyorg/litegraph";
import type { CanvasDocument, CanvasEdge, CanvasNode } from "../canvas/types";

export type WorkflowPortType = "text" | "document" | "any";

export interface WorkflowPort {
  name: string;
  type: WorkflowPortType;
  required?: boolean;
}

export interface WorkflowNodeDefinition {
  type: string;
  title: string;
  category: string;
  width: number;
  height: number;
  shape?: string;
  color?: string;
  bgcolor?: string;
  boxcolor?: string;
  inputs: WorkflowPort[];
  outputs: WorkflowPort[];
  defaults: Record<string, string | number | boolean>;
}

export interface WorkflowDocument {
  id: string;
  noteId?: string;
  conversationId?: string;
  graph: SerialisableGraph | Record<string, unknown>;
}

export interface WorkflowValidationIssue {
  code: string;
  message: string;
  nodeId?: string;
  linkId?: string | number;
}

export interface WorkflowValidationResult {
  valid: boolean;
  issues: WorkflowValidationIssue[];
  executionOrder: string[];
}

export const WORKFLOW_NODE_DEFINITIONS: WorkflowNodeDefinition[] = [
  {
    type: "floral/text",
    title: "文本节点",
    category: "基础",
    width: 220,
    height: 120,
    shape: "round",
    inputs: [],
    outputs: [{ name: "text", type: "text" }],
    defaults: { text: "新节点" },
  },
  {
    type: "floral/card",
    title: "卡片节点",
    category: "基础",
    width: 260,
    height: 150,
    inputs: [{ name: "text", type: "text" }],
    outputs: [{ name: "text", type: "text" }],
    defaults: { text: "" },
  },
  {
    type: "floral/document",
    title: "文档节点",
    category: "文档",
    width: 260,
    height: 120,
    inputs: [],
    outputs: [{ name: "document", type: "document" }],
    defaults: { title: "未命名文档", documentId: "" },
  },
  {
    type: "floral/agent",
    title: "Agent 节点",
    category: "自动化",
    width: 280,
    height: 160,
    inputs: [{ name: "input", type: "any", required: true }],
    outputs: [{ name: "result", type: "any" }],
    defaults: { prompt: "总结输入内容" },
  },
];

export function createEmptyWorkflowDocument(id: string, noteId?: string): WorkflowDocument {
  return {
    id,
    noteId,
    graph: {
      version: 1,
      state: {},
      nodes: [],
      links: [],
      groups: [],
    },
  };
}

export function canvasDocumentToWorkflowDocument(doc: CanvasDocument): WorkflowDocument {
  const linkByTarget = new Map<string, string>();
  const linksBySource = new Map<string, string[]>();

  for (const edge of doc.edges) {
    linkByTarget.set(edge.toNodeId, edge.id);
    const sourceLinks = linksBySource.get(edge.fromNodeId) ?? [];
    sourceLinks.push(edge.id);
    linksBySource.set(edge.fromNodeId, sourceLinks);
  }

  const nodes = doc.nodes.map((node, index) => ({
    id: node.id,
    type: node.type === "card" ? "floral/card" : "floral/text",
    title: node.type === "card" ? "卡片节点" : "文本节点",
    pos: [node.x, node.y],
    size: [node.width, node.height],
    flags: {},
    order: index,
    mode: 0,
    inputs: node.type === "card" ? [{ name: "text", type: "text", link: linkByTarget.get(node.id) ?? null }] : [],
    outputs: [{ name: "text", type: "text", links: linksBySource.get(node.id) ?? [] }],
    shape: "round",
    properties: {
      canvasNodeId: node.id,
      text: node.text,
      source: node.source ?? "user",
    },
  }));

  const links = doc.edges.map((edge) => ({
    id: edge.id,
    origin_id: edge.fromNodeId,
    origin_slot: 0,
    target_id: edge.toNodeId,
    target_slot: 0,
    type: "text",
  }));

  return {
    id: doc.id,
    noteId: doc.noteId,
    graph: {
      version: 1,
      state: {},
      nodes,
      links,
      groups: [],
      extra: {
        canvasDocumentId: doc.id,
        noteId: doc.noteId,
      },
    },
  };
}

export function workflowDocumentToCanvasDocument(workflow: WorkflowDocument): CanvasDocument {
  const graph = workflow.graph as {
    nodes?: Array<Record<string, unknown>>;
    links?: Array<Record<string, unknown>>;
  };

  const nodes: CanvasNode[] = (graph.nodes ?? []).map((node) => {
    const properties = asRecord(node.properties);
    const pos = numberPair(node.pos, [80, 80]);
    const size = numberPair(node.size, [220, 120]);
    const type = String(node.type ?? "floral/text").includes("card") ? "card" : "text";

    return {
      id: String(node.id ?? properties.canvasNodeId ?? crypto.randomUUID()),
      type,
      x: pos[0],
      y: pos[1],
      width: size[0],
      height: size[1],
      text: String(properties.text ?? properties.title ?? node.title ?? ""),
      source: readSource(properties.source),
    };
  });

  const edges: CanvasEdge[] = (graph.links ?? []).map((link) => ({
    id: String(link.id ?? crypto.randomUUID()),
    fromNodeId: String(link.origin_id ?? ""),
    toNodeId: String(link.target_id ?? ""),
    style: link.style === "dashed" ? "dashed" : "solid",
  }));

  return {
    id: workflow.id,
    noteId: workflow.noteId,
    nodes,
    edges: edges.filter((edge) => edge.fromNodeId && edge.toNodeId),
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function numberPair(value: unknown, fallback: [number, number]): [number, number] {
  if (!Array.isArray(value)) return fallback;
  const first = typeof value[0] === "number" ? value[0] : fallback[0];
  const second = typeof value[1] === "number" ? value[1] : fallback[1];
  return [first, second];
}

function readSource(value: unknown): CanvasNode["source"] {
  return value === "agent" || value === "cowrite" ? value : "user";
}
