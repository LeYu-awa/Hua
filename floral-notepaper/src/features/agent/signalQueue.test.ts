import { describe, expect, it, vi } from "vitest";
import { SignalQueue, type AgentUICommand } from "./signalQueue";

const connection: AgentUICommand = {
  type: "suggest_connection",
  nodeIds: ["a", "b"],
  message: "要不要连起来？",
  confidence: 0.9,
};

describe("SignalQueue", () => {
  it("dispatch 会分发给订阅者", () => {
    const q = new SignalQueue();
    const listener = vi.fn();
    q.subscribe(listener);
    expect(q.dispatch(connection, { now: 0 })).toBe(true);
    expect(listener).toHaveBeenCalledWith(connection);
  });

  it("冷却窗口内的同类信号被丢弃", () => {
    const q = new SignalQueue();
    expect(q.enqueue(connection, { now: 0 })).toBe(true);
    // 同一对节点，冷却内再次入队应被拒
    expect(q.enqueue(connection, { now: 1000 })).toBe(false);
  });

  it("节点对顺序无关的去重", () => {
    const q = new SignalQueue();
    const reversed: AgentUICommand = { ...connection, nodeIds: ["b", "a"] };
    expect(q.enqueue(connection, { now: 0 })).toBe(true);
    expect(q.enqueue(reversed, { now: 100 })).toBe(false);
  });

  it("flush 按优先级降序分发", () => {
    const q = new SignalQueue();
    const received: string[] = [];
    q.subscribe((cmd) => received.push(cmd.type));
    const marker: AgentUICommand = {
      type: "replay_marker",
      time: 1,
      markerType: "flow",
      title: "t",
      summary: "s",
    };
    const panel: AgentUICommand = {
      type: "show_discussion_panel",
      topic: "上云",
      groups: [],
      bridgeNodeIds: [],
    };
    q.enqueue(marker, { now: 0 });
    q.enqueue(panel, { now: 0 });
    q.flush();
    // discussion_panel 优先级 80 > replay_marker 10
    expect(received).toEqual(["show_discussion_panel", "replay_marker"]);
  });

  it("replay_marker 冷却为 0，可重复入队", () => {
    const q = new SignalQueue();
    const marker: AgentUICommand = {
      type: "replay_marker",
      time: 1,
      markerType: "flow",
      title: "t",
      summary: "s",
    };
    expect(q.enqueue(marker, { now: 0 })).toBe(true);
    expect(q.enqueue({ ...marker, time: 2 }, { now: 0 })).toBe(true);
  });

  it("reset 清空队列", () => {
    const q = new SignalQueue();
    q.enqueue(connection, { now: 0 });
    expect(q.size).toBe(1);
    q.reset();
    expect(q.size).toBe(0);
  });
});
