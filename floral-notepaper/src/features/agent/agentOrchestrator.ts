// Agent 编排层（issue 第 17 节 insight_router）
// 把各场景分析器统一接入信号队列：接收标准化输入，调用对应分析器，
// 命中阈值时产出 AgentUICommand 投递给 SignalQueue（带冷却/去重/优先级）。
// 总开关关闭时全部静默。分析失败一律降级（不抛错、不打扰）。

import type { ProviderConfig } from "../settings/types";
import type { InkEvent } from "../ink/types";
import type { AnalyzedSession } from "../ink/analyze";
import { SignalQueue, agentSignalQueue, type AgentUICommand } from "./signalQueue";
import { assessAnxiety, type WritingBaseline, DEFAULT_BASELINE } from "./moodDetector";
import {
  findImplicitConnections,
  type ConnectionCandidateNode,
  type ExistingEdge,
} from "./connectionRecommendations";
import { detectConsensus, toDiscussionCommand, type OpinionNode } from "./consensus";
import { trackHandoffs, type CollabEditEvent } from "./handoffTracker";
import { distillChatMessages, toDistillCommand, type ChatMessage } from "./chatDistill";
import { generateReplayMarkers, toReplayCommand } from "./replayMarkers";

export interface OrchestratorOptions {
  /** Agent 总开关，false 时全部静默 */
  enabled: boolean;
  /** 注入的信号队列，默认用全局 agentSignalQueue（便于测试隔离） */
  queue?: SignalQueue;
  /** 焦虑干预阈值，默认 2.0 */
  anxietyThreshold?: number;
}

/** 情绪信号 -> live2d_signal 的文案 */
const WORRIED_MESSAGES = ["卡在这里了？先写别的段落也可以。", "要不要先歇一下，我在这儿。"];

export class AgentOrchestrator {
  private readonly enabled: boolean;
  private readonly queue: SignalQueue;
  private readonly anxietyThreshold: number;

  constructor(options: OrchestratorOptions) {
    this.enabled = options.enabled;
    this.queue = options.queue ?? agentSignalQueue;
    this.anxietyThreshold = options.anxietyThreshold ?? 2.0;
  }

  private emit(cmd: AgentUICommand, now: number): boolean {
    return this.queue.enqueue(cmd, { now });
  }

  /**
   * 处理编辑活动：评估焦虑，超阈值时投递关怀信号（live2d_signal）。
   * 返回本次投递被接受的指令数。
   */
  onInkActivity(
    events: InkEvent[],
    baseline: WritingBaseline = DEFAULT_BASELINE,
    now = Date.now(),
  ): number {
    if (!this.enabled) return 0;
    const assessment = assessAnxiety(events, baseline, now, 300_000, this.anxietyThreshold);
    if (!assessment.shouldIntervene) return 0;
    const message = WORRIED_MESSAGES[Math.min(WORRIED_MESSAGES.length - 1, 0)];
    const accepted = this.emit(
      {
        type: "live2d_signal",
        mood: "worried",
        animation: "tilt",
        bubbleText: message,
        priority: 60,
      },
      now,
    );
    return accepted ? 1 : 0;
  }

  /**
   * 分析画布节点：产出隐含连接建议。分析失败降级为 0。
   */
  async onCanvasStable(
    nodes: ConnectionCandidateNode[],
    edges: ExistingEdge[],
    providers: ProviderConfig[],
    now = Date.now(),
  ): Promise<number> {
    if (!this.enabled) return 0;
    const connections = await findImplicitConnections(nodes, edges, providers);
    let count = 0;
    for (const c of connections) {
      const ok = this.emit(
        {
          type: "suggest_connection",
          nodeIds: [c.sourceId, c.targetId],
          message: c.message,
          confidence: c.similarity,
        },
        now,
      );
      if (ok) count++;
    }
    return count;
  }

  /**
   * 分析议题簇：产出共识/分歧面板。分析失败降级为 0。
   */
  async onDiscussion(
    topic: string,
    opinions: OpinionNode[],
    providers: ProviderConfig[],
    now = Date.now(),
  ): Promise<number> {
    if (!this.enabled) return 0;
    const result = await detectConsensus(topic, opinions, providers);
    if (!result) return 0;
    return this.emit(toDiscussionCommand(result), now) ? 1 : 0;
  }

  /**
   * 分析多人编辑事件：为每个接力点产出回放标记。
   */
  onCollabEdits(events: CollabEditEvent[], now = Date.now()): number {
    if (!this.enabled) return 0;
    const { handoffs } = trackHandoffs(events);
    let count = 0;
    for (const h of handoffs) {
      const ok = this.emit(
        {
          type: "replay_marker",
          time: h.timestamp,
          markerType: "handoff",
          title: "接力点",
          summary: `${h.fromUserId} → ${h.toUserId} 在「${h.area}」区接力`,
        },
        now,
      );
      if (ok) count++;
    }
    return count;
  }

  /**
   * 分析聊天消息：产出沉淀节点建议。
   */
  onChatMessages(messages: ChatMessage[], now = Date.now()): number {
    if (!this.enabled) return 0;
    const suggestions = distillChatMessages(messages);
    let count = 0;
    for (const s of suggestions) {
      if (this.emit(toDistillCommand(s), now)) count++;
    }
    return count;
  }

  /**
   * 分析一次写作 session：产出回放关键帧标记。
   */
  async onSessionReplay(
    session: AnalyzedSession,
    providers: ProviderConfig[],
    now = Date.now(),
    useLLM = false,
  ): Promise<number> {
    if (!this.enabled) return 0;
    const markers = await generateReplayMarkers(session, providers, { useLLM });
    let count = 0;
    for (const m of markers) {
      if (this.emit(toReplayCommand(m), now)) count++;
    }
    return count;
  }

  /** 把队列中待处理指令按优先级分发给订阅者 */
  flush(): AgentUICommand[] {
    return this.queue.flush();
  }
}
