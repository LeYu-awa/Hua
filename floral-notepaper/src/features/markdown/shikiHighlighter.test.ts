import { describe, expect, it } from "vitest";
import { highlightTokens, normalizeLanguage } from "./shikiHighlighter";

describe("shikiHighlighter", () => {
  it("TS 代码返回 One Dark Pro 标准 token 色值", async () => {
    const tokens = await highlightTokens("const greet = (name: string) => name;", "ts");
    expect(tokens).not.toBeNull();
    const flat = tokens!.flat();
    const keyword = flat.find((t) => t.content === "const");
    const type = flat.find((t) => t.content === "string");
    expect(keyword?.color?.toUpperCase()).toBe("#C678DD");
    expect(type?.color?.toUpperCase()).toBe("#E5C07B");
  });

  it("无语言/未知语言回退纯文本，不抛异常", async () => {
    const tokens = await highlightTokens("hello", "not-a-real-lang");
    expect(tokens).not.toBeNull();
  });

  it("normalizeLanguage 处理别名与信息串", () => {
    expect(normalizeLanguage("ts")).toBe("typescript");
    expect(normalizeLanguage("py")).toBe("python");
    expect(normalizeLanguage("sh")).toBe("bash");
    expect(normalizeLanguage("tsx?react")).toBe("tsx");
    expect(normalizeLanguage("unknown-lang")).toBe("plaintext");
    expect(normalizeLanguage(undefined)).toBe("plaintext");
    expect(normalizeLanguage("")).toBe("plaintext");
  });
});
