import { describe, expect, it } from "vitest";
import { buildContentVisual, summarizeContent } from "./contentVisualizer";

const SAMPLE = [
  "番茄工作法是一种简单有效的时间管理方法。",
  "它的核心是将工作时间切分为 25 分钟的专注段。",
  "每个专注段之间安排 5 分钟休息，称为番茄钟。",
  "关键在于：专注段内不做任何无关事情，避免被打断。",
  "研究表明，短周期节奏能显著提升专注力与产出。",
  "建议先从一个番茄钟开始，逐步适应后再增加。",
].join("\n");

describe("buildContentVisual", () => {
  it("空文本返回空结构", () => {
    const result = buildContentVisual("");
    expect(result.nodes).toHaveLength(0);
    expect(result.topic).toContain("空文本");
  });

  it("解析出主题节点与要点分支，并生成支持关系连线", () => {
    const result = buildContentVisual(SAMPLE);
    // 主题 + 最多 6 个要点
    expect(result.nodes.length).toBeGreaterThanOrEqual(2);
    expect(result.nodes[0].type).toBe("knowledge");
    expect(result.nodes[0].source).toBe("agent");
    expect(result.keyPoints.length).toBeGreaterThan(0);
    // 每个要点节点都有一条从主题出发的「要点」连线
    expect(result.edges.length).toBe(result.nodes.length - 1);
    for (const edge of result.edges) {
      expect(edge.fromNodeId).toBe(result.nodes[0].id);
      expect(edge.relationType).toBe("supports");
    }
    // 布局不重叠：节点坐标各不相同
    const coords = result.nodes.map((n) => `${n.x},${n.y}`);
    expect(new Set(coords).size).toBe(coords.length);
  });

  it("包含关键词语气的句子优先被保留（主题或要点）", () => {
    const text = "普通句子一句话。关键在于：这句话带关键词，必须被选中。";
    const result = buildContentVisual(text, 2);
    const kept = [result.topic, ...result.keyPoints].join("");
    expect(kept).toContain("关键");
  });
});

describe("summarizeContent", () => {
  it("输出主题 + 编号要点列表", () => {
    const summary = summarizeContent(SAMPLE, 3);
    expect(summary).toContain("主题：");
    expect(summary.split("\n").length).toBeGreaterThanOrEqual(2);
  });
});
