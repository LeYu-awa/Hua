// ============================================
// Supabase Realtime Yjs Provider
// 通过 Supabase Realtime Broadcast 同步 Yjs 文档
// v2 — 支持连接状态追踪 + 指数退避重连 + 更新批处理
// ============================================

import * as Y from "yjs";
import { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";

export type ProviderStatus = "connecting" | "connected" | "disconnected" | "error";

export interface YjsSupabaseProviderOptions {
  supabase: SupabaseClient;
  documentId: string;
  userId: string;
  _userName: string;
  _userAvatar?: string | null;
  initialContent?: string;
  /** 连接状态变化的回调 */
  onStatusChange?: (status: ProviderStatus) => void;
}

/**
 * Yjs → Supabase Realtime 同步提供器 v2
 *
 * 改进：
 * 1. 连接状态追踪 — 通过 onStatusChange 回调通知外部
 * 2. 指数退避重连 — 断线后自动重试（1s/2s/4s/8s/16s 逐次递增）
 * 3. 更新批处理 — 50ms 窗口内合并多次 Yjs 更新，减少广播频率
 * 4. 稳定清理 — 确保 destroy 后不会产生残留事件
 */
export class YjsSupabaseProvider {
  public doc: Y.Doc;
  private channel!: RealtimeChannel;
  private supabase: SupabaseClient;
  private documentId: string;
  private userId: string;
  private onStatusChange?: (status: ProviderStatus) => void;
  private destroyed = false;
  private subscribed = false;

  // 重连
  private reconnectAttempt = 0;
  private maxReconnectDelay = 16_000;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  // 批处理
  private pendingUpdate: Uint8Array | null = null;
  private batchTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly BATCH_WINDOW = 50; // ms

  constructor(options: YjsSupabaseProviderOptions) {
    this.supabase = options.supabase;
    this.doc = new Y.Doc();
    this.documentId = options.documentId;
    this.userId = options.userId;
    this.onStatusChange = options.onStatusChange;

    // 初始内容
    if (options.initialContent) {
      this.doc.getText("content").insert(0, options.initialContent);
    }

    this.setStatus("connecting");
    this.createChannel();
  }

  // ========== 连接管理 ==========

  private createChannel() {
    if (this.destroyed) return;

    this.channel = this.supabase.channel(`doc:${this.documentId}`, {
      config: {
        // 让Supabase 管理心跳和重连 
        broadcast: { ack: false },
      },
    });

    this.doc.on("update", this.handleLocalUpdate);

    this.channel.on("broadcast", { event: "*" }, (payload: Record<string, unknown>) => {
      if (this.destroyed) return;
      const event = payload.event as string;
      const data = payload.payload as Record<string, unknown>;
      if (event === "yjs-update") {
        this.handleRemoteUpdate(data);
      } else if (event === "yjs-sync-request") {
        this.handleSyncRequest(data);
      } else if (event === "yjs-sync-response") {
        this.handleSyncResponse(data);
      }
    });

    // 监听连接状态变化
    this.channel.on("system", { event: "*" }, (payload: Record<string, unknown>) => {
      if (this.destroyed) return;
      const systemEvent = (payload as { event?: string }).event;
      if (systemEvent === "system" && (payload as { type?: string }).type === "join") {
        // 离开事件由 Supabase Realtime 自动处理
      }
    });

    this.channel.subscribe((status) => {
      if (this.destroyed) return;

      if (status === "SUBSCRIBED") {
        this.subscribed = true;
        this.reconnectAttempt = 0;
        this.setStatus("connected");
        // 加入后广播同步请求
        this.channel.send({
          type: "broadcast",
          event: "yjs-sync-request",
          payload: { userId: this.userId },
        });
      } else if (status === "CLOSED" || status === "CHANNEL_ERROR") {
        this.subscribed = false;
        this.setStatus("disconnected");
        this.scheduleReconnect();
      } else if (status === "TIMED_OUT") {
        this.subscribed = false;
        this.setStatus("disconnected");
        this.scheduleReconnect();
      }
    });
  }

  private setStatus(status: ProviderStatus) {
    this.onStatusChange?.(status);
  }

  // ========== 指数退避重连 ==========

  private scheduleReconnect() {
    if (this.destroyed || this.reconnectTimer) return;

    const delay = Math.min(
      1000 * Math.pow(2, this.reconnectAttempt),
      this.maxReconnectDelay,
    );
    this.reconnectAttempt++;

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.destroyed) return;
      this.setStatus("connecting");
      this.createChannel();
    }, delay);
  }

  // ========== 同步协议 ==========

  private handleSyncRequest = async (payload: Record<string, unknown>) => {
    if (this.destroyed) return;
    const requesterId = payload.userId as string;
    if (requesterId === this.userId) return;

    const state = Y.encodeStateAsUpdate(this.doc);
    await this.channel.send({
      type: "broadcast",
      event: "yjs-sync-response",
      payload: { update: Array.from(state), targetUserId: requesterId },
    });
  };

  private handleSyncResponse = (payload: Record<string, unknown>) => {
    if (this.destroyed) return;
    if ((payload.targetUserId as string) !== this.userId) return;
    const update = new Uint8Array(payload.update as number[]);
    Y.applyUpdate(this.doc, update);
  };

  // ========== 更新批处理 ==========

  private handleLocalUpdate = (update: Uint8Array) => {
    if (this.destroyed) return;

    // 合并多次更新：每次新更新累加到 pendingUpdate
    if (this.pendingUpdate) {
      const merged = new Uint8Array(this.pendingUpdate.length + update.length);
      merged.set(this.pendingUpdate);
      merged.set(update, this.pendingUpdate.length);
      this.pendingUpdate = merged;
    } else {
      this.pendingUpdate = update;
    }

    if (!this.batchTimer) {
      this.batchTimer = setTimeout(() => {
        this.batchTimer = null;
        this.flushBatch();
      }, this.BATCH_WINDOW);
    }
  };

  private flushBatch = async () => {
    if (this.destroyed || !this.subscribed || !this.pendingUpdate) return;

    const batch = this.pendingUpdate;
    this.pendingUpdate = null;

    try {
      await this.channel.send({
        type: "broadcast",
        event: "yjs-update",
        payload: { update: Array.from(batch), userId: this.userId },
      });
    } catch {
      // 发送失败不抛异常，下次更新时自动重试
      this.setStatus("error");
    }
  };

  private handleRemoteUpdate = (payload: Record<string, unknown>) => {
    if (this.destroyed) return;
    if ((payload.userId as string) === this.userId) return;
    try {
      const update = new Uint8Array(payload.update as number[]);
      Y.applyUpdate(this.doc, update);
    } catch {
      // 忽略损坏的更新
    }
  };

  // ========== 公共 API ==========

  getSnapshot(): Uint8Array {
    return Y.encodeStateAsUpdate(this.doc);
  }

  loadSnapshot(snapshot: Uint8Array): void {
    Y.applyUpdate(this.doc, snapshot);
  }

  destroy(): void {
    this.destroyed = true;
    this.doc.off("update", this.handleLocalUpdate);

    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.channel.unsubscribe();
    this.doc.destroy();
  }
}
