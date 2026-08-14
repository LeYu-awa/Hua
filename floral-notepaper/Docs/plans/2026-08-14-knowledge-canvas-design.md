# 设计 · 知识采集与加工画布（AI 驱动的知识工作台）

日期：2026-08-14
项目：floral-notepaper
状态：设计已确认，待实施
关联：`2026-08-14-canvas-writeup-productive-agent-design.md`（组卡成文/记忆闭环基建，本设计复用其引擎）

## 1. 定位转变（与用户确认）

**从小说导向 → 知识工作画布**：面向所有知识工作者，而非仅小说创作者。

```
用户问一个领域问题
  → AI 自动上网搜索（SearXNG，网页/图片/链接）
  → 关键信息自动提炼成「知识卡」落入画布（含来源链接）
  → 用户拖自己的「灵感卡」与 AI 卡片连线关联
  → 框选一组卡片 → 一键产出「用户自己的知识成果」
     （小红书式图文贴 / 主题知识总结 / 要点清单）
```

## 2. 数据模型（P0）

### 2.1 节点类型（6 类，替换原 4 类）

```
CanvasNodeType: knowledge | idea | opinion | resource | task | question
CanvasNode.fields: Record<string,string>   // 类型化字段

knowledge 知识卡: 来源URL / 来源标题 / 可信度
idea      灵感卡: 无（用户自己的话）
opinion   观点卡: 观点方 / 立场
resource  来源卡: 链接 / 类型(网页|图片|视频|文档)
task      待办卡: 完成 / 截止（复用已有 done/dueDate）
question  问题卡: 状态(待答|已答)
```

- Rust `CanvasNode` 增加 `fields: HashMap<String,String>`（serde default，兼容旧数据）
- 旧类型映射：text→idea（默认）、card→knowledge、resource 保留、task 保留

### 2.2 连线关系类型

```
CanvasEdge.relationType: related | causality | contrast | supports | opposes | cites
CanvasEdge.label: string（自定义标签）
```

- Rust `CanvasEdge` 增加 `relation_type`（default related）+ `label`（default 空）
- 前端：拉线时弹关系类型菜单；右键连线可改类型/标签

## 3. 采集闭环（P1）

### 3.1 画布内提问条（画布顶部常驻）

```
输入问题 → 创建 knowledge.collect 任务（Rust 编排）
 → web.search(query)          SearXNG 检索（web_search.rs 已实现）
 → LLM 提炼                   JSON: {"cards":[{text,url,title}]}（3-6 条）
 → 卡片清单预览确认            每条：文本 + 来源标题 + URL + 可信度
 → canvas.batch-create        批量落 knowledge 卡（source=agent，带 fields.url/title）
     + 落一张 question 卡「问题」状态=已答
     + question 卡与各 knowledge 卡自动连线（cites）
```

### 3.2 Rust 新增

- `canvas.batch-create` 工具：`input {canvasId, cards:[{type,text,fields,x,y}]}` → 批量落卡 + 连线
- `knowledge.collect` 技能：`matches` 命中"搜索/查一下/了解一下/怎么…"等；plan: web.search → llm(提炼 JSON) → canvas.batch-create(确认)
- `parse_collect_cards(text)`：容错解析 LLM 卡片 JSON
- SearXNG docker 部署配置：`docker/searxng/docker-compose.yml` + 设置里"Web 搜索"地址配置项

## 4. 产出资产（P2）

**复用现有组卡成文链路**（框选 → canvas.read → RAG → LLM → 预览编辑 → 确认落成笔记 → drafted_by 留痕），扩展产出类型表：

| 产出类型 | 模板要点 | 落点 |
|---|---|---|
| 小红书图文贴 | 吸睛标题 + 口语化正文（分段+emoji）+ 话题标签 | 新笔记（可复制发布） |
| 主题知识总结 | 引言 + 分点展开 + 小结，附来源引用 | 新笔记 |
| 要点清单 | 3-8 条分点提炼 | 新笔记 |

- 前端：WriteupDialog 类型选项扩展（保留写作向 4 类 + 新增知识向 3 类）；工具栏"产出"菜单

## 5. 实施顺序与测试

| 期 | 内容 | 测试 |
|---|---|---|
| P0 | 模型扩展 + 类型化表单 + 连线类型选择器 + 迁移 | Rust canvas 模型 round-trip；前端表单/连线选择器 |
| P1 | 提问条 + knowledge.collect + canvas.batch-create + SearXNG docker | Rust 技能流水线/解析器/batch-create；前端提问条集成 |
| P2 | 产出类型扩展 + 产出菜单 | 复用 writeup 测试 + 新类型模板断言 |

全部复用任务引擎/记忆/留痕/预览确认基建；测试覆盖两端。
