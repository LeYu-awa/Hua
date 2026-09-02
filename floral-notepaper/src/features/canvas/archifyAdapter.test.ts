import { describe, expect, it } from "vitest";
import { buildArchitecturePatch, buildDataflowPatch, buildDiagramPatch, buildLifecyclePatch, validateArchitecture, validateCanvasPatch, validateDataflow, validateDiagram, validateLifecycle } from "./archifyAdapter";
import type { ArchitectureIR, CanvasDocument, DataflowIR, LifecycleIR } from "./types";

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

const dataflowIr: DataflowIR = {
  schema_version: 1,
  diagram_type: "dataflow",
  meta: { title: "下单" },
  stages: [{ label: "端上" }, { label: "服务端" }],
  nodes: [
    { id: "ui", type: "frontend", label: "下单页", stage: 0, row: 0 },
    { id: "api", type: "backend", label: "订单服务", stage: 1, row: 0 },
    { id: "db", type: "database", label: "订单库", stage: 1, row: 1 },
  ],
  flows: [
    { from: "ui", to: "api", label: "订单数据" },
    { from: "api", to: "db", label: "落库" },
  ],
};

const lifecycleIr: LifecycleIR = {
  schema_version: 1,
  diagram_type: "lifecycle",
  meta: { title: "订单状态" },
  lanes: [
    { id: "sys", label: "系统" },
    { id: "usr", label: "用户" },
  ],
  states: [
    { id: "created", type: "active", label: "已创建", lane: "sys", col: 0 },
    { id: "paid", type: "waiting", label: "已支付", lane: "sys", col: 1 },
    { id: "refund", type: "failure", label: "已退款", lane: "usr", col: 0 },
  ],
  transitions: [
    { from: "created", to: "paid", label: "支付成功" },
    { from: "paid", to: "refund", variant: "dashed" },
  ],
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

describe("Archify Dataflow 最小兼容子集", () => {
  it("拒绝阶段越界、空 label 和悬空引用", () => {
    expect(validateDataflow({ ...dataflowIr, extra: true })).toContain("不支持的字段: /extra");
    expect(validateDataflow({ ...dataflowIr, nodes: dataflowIr.nodes.map((node, index) => (index === 0 ? { ...node, stage: 9 } : node)) })).toContain("/nodes/0/stage 超出阶段范围");
    expect(validateDataflow({ ...dataflowIr, flows: [{ from: "ui", to: "missing", label: "x" }] })).toContain("/flows/0/to 引用不存在");
    expect(validateDataflow({ ...dataflowIr, flows: [{ from: "ui", to: "api", label: "" }] })).toContain("/flows/0/label 必须为非空字符串");
  });

  it("将合法 IR 转为 df- 前缀节点、连线和按阶段分组", () => {
    const patch = buildDataflowPatch(dataflowIr, canvas, ["doc-1"]);
    expect(patch.diagramType).toBe("dataflow");
    expect(patch.nodesToAdd.map((node) => node.id)).toEqual(["df-ui", "df-api", "df-db"]);
    expect(patch.nodesToAdd[2].type).toBe("resource");
    expect(patch.nodesToAdd[0]).toMatchObject({ x: 80, y: 80 });
    expect(patch.nodesToAdd[1]).toMatchObject({ x: 320, y: 80 });
    expect(patch.nodesToAdd[2]).toMatchObject({ x: 320, y: 230 });
    expect(patch.edgesToAdd[0]).toMatchObject({ fromNodeId: "df-ui", toNodeId: "df-api", label: "订单数据" });
    expect(patch.groupsToAdd.map((group) => group.title)).toEqual(["端上", "服务端"]);
    expect(patch.groupsToAdd[1].nodeIds).toEqual(["df-api", "df-db"]);
    expect(validateCanvasPatch(patch, canvas)).toEqual([]);
  });

  it("生成稳定的 Patch 与唯一内部 ID", () => {
    const first = buildDataflowPatch(dataflowIr, canvas);
    expect(buildDataflowPatch(dataflowIr, canvas)).toEqual(first);
    expect(new Set(first.edgesToAdd.map((edge) => edge.id)).size).toBe(first.edgesToAdd.length);
    expect(new Set(first.groupsToAdd.map((group) => group.id)).size).toBe(first.groupsToAdd.length);
  });
});

describe("Archify Lifecycle 最小兼容子集", () => {
  it("拒绝泳道悬空、非法类型与 col 越界", () => {
    expect(validateLifecycle({ ...lifecycleIr, states: lifecycleIr.states.map((state, index) => (index === 0 ? { ...state, lane: "ghost" } : state)) })).toContain("/states/0/lane 引用不存在");
    expect(validateLifecycle({ ...lifecycleIr, states: lifecycleIr.states.map((state, index) => (index === 0 ? { ...state, type: "bogus" } : state)) })).toContain("/states/0/type 无效");
    expect(validateLifecycle({ ...lifecycleIr, states: lifecycleIr.states.map((state, index) => (index === 0 ? { ...state, col: 9 } : state)) })).toContain("/states/0/col 需在 0-4");
  });

  it("将合法 IR 转为 lc- 前缀节点、泳道分组和虚线边", () => {
    const patch = buildLifecyclePatch(lifecycleIr, canvas, ["doc-1"]);
    expect(patch.diagramType).toBe("lifecycle");
    expect(patch.nodesToAdd.map((node) => node.id)).toEqual(["lc-created", "lc-paid", "lc-refund"]);
    expect(patch.nodesToAdd[0]).toMatchObject({ x: 80, y: 80 });
    expect(patch.nodesToAdd[1]).toMatchObject({ x: 320, y: 80 });
    expect(patch.nodesToAdd[2]).toMatchObject({ x: 80, y: 230 });
    expect(patch.groupsToAdd.map((group) => group.title)).toEqual(["系统", "用户"]);
    expect(patch.groupsToAdd[0].nodeIds).toEqual(["lc-created", "lc-paid"]);
    expect(patch.edgesToAdd[1]).toMatchObject({ fromNodeId: "lc-paid", toNodeId: "lc-refund", style: "dashed" });
    expect(validateCanvasPatch(patch, canvas)).toEqual([]);
  });

  it("边文案取 label ?? note，生成稳定 Patch", () => {
    const noted = { ...lifecycleIr, transitions: [{ from: "created", to: "paid", note: "自动" }] } as LifecycleIR;
    const patch = buildLifecyclePatch(noted, canvas);
    expect(patch.edgesToAdd[0].label).toBe("自动");
    expect(buildLifecyclePatch(lifecycleIr, canvas)).toEqual(buildLifecyclePatch(lifecycleIr, canvas));
  });
});

describe("统一分派 validateDiagram / buildDiagramPatch", () => {
  it("按 diagram_type 路由到对应校验器", () => {
    expect(validateDiagram(dataflowIr)).toEqual([]);
    expect(validateDiagram(lifecycleIr)).toEqual([]);
    expect(validateDiagram(ir)).toEqual([]);
    expect(validateDiagram({ ...ir, diagram_type: "flowchart" }).some((message) => message.includes("diagram_type 必须为 architecture / dataflow / lifecycle"))).toBe(true);
  });

  it("按 diagram_type 路由到对应建图器且结果稳定", () => {
    expect(buildDiagramPatch(dataflowIr, canvas).diagramType).toBe("dataflow");
    expect(buildDiagramPatch(lifecycleIr, canvas).diagramType).toBe("lifecycle");
    expect(buildDiagramPatch(ir, canvas).diagramType).toBe("architecture");
    expect(buildDiagramPatch(dataflowIr, canvas)).toEqual(buildDataflowPatch(dataflowIr, canvas));
  });
});
