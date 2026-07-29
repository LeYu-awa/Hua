import { describe, expect, it } from "vitest";
import { formatMarkdownSelection, pinTileButtonTitle } from "./markdownCommands";
import type { FormatAction, FormatLabels } from "./markdownCommands";

const labels: FormatLabels = {
  boldText: "粗体文本",
  italicText: "斜体文本",
  headingText: "标题",
  listItem: "列表项",
  codeText: "代码",
  quoteText: "引用文本",
};

function format(value: string, action: FormatAction, selectionStart = 0, selectionEnd = value.length) {
  return formatMarkdownSelection({ value, action, selectionStart, selectionEnd, labels });
}

describe("markdownCommands", () => {
  it("wraps inline selections", () => {
    expect(format("abc", "bold").value).toBe("**abc**");
    expect(format("abc", "italic").value).toBe("*abc*");
    expect(format("abc", "inlineMath").value).toBe("$abc$");
  });

  it("uses localized fallback text when no selection exists", () => {
    const result = format("", "bold", 0, 0);

    expect(result.value).toBe("**粗体文本**");
    expect(result.selectionStart).toBe(2);
    expect(result.selectionEnd).toBe(6);
  });

  it("formats multiline lists and quotes", () => {
    expect(format("a\nb", "ul").value).toBe("- a\n- b");
    expect(format("a\nb", "ol").value).toBe("1. a\n2. b");
    expect(format("a\nb", "quote").value).toBe("> a\n> b");
  });

  it("cycles existing heading levels", () => {
    const result = format("## title", "heading", 3, 8);

    expect(result.value).toBe("### title");
    expect(result.selectionStart).toBe(4);
    expect(result.selectionEnd).toBe(9);
  });

  it("formats block code and block math", () => {
    expect(format("a\nb", "code").value).toBe("```\na\nb\n```");
    expect(format("x", "blockMath").value).toBe("\n$$\nx\n$$\n");
  });

  it("returns pin tile labels", () => {
    expect(pinTileButtonTitle(true)).toBe("取消钉屏");
    expect(pinTileButtonTitle(false)).toBe("钉到屏幕");
  });
});
