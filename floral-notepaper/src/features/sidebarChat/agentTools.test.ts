import { describe, expect, test } from "vitest";
import {
  buildAgentTools,
  buildAssistantToolCallMessage,
  DEFAULT_AGENT_PERMISSION_POLICY,
  getStreamToolCallDelta,
  isDangerousTool,
  isReadOnlyTool,
  mergeToolCallDelta,
  parseToolArguments,
  requiresConfirmForTool,
  type AgentPermissionPolicy,
  type AgentToolCall,
} from "./agentTools";

describe("agent tool definitions", () => {
  test("buildAgentTools exposes all nine tools with required params", () => {
    const tools = buildAgentTools();
    expect(tools).toHaveLength(9);
    const byName = new Map(tools.map((tool) => [tool.function.name, tool]));
    expect(byName.get("note.search")?.function.parameters.required).toContain("query");
    expect(byName.get("note.update")?.function.parameters.required).toContain("content");
    expect(byName.get("web.search")?.function.parameters.required).toContain("query");
    expect(byName.get("external.openUrl")?.function.parameters.required).toContain("url");
    expect(byName.get("external.copyText")?.function.parameters.required).toContain("text");
  });

  test("classifies dangerous vs read-only tools", () => {
    expect(isDangerousTool("note.update")).toBe(true);
    expect(isDangerousTool("note.create")).toBe(true);
    expect(isDangerousTool("note.moveCategory")).toBe(true);
    expect(isDangerousTool("web.search")).toBe(true);
    expect(isDangerousTool("external.openUrl")).toBe(true);
    expect(isDangerousTool("external.copyText")).toBe(true);
    expect(isDangerousTool("note.read")).toBe(false);

    expect(isReadOnlyTool("note.search")).toBe(true);
    expect(isReadOnlyTool("note.list")).toBe(true);
    expect(isReadOnlyTool("note.read")).toBe(true);
    expect(isReadOnlyTool("note.update")).toBe(false);
  });

  test("default permission policy confirms writes/web/external, not reads", () => {
    expect(requiresConfirmForTool("note.update", DEFAULT_AGENT_PERMISSION_POLICY)).toBe(true);
    expect(requiresConfirmForTool("note.create", DEFAULT_AGENT_PERMISSION_POLICY)).toBe(true);
    expect(requiresConfirmForTool("note.moveCategory", DEFAULT_AGENT_PERMISSION_POLICY)).toBe(true);
    expect(requiresConfirmForTool("web.search", DEFAULT_AGENT_PERMISSION_POLICY)).toBe(true);
    expect(requiresConfirmForTool("external.openUrl", DEFAULT_AGENT_PERMISSION_POLICY)).toBe(true);
    expect(requiresConfirmForTool("external.copyText", DEFAULT_AGENT_PERMISSION_POLICY)).toBe(true);
    expect(requiresConfirmForTool("note.read", DEFAULT_AGENT_PERMISSION_POLICY)).toBe(false);
    expect(requiresConfirmForTool("note.search", DEFAULT_AGENT_PERMISSION_POLICY)).toBe(false);
  });

  test("lenient policy skips confirmation for writes/web/external", () => {
    const lenient: AgentPermissionPolicy = {
      readWithoutConfirmation: true,
      writeBeforeConfirm: false,
      webSearchBeforeConfirm: false,
      externalBeforeConfirm: false,
    };
    expect(requiresConfirmForTool("note.update", lenient)).toBe(false);
    expect(requiresConfirmForTool("web.search", lenient)).toBe(false);
    expect(requiresConfirmForTool("external.copyText", lenient)).toBe(false);
  });

  test("read confirmation follows readWithoutConfirmation flag", () => {
    const strictRead: AgentPermissionPolicy = {
      ...DEFAULT_AGENT_PERMISSION_POLICY,
      readWithoutConfirmation: false,
    };
    expect(requiresConfirmForTool("note.search", strictRead)).toBe(true);
    expect(requiresConfirmForTool("note.read", strictRead)).toBe(true);
  });
});

describe("streaming tool call deltas", () => {
  test("extracts tool_calls delta from a frame", () => {
    const deltas = getStreamToolCallDelta({
      choices: [
        {
          delta: {
            tool_calls: [
              {
                index: 0,
                id: "call_1",
                type: "function",
                function: { name: "note.search", arguments: "" },
              },
            ],
          },
        },
      ],
    });
    expect(deltas).toEqual([{ index: 0, id: "call_1", name: "note.search", arguments: undefined }]);
  });

  test("returns null for frames without tool_calls", () => {
    expect(getStreamToolCallDelta({ choices: [{ delta: { content: "hi" } }] })).toBeNull();
    expect(getStreamToolCallDelta(null)).toBeNull();
    expect(getStreamToolCallDelta({})).toBeNull();
    expect(getStreamToolCallDelta({ choices: [] })).toBeNull();
  });

  test("merges argument fragments across chunks by index", () => {
    let calls: AgentToolCall[] = [];
    calls = mergeToolCallDelta(calls, [{ index: 0, id: "call_1", name: "note.search" }]);
    calls = mergeToolCallDelta(calls, [{ index: 0, arguments: '{"query":' }]);
    calls = mergeToolCallDelta(calls, [{ index: 0, arguments: '"周报"}' }]);
    calls = mergeToolCallDelta(calls, [{ index: 1, id: "call_2", name: "web.search" }]);
    calls = mergeToolCallDelta(calls, [{ index: 1, arguments: '{"query":"Tauri"}' }]);
    expect(calls).toEqual([
      { id: "call_1", name: "note.search", arguments: '{"query":"周报"}' },
      { id: "call_2", name: "web.search", arguments: '{"query":"Tauri"}' },
    ]);
  });
});

describe("tool argument parsing", () => {
  test("parses valid JSON arguments", () => {
    expect(parseToolArguments('{"query":"周报","limit":5}')).toEqual({ query: "周报", limit: 5 });
  });

  test("returns empty object for malformed JSON", () => {
    expect(parseToolArguments("not-json")).toEqual({});
    expect(parseToolArguments("")).toEqual({});
    expect(parseToolArguments('{"a":')).toEqual({});
  });
});

describe("assistant tool call message", () => {
  test("builds the assistant message with tool_calls for feeding back", () => {
    const message = buildAssistantToolCallMessage([
      { id: "call_1", name: "note.search", arguments: '{"query":"x"}' },
    ]);
    expect(message.role).toBe("assistant");
    expect(message.content).toBeNull();
    expect(message.tool_calls).toEqual([
      {
        id: "call_1",
        type: "function",
        function: { name: "note.search", arguments: '{"query":"x"}' },
      },
    ]);
  });
});
