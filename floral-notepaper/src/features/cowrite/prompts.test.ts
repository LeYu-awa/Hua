import { describe, expect, it } from "vitest";
import {
  IDENTITY_PRESETS,
  SCENARIO_PRESETS,
  getScenario,
  getSystemPrompt,
  buildCoWriteMessages,
} from "./prompts";
import type { CoWriteSession } from "./types";

describe("cowrite prompts", () => {
  it("has 5 identity presets", () => {
    expect(IDENTITY_PRESETS).toHaveLength(5);
    expect(IDENTITY_PRESETS.map((p) => p.key)).toEqual([
      "continuator",
      "questioner",
      "opposer",
      "poetic",
      "custom",
    ]);
  });

  it("returns custom prompt when identity is custom", () => {
    const custom = "你是我的专属写作助手";
    expect(getSystemPrompt("custom", custom)).toBe(custom);
  });

  it("falls back to continuator when identity is unknown", () => {
    const fallback = getSystemPrompt("continuator");
    expect(getSystemPrompt("unknown" as any)).toBe(fallback);
  });

  it("builds messages with system and user roles for empty session", () => {
    const session: CoWriteSession = {
      id: "1",
      noteId: "n1",
      identity: "continuator",
      blocks: [],
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-01T00:00:00Z",
    };
    const messages = buildCoWriteMessages(session, "continuator");
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe("system");
    expect(messages[1].role).toBe("user");
    expect(messages[1].content).toBe("开始写第一段吧。");
  });

  it("tags blocks with human/ai authors in user message", () => {
    const session: CoWriteSession = {
      id: "1",
      noteId: "n1",
      identity: "questioner",
      blocks: [
        { author: "human", text: "今天天气很好。", timestamp: 1 },
        { author: "ai", text: "适合出去走走。", timestamp: 2 },
      ],
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-01T00:00:00Z",
    };
    const messages = buildCoWriteMessages(session, "questioner");
    expect(messages[1].content).toContain("<human>今天天气很好。</human>");
    expect(messages[1].content).toContain("<ai>适合出去走走。</ai>");
  });

  it("has 4 scenario presets", () => {
    expect(SCENARIO_PRESETS).toHaveLength(4);
    expect(SCENARIO_PRESETS.map((s) => s.key)).toEqual(["letter", "story", "debate", "diary"]);
  });

  it("looks up scenario by key", () => {
    const story = getScenario("story");
    expect(story).toBeDefined();
    expect(story?.label).toBe("故事接龙");
    expect(story?.identity).toBe("continuator");
    expect(story?.openingLine).toBeTruthy();
  });

  it("uses customPrompt for non-custom identity when provided", () => {
    const scenarioPrompt = "你正在一起写书信。";
    expect(getSystemPrompt("continuator", scenarioPrompt)).toBe(scenarioPrompt);
  });
});
