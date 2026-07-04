// ============================================
// Demo 协作者模拟 Hook
// 在画布中模拟"花箴助手"的游标和操作，
// 让没有真实好友的用户也能预览多人协作效果。
// ============================================

import { useEffect, useRef } from "react";
import * as Y from "yjs";
import { SYSTEM_BOT_USER_ID, SYSTEM_BOT_NAME } from "./constants";

/** 用于 Demo 的用户颜色（12 色之一，取固定索引） */
const BOT_COLOR = "#4A90D9";

/** 生成一个随机整数 [min, max] */
function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * useDemoCollaborator
 *
 * 在指定的 Y.Doc 中模拟一个远程协作者。
 * - 每隔 500ms-1500ms 随机移动一次光标
 * - 光标在页面范围内平滑移动
 * - 偶尔点击/选中/绘制简单形状
 */
export function useDemoCollaborator(
  ydoc: Y.Doc | null,
  enabled: boolean,
): void {
  const animRef = useRef<number | null>(null);

  useEffect(() => {
    if (!ydoc || !enabled) return;

    // 用于存储 bot 光标位置的 Y.Map
    const yPresence = ydoc.getMap("presence");

    // 清理旧的 bot 残留（如果有的话）
    yPresence.delete(SYSTEM_BOT_USER_ID);

    // 当前光标位置（页面坐标）
    let x = randInt(200, 800);
    let y = randInt(200, 600);
    let targetX = randInt(200, 1800);
    let targetY = randInt(200, 1200);
    let state: "moving" | "idle" | "clicking" = "moving";

    // 发送 bot 的 presence 更新
    const sendPresence = () => {
      const cursorX = Math.round(x);
      const cursorY = Math.round(y);
      yPresence.set(SYSTEM_BOT_USER_ID, {
        userId: SYSTEM_BOT_USER_ID,
        userName: SYSTEM_BOT_NAME,
        color: BOT_COLOR,
        cursor: { x: cursorX, y: cursorY },
        // 模拟选中的 shape（随机切换）
        selectedShapeIds: Math.random() < 0.2 ? [] : undefined,
        // 模拟绘图状态
        followingUserId: null,
      });
    };

    // 模拟 tick
    const tick = () => {
      if (state === "moving") {
        // 缓动移向目标点
        const dx = targetX - x;
        const dy = targetY - y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < 5) {
          // 到达目标，切换状态
          const roll = Math.random();
          if (roll < 0.15) {
            // 15% 概率点击
            state = "clicking";
          } else {
            // 否则去新目标
            targetX = randInt(100, 1900);
            targetY = randInt(100, 1300);
          }
        } else {
          // 以一定速度移向目标
          const speed = Math.max(3, dist * 0.08);
          x += (dx / dist) * speed;
          y += (dy / dist) * speed;
        }
      } else if (state === "clicking") {
        // 模拟点击（停留片刻）
        state = "moving";
        // 点击后跳到一个较远的新目标
        targetX = randInt(100, 1900);
        targetY = randInt(100, 1300);
      } else if (state === "idle") {
        // 空闲状态，偶尔醒过来
        if (Math.random() < 0.05) {
          state = "moving";
          targetX = randInt(100, 1900);
          targetY = randInt(100, 1300);
        }
      }

      sendPresence();

      // 下一次 tick（500~1200ms 随机间隔，模拟不规律的人类行为）
      const delay = state === "clicking" ? 800 : randInt(400, 1200);
      animRef.current = window.setTimeout(tick, delay);
    };

    // 启动
    sendPresence();
    animRef.current = window.setTimeout(tick, 800);

    return () => {
      if (animRef.current !== null) {
        clearTimeout(animRef.current);
        animRef.current = null;
      }
      // 清理 bot 的 presence 记录
      try {
        yPresence.delete(SYSTEM_BOT_USER_ID);
      } catch {
        // 忽略清理错误
      }
    };
  }, [ydoc, enabled]);
}
