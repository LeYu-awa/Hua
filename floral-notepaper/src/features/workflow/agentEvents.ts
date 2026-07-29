import type { AgentEventInput } from "../agent/types";
import type { WorkflowDocument } from "./types";

export function workflowToAgentEvents(
  workflow: WorkflowDocument,
  conversationId: string,
  userId: string,
): AgentEventInput[] {
  const graph = workflow.graph as {
    nodes?: Array<Record<string, unknown>>;
    links?: Array<Record<string, unknown>>;
  };
  const timestamp = new Date().toISOString();

  const nodeEvents = (graph.nodes ?? []).map((node) => {
    const properties = asRecord(node.properties);
    const pos = numberPair(node.pos);
    const size = numberPair(node.size, [220, 120]);

    return {
      conversationId,
      userId,
      eventType: "canvas_shape_updated" as const,
      timestamp,
      payload: {
        nodeId: String(node.id ?? ""),
        shapeType: String(node.type ?? "workflow-node"),
        text: String(properties.text ?? properties.title ?? node.title ?? ""),
        x: pos[0],
        y: pos[1],
        w: size[0],
        h: size[1],
        authorId: userId,
        props: properties,
      },
    };
  });

  const linkEvents = (graph.links ?? []).map((link) => ({
    conversationId,
    userId,
    eventType: "canvas_binding_added" as const,
    timestamp,
    payload: {
      bindingId: String(link.id ?? ""),
      bindingType: "workflow-link",
      fromId: String(link.origin_id ?? ""),
      toId: String(link.target_id ?? ""),
      authorId: userId,
    },
  }));

  return [...nodeEvents, ...linkEvents];
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function numberPair(value: unknown, fallback: [number, number] = [0, 0]): [number, number] {
  if (!Array.isArray(value)) return fallback;
  const first = typeof value[0] === "number" ? value[0] : fallback[0];
  const second = typeof value[1] === "number" ? value[1] : fallback[1];
  return [first, second];
}
