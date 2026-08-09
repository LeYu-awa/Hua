import { describe, expect, it } from "vitest";
import {
  approxCharWidth,
  buildCanvasSvg,
  charsFit,
  layoutNoteLines,
  wrapText,
  wrapTextByPixels,
} from "./canvasExport";
import type { CanvasDocument } from "./types";

const doc: CanvasDocument = {
  id: "canvas-test",
  noteId: null,
  nodes: [
    {
      id: "n1",
      type: "text",
      x: 100,
      y: 200,
      width: 200,
      height: 80,
      text: "花箴项目里程碑",
      zIndex: 1,
      source: undefined,
    },
    {
      id: "n2",
      type: "text",
      x: 400,
      y: 220,
      width: 240,
      height: 96,
      text: "实现画布导出 PNG",
      zIndex: 2,
      source: undefined,
    },
  ],
  edges: [
    { id: "e1", fromNodeId: "n1", toNodeId: "n2", style: "dashed" },
  ],
};

describe("wrapText", () => {
  it("超出长度按字符折行", () => {
    expect(wrapText("abcdefgh", 4)).toEqual(["abcd", "efgh"]);
  });
  it("换行符强制断行", () => {
    expect(wrapText("ab\ncd", 4)).toEqual(["ab", "cd"]);
  });
  it("limit 下限为 1", () => {
    expect(wrapText("abc", 0)).toEqual(["a", "b", "c"]);
  });
});

describe("approxCharWidth / charsFit / wrapTextByPixels（保真折行）", () => {
  it("CJK 全角 ≈ 字号，ASCII 减半", () => {
    expect(approxCharWidth("画", 14)).toBe(14);
    expect(approxCharWidth("a", 14)).toBeCloseTo(7.7);
  });
  it("charsFit 按像素宽累计", () => {
    // 14px 字号下 "abc" (ASCII ≈7.7) = 23.1 < 30，"d" 追加会超 → 3
    expect(charsFit("abcd", 30, 14)).toBe(3);
  });
  it("混合中英按像素折行，行内容与原文无损拼接", () => {
    const lines = wrapTextByPixels("你好hello世界", 60, 14);
    expect(lines.join("")).toBe("你好hello世界");
    expect(lines.length).toBeGreaterThan(1);
  });
});

describe("buildCanvasSvg（导出保真源）", () => {
  it("保留节点文本与 XML 转义", () => {
    const svg = buildCanvasSvg({
      ...doc,
      nodes: [{ ...doc.nodes[0], text: "A <B> & \"C\"" }, doc.nodes[1]],
    });
    expect(svg).toContain("A &lt;B&gt; &amp; &quot;C&quot;");
    // 其余节点原文不受影响
    expect(svg).toContain("实现画布导出 PNG");
  });

  it("保留节点坐标/尺寸（世界坐标 + 偏移还原）", () => {
    const svg = buildCanvasSvg(doc);
    // minX=100 minY=200 → offset=(40-100, 40-200)=(-60,-160)
    // n1 (100,200,200x80) → 导出坐标 (40,40)
    expect(svg).toContain('<rect x="40" y="40" width="200" height="80"');
    // n2 (400,220,240x96) → (340,60)
    expect(svg).toContain('<rect x="340" y="60" width="240" height="96"');
  });

  it("保留连线且虚线样式透传", () => {
    const svg = buildCanvasSvg(doc);
    // n1 中心 (200,240) + 偏移 (-60,-160) → (140,80)
    // n2 中心 (520,268) + 偏移 → (460,108)
    expect(svg).toContain('<line x1="140" y1="80" x2="460" y2="108"');
    expect(svg).toContain('stroke-dasharray="6 4"');
  });

  it("根尺寸覆盖全部节点边界（含 40px 内边距）", () => {
    const svg = buildCanvasSvg(doc);
    // minX=100 minY=200 maxX=640 maxY=316 → 宽 = 640-100+80 = 620，高 = 316-200+80 = 196
    expect(svg).toContain('width="620" height="196"');
    expect(svg).toContain('viewBox="0 0 620 196"');
  });

  it("空画布返回最小白底 SVG", () => {
    const svg = buildCanvasSvg({ id: "x", noteId: null, nodes: [], edges: [] });
    expect(svg).toContain("<svg");
    expect(svg).toContain('fill="#ffffff"');
  });

  it("zIndex 升序渲染：后序节点在后（上层）", () => {
    const svg = buildCanvasSvg(doc);
    const i1 = svg.indexOf('width="200" height="80"'); // n1 (z1)
    const i2 = svg.indexOf('width="240" height="96"'); // n2 (z2)
    expect(i1).toBeGreaterThan(-1);
    expect(i2).toBeGreaterThan(-1);
    expect(i1).toBeLessThan(i2);
  });
});

describe("layoutNoteLines（笔记 PNG 排版）", () => {
  it("标题与正文分别折行且无损", () => {
    const { titleLines, bodyLines } = layoutNoteLines("导出说明", "这是正文内容", 60, 14);
    expect(titleLines.join("")).toBe("导出说明");
    expect(bodyLines.join("")).toBe("这是正文内容");
    expect(titleLines.length).toBeGreaterThan(0);
  });
  it("空标题回退默认名", () => {
    const { titleLines } = layoutNoteLines("", "内容", 60, 14);
    expect(titleLines.join("")).toBe("未命名笔记");
  });
  it("长文本按像素宽折成多行", () => {
    const { bodyLines } = layoutNoteLines("t", "一二三四五六七八九十".repeat(5), 100, 14);
    expect(bodyLines.length).toBeGreaterThan(5);
  });
});
