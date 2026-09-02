import { describe, expect, it } from "vitest";
import { buildArchitecturePatch, validateArchitecture, validateCanvasPatch } from "./archifyAdapter";
import type { ArchitectureIR, CanvasDocument } from "./types";

const canvas: CanvasDocument = { id: "canvas-1", nodes: [], edges: [], groups: [] };
const ir: ArchitectureIR = {
  schema_version: 1,
  diagram_type: "architecture",
  meta: { title: "订单平台" },
  components: [
    { id: "api", type: "backend", label: "API" },
    { id: "db", type: "database", label: "数据库", sublabel: "PostgreSQL" },
  ],
  boundaries: [{ kind: "region", label: "生产环境", wraps: ["api", "db"] }],
  connections: [{ from: "api", to: "db", label: "SQL", variant: "emphasis" }],
};

describe("Archify Architecture 最小兼容子集", () => {
  it("拒绝未知字段和悬空引用", () => {
    expect(validateArchitecture({ ...ir, extra: true })).toContain("不支持的字段: /extra");
    expect(validateArchitecture({ ...ir, connections: [{ from: "api", to: "missing" }] })).toContain("/connections/0/to 引用不存在");
  });

  it("将合法 IR 转为现有 Canvas 节点、边和分组", () => {
    const patch = buildArchitecturePatch(ir, canvas, ["doc-1"]);
    expect(patch.nodesToAdd.map((node) => node.source)).toEqual(["agent", "agent"]);
    expect(patch.nodesToAdd[1].type).toBe("resource");
    expect(patch.edgesToAdd[0]).toMatchObject({ fromNodeId: "arch-api", toNodeId: "arch-db", relationType: "related" });
    expect(patch.groupsToAdd[0].nodeIds).toEqual(["arch-api", "arch-db"]);
    expect(validateCanvasPatch(patch, canvas)).toEqual([]);
  });

  it("生成稳定的 Patch 和内部唯一 ID", () => {
    const first = buildArchitecturePatch(ir, canvas);
    const second = buildArchitecturePatch(ir, canvas);
    expect(second).toEqual(first);
    expect(new Set(first.edgesToAdd.map((edge) => edge.id)).size).toBe(first.edgesToAdd.length);
    expect(new Set(first.groupsToAdd.map((group) => group.id)).size).toBe(first.groupsToAdd.length);
  });

  it("按矩形而非左上角避让已有节点和 Patch 内节点", () => {
    const crowded = { ...canvas, nodes: [{ id: "existing", type: "idea" as const, x: 80, y: 80, width: 300, height: 180, text: "已有" }] };
    const patch = buildArchitecturePatch(ir, crowded);
    expect(patch.nodesToAdd.every((node) => node.x >= 380 || node.y >= 260)).toBe(true);
    expect(validateCanvasPatch(patch, crowded)).toEqual([]);
  });

  it("拒绝 Patch 内重复 ID 和矩形冲突", () => {
    const patch = buildArchitecturePatch(ir, canvas);
    const duplicate = { ...patch, nodesToAdd: [patch.nodesToAdd[0], { ...patch.nodesToAdd[1], id: patch.nodesToAdd[0].id }] };
    expect(validateCanvasPatch(duplicate, canvas)).toContain(`节点 ID 冲突: ${patch.nodesToAdd[0].id}`);
    const overlap = { ...patch, nodesToAdd: patch.nodesToAdd.map((node) => ({ ...node, x: 0, y: 0 })) };
    expect(validateCanvasPatch(overlap, canvas)).toContain(`节点矩形冲突: ${overlap.nodesToAdd[0].id}`);
  });
});
