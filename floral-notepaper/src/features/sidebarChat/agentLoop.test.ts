import { describe, expect, test, vi } from "vitest";
import { runAgentLoop, type AgentLoopDeps, type AgentRequestResult } from "./agentLoop";
import type { AgentToolCall } from "./agentTools";

function toolCall(id: string, name: string, args = "{}"): AgentToolCall {
  return { id, name, arguments: args };
}

/** 顺序返回预置结果；超出后重复最后一个 */
function scriptedRequest(...results: AgentRequestResult[]) {
  let index = 0;
  return async () => {
    const result = results[Math.min(index, results.length - 1)];
    index += 1;
    return { ...result, toolCalls: result.toolCalls ?? [] };
  };
}

function baseDeps(overrides: Partial<AgentLoopDeps>): AgentLoopDeps {
  return {
    requestWithTools: async () => ({ reply: "OK", toolCalls: [] }),
    onAgentStatus: () => {},
    confirmRound: async () => true,
    executeTool: async (call) => `result of ${call.name}`,
    ...overrides,
  };
}

describe("agent loop", () => {
  test("returns plain reply when the model does not call tools", async () => {
    const deps = baseDeps({
      requestWithTools: scriptedRequest({ reply: "你好！", toolCalls: [] }),
    });
    const result = await runAgentLoop([{ role: "user", content: "你好" }], deps);
    expect(result).toEqual({ text: "你好！", cancelled: false, finishedByToolLimit: false });
  });

  test("executes read-only tool calls and feeds results back", async () => {
    const messages: Array<Array<Record<string, unknown>>> = [];
    const executeTool = vi.fn(async (call: AgentToolCall) => `输出：${call.name}`);
    const deps = baseDeps({
      requestWithTools: async (m) => {
        messages.push(m);
        if (messages.length === 1) {
          return { reply: "", toolCalls: [toolCall("call_1", "note.search", '{"query":"周报"}')] };
        }
        return { reply: "找到了周报。", toolCalls: [] };
      },
      executeTool,
    });

    const result = await runAgentLoop([{ role: "user", content: "查周报" }], deps);

    expect(result).toEqual({ text: "找到了周报。", cancelled: false, finishedByToolLimit: false });
    expect(executeTool).toHaveBeenCalledTimes(1);
    expect(executeTool).toHaveBeenCalledWith(
      expect.objectContaining({ name: "note.search", arguments: '{"query":"周报"}' }),
    );

    // 第二次请求应包含 assistant tool_calls 消息 + 对应 tool 结果消息
    const second = messages[1];
    expect(second.some((m) => m.role === "assistant" && Array.isArray(m.tool_calls))).toBe(true);
    const toolMessage = second.find((m) => m.role === "tool");
    expect(toolMessage?.tool_call_id).toBe("call_1");
    expect(toolMessage?.content).toBe("输出：note.search");
  });

  test("confirms dangerous rounds before executing", async () => {
    const executeTool = vi.fn(async () => "done");
    const confirmRound = vi.fn(async () => true);
    const deps = baseDeps({
      requestWithTools: scriptedRequest(
        { reply: "", toolCalls: [toolCall("c1", "web.search", '{"query":"Tauri"}')] },
        { reply: "搜索完成。", toolCalls: [] },
      ),
      confirmRound,
      executeTool,
    });

    const result = await runAgentLoop([{ role: "user", content: "搜索 Tauri" }], deps);

    expect(result.text).toBe("搜索完成。");
    expect(confirmRound).toHaveBeenCalledTimes(1);
    expect(confirmRound).toHaveBeenCalledWith([expect.objectContaining({ name: "web.search" })]);
    expect(executeTool).toHaveBeenCalledTimes(1);
  });

  test("skips execution when a dangerous round is rejected", async () => {
    const executeTool = vi.fn(async () => "done");
    const statuses: string[] = [];
    const deps = baseDeps({
      requestWithTools: scriptedRequest(
        { reply: "", toolCalls: [toolCall("c1", "note.update", '{"query":"周报","content":"x"}')] },
        { reply: "好的，我不修改笔记。", toolCalls: [] },
      ),
      confirmRound: async () => false,
      executeTool,
      onAgentStatus: (s) => statuses.push(s),
    });

    const result = await runAgentLoop([{ role: "user", content: "改周报" }], deps);

    expect(result.text).toBe("好的，我不修改笔记。");
    expect(executeTool).not.toHaveBeenCalled();
    expect(statuses).toContain("已拒绝本轮工具调用");
  });

  test("feeds execution errors back to the model", async () => {
    const messages: Array<Array<Record<string, unknown>>> = [];
    const deps = baseDeps({
      requestWithTools: async (m) => {
        messages.push(m);
        return { reply: "", toolCalls: [toolCall("c1", "note.read", "{}")] };
      },
      executeTool: async () => {
        throw new Error("后端不可用");
      },
    });

    await runAgentLoop([{ role: "user", content: "读笔记" }], deps);

    const toolMessage = messages[1]?.find((m) => m.role === "tool");
    expect(toolMessage?.tool_call_id).toBe("c1");
    expect(String(toolMessage?.content)).toContain("工具执行失败：后端不可用");
  });

  test("stops after MAX_AGENT_TOOL_ROUNDS", async () => {
    const executeTool = vi.fn(async () => "ok");
    const deps = baseDeps({
      requestWithTools: async () => ({
        reply: "",
        toolCalls: [toolCall("c", "note.search", "{}")],
      }),
      executeTool,
    });

    const result = await runAgentLoop([{ role: "user", content: "x" }], deps);

    expect(result.finishedByToolLimit).toBe(true);
    expect(result.text).toBe("");
    expect(executeTool).toHaveBeenCalledTimes(4);
  });
});
