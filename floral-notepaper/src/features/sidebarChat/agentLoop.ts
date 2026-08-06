import {
  buildAssistantToolCallMessage,
  isDangerousTool,
  toolDisplayName,
  type AgentToolCall,
} from "./agentTools";

/** 单次对话允许的最大工具调用轮次，防止模型死循环 */
export const MAX_AGENT_TOOL_ROUNDS = 4;

export interface AgentRequestResult {
  reply: string;
  toolCalls: AgentToolCall[];
}

export interface AgentLoopDeps {
  /** 流式请求：content 通过 onDelta 逐字流出，返回聚合后的 toolCalls */
  requestWithTools: (messages: Array<Record<string, unknown>>) => Promise<AgentRequestResult>;
  onAgentStatus: (status: string) => void;
  /** 含危险工具（写/联网/外部）的轮次先整轮确认，返回 true 继续执行 */
  confirmRound: (calls: AgentToolCall[]) => Promise<boolean>;
  /** 执行单个工具调用，返回回喂给模型的文本结果 */
  executeTool: (call: AgentToolCall) => Promise<string>;
}

export interface AgentLoopResult {
  text: string;
  cancelled: boolean;
  finishedByToolLimit: boolean;
}

/**
 * 标准 Agent 循环（function calling）：
 * 模型自主决定调用哪个工具 → 前端执行 → 结果回喂 → 直至模型给出纯文本回复。
 * 含危险工具的轮次会先整轮人工确认。
 */
export async function runAgentLoop(
  initialMessages: Array<Record<string, unknown>>,
  deps: AgentLoopDeps,
): Promise<AgentLoopResult> {
  let current = [...initialMessages];

  for (let round = 0; round < MAX_AGENT_TOOL_ROUNDS; round++) {
    const result = await deps.requestWithTools([...current]);

    if (!result.toolCalls || result.toolCalls.length === 0) {
      return { text: result.reply, cancelled: false, finishedByToolLimit: false };
    }

    const hasDangerous = result.toolCalls.some((call) => isDangerousTool(call.name));
    if (hasDangerous) {
      const ok = await deps.confirmRound(result.toolCalls);
      if (!ok) {
        deps.onAgentStatus("已拒绝本轮工具调用");
        current = [
          ...current,
          buildAssistantToolCallMessage(result.toolCalls),
          {
            role: "user",
            content: "用户拒绝了上述工具调用。请直接用文字回答用户，不要再次调用工具。",
          },
        ];
        continue;
      }
    }

    const toolMessages: Array<Record<string, unknown>> = [];
    for (const call of result.toolCalls) {
      deps.onAgentStatus(`调用工具：${toolDisplayName(call.name)}`);
      try {
        const output = await deps.executeTool(call);
        toolMessages.push({ role: "tool", tool_call_id: call.id, content: output });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        toolMessages.push({
          role: "tool",
          tool_call_id: call.id,
          content: `工具执行失败：${message}`,
        });
      }
    }

    current = [
      ...current,
      buildAssistantToolCallMessage(result.toolCalls),
      ...toolMessages,
    ];
  }

  return { text: "", cancelled: false, finishedByToolLimit: true };
}
