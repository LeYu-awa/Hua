// Agent 洞察分发：AgentUICommand 类型 + 信号队列
// 统一各 Agent 场景产出的 UI 指令，经优先级 + 冷却 + 去重后分发给
// 画布 / 花灵精灵 / 回放 等订阅者。对应 issue 第 17.1 节 IPC 指令协议。
// 花灵（Live2D）当前用 CSS 精灵 WritingCompanion 承接 live2d_signal。

import { CooldownTracker, sortByPriorityDesc } from "./ruleEngine";

/** 花灵情绪，用于驱动精灵表情/动作 */
export type FloralMood = "happy" | "neutral" | "sleepy" | "excited" | "worried" | "curious";

/** 回放关键帧类型 */
export type ReplayMarkerType = "handoff" | "conflict" | "flow" | "stuck" | "consensus";

/** 统一的 Agent UI 指令（可扩展的可辨识联合） */
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
      type: "show_discussion_panel";
      topic: string;
      groups: Array<{ label: string; userIds: string[]; color: string }>;
      bridgeNodeIds: string[];
    }
  | {
      type: "distill_chat_node";
      messageId: string;
      docId: string;
      suggestedText: string;
      message: string;
    }
  | {
      type: "archive_suggest";
      nodeIds: string[];
      groupLabel: string;
      message: string;
    }
  | {
      type: "live2d_signal";
      mood: FloralMood;
      animation: string;
      bubbleText: string;
      priority: number;
    }
  | {
      type: "replay_marker";
      time: number;
      markerType: ReplayMarkerType;
      title: string;
      summary: string;
    };

export type AgentUICommandType = AgentUICommand["type"];

/** 各指令的默认优先级（大者优先），live2d_signal 用自带 priority */
const DEFAULT_PRIORITY: Record<AgentUICommandType, number> = {
  show_discussion_panel: 80,
  live2d_signal: 60,
  suggest_connection: 50,
  distill_chat_node: 40,
  show_semantic_gap: 30,
  archive_suggest: 20,
  replay_marker: 10,
};

/** 各指令默认冷却时间（ms），避免同类反复打扰 */
const DEFAULT_COOLDOWN_MS: Record<AgentUICommandType, number> = {
  live2d_signal: 30_000,
  suggest_connection: 15_000,
  show_semantic_gap: 10 * 60_000,
  show_discussion_panel: 60_000,
  distill_chat_node: 20_000,
  archive_suggest: 60_000,
  replay_marker: 0,
};

function commandPriority(cmd: AgentUICommand): number {
  if (cmd.type === "live2d_signal") return cmd.priority;
  return DEFAULT_PRIORITY[cmd.type];
}

/** 去重 key：同一指令 + 关键目标只提示一次（在冷却窗口内） */
function commandDedupeKey(cmd: AgentUICommand): string {
  switch (cmd.type) {
    case "suggest_connection": {
      const [a, b] = cmd.nodeIds;
      return `suggest_connection:${a < b ? `${a}-${b}` : `${b}-${a}`}`;
    }
    case "show_semantic_gap":
      return `show_semantic_gap:${cmd.items.slice().sort().join(",")}`;
    case "show_discussion_panel":
      return `show_discussion_panel:${cmd.topic}`;
    case "distill_chat_node":
      return `distill_chat_node:${cmd.messageId}`;
    case "archive_suggest":
      return `archive_suggest:${cmd.nodeIds.slice().sort().join(",")}`;
    case "live2d_signal":
      return `live2d_signal:${cmd.mood}:${cmd.animation}`;
    case "replay_marker":
      return `replay_marker:${cmd.markerType}:${cmd.time}`;
  }
}

type Listener = (cmd: AgentUICommand) => void;

export interface EnqueueOptions {
  /** 覆盖默认冷却时间 */
  cooldownMs?: number;
  /** 触发时间戳，默认取 Date.now() */
  now?: number;
}

/**
 * 信号队列：收集各场景的 AgentUICommand，按冷却 + 去重过滤，
 * 按优先级排序后分发给订阅者。所有提示都可被下游忽略（可忽略原则）。
 */
export class SignalQueue {
  private readonly listeners = new Set<Listener>();
  private readonly cooldown = new CooldownTracker();
  private pending: AgentUICommand[] = [];

  /** 订阅分发，返回取消订阅函数 */
  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * 入队一条指令。若在冷却窗口内则被丢弃，返回是否被接受。
   * replay_marker 冷却为 0，总是接受（回放标记不打扰用户）。
   */
  enqueue(cmd: AgentUICommand, options: EnqueueOptions = {}): boolean {
    const now = options.now ?? Date.now();
    const cooldownMs = options.cooldownMs ?? DEFAULT_COOLDOWN_MS[cmd.type];
    const key = commandDedupeKey(cmd);
    if (cooldownMs > 0 && !this.cooldown.tryFire(key, cooldownMs, now)) {
      return false;
    }
    this.pending.push(cmd);
    return true;
  }

  /**
   * 按优先级排序后分发全部待处理指令并清空队列。
   * 返回本次分发的指令列表。
   */
  flush(): AgentUICommand[] {
    if (this.pending.length === 0) return [];
    const ordered = sortByPriorityDesc(
      this.pending.map((cmd) => ({ cmd, priority: commandPriority(cmd) })),
    ).map((x) => x.cmd);
    this.pending = [];
    for (const cmd of ordered) {
      for (const listener of this.listeners) listener(cmd);
    }
    return ordered;
  }

  /** 入队并立即分发单条指令，返回是否被接受 */
  dispatch(cmd: AgentUICommand, options: EnqueueOptions = {}): boolean {
    const accepted = this.enqueue(cmd, options);
    if (accepted) this.flush();
    return accepted;
  }

  /** 待处理指令数 */
  get size(): number {
    return this.pending.length;
  }

  /** 清空队列与冷却状态 */
  reset(): void {
    this.pending = [];
    this.cooldown.reset();
  }
}

/** 全局共享的信号队列实例，供各场景与 UI 订阅 */
export const agentSignalQueue = new SignalQueue();
