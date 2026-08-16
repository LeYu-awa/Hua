import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("./embeddingService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./embeddingService")>();
  return { ...actual, callEmbedding: vi.fn() };
});

import { AgentOrchestrator } from "./agentOrchestrator";
import { SignalQueue, type AgentUICommand } from "./signalQueue";
import { DEFAULT_BASELINE } from "./moodDetector";
import { callEmbedding } from "./embeddingService";
import type { InkEvent } from "../ink/types";
import type { CollabEditEvent } from "./handoffTracker";
import type { ChatMessage } from "./chatDistill";

const mockedEmbedding = vi.mocked(callEmbedding);

beforeEach(() => {
  mockedEmbedding.mockReset();
});

function ev(type: InkEvent["type"], timestamp: number, extra: Partial<InkEvent> = {}): InkEvent {
  return {
    id: `${type}-${timestamp}`,
    sessionId: "s",
    noteId: "n",
    source: "main",
    type,
    index: 0,
    timestamp,
    ...extra,
  };
}

/** 制造高焦虑事件序列（大量删除 + 频繁光标 + 停顿） */
function anxiousEvents(now: number): InkEvent[] {
  const events: InkEvent[] = [];
  for (let i = 0; i < 20; i++) events.push(ev("delete", now - 280_000 + i * 1_000, { length: 5 }));
  for (let i = 0; i < 5; i++) events.push(ev("insert", now - 250_000 + i * 1_000));
  for (let i = 0; i < 20; i++) events.push(ev("cursor", now - 200_000 + i * 7_000));
  return events;
}

describe("AgentOrchestrator - 总开关", () => {
  it("enabled=false 时全部静默", () => {
    const queue = new SignalQueue();
    const orch = new AgentOrchestrator({ enabled: false, queue });
    const now = 1_000_000;
    expect(orch.onInkActivity(anxiousEvents(now), DEFAULT_BASELINE, now)).toBe(0);
    expect(orch.onCollabEdits([], now)).toBe(0);
    expect(orch.onChatMessages([], now)).toBe(0);
  });
});

describe("AgentOrchestrator - onInkActivity", () => {
  it("高焦虑时投递 live2d_signal", () => {
    const queue = new SignalQueue();
    const got: AgentUICommand[] = [];
    queue.subscribe((c) => got.push(c));
    const orch = new AgentOrchestrator({ enabled: true, queue });
    const now = 1_000_000;

    const count = orch.onInkActivity(anxiousEvents(now), DEFAULT_BASELINE, now);
    expect(count).toBe(1);
    queue.flush();
    expect(got[0]?.type).toBe("live2d_signal");
    if (got[0]?.type === "live2d_signal") expect(got[0].mood).toBe("worried");
  });

  it("平稳输出时不打扰", () => {
    const queue = new SignalQueue();
    const orch = new AgentOrchestrator({ enabled: true, queue });
    const now = 1_000_000;
    const calm: InkEvent[] = [];
    for (let i = 0; i < 30; i++) calm.push(ev("insert", now - 300_000 + i * 8_000));
    expect(orch.onInkActivity(calm, DEFAULT_BASELINE, now)).toBe(0);
  });
});

describe("AgentOrchestrator - onCollabEdits", () => {
  it("接力点产出 replay_marker", () => {
    const queue = new SignalQueue();
    const orch = new AgentOrchestrator({ enabled: true, queue });
    const events: CollabEditEvent[] = [
      { userId: "A", area: "方案", nodeId: "n1", timestamp: 1000, kind: "edit" },
      { userId: "B", area: "方案", nodeId: "n2", timestamp: 2000, kind: "edit" },
    ];
    const count = orch.onCollabEdits(events, 5000);
    expect(count).toBe(1);
  });
});

describe("AgentOrchestrator - onChatMessages", () => {
  it("决策类消息产出 distill_chat_node", () => {
    const queue = new SignalQueue();
    const got: AgentUICommand[] = [];
    queue.subscribe((c) => got.push(c));
    const orch = new AgentOrchestrator({ enabled: true, queue });
    const messages: ChatMessage[] = [
      {
        id: "m1",
        docId: "d1",
        senderId: "u1",
        content: "我们决定先做实时同步 MVP",
        createdAt: 1000,
      },
    ];
    const count = orch.onChatMessages(messages, 5000);
    expect(count).toBe(1);
    queue.flush();
    expect(got[0]?.type).toBe("distill_chat_node");
  });
});

describe("AgentOrchestrator - 降级", () => {
  it("Embedding 不可用时画布分析降级为 0", async () => {
    mockedEmbedding.mockRejectedValue(new Error("no provider"));
    const queue = new SignalQueue();
    const orch = new AgentOrchestrator({ enabled: true, queue });
    const count = await orch.onCanvasStable(
      [
        { id: "a", text: "实时同步需求", x: 0, y: 0 },
        { id: "b", text: "实时同步排期", x: 700, y: 0 },
      ],
      [],
      [],
    );
    expect(count).toBe(0);
  });

  it("Embedding 不可用时共识分析降级为 0", async () => {
    mockedEmbedding.mockRejectedValue(new Error("no provider"));
    const queue = new SignalQueue();
    const orch = new AgentOrchestrator({ enabled: true, queue });
    const count = await orch.onDiscussion(
      "上云",
      [
        { id: "a", authorId: "u1", text: "应该上云" },
        { id: "b", authorId: "u2", text: "不该上云" },
        { id: "c", authorId: "u3", text: "混合云" },
      ],
      [],
    );
    expect(count).toBe(0);
  });
});
