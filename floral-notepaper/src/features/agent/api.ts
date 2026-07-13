import { invoke } from "@tauri-apps/api/core";
import type {
  AgentAnalysisResult,
  AgentCanvasNode,
  AgentCollaborationSegment,
  AgentEvent,
  AgentEventInput,
  AgentReplayMarker,
  AgentReviewReport,
  AgentSuggestion,
  AgentSuggestionStatus,
} from "./types";

export function recordAgentEvent(event: AgentEventInput): Promise<AgentEvent> {
  return invoke("agent_record_event", { event });
}

export function recordAgentEvents(events: AgentEventInput[]): Promise<AgentEvent[]> {
  return invoke("agent_record_events", { events });
}

export function listAgentEvents(
  conversationId: string,
  limit?: number,
): Promise<AgentEvent[]> {
  return invoke("agent_list_events", { conversationId, limit });
}

export function listAgentCanvasNodes(conversationId: string): Promise<AgentCanvasNode[]> {
  return invoke("agent_list_canvas_nodes", { conversationId });
}

export function analyzeAgentConversation(
  conversationId: string,
): Promise<AgentAnalysisResult> {
  return invoke("agent_analyze_conversation", { conversationId });
}

export function listAgentSuggestions(
  conversationId: string,
  status: AgentSuggestionStatus | null = "pending",
): Promise<AgentSuggestion[]> {
  return invoke("agent_list_suggestions", { conversationId, status });
}

export function dismissAgentSuggestion(suggestionId: string): Promise<AgentSuggestion> {
  return invoke("agent_dismiss_suggestion", { suggestionId });
}

export function acceptAgentSuggestion(suggestionId: string): Promise<AgentSuggestion> {
  return invoke("agent_accept_suggestion", { suggestionId });
}

export function listAgentReplayMarkers(conversationId: string): Promise<AgentReplayMarker[]> {
  return invoke("agent_list_replay_markers", { conversationId });
}

export function listAgentCollaborationSegments(
  conversationId: string,
): Promise<AgentCollaborationSegment[]> {
  return invoke("agent_list_collaboration_segments", { conversationId });
}

export function generateAgentReviewReport(conversationId: string): Promise<AgentReviewReport> {
  return invoke("agent_generate_review_report", { conversationId });
}

export function recordAgentChatMessageEvent(params: {
  conversationId: string;
  messageId: string;
  userId: string;
  content: string;
  timestamp?: string;
}): Promise<AgentEvent> {
  return invoke("agent_record_chat_message_event", params);
}
