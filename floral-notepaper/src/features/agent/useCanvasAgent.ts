// 画布 Agent 交互 Hook（issue 场景一/二/三）
// 把三个纯分析器（隐含连接 / 语义空白区 / 共识分歧）统一封装成 React 状态，
// 供 CanvasPage 渲染「可观察、可忽略、可追溯、可降级」的覆盖层。
//
// 设计原则（对齐 issue §18）：
// - 可降级：无 embedding / 分析失败时，结果为空/null，UI 静默不报错。
// - 可忽略：每类结果都有 dismiss，忽略后不再展示。
// - 不打扰：分析由用户显式触发（工具栏按钮），不做后台轮询。
// - 能复用：本 Hook 只依赖已测过的分析器，不含 UI。

import { useCallback, useMemo, useState } from "react";
import type { ProviderConfig } from "../settings/types";
import type { CanvasNode, CanvasEdge } from "../canvas/types";
import {
  findImplicitConnections,
  type ImplicitConnection,
} from "./connectionRecommendations";
import { detectSemanticGaps, type SemanticGapResult } from "./semanticGap";
import { detectConsensus, type ConsensusResult } from "./consensus";
import { pairKey } from "./ruleEngine";

export type CanvasAgentKind = "connection" | "gap" | "discussion";

export interface CanvasAgentState {
  /** 隐含连接建议（去掉已忽略的） */
  connections: ImplicitConnection[];
  /** 语义空白区结果 */
  gap: SemanticGapResult | null;
  /** 共识/分歧结果 */
  discussion: ConsensusResult | null;
  /** 各分析器加载态 */
  loading: Record<CanvasAgentKind, boolean>;
  /** 各分析器「已运行但无结果」提示（用于给用户反馈，而非静默） */
  emptyHint: Record<CanvasAgentKind, boolean>;
}

export interface CanvasAgentApi extends CanvasAgentState {
  runConnections: (nodes: CanvasNode[], edges: CanvasEdge[]) => Promise<void>;
  runGap: (nodes: CanvasNode[]) => Promise<void>;
  runDiscussion: (topic: string, nodes: CanvasNode[]) => Promise<void>;
  dismissConnection: (sourceId: string, targetId: string) => void;
  dismissGap: () => void;
  dismissDiscussion: () => void;
  /** 画布结构变化（增删节点）时清空过期建议 */
  clearAll: () => void;
}

const NO_LOADING: Record<CanvasAgentKind, boolean> = {
  connection: false,
  gap: false,
  discussion: false,
};

/**
 * 画布 Agent 交互状态机。providers 为空或 enabled=false 时，所有 run* 都安全返回空。
 */
export function useCanvasAgent(
  providers: ProviderConfig[],
  enabled: boolean,
): CanvasAgentApi {
  const [rawConnections, setRawConnections] = useState<ImplicitConnection[]>([]);
  const [gap, setGap] = useState<SemanticGapResult | null>(null);
  const [discussion, setDiscussion] = useState<ConsensusResult | null>(null);
  const [loading, setLoading] = useState<Record<CanvasAgentKind, boolean>>(NO_LOADING);
  const [emptyHint, setEmptyHint] = useState<Record<CanvasAgentKind, boolean>>({
    connection: false,
    gap: false,
    discussion: false,
  });
  // 已忽略的连接对（顺序无关 key）
  const [dismissedPairs, setDismissedPairs] = useState<Set<string>>(() => new Set());

  const setLoad = useCallback((kind: CanvasAgentKind, v: boolean) => {
    setLoading((prev) => ({ ...prev, [kind]: v }));
  }, []);
  const setEmpty = useCallback((kind: CanvasAgentKind, v: boolean) => {
    setEmptyHint((prev) => ({ ...prev, [kind]: v }));
  }, []);

  const ready = enabled && providers.length > 0;

  const runConnections = useCallback(
    async (nodes: CanvasNode[], edges: CanvasEdge[]) => {
      if (!ready) return;
      setLoad("connection", true);
      setEmpty("connection", false);
      try {
        const result = await findImplicitConnections(
          nodes.map((n) => ({ id: n.id, text: n.text, x: n.x, y: n.y })),
          edges.map((e) => ({ fromNodeId: e.fromNodeId, toNodeId: e.toNodeId })),
          providers,
        );
        setRawConnections(result);
        setEmpty("connection", result.length === 0);
      } catch {
        setRawConnections([]);
        setEmpty("connection", true);
      } finally {
        setLoad("connection", false);
      }
    },
    [ready, providers, setLoad, setEmpty],
  );

  const runGap = useCallback(
    async (nodes: CanvasNode[]) => {
      if (!ready) return;
      setLoad("gap", true);
      setEmpty("gap", false);
      try {
        const result = await detectSemanticGaps(
          nodes.map((n) => ({ id: n.id, text: n.text, x: n.x, y: n.y })),
          providers,
        );
        setGap(result);
        setEmpty("gap", result === null);
      } catch {
        setGap(null);
        setEmpty("gap", true);
      } finally {
        setLoad("gap", false);
      }
    },
    [ready, providers, setLoad, setEmpty],
  );

  const runDiscussion = useCallback(
    async (topic: string, nodes: CanvasNode[]) => {
      if (!ready) return;
      setLoad("discussion", true);
      setEmpty("discussion", false);
      try {
        const result = await detectConsensus(
          topic,
          nodes.map((n) => ({ id: n.id, text: n.text, authorId: n.source ?? "user" })),
          providers,
        );
        setDiscussion(result);
        setEmpty("discussion", result === null);
      } catch {
        setDiscussion(null);
        setEmpty("discussion", true);
      } finally {
        setLoad("discussion", false);
      }
    },
    [ready, providers, setLoad, setEmpty],
  );

  const dismissConnection = useCallback((sourceId: string, targetId: string) => {
    setDismissedPairs((prev) => {
      const next = new Set(prev);
      next.add(pairKey(sourceId, targetId));
      return next;
    });
  }, []);

  const dismissGap = useCallback(() => setGap(null), []);
  const dismissDiscussion = useCallback(() => setDiscussion(null), []);

  const clearAll = useCallback(() => {
    setRawConnections([]);
    setGap(null);
    setDiscussion(null);
    setEmptyHint({ connection: false, gap: false, discussion: false });
  }, []);

  const connections = useMemo(
    () => rawConnections.filter((c) => !dismissedPairs.has(pairKey(c.sourceId, c.targetId))),
    [rawConnections, dismissedPairs],
  );

  return {
    connections,
    gap,
    discussion,
    loading,
    emptyHint,
    runConnections,
    runGap,
    runDiscussion,
    dismissConnection,
    dismissGap,
    dismissDiscussion,
    clearAll,
  };
}
