# Debug: chat-image-display

状态：[FIXED]
时间：2026-08-17

## 问题描述

智能体对话（SidebarChat → AgentTimelineMessage）中，联网搜索（`web.search`）的结果缩略图无法在会话界面内正常展示：

- 会话内「**图片预览**」区块的图片加载失败（表现为 404/403、破碎图片或干脆不显示）。
- 偶发情况下「图片预览」区块完全不出现（公共 SearXNG 实例限流/不可用导致结果里根本没有 thumbnail）。

## 排查过程

### 候选假设与排除

| # | 假设 | 排查方式 | 结论 |
|---|------|---------|------|
| H1 | CSP 限制（img-src 缺失） | 检查 `src-tauri/tauri.conf.json` | **排除**：`security.csp = null`，无任何 CSP 指令限制图片加载 |
| H2 | Markdown 图片语法被破坏（标题含 `[]`/`()`、URL 带 `&w=` 等） | 用 react-markdown v10 + remark-gfm 在 SSR 环境实测 8 组含特殊字符用例 | **排除**：全部正确解析为 `<img>`，`![樱花[图片]](url?...&w=100)` 等均渲染成功 |
| H3 | CSS 隐藏图片 | 检查 `MARKDOWN_CONTENT_CLASS` | **排除**：无 `img` 相关样式；默认 `<img>` 可见（仅缺尺寸约束） |
| H4 | 接口传输限制（thumbnail 字段被截断/丢失） | 检查 `web_search.rs` 的 `WebSearchResult` 序列化 | **排除**：`thumbnail: Option<String>`，`skip_serializing_if = "Option::is_none"`，正常返回完整字符串 |
| H5 | 渲染路径错误：thumbnail 为**相对路径**，被按应用自身 origin 解析 | 静态分析 + SearXNG 行为知识 | **确认为主根因**（见下） |
| H6 | 公共 SearXNG 实例限流/反爬（429） | 沙箱实测公共实例均返回 `429 Too Many Requests` | **确认为次根因**：结果不可达 → 无 thumbnail → 预览区缺失 |

### 根因链（H5 主根因）

```
SearXNG JSON API 返回的 thumbnail 字段是相对路径（如 /image_proxy?url=<encoded>&h=100&w=100）
  ↓
web_search.rs 直接透传 String::from（未归一化）
  ↓
agentRuntime.ts formatToolResponse 把 ![title](thumbnail) 原样拼进 markdown
  ↓
AgentTimelineMessage 的 ReactMarkdown 渲染出 <img src="/image_proxy?...">
  ↓
WebView2 按应用自身 origin 解析相对路径
  ├─ dev：http://localhost:1420/image_proxy?…   → 404
  └─ 生产：tauri://localhost/image_proxy?…      → 404/403
  ↓
图片无法加载，表现为不显示 / 破碎图
```

次要根因：`web.search` 依赖 5 个公共 SearXNG 实例（`PUBLIC_SEARXNG_INSTANCES`），这些实例对共享出口 IP 经常返回 429，导致结果为空或 thumbnail 缺失；DDG HTML 回退不提供 thumbnail（`thumbnail: None`）。此时无图可展示属于上游数据源问题，需在 UI 上给出兜底而非报错。

## 修复方案

### F1（根因修复）：Rust 端 thumbnail 绝对化归一化

[web_search.rs](file:///d:/花箴/floral-notepaper/src-tauri/src/services/agent/web_search.rs) 新增 `normalize_thumbnail(thumbnail, base_url)`，在 `search_instance` 解析结果时对 thumbnail 做归一化：

- `/path` 相对路径 → 拼上实例 origin（`{base}/path`），解决 404/403 主根因；
- `//host/path` 协议相对 → 补 `https:`；
- `http(s)://` 绝对地址 → 原样保留；
- `data:` / `javascript:` / `ftp:` / 空值 → 返回 `None` 直接丢弃，防止污染渲染与潜在注入。

### F2（安全兜底）：前端 http(s) 白名单校验

[agentRuntime.ts](file:///d:/花箴/floral-notepaper/src/features/sidebarChat/agentRuntime.ts) 的 `formatToolResponse` 新增 `isSafeThumbnailUrl`：

- 只允许 `^https?:\/\/\S+$` 的绝对地址进入「图片预览」；
- 相对路径、非 http(s) scheme、含空白异常值一律过滤；
- 与 F1 形成双层防护（即便后端来源变更/旧数据，前端也不会把非法 URL 拼进 markdown）。

### F3（展示层）：图片样式约束与加载失败兜底

[SidebarChat.tsx](file:///d:/花箴/floral-notepaper/src/features/sidebarChat/SidebarChat.tsx)：

- `MARKDOWN_CONTENT_CLASS` 补充 `[&_img]` 规则：`max-w-full`、`max-h-40`、`rounded-md`、细边框、`object-cover`、上下留白，图片不再撑破气泡；
- 新增 `SafeMarkdownImage` 组件并注入 `ReactMarkdown components={{ img }}`：外部图源加载失败（403 反爬、连接中断等）时，用带 alt 文本的占位块替代破碎图标，交互层体验完整。

### F4：验收自动化

- Rust 单测：`normalizes_thumbnail_urls`（6 类输入）+ 扩展 `parses_searxng_json_results`（相对路径 thumbnail 端到端归一化断言）；
- 前端单测：新增 `agentRuntime.test.ts` 覆盖「绝对 URL 渲染为预览 / 相对路径与非法 scheme 被过滤 / 无缩略图时不渲染预览块」三个场景。

## 功能说明（图片展示交互）

### 展示链路

```
web.search 工具 → Rust searxng_search/duckduckgo_search
  → WebSearchResult.thumbnail（已归一化为绝对 http(s) URL）
  → 前端 formatToolResponse 白名单校验
  → markdown：![title](thumbnail)（**图片预览** 区块）
  → AgentTimelineMessage → ReactMarkdown → SafeMarkdownImage → <img>
```

### 行为约定

1. **有图才显示**：仅当结果含合法 `http(s)` 缩略图时才渲染「**图片预览**」区块；无图时该区块整体不出现，不影响来源列表与摘要。
2. **失败可见兜底**：图片加载失败显示占位块（alt 文本或「图片加载失败」），不显示破碎图图标。
3. **尺寸约束**：图片最大宽度为消息容器宽、最大高度 160px、圆角边框，多图垂直排列。
4. **安全约束**：仅 `http(s)://` 可进入渲染路径；相对路径、`data:`、`javascript:` 等一律在 Rust 归一化层与前端白名单双层拦截。

### 已知限制

- 公共 SearXNG 实例 429 限流时结果本身可能为空 → 上游数据源问题，非渲染缺陷；建议配置自托管实例（`docker/searxng/docker-compose.yml` 已提供）。
- DDG HTML 回退不携带 thumbnail → 回退路径下无图片预览属预期行为。

## 验收测试结果

| 验证项 | 方式 | 结果 |
|--------|------|------|
| Rust：thumbnail 归一化单测（相对路径/协议相对/绝对/非法/空） | `cargo test web_search` | ✅ 8/8 通过（含新增 2 项） |
| Rust：端到端解析断言（stub HTTP 返回相对路径 → 归一化为绝对 URL） | 同上 | ✅ 通过 |
| 前端：`agentRuntime.test.ts` 图片预览过滤（绝对 URL 渲染 / 相对路径与 `javascript:` 过滤 / 无图不渲染预览块） | `npx vitest run` | ✅ 2/2 通过 |
| 前端全量回归 | `npx vitest run` | ✅ 77 文件 / 428 用例全绿 |
| 类型检查（含 SidebarChat SafeMarkdownImage / ReactMarkdown components） | `npx tsc --noEmit` | ✅ 无错误 |

> 备注：Tauri 桌面窗口内实测需真实 SearXNG 实例返回 thumbnail；当前沙箱出口 IP 被公共实例限流（429），故以「归一化逻辑单测 + 渲染过滤单测 + 全量回归」作为验收证据链，功能修复覆盖到代码路径层。
