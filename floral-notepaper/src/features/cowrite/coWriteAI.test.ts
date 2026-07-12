import { describe, expect, it, vi } from "vitest";
import { requestCoWriteAITurn, regenerateCoWriteAITurn, generateInspirations } from "./coWriteAI";
import type { CoWriteSession } from "./types";
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

const createSession = (blocks: CoWriteSession["blocks"] = []): CoWriteSession => ({
  id: "s1",
  noteId: "n1",
  identity: "continuator",
  blocks,
  createdAt: "2024-01-01T00:00:00Z",
  updatedAt: "2024-01-01T00:00:00Z",
});

describe("requestCoWriteAITurn", () => {
  it("calls the DeepSeek-compatible API and returns trimmed content", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: "  AI generated reply  " } }],
      }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const providers = [createProvider()];
    const session = createSession();

    const result = await requestCoWriteAITurn(session, "continuator", undefined, providers);

    expect(result).toBe("AI generated reply");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.example.com/v1/chat/completions");

    const body = JSON.parse(options.body as string);
    expect(body.model).toBe("model-1");
    expect(body.stream).toBe(false);
    expect(body.temperature).toBe(0.8);
    expect(body.max_tokens).toBe(500);
    expect(body.messages).toHaveLength(2);
    expect(body.messages[0].role).toBe("system");
    expect(body.messages[1].role).toBe("user");
  });

  it("prefers a provider whose name contains deepseek", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: "ok" } }] }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const providers = [
      createProvider({
        id: "other",
        name: "Other",
        models: [{ modelId: "m-other", displayName: "Other" }],
      }),
      createProvider({
        id: "deepseek",
        name: "My DeepSeek",
        models: [{ modelId: "m-ds", displayName: "DS" }],
      }),
    ];

    await requestCoWriteAITurn(createSession(), "continuator", undefined, providers);

    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(options.body as string);
    expect(body.model).toBe("m-ds");
  });

  it("throws when no enabled provider is available", async () => {
    await expect(
      requestCoWriteAITurn(createSession(), "continuator", undefined, []),
    ).rejects.toThrow("没有可用的 AI 供应商");
  });

  it("throws on non-ok response", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => "Unauthorized",
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    await expect(
      requestCoWriteAITurn(createSession(), "continuator", undefined, [createProvider()]),
    ).rejects.toThrow("AI 响应错误 (401): Unauthorized");
  });

  it("accepts custom temperature", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: "ok" } }] }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    await requestCoWriteAITurn(createSession(), "continuator", undefined, [createProvider()], 1.2);

    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(options.body as string);
    expect(body.temperature).toBe(1.2);
  });
});

describe("regenerateCoWriteAITurn", () => {
  it("appends regenerate suffix and uses temperature 1.0", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: "new version" } }] }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const session = createSession([
      { author: "human", text: "你好", timestamp: 1 },
      { author: "ai", text: "旧的回复", timestamp: 2 },
    ]);

    await regenerateCoWriteAITurn(session, "continuator", undefined, [createProvider()]);

    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(options.body as string);
    expect(body.temperature).toBe(1.0);
    expect(body.messages[body.messages.length - 1].content).toContain("换一种写法：");
  });
});

describe("generateInspirations", () => {
  it("returns 3 inspirations parsed from JSON", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [
          {
            message: {
              content: `[{"title":"回忆","snippet":"那天下午的阳光……"},{"title":"冲突","snippet":"他突然停下脚步——"},{"title":"细节","snippet":"桌角的咖啡已经凉了。"}]`,
            },
          },
        ],
      }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await generateInspirations("笔记内容", [createProvider()]);

    expect(result).toHaveLength(3);
    expect(result[0]).toHaveProperty("title");
    expect(result[0]).toHaveProperty("snippet");
  });

  it("parses JSON inside markdown code block", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [
          {
            message: {
              content:
                '```json\n[{"title":"A","snippet":"a"},{"title":"B","snippet":"b"},{"title":"C","snippet":"c"}]\n```',
            },
          },
        ],
      }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await generateInspirations("", [createProvider()]);
    expect(result).toHaveLength(3);
    expect(result[2].title).toBe("C");
  });
});
