// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { CANVAS_TEMPLATES, getTemplateById } from "./templates";

describe("场景化快速入门模板（ob-2）", () => {
  it("提供头脑风暴/项目规划/笔记整理三类模板", () => {
    const ids = CANVAS_TEMPLATES.map((template) => template.id);
    expect(ids).toEqual(["brainstorming", "project-planning", "notes"]);
  });

  it("每个模板都包含预设卡片组（节点）与连线、场景教程", () => {
    for (const template of CANVAS_TEMPLATES) {
      expect(template.document.nodes.length).toBeGreaterThan(3);
      expect(template.tutorial.length).toBeGreaterThan(0);
      expect(template.desc.length).toBeGreaterThan(0);
      // 连线两端必须指向存在的节点
      const ids = new Set(template.document.nodes.map((node) => node.id));
      for (const edge of template.document.edges) {
        expect(ids.has(edge.fromNodeId)).toBe(true);
        expect(ids.has(edge.toNodeId)).toBe(true);
      }
    }
  });

  it("模板节点有合法坐标与尺寸（不产生 NaN）", () => {
    for (const template of CANVAS_TEMPLATES) {
      for (const node of template.document.nodes) {
        expect(Number.isFinite(node.x)).toBe(true);
        expect(Number.isFinite(node.y)).toBe(true);
        expect(node.width).toBeGreaterThan(0);
        expect(node.height).toBeGreaterThan(0);
      }
    }
  });

  it("getTemplateById 可查询到模板", () => {
    expect(getTemplateById("brainstorming")?.title).toBe("头脑风暴");
    expect(getTemplateById("unknown")).toBeUndefined();
  });
});
