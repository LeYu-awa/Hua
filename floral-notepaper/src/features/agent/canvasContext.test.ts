import { describe, expect, it } from "vitest";
import { buildCanvasContext } from "./canvasContext";

describe("buildCanvasContext", () => {
  it("无节点时返回空上下文（可降级）", () => {
    const r = buildCanvasContext([]);
    expect(r.contextText).toBe("");
    expect(r.referencedNodes).toEqual([]);
  });

  it("过滤空白节点", () => {
    const r = buildCanvasContext([
      { id: "a", text: "   " },
      { id: "b", text: "人物关系：A 与 B 的冲突" },
    ]);
    expect(r.referencedNodes).toHaveLength(1);
    expect(r.referencedNodes[0].id).toBe("b");
    expect(r.contextText).toContain("A 与 B 的冲突");
  });

  it("按文本长度降序取前 maxNodes 个", () => {
    const nodes = [
      { id: "s", text: "短" },
      { id: "m", text: "中等长度的一段设定内容" },
      { id: "l", text: "这是最长的一段，包含最多的信息量与背景交代细节" },
    ];
    const r = buildCanvasContext(nodes, { maxNodes: 2 });
    expect(r.referencedNodes.map((n) => n.id)).toEqual(["l", "m"]);
  });

  it("超长文本按 maxCharsPerNode 截断", () => {
    const long = "字".repeat(300);
    const r = buildCanvasContext([{ id: "a", text: long }], { maxCharsPerNode: 50 });
    expect(r.referencedNodes[0].text.endsWith("…")).toBe(true);
    expect(r.referencedNodes[0].text.length).toBeLessThanOrEqual(51);
  });
});
