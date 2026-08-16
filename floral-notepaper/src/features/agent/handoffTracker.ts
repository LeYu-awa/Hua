// 多人接力写作追踪（issue 场景六）
// 基于多人操作事件的时间线，检测"接力"（一个用户在另一个用户离开某区域后
// 进入同一区域延续内容）与并行协作，并自动生成角色标签。
// 纯规则、确定性，不依赖 AI（区域映射由调用方提供）。

export interface CollabEditEvent {
  userId: string;
  /** 语义区域标识（由调用方把画布坐标/节点映射成区域） */
  area: string;
  nodeId: string;
  timestamp: number;
  /** 新建节点还是编辑已有 */
  kind: "create" | "edit";
}

/** 一个接力点：区域内编辑者从 fromUser 切换到 toUser */
export interface HandoffPoint {
  area: string;
  fromUserId: string;
  toUserId: string;
  timestamp: number;
}

export type CollabRole = "框架设计者" | "深化者" | "内容贡献者";

export interface RoleTag {
  userId: string;
  role: CollabRole;
}

export interface HandoffResult {
  handoffs: HandoffPoint[];
  roles: RoleTag[];
  /** 每个用户的编辑事件时间线（按时间升序） */
  timelines: Record<string, CollabEditEvent[]>;
}

export interface HandoffOptions {
  /** 判定接力的最大时间间隔（ms），默认 30 分钟 */
  maxGapMs?: number;
}

/**
 * 追踪多人接力与角色。
 * @returns handoffs 按时间升序；roles 每个用户一个标签。
 */
export function trackHandoffs(
  events: CollabEditEvent[],
  options: HandoffOptions = {},
): HandoffResult {
  const maxGapMs = options.maxGapMs ?? 30 * 60_000;
  const sorted = [...events].sort((a, b) => a.timestamp - b.timestamp);

  // 时间线
  const timelines: Record<string, CollabEditEvent[]> = {};
  for (const e of sorted) {
    (timelines[e.userId] ??= []).push(e);
  }

  // 按区域检测接力：区域内相邻事件的用户发生切换，且间隔在窗口内
  const byArea = new Map<string, CollabEditEvent[]>();
  for (const e of sorted) {
    (byArea.get(e.area) ?? byArea.set(e.area, []).get(e.area)!).push(e);
  }

  const handoffs: HandoffPoint[] = [];
  for (const [area, areaEvents] of byArea) {
    for (let i = 1; i < areaEvents.length; i++) {
      const prev = areaEvents[i - 1];
      const cur = areaEvents[i];
      if (prev.userId !== cur.userId && cur.timestamp - prev.timestamp <= maxGapMs) {
        handoffs.push({
          area,
          fromUserId: prev.userId,
          toUserId: cur.userId,
          timestamp: cur.timestamp,
        });
      }
    }
  }
  handoffs.sort((a, b) => a.timestamp - b.timestamp);

  // 角色判定
  const roles = assignRoles(sorted, handoffs, timelines);

  return { handoffs, roles, timelines };
}

function assignRoles(
  sorted: CollabEditEvent[],
  handoffs: HandoffPoint[],
  timelines: Record<string, CollabEditEvent[]>,
): RoleTag[] {
  const userIds = Object.keys(timelines);
  if (userIds.length === 0) return [];

  // 各用户新建节点数
  const createCount: Record<string, number> = {};
  // 各用户作为"接力接手方"的次数（深化他人内容）
  const takeoverCount: Record<string, number> = {};
  for (const id of userIds) {
    createCount[id] = 0;
    takeoverCount[id] = 0;
  }
  for (const e of sorted) {
    if (e.kind === "create") createCount[e.userId]++;
  }
  for (const h of handoffs) {
    takeoverCount[h.toUserId]++;
  }

  // 框架设计者：新建节点最多，且首个事件最早
  const firstEventAt: Record<string, number> = {};
  for (const id of userIds) {
    firstEventAt[id] = timelines[id][0]?.timestamp ?? Infinity;
  }
  const framer = userIds
    .slice()
    .sort((a, b) => createCount[b] - createCount[a] || firstEventAt[a] - firstEventAt[b])[0];

  return userIds.map((id) => {
    if (id === framer && createCount[id] > 0) {
      return { userId: id, role: "框架设计者" as const };
    }
    if (takeoverCount[id] >= 1) {
      return { userId: id, role: "深化者" as const };
    }
    return { userId: id, role: "内容贡献者" as const };
  });
}
