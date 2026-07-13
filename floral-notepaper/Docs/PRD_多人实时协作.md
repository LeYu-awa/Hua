# PRD · 多人实时协作

## 一、功能定义

### 一句话描述
好友之间可以**实时同步编辑同一篇文档**，右侧聊天栏实时沟通，支持语音通话。

### 用户场景
1. 我打开一篇笔记，点击"邀请协作"，选择好友 → 好友收到通知
2. 好友加入后，两人光标可见（不同颜色），文档内容实时同步
3. 右侧聊天栏显示实时消息，可以打字或语音交流
4. 协作结束后，文档自动保存为各自的个人笔记副本

---

## 二、技术方案

### 2.1 文档同步：Yjs (CRDT)

**为什么选 Yjs**
- 无需中心化冲突解决，每个客户端本地 CRDT 合并
- 支持离线编辑后同步
- 生态成熟，有 React 绑定 (`@yjs/react`)
- 免费开源

**架构**

```
┌─ 我的编辑器 ─┐                    ┌─ 好友编辑器 ─┐
│  textarea    │                    │  textarea    │
│      │       │                    │      │       │
│   Y.Doc      │                    │   Y.Doc      │
│      │       │                    │      │       │
│  y-supabase  │◄─ Supabase ──────►│  y-supabase  │
│  provider    │   Realtime         │  provider    │
└──────────────┘   Channel          └──────────────┘
```

**y-supabase provider 设计**

Supabase Realtime 基于 WebSocket 的 Broadcast/Presence，可以直接用作 Yjs 的 transport：

```ts
// src/features/collab/y-supabase-provider.ts
// 通过 Supabase Realtime Channel 的 broadcast 事件传递 Yjs 的 update
// 利用 Presence 同步各用户的光标位置
```

**核心依赖**

```json
{
  "yjs": "^13.6",
  "y-protocols": "^1.0",
  "lib0": "^0.2"
}
```

### 2.2 实时聊天：Supabase Realtime

聊天消息通过 `collab_messages` 表 + Supabase Realtime 订阅实现：

```
INSERT collab_messages → Supabase → Realtime Broadcast → 所有参与者收到
```

### 2.3 语音通话：WebRTC (免费 P2P)

- 使用 WebRTC API（浏览器/Tauri webview 原生支持）
- 信令通过 Supabase Realtime Channel 传递 SDP/ICE
- P2P 连接建立后，音频流直连，不经过服务器
- 免费、无服务器成本

### 2.4 好友通知：Supabase pg_notify

好友申请/协作邀请使用数据库触发器 + Realtime 订阅：

```
INSERT friendships → pg_notify('friend_request') → Supabase Realtime → 客户端收到通知
```

---

## 三、数据结构

### 3.1 数据库（已创建）

```
collab_docs (协作文档)
  id, owner_id, title, created_at, updated_at

collab_participants (参与者)
  doc_id, user_id, role(owner/editor/viewer), joined_at

collab_messages (聊天消息)
  id, doc_id, sender_id, content, msg_type(text/system/voice), created_at
```

### 3.2 Yjs 文档结构

```ts
// 每个协作会话一个 Y.Doc
const ydoc = new Y.Doc();

// 文档内容（绑定到 textarea）
const ytext = ydoc.getText("content");

// 文档标题
const ytitle = ydoc.getText("title");

// 参与者光标（通过 Awareness）
const awareness = new Awareness(ydoc);
awareness.setLocalState({
  user: { id, name, color },
  cursor: { index, length },
});
```

---

## 四、UI 设计

### 4.1 协作入口

- MainWindow 工具栏新增"邀请协作"按钮
- 点击弹出好友选择列表（仅显示在线好友）
- 发送邀请 → 等待对方接受

### 4.2 协作视图

```
┌──────────┬───────────────────────┬──────────────────┐
│ AppSide  │   Toolbar             │  CollabSidebar    │
│          │  [邀请] [语音 📞]      │  ┌──────────────┐ │
│          ├───────────────────────┤  │ 🟢 你         │ │
│          │                       │  │ 🟢 好友 (编辑) │ │
│          │   文档编辑区           │  ├──────────────┤ │
│          │   (多人光标可见)       │  │ 聊天消息       │ │
│          │                       │  │ 你: 这段改一下 │ │
│          │                       │  │ 好友: 好的     │ │
│          │                       │  │ ...           │ │
│          │                       │  ├──────────────┤ │
│          │                       │  │ [输入...] [→] │ │
│          │                       │  └──────────────┘ │
├──────────┴───────────────────────┴──────────────────┤
│  StatusBar: 协作中 · 2 人 · 128 字                    │
└─────────────────────────────────────────────────────┘
```

### 4.3 CollabSidebar 组件

```tsx
interface CollabSidebarProps {
  docId: string;       // 协作文档 ID
  participants: Participant[];  // 参与者列表 + 在线状态
  messages: CollabMessage[];    // 聊天消息
  onSendMessage: (text: string) => void;
  onStartVoiceCall: () => void;
}
```

---

## 五、实现步骤

| 步骤 | 任务 | 预估 |
|------|------|------|
| 1 | 安装 yjs、创建 y-supabase-provider | 1 天 |
| 2 | 封装 useCollabDoc hook（Yjs 绑定 textarea） | 1 天 |
| 3 | 实现 Awareness（多光标显示） | 0.5 天 |
| 4 | 实现 CollabSidebar（参与者列表 + 聊天） | 1 天 |
| 5 | 接入 Supabase Realtime 聊天消息 | 0.5 天 |
| 6 | WebRTC 语音通话 | 1.5 天 |
| 7 | 好友邀请/通知流程 | 1 天 |
| 8 | 集成测试 | 1 天 |

---

## 六、注意事项

- Yjs update 字节量小（增量同步），不会占满 Supabase Realtime 带宽
- Awareness（光标/在线状态）不持久化，通过 Realtime Presence 同步
- 协作结束后，文档自动保存为 `.md` 本地文件
- 聊天消息保留 30 天自动清理（可配）

---

> 文档版本：v1.0
> 创建日期：2026-06-26
