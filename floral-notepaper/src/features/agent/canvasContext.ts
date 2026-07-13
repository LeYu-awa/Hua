// 共笔画布上下文注入（issue 场景八）
// 把画布节点摘要成一段可注入共笔 Prompt 的上下文，并返回被引用的节点清单
// 供 UI 展示「已参考画布节点」，保证 AI 输出可追溯到画布设定。
//
// 纯函数、无网络依赖，可降级：无节点时返回空上下文。

export interface CanvasContextNode {
  id: string;
  text: string;
}

export interface CanvasContextResult {
  /** 注入 Prompt 的上下文文本（无可用节点时为空串） */
  contextText: string;
  /** 实际被引用的节点（用于 UI 展示来源） */
  referencedNodes: CanvasContextNode[];
}

/**
 * 从画布节点构造共笔上下文。
 * - 过滤空文本节点
 * - 按文本长度降序取信息量最高的前 maxNodes 个（简单的信息密度启发式）
 * - 每条截断到 maxCharsPerNode，避免 Prompt 过长
 */
export function buildCanvasContext(
  nodes: CanvasContextNode[],
  options: { maxNodes?: number; maxCharsPerNode?: number } = {},
): CanvasContextResult {
  const maxNodes = options.maxNodes ?? 6;
  const maxCharsPerNode = options.maxCharsPerNode ?? 120;

  const valid = nodes
    .map((n) => ({ id: n.id, text: n.text.trim() }))
    .filter((n) => n.text.length > 0);

  if (valid.length === 0) {
    return { contextText: "", referencedNodes: [] };
  }

  const referenced = [...valid]
    .sort((a, b) => b.text.length - a.text.length)
    .slice(0, maxNodes)
    .map((n) => ({
      id: n.id,
      text: n.text.length > maxCharsPerNode ? n.text.slice(0, maxCharsPerNode) + "…" : n.text,
    }));

  const lines = referenced.map((n, i) => `${i + 1}. ${n.text.replace(/\n+/g, " ")}`);
  const contextText = `参考画布上的相关设定（请自然融入，不必逐条照搬）：\n${lines.join("\n")}`;

  return { contextText, referencedNodes: referenced };
}
