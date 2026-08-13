import { afterEach, describe, expect, it, vi } from "vitest";
import { composeDiaryContent, composeFromFallback, makeTitle } from "./composeDiaryContent";
import type { DiarySourceMessage } from "./composeDiaryContent";
import type { ProviderConfig } from "../settings/types";

const createProvider = (overrides?: Partial<ProviderConfig>): ProviderConfig => ({
  id: "ds",
  enabled: true,
  name: "DeepSeek",
  protocol: "openai",
  apiKey: "sk-test",
  baseUrl: "https://api.example.com",
  apiPath: "/v1/chat/completions",
  models: [{ modelId: "model-1", displayName: "Model 1" }],
  ...overrides,
});

const messages: DiarySourceMessage[] = [
  { role: "user", content: "今天想到一个角色动机：她害怕被忘记。", createdAt: 1 },
  { role: "assistant", content: "这个动机很有张力，可以往「失去记忆」的方向展开。", createdAt: 2 },
  { role: "user", content: "对，还想写雨夜车站重逢的场景。", createdAt: 3 },
];

describe("composeDiaryContent", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("uses LLM to compose when a provider is available", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: " 今天聊了角色动机和雨夜重逢。 " } }],
      }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await composeDiaryContent(messages, [createProvider()]);

    expect(result.usedFallback).toBe(false);
    expect(result.content).toBe("今天聊了角色动机和雨夜重逢。");
    expect(result.title).toBe("今天想到一个角色动机：她害怕被忘记。");

    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.example.com/v1/chat/completions");
    const body = JSON.parse(options.body as string);
    expect(body.model).toBe("model-1");
    expect(body.messages).toHaveLength(2);
    expect(body.messages[0].role).toBe("system");
  });

  it("falls back to transcript when no provider is enabled", async () => {
    const result = await composeDiaryContent(messages, []);

    expect(result.usedFallback).toBe(true);
    expect(result.content).toContain("我：今天想到一个角色动机");
    expect(result.content).toContain("花灵：这个动机很有张力");
  });

  it("falls back when the LLM call fails", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("network down"));
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await composeDiaryContent(messages, [createProvider()]);

    expect(result.usedFallback).toBe(true);
    expect(result.content).toContain("我：今天想到一个角色动机");
  });

  it("falls back when the LLM returns an empty reply", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: "   " } }] }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await composeDiaryContent(messages, [createProvider()]);

    expect(result.usedFallback).toBe(true);
  });

  it("skips empty messages in the transcript", async () => {
    const result = composeFromFallback([
      { role: "user", content: "  ", createdAt: 1 },
      { role: "user", content: "有效内容", createdAt: 2 },
    ]);

    expect(result.content).toBe("我：有效内容");
    expect(result.content).not.toContain("花灵：");
  });

  it("truncates long fallback messages", async () => {
    const long = "长".repeat(500);
    const result = composeFromFallback([{ role: "user", content: long, createdAt: 1 }]);

    expect(result.content.length).toBeLessThan(300);
    expect(result.content).toContain("…");
  });
});

describe("makeTitle", () => {
  it("uses the first non-empty user message", () => {
    expect(makeTitle(messages)).toBe("今天想到一个角色动机：她害怕被忘记。");
  });

  it("strips markdown heading markers", () => {
    expect(makeTitle([{ role: "user", content: "## 雨夜车站", createdAt: 1 }])).toBe("雨夜车站");
  });

  it("falls back when there is no user content", () => {
    expect(
      makeTitle([
        { role: "assistant", content: "你好", createdAt: 1 },
        { role: "user", content: "  ", createdAt: 2 },
      ]),
    ).toBe("今天的记录");
  });
});
