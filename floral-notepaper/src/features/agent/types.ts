export type AgentEventType =
  | "canvas_shape_added"
  | "canvas_shape_updated"
  | "canvas_shape_removed"
  | "canvas_binding_added"
  | "canvas_binding_removed"
  | "chat_message_sent";

export interface AgentEventInput {
  conversationId: string;
  userId: string;
  eventType: AgentEventType;
  timestamp?: string;
  payload: Record<string, unknown>;
}

export interface AgentEvent extends AgentEventInput {
  id: string;
  timestamp: string;
}

export interface AgentCanvasNode {
  conversationId: string;
  nodeId: string;
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
  authorId: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
}

export type AgentSuggestionStatus = "pending" | "dismissed" | "accepted";

export type AgentSuggestionType =
  | "idle_prompt"
  | "chat_to_canvas_node"
  | "suggest_connection";

export interface AgentSuggestion {
  id: string;
  conversationId: string;
  suggestionType: AgentSuggestionType;
  title: string;
  message: string;
  status: AgentSuggestionStatus;
  priority: number;
  sourceEventIds: string[];
  relatedNodeIds: string[];
  payload: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export type AgentReplayMarkerType = "handoff" | "conflict" | "flow" | "stuck" | "consensus";

export interface AgentReplayMarker {
  id: string;
  conversationId: string;
  time: number;
  markerType: AgentReplayMarkerType;
  title: string;
  summary: string;
  relatedEventIds: string[];
  relatedNodeIds: string[];
  createdAt: string;
}

export interface AgentCollaborationSegment {
  id: string;
  conversationId: string;
  fromUserId: string;
  toUserId: string;
  startedAt: string;
  endedAt: string;
  eventCount: number;
  relatedEventIds: string[];
  relatedNodeIds: string[];
  summary: string;
  createdAt: string;
}

export interface AgentReviewReport {
  conversationId: string;
  title: string;
  summary: string;
  healthScore: number;
  markerCounts: Record<string, number>;
  highlights: string[];
  risks: string[];
  nextSteps: string[];
  generatedAt: string;
}

export interface AgentAnalysisResult {
  suggestions: AgentSuggestion[];
  replayMarkers: AgentReplayMarker[];
  collaborationSegments: AgentCollaborationSegment[];
}

export type AgentUICommand =
  | {
      type: "suggest_connection";
      nodeIds: [string, string];
      message: string;
      confidence: number;
    }
  | {
      type: "show_semantic_gap";
      areaHint: { x: number; y: number };
      items: string[];
      message: string;
    }
  | {
      type: "live2d_signal";
      mood: "happy" | "neutral" | "sleepy" | "excited" | "worried" | "curious";
      animation: string;
      bubbleText: string;
      priority: number;
    }
  | {
      type: "replay_marker";
      time: number;
      markerType: AgentReplayMarkerType;
      title: string;
      summary: string;
    };
