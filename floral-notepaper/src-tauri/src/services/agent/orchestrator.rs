//! 主编排：Planner + Executor + Observer（Phase B-F 落地版）
//!
//! - Planner：规则兜底（无 LLM 可跑，确定性、可测）+ LLM 规划（`plan_with_llm`，失败回退规则）。
//!   组合目标识别：检索 / 总结 / 画布成文 / 调研，分别展开成固定流水线。
//! - Executor：按 StepKind 分发。Tool（原子/组合工具）、Llm（记忆注入 + 生成）、
//!   Confirm（暂停等确认）、Output（输出总线：Live2D / 语音 / UI）。
//! - Observer：步骤失败重试 1 次 → 仍失败置 Failed；写操作步骤走 AwaitingConfirm 人工确认。
//! - 进度事件：每步开始/完成 emit `agent.step`，任务状态变更 emit `agent.task`，
//!   待确认 emit `agent.awaiting_confirm`，产出走 `agent.live2d` / `agent.speech` / `agent.ui`。
//!   AppHandle 可选（测试传 None，纯逻辑可单测）。

use crate::services::agent::llm_provider::{resolve_endpoint, HttpLlmProvider};
use crate::services::agent::output_bus;
use crate::services::agent::rag;
use crate::services::agent::task_store::{
    AgentTaskStore, Step, StepKind, StepStatus, Task, TaskStatus,
};
use crate::services::agent::vector_store::VectorStore;
use crate::services::agent::web_search::searxng_search;
use crate::services::canvas::{CanvasDocument, CanvasEdge, CanvasGroup, CanvasNode, CanvasStore};
use crate::services::notes::{default_store, AppError, Note, NoteMetadata, NoteStore, SaveNoteRequest};
use serde::Deserialize;
use serde_json::{json, Value};
use std::sync::{Arc, LazyLock, Mutex as StdMutex};
use tauri::{AppHandle, Emitter};

/// 每个任务一把进程内异步锁：并发 agent_task_run / agent_task_confirm 对同一任务
/// 只能有一个执行者，避免已确认的写步骤被重复执行（重复建笔记/落卡/追加）。
static TASK_RUN_LOCKS: LazyLock<StdMutex<std::collections::HashMap<String, Arc<tokio::sync::Mutex<()>>>>> =
    LazyLock::new(|| StdMutex::new(std::collections::HashMap::new()));

fn task_run_lock(task_id: &str) -> Arc<tokio::sync::Mutex<()>> {
    let mut map = TASK_RUN_LOCKS
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    map.entry(task_id.to_string())
        .or_insert_with(|| Arc::new(tokio::sync::Mutex::new(())))
        .clone()
}

/// 目标文本里常见的前缀（动词/祈使），规划时剥掉，剩下的是搜索词
const LEADING_PREFIXES: &[&str] = &[
    "请帮我", "帮我找找", "帮我找一下", "帮我搜索", "帮我查一下", "查找一下", "搜索一下",
    "检索一下", "找一下", "帮我找", "请查找", "请搜索", "请检索", "查找", "搜索", "检索",
    "找找", "帮我", "请", "找",
];

/// 目标文本里常见的后缀（名词收尾），规划时剥掉
const TRAILING_SUFFIXES: &[&str] = &[
    "相关的笔记", "相关笔记", "的笔记", "相关内容", "的内容", "相关资料",
];

/// 搜索时忽略的填充词（避免"关于""相关"这类虚词命中一堆无关笔记）
const SEARCH_STOPWORDS: &[&str] = &[
    "关于", "相关", "一下", "一些", "这个", "那个", "内容", "笔记",
];

/// 组合目标关键词
const CANVAS_WORDS: &[&str] = &["画布", "脑图", "思维导图", "canvas", "节点", "卡片"];
const SUMMARIZE_WORDS: &[&str] = &["总结", "摘要", "汇总", "提炼", "概括"];
const WRITE_WORDS: &[&str] = &["写", "成文", "整理", "文章", "笔记", "总结"];
const RESEARCH_WORDS: &[&str] = &["调研", "查资料", "了解", "研究"];
const EXPORT_WORDS: &[&str] = &["导出", "生成文件", "输出文件", "export", "保存为"];
const ORGANIZE_WORDS: &[&str] = &["排版", "重排", "自动排列", "整理画布", "布局", "organize", "排列"];
const ENHANCE_WORDS: &[&str] = &["扩写", "展开", "补充细节", "丰富", "深化", "enhance", "详细一点"];
const CHAPTER_WORDS: &[&str] = &["续写", "下一章", "下一节", "继续写", "chapter", "接着写"];
const GROUP_WORDS: &[&str] = &["分组", "归组", "归类", "自动分组", "泳道", "group"];
const COLLECT_WORDS: &[&str] = &["知识采集", "采集", "搜集", "搜一下"];
const SOCIAL_PUBLISH_WORDS: &[&str] = &[
    "朋友圈",
    "小红书",
    "QQ说说",
    "qq说说",
    "社交",
    "发帖",
    "发布动态",
];

// ── 查询抽取与原子工具 ────────────────────────────────────────────────────────

/// 从用户目标里抽搜索词：剥常见前缀/后缀，留下核心（"帮我找一下关于 RAG 的笔记" → "RAG"）
pub fn extract_query(goal: &str) -> String {
    let mut q = goal.trim().to_string();
    // 循环剥前缀动词："请帮我搜索 X" → 剥"请帮我" → "搜索 X" → 再剥"搜索" → "X"
    loop {
        let before = q.clone();
        for prefix in LEADING_PREFIXES {
            if let Some(rest) = q.strip_prefix(prefix) {
                q = rest.trim().to_string();
                break;
            }
        }
        if q == before {
            break;
        }
    }
    let mut out = q;
    for suffix in TRAILING_SUFFIXES {
        if out.ends_with(suffix) {
            out.truncate(out.len() - suffix.len());
            out = out.trim().to_string();
            break;
        }
    }
    for word in ["关于", "相关"] {
        if out.strip_prefix(word).is_some() {
            out = out[word.len()..].trim().to_string();
            break;
        }
    }
    out
}

/// 把查询拆成搜索词：空白/标点切分，去停用词，至少 2 字符（大小写不敏感）
pub fn query_terms(query: &str) -> Vec<String> {
    query
        .split(|c: char| {
            c.is_whitespace()
                || c.is_ascii_punctuation()
                || "，。；、·的了".contains(c)
        })
        .map(str::trim)
        .filter(|t| !t.is_empty())
        .filter(|t| !SEARCH_STOPWORDS.contains(t))
        .filter(|t| t.chars().count() >= 2)
        .map(|t| t.to_lowercase())
        .collect()
}

/// 原子工具 note.search：对笔记元数据（标题/预览/分类）做关键词匹配（AND 语义）
pub fn note_search(
    store: &NoteStore,
    query: &str,
    limit: usize,
) -> Result<Vec<NoteMetadata>, AppError> {
    let terms = query_terms(query);
    if terms.is_empty() {
        return Ok(Vec::new());
    }
    let all = store.list_notes()?;
    let hits = all
        .into_iter()
        .filter(|note| {
            let hay = format!("{} {} {}", note.title, note.preview, note.category).to_lowercase();
            terms.iter().all(|term| hay.contains(term))
        })
        .take(limit.max(1))
        .collect();
    Ok(hits)
}

/// 原子工具 note.read：按 id 读笔记全文
pub fn note_read(store: &NoteStore, id: &str) -> Result<Note, AppError> {
    store.read_note(id)
}

fn has_any(text: &str, words: &[&str]) -> bool {
    let lower = text.to_lowercase();
    words.iter().any(|w| lower.contains(w))
}

fn step(
    step_id: &str,
    kind: StepKind,
    tool: Option<&str>,
    input: Value,
    required_confirm: bool,
) -> Step {
    Step {
        step_id: step_id.into(),
        kind,
        tool: tool.map(str::to_string),
        input,
        output: None,
        status: StepStatus::Pending,
        required_confirm,
        confirmed: false,
    }
}

fn tool_step(step_id: &str, tool: &str, input: Value) -> Step {
    step(step_id, StepKind::Tool, Some(tool), input, false)
}

fn tool_step_confirm(step_id: &str, tool: &str, input: Value) -> Step {
    step(step_id, StepKind::Tool, Some(tool), input, true)
}

fn llm_step(step_id: &str, input: Value) -> Step {
    step(step_id, StepKind::Llm, None, input, false)
}

/// 该步骤失败后重试是否安全：只读/幂等工具与 LLM 步骤可安全重试；
/// 写类工具（建笔记/追加章节/建节点/批量落卡）重试可能重复落盘，禁止重试。
fn step_retry_is_safe(step: &Step) -> bool {
    if step.kind == StepKind::Llm {
        return true;
    }
    matches!(
        step.tool.as_deref(),
        Some(
            "note.search" | "note.read" | "canvas.read" | "web.search" | "llm.generate"
                | "note.export" | "canvas.organize"
        )
    )
}

// ── Planner：技能注册表（Skill = 目标检测 + 流水线展开） ─────────────────────

/// 技能定义：`matches` 判断用户目标是否命中本技能，`plan` 把目标展开成步骤流水线。
/// 产品 Agent 技能与 orchestrator 工具注册表同源：注册新技能 = 新流水线 + 可选新工具分支。
#[derive(Clone)]
pub struct Skill {
    pub name: &'static str,
    pub description: &'static str,
    pub matches: fn(&str) -> bool,
    pub plan: fn(&str) -> Vec<Step>,
}

/// 技能流水线：检索 → 读第一条命中
fn search_plan(goal: &str) -> Vec<Step> {
    vec![
        tool_step("s1", "note.search", json!({ "query": extract_query(goal), "limit": 5 })),
        tool_step("s2", "note.read", json!({ "id": "top" })),
    ]
}

/// 技能流水线：检索 → 读 → LLM 摘要 → 落库（确认）
fn summarize_plan(goal: &str) -> Vec<Step> {
    vec![
        tool_step("s1", "note.search", json!({ "query": extract_query(goal), "limit": 5 })),
        tool_step("s2", "note.read", json!({ "id": "top" })),
        llm_step(
            "s3",
            json!({
                "promptTemplate": "用 3-5 条要点总结下面这篇笔记：\n{previousOutput}"
            }),
        ),
        tool_step_confirm(
            "s4",
            "note.create",
            json!({ "title": "笔记摘要", "category": "AI 生成" }),
        ),
    ]
}

/// 技能流水线：画布成文（组卡成文闭环）
/// 目标格式（前端成文入口生成）："整理成文：<类型>；意图：<描述>；卡片：id1,id2"
/// 类型 ∈ {大纲, 初稿, 总结, 设定集}；卡片段缺失 → 读全画布；类型缺省 → 初稿
fn canvas_writeup_plan(goal: &str) -> Vec<Step> {
    let req = parse_writeup_goal(goal);
    let node_ids = req.node_ids.clone();
    let retrieve_query = if req.intent.trim().is_empty() {
        if node_ids.is_empty() {
            "画布内容".to_string()
        } else {
            format!("画布卡片 {} 张", node_ids.len())
        }
    } else {
        req.intent.clone()
    };
    vec![
        tool_step("w1", "canvas.read", json!({ "canvasId": "first", "nodeIds": node_ids })),
        llm_step(
            "w2",
            json!({
                "retrieve": retrieve_query,
                "promptTemplate": writeup_template(&req.kind, &req.intent),
            }),
        ),
        tool_step_confirm(
            "w3",
            "note.create",
            json!({ "title": "画布整理成文", "category": "AI 生成", "content": "{previousOutput}" }),
        ),
    ]
}

/// 组卡成文请求（从 goal 解析）
#[derive(Debug, Clone, Default, PartialEq)]
pub struct WriteupRequest {
    pub node_ids: Vec<String>,
    /// 产出类型：大纲 / 初稿 / 总结 / 设定集（缺省 → 初稿）
    pub kind: String,
    /// 用户补充意图（可选）
    pub intent: String,
}

/// AI 自动分组结果（LLM 输出的单个分组）
#[derive(Debug, Clone, PartialEq)]
pub struct GroupSpec {
    pub title: String,
    pub node_ids: Vec<String>,
}

/// 解析组卡成文目标："整理成文：<类型>；意图：<描述>；卡片：id1,id2"
/// 各段缺失均容错：卡片缺失 → 空（读全画布）；类型缺失 → 初稿；意图缺失 → 空。
pub fn parse_writeup_goal(goal: &str) -> WriteupRequest {
    let mut req = WriteupRequest {
        kind: "初稿".to_string(),
        ..Default::default()
    };
    for sep in ["整理成文：", "整理成文:"] {
        if let Some(index) = goal.find(sep) {
            let rest = &goal[index + sep.len()..];
            let kind = rest.split(['；', ';']).next().unwrap_or("").trim();
            if !kind.is_empty() {
                req.kind = kind.to_string();
            }
            break;
        }
    }
    for sep in ["意图：", "意图:"] {
        if let Some(index) = goal.find(sep) {
            let rest = &goal[index + sep.len()..];
            req.intent = rest.split(['；', ';']).next().unwrap_or("").trim().to_string();
            break;
        }
    }
    for sep in ["卡片：", "卡片:"] {
        if let Some(index) = goal.find(sep) {
            let rest = &goal[index + sep.len()..];
            req.node_ids = rest
                .split(['；', ';'])
                .next()
                .unwrap_or("")
                .split([',', '，', ' '])
                .map(str::trim)
                .filter(|token| !token.is_empty())
                .map(str::to_string)
                .collect();
            break;
        }
    }
    req
}

/// 产出类型 → 提示词模板（保留 {previousOutput} 占位符，由执行器替换为画布内容）
pub fn writeup_template(kind: &str, intent: &str) -> String {
    let base = match kind.trim() {
        "大纲" => "请把下面的画布内容整理成结构清晰的大纲（层级标题 + 要点，保留关键信息）：",
        "总结" => "请把下面的画布内容凝练成一篇简洁的总结（3-5 段，突出核心结论）：",
        "设定集" => "请把下面的画布内容整理成条目化的设定集（按人物/世界观/规则等分类，逐条列出）：",
        "图文贴" => "请把下面的画布内容写成一条适合小红书/朋友圈发布的图文贴：标题要吸睛但不标题党；正文口语化、分段（每段 1-2 句）、适度使用 emoji；结尾附 3-6 个话题标签（#开头）。只输出贴文内容，不要解释：",
        "主题总结" => "请把下面的画布内容整理成一篇主题知识总结：开头一句话点明主题，中间分点展开（每条附来源出处），结尾 2-3 句小结与延伸思考。保留关键事实与来源链接：",
        "要点清单" => "请把下面的画布内容提炼成 3-8 条要点清单，每条一句话、可直接引用，按重要性排序：",
        _ => "请把下面的画布内容写成一篇文章（成段成文、逻辑连贯、保留全部要点，可适度展开）：",
    };
    let intent = intent.trim();
    if intent.is_empty() {
        format!("{base}\n{{previousOutput}}")
    } else {
        format!("{base}\n用户补充意图：{intent}\n\n{{previousOutput}}")
    }
}

/// 从续写目标里抽笔记 id（"续写笔记 <id> 的下一章（当前标题：…）" → "<id>"）
pub fn extract_chapter_note_id(goal: &str) -> Option<String> {
    for marker in ["续写笔记 ", "续写笔记"] {
        if let Some(rest) = goal.find(marker).map(|i| &goal[i + marker.len()..]) {
            let id = rest
                .split(|c: char| c.is_whitespace() || c == '（' || c == '(' || c == '的')
                .find(|token| !token.is_empty())
                .unwrap_or("");
            if !id.is_empty() {
                return Some(id.to_string());
            }
        }
    }
    None
}

/// 技能流水线：章节续写（读原文 → LLM 续写 → 追加保存，确认）
fn chapter_plan(goal: &str) -> Vec<Step> {
    let note_id = extract_chapter_note_id(goal).unwrap_or_default();
    vec![
        tool_step("ch1", "note.read", json!({ "id": note_id })),
        llm_step(
            "ch2",
            json!({
                "promptTemplate": "你是花笺里的续写助手。请接着下面笔记的结尾续写下一章（保持行文风格一致、篇幅相当，直接输出续写正文）：\n{previousOutput}"
            }),
        ),
        tool_step_confirm(
            "ch3",
            "note.update",
            json!({ "id": note_id, "mode": "append", "content": "{previousOutput}" }),
        ),
    ]
}

/// 技能流水线：AI 自动分组（读画布 → LLM 语义归组 → 写回分组，确认）
/// 目标：把画布卡片按语义自动分成泳道（分组输出落地）
fn group_plan(_goal: &str) -> Vec<Step> {
    vec![
        tool_step("g1", "canvas.read", json!({ "canvasId": "first" })),
        llm_step(
            "g2",
            json!({
                "promptTemplate": "你是花笺画布整理助手。请把下面的画布卡片按主题语义自动分组（2-6 组），并输出严格 JSON：\n{\"groups\": [{\"title\": \"组名\", \"nodeIds\": [\"卡片id\", ...]}]}\n每组至少 1 张卡片、每张卡片只属于一组，id 必须来自输入列表。只输出 JSON，不要解释。\n\n{previousOutput}"
            }),
        ),
        tool_step_confirm("g3", "canvas.save-groups", json!({ "canvasId": "first" })),
    ]
}

/// 从 LLM 输出里提取第一个完整 JSON 对象：忽略围栏/前后杂文，
/// 即使 JSON 后带含 '}' 的尾巴也只解析到对象真实结束处（比"首 { 到末 }"截断更稳）。
fn parse_first_json(text: &str) -> Result<Value, AppError> {
    let start = text
        .find('{')
        .ok_or_else(|| AppError::new("jsonParse", "输出中未找到 JSON 对象"))?;
    let mut de = serde_json::Deserializer::from_str(&text[start..]);
    Value::deserialize(&mut de)
        .map_err(|e| AppError::new("jsonParse", format!("JSON 解析失败：{e}")))
}

/// 从 LLM 输出解析分组 JSON（容错去掉 ```json 围栏与尾部杂文）
pub fn parse_group_plan(text: &str) -> Result<Vec<GroupSpec>, AppError> {
    let value = parse_first_json(text)
        .map_err(|e| AppError::new("groupParse", format!("分组结果不是合法 JSON：{}", e.message)))?;
    let groups = value
        .get("groups")
        .and_then(Value::as_array)
        .ok_or_else(|| AppError::new("groupParse", "分组结果缺少 groups 数组"))?;
    let mut out = Vec::new();
    for item in groups {
        let title = item.get("title").and_then(Value::as_str).unwrap_or("未命名分组");
        let node_ids: Vec<String> = item
            .get("nodeIds")
            .and_then(Value::as_array)
            .map(|ids| {
                ids.iter()
                    .filter_map(Value::as_str)
                    .map(str::to_string)
                    .collect()
            })
            .unwrap_or_default();
        if !node_ids.is_empty() {
            out.push(GroupSpec {
                title: title.trim().to_string(),
                node_ids,
            });
        }
    }
    if out.is_empty() {
        return Err(AppError::new("groupParse", "分组结果为空"));
    }
    Ok(out)
}

/// 把 AI 分组写回画布文档：替换旧 AI 分组（group-ai-*），更新节点归属；手动分组保留。
/// 安全：LLM 幻觉的分组 id（画布中不存在）直接丢弃，不生成幽灵分组；
/// 每张卡片只归属第一个包含它的分组，避免 UI 中卡片同时在多组。
pub fn apply_ai_groups(doc: &mut CanvasDocument, specs: &[GroupSpec]) {
    for node in doc.nodes.iter_mut() {
        if node
            .group
            .as_deref()
            .is_some_and(|g| g.starts_with("group-ai-"))
        {
            node.group = None;
        }
    }
    doc.groups.retain(|g| !g.id.starts_with("group-ai-"));

    let known_ids: std::collections::HashSet<String> =
        doc.nodes.iter().map(|node| node.id.clone()).collect();
    let mut assigned: std::collections::HashSet<String> = std::collections::HashSet::new();

    for (index, spec) in specs.iter().enumerate() {
        let group_id = format!("group-ai-{index}");
        // 过滤：只保留画布中真实存在、且尚未被其它组分配的节点
        let valid_ids: Vec<String> = spec
            .node_ids
            .iter()
            .filter(|node_id| known_ids.contains(node_id.as_str()))
            .filter(|node_id| !assigned.contains(*node_id))
            .cloned()
            .collect();
        if valid_ids.is_empty() {
            continue; // 空组不落盘（避免幽灵分组）
        }
        for node_id in &valid_ids {
            assigned.insert(node_id.clone());
        }
        doc.groups.push(CanvasGroup {
            id: group_id.clone(),
            title: spec.title.clone(),
            node_ids: valid_ids.clone(),
        });
        for node in doc.nodes.iter_mut() {
            if valid_ids.iter().any(|node_id| node_id == &node.id) {
                node.group = Some(group_id.clone());
            }
        }
    }
}

/// 知识采集目标格式（前端提问条生成）："知识采集：<问题>" → 提取问题文本
pub fn extract_collect_query(goal: &str) -> String {
    for marker in ["知识采集：", "知识采集:", "搜索：", "搜索:"] {
        if let Some(rest) = goal.find(marker).map(|i| &goal[i + marker.len()..]) {
            let q = rest.trim();
            if !q.is_empty() {
                return q.to_string();
            }
        }
    }
    goal.trim().to_string()
}

/// 知识采集技能：检索 → LLM 提炼知识卡 JSON → 批量落画布。
/// 全自动流水线（画布是用户的学习空间）：落卡不需要用户确认，直接写回。
fn collect_plan(goal: &str) -> Vec<Step> {
    let query = extract_collect_query(goal);
    vec![
        tool_step("k1", "web.search", json!({ "query": query, "limit": 6 })),
        llm_step(
            "k2",
            json!({
                "promptTemplate": "你是知识提炼助手。根据下面的搜索结果，提炼 3-6 条最关键的知识点，输出严格 JSON：\n{\"cards\": [{\"text\": \"知识点（一句话）\", \"url\": \"来源链接\", \"title\": \"来源标题\"}]}\n每条知识必须能从搜索结果中找到依据，url 使用搜索结果里的真实链接。\n如果搜索结果为空（或提示未配置搜索、基于模型知识作答），请改为基于你自己的知识提炼 3-6 条可靠知识点，此时 url 与 title 一律留空字符串，表示无来源。\n只输出 JSON，不要解释。\n\n{previousOutput}"
            }),
        ),
        tool_step(
            "k3",
            "canvas.batch-create",
            json!({ "canvasId": "first", "question": query }),
        ),
    ]
}

/// 一条待落画布的知识卡
#[derive(Debug, Clone, PartialEq)]
pub struct CollectCard {
    pub text: String,
    pub url: String,
    pub title: String,
}

/// 从 LLM 输出解析知识卡 JSON（容错去掉 ```json 围栏与尾部杂文）
pub fn parse_collect_cards(text: &str) -> Result<Vec<CollectCard>, AppError> {
    let value = parse_first_json(text)
        .map_err(|e| AppError::new("collectParse", format!("提炼结果不是合法 JSON：{}", e.message)))?;
    let cards = value
        .get("cards")
        .and_then(Value::as_array)
        .ok_or_else(|| AppError::new("collectParse", "提炼结果缺少 cards 数组"))?;
    let mut out = Vec::new();
    for item in cards {
        let text = item
            .get("text")
            .and_then(Value::as_str)
            .map(str::trim)
            .unwrap_or("");
        if text.is_empty() {
            continue;
        }
        out.push(CollectCard {
            text: text.to_string(),
            url: item.get("url").and_then(Value::as_str).unwrap_or("").trim().to_string(),
            title: item.get("title").and_then(Value::as_str).unwrap_or("").trim().to_string(),
        });
    }
    if out.is_empty() {
        return Err(AppError::new("collectParse", "提炼结果为空"));
    }
    Ok(out)
}

/// 技能流水线：联网调研
fn research_plan(goal: &str) -> Vec<Step> {
    vec![
        tool_step("r1", "web.search", json!({ "query": extract_query(goal), "limit": 5 })),
        llm_step(
            "r2",
            json!({
                "promptTemplate": "把下面的搜索结果整理成一篇 200 字以内的调研摘要；如果结果为空或提示搜索未配置，请基于你自己的知识作答，并注明「未联网（搜索未配置）」。\n{previousOutput}"
            }),
        ),
        tool_step_confirm(
            "r3",
            "note.create",
            json!({ "title": "调研摘要", "category": "AI 生成" }),
        ),
    ]
}

/// 技能流水线：导出笔记为文件（确认）
fn export_plan(goal: &str) -> Vec<Step> {
    vec![
        tool_step("e1", "note.search", json!({ "query": extract_query(goal), "limit": 5 })),
        tool_step("e2", "note.read", json!({ "id": "top" })),
        tool_step_confirm("e3", "note.export", json!({ "format": "markdown" })),
    ]
}

/// 技能流水线：社交文案编排（检索素材 → LLM 按平台规范编排 → 确认落库）。
/// 卡片/图文素材的视觉生成由前端社交发布面板与 assistant_tools 的 social.generate 承接。
fn social_publish_plan(goal: &str) -> Vec<Step> {
    vec![
        tool_step("sp1", "note.search", json!({ "query": extract_query(goal), "limit": 5 })),
        tool_step("sp2", "note.read", json!({ "id": "top" })),
        llm_step(
            "sp3",
            json!({
                "promptTemplate": format!(
                    "请把下面这篇笔记编排成一条适合发 QQ说说 / 微信朋友圈 / 小红书的社交文案。\n要求：\n1. 保留原创信息与核心亮点，口语化、有温度\n2. 正文不超过 300 字\n3. 结尾附 3-5 个 # 话题标签\n4. 不要出现极限词（最/第一/绝对等）\n\n用户目标：{}\n\n笔记内容：\n{{previousOutput}}",
                    goal
                )
            }),
        ),
        tool_step_confirm(
            "sp4",
            "note.create",
            json!({ "title": "社交文案", "category": "AI 生成", "content": "{previousOutput}" }),
        ),
    ]
}

/// 技能流水线：画布节点自动排版（确认）
fn organize_plan(_goal: &str) -> Vec<Step> {
    vec![
        tool_step("o1", "canvas.read", json!({ "canvasId": "first" })),
        tool_step_confirm("o2", "canvas.organize", json!({ "canvasId": "first" })),
    ]
}

/// 从扩写目标里抽节点 id（"扩写节点 node-123 的内容：原文" → "node-123"）。
/// 前端扩写入口按此格式生成 goal；解析不到时返回 None（走追加新节点兜底）。
pub fn extract_node_id(goal: &str) -> Option<String> {
    let marker = "节点";
    let rest = goal.find(marker).map(|i| &goal[i + marker.len()..]).unwrap_or("");
    let tokens: Vec<&str> = rest
        .split(|c: char| c.is_whitespace() || c == '：' || c == ':' || c == '，' || c == ',')
        .filter(|token| !token.is_empty())
        .collect();
    // 优先取像节点 id 的 token（前端生成的 id 形如 node-<时间戳>-...）；
    // 否则跳过"的/内容/里面"等虚词，避免 "扩写这个节点的内容" 解析出 id="的"
    tokens
        .iter()
        .find(|token| token.contains("node-"))
        .or_else(|| {
            tokens
                .iter()
                .find(|token| !["的", "内容", "里面", "这个", "那个"].contains(token))
        })
        .map(|token| token.to_string())
}

/// 从扩写目标里抽节点原文（"…的内容：<原文>" 冒号之后的部分）
pub fn extract_node_text(goal: &str) -> Option<String> {
    for sep in ["的内容：", "的内容:", "：", ":"] {
        if let Some((_, text)) = goal.split_once(sep) {
            let trimmed = text.trim();
            if !trimmed.is_empty() {
                return Some(trimmed.to_string());
            }
        }
    }
    None
}

/// 技能流水线：画布节点扩写/润色（读画布 → LLM 扩写 → 确认 → 写回保存）
/// 目标格式（前端扩写入口生成）："扩写节点 <nodeId> 的内容：<原文>"
fn enhance_plan(goal: &str) -> Vec<Step> {
    let node_id = extract_node_id(goal).unwrap_or_default();
    let node_text =
        extract_node_text(goal).unwrap_or_else(|| goal.trim().to_string());
    vec![
        tool_step("h1", "canvas.read", json!({ "canvasId": "first" })),
        llm_step(
            "h2",
            json!({
                "prompt": format!(
                    "请扩写/润色下面的画布节点内容，保持原有要点，补充细节、使表达更完整；直接输出扩写后的内容，不要解释：\n\n{node_text}"
                )
            }),
        ),
        tool_step_confirm(
            "h3",
            "canvas.save",
            json!({ "canvasId": "first", "nodeId": node_id }),
        ),
    ]
}

/// 全部技能（顺序即优先级，首个 matches 命中的生效；note.search 兜底）
static SKILLS: &[Skill] = &[
    Skill {
        name: "canvas.node.enhance",
        description: "扩写/润色画布节点内容（LLM 扩写后写回保存）",
        matches: |g| has_any(g, ENHANCE_WORDS),
        plan: enhance_plan,
    },
    Skill {
        name: "canvas.writeup",
        description: "把画布内容整理成一篇笔记",
        matches: |g| has_any(g, CANVAS_WORDS) && has_any(g, WRITE_WORDS),
        plan: canvas_writeup_plan,
    },
    Skill {
        name: "note.chapter",
        description: "续写笔记的下一章（读原文 → LLM 续写 → 追加保存）",
        matches: |g| has_any(g, CHAPTER_WORDS),
        plan: chapter_plan,
    },
    Skill {
        name: "canvas.group",
        description: "AI 自动分组：把画布卡片按语义分成泳道（确认后写回）",
        matches: |g| has_any(g, GROUP_WORDS),
        plan: group_plan,
    },
    Skill {
        name: "knowledge.collect",
        description: "知识采集：AI 上网检索并提炼成知识卡批量落入画布（确认后写回）",
        matches: |g| has_any(g, COLLECT_WORDS),
        plan: collect_plan,
    },
    Skill {
        name: "note.summarize",
        description: "检索并总结相关笔记",
        matches: |g| has_any(g, SUMMARIZE_WORDS),
        plan: summarize_plan,
    },
    Skill {
        name: "research",
        description: "联网调研并生成摘要",
        matches: |g| has_any(g, RESEARCH_WORDS),
        plan: research_plan,
    },
    Skill {
        name: "note.export",
        description: "把笔记导出为文件（Markdown，后续可接 Excel/PDF 模板）",
        matches: |g| has_any(g, EXPORT_WORDS),
        plan: export_plan,
    },
    Skill {
        name: "canvas.organize",
        description: "画布节点自动排版（网格排列，消除重叠）",
        matches: |g| has_any(g, ORGANIZE_WORDS),
        plan: organize_plan,
    },
    Skill {
        name: "social.publish",
        description: "把笔记/内容编排成社交文案并落库（QQ说说/朋友圈/小红书）",
        matches: |g| has_any(g, SOCIAL_PUBLISH_WORDS),
        plan: social_publish_plan,
    },
    Skill {
        name: "note.search",
        description: "检索本地笔记",
        matches: |_| true,
        plan: search_plan,
    },
];

/// 全部技能副本（供外部枚举/序列化）
pub fn skill_registry() -> Vec<Skill> {
    SKILLS.to_vec()
}

/// 结构化目标前缀（前端入口生成，格式固定）→ 直接命中对应技能。
/// 关键词匹配有互相劫持风险（如"扩写"含"写"、writeup 的"画布+写"会误吞增强目标），
/// 结构化格式必须优先判定。
fn structured_skill(goal: &str) -> Option<&'static Skill> {
    let trimmed = goal.trim_start();
    for (marker, name) in [
        ("整理成文", "canvas.writeup"),
        ("知识采集", "knowledge.collect"),
        ("续写笔记", "note.chapter"),
        ("自动分组", "canvas.group"),
        ("扩写节点", "canvas.node.enhance"),
        ("生成社交文案", "social.publish"),
    ] {
        if trimmed.starts_with(marker) {
            return SKILLS.iter().find(|skill| skill.name == name);
        }
    }
    None
}

/// 命中技能：结构化格式优先，再按注册顺序关键词匹配；note.search 永远兜底
pub fn match_skill(goal: &str) -> &'static Skill {
    if let Some(skill) = structured_skill(goal) {
        return skill;
    }
    SKILLS
        .iter()
        .find(|skill| (skill.matches)(goal))
        .expect("note.search 兜底技能必然命中")
}

/// 规则兜底 Planner：按技能注册表展开固定流水线（无 LLM 可跑，确定性、可测）
pub fn plan_for_goal(goal: &str) -> Vec<Step> {
    let skill = match_skill(goal);
    (skill.plan)(goal)
}

/// 工具注册表描述（供 LLM 规划器选择）
pub fn tool_registry_json() -> Value {
    json!([
        {"name":"note.search","description":"按关键词搜索本地笔记，返回标题/分类/摘要列表","input":{"query":"string","limit":"int 默认5"}},
        {"name":"note.read","description":"读取笔记全文","input":{"id":"笔记id，或 \"top\" 表示读上一步搜索的第一条"}},
        {"name":"note.create","description":"新建笔记（写操作，需确认）","input":{"title":"string","content":"string","category":"string 可选"}},
        {"name":"note.update","description":"更新既有笔记：mode=append 追加到末尾（章节续写），否则覆盖（写操作，需确认）","input":{"id":"笔记id","mode":"append|replace 默认 replace","content":"string"}},
        {"name":"canvas.read","description":"读取画布文档（节点+连线）","input":{"canvasId":"string 或 \"first\""}},
        {"name":"canvas.node.create","description":"在画布创建文本节点（写操作，需确认）","input":{"canvasId":"string 或 \"first\"","content":"string"}},
        {"name":"canvas.save","description":"把上一步 LLM 生成内容写回画布：nodeId 命中则更新该节点文本，否则追加 agent 节点（写操作，需确认）","input":{"canvasId":"string 或 \"first\"","nodeId":"string 可选"}},
        {"name":"canvas.save-groups","description":"把上一步 LLM 的分组结果写回画布（AI 自动分组，写操作，需确认）","input":{"canvasId":"string 或 \"first\""}},
        {"name":"canvas.batch-create","description":"把上一步 LLM 提炼的知识卡批量落入画布，并落一张问题卡自动 cites 连线（知识采集，全自动落卡，无需确认）","input":{"canvasId":"string 或 \"first\"","question":"string"}},
        {"name":"web.search","description":"通过本地 SearXNG 搜索互联网（需确认）","input":{"query":"string","limit":"int 默认5"}},
        {"name":"llm.generate","description":"用 LLM 生成或改写文本","input":{"prompt":"string"}},
    ])
}

/// 解析 LLM 规划的 JSON 文本 → Steps（容错去掉 ```json 围栏与尾部杂文）
pub fn parse_llm_plan(text: &str) -> Result<Vec<Step>, AppError> {
    let value = parse_first_json(text)
        .map_err(|e| AppError::new("llmPlanParse", format!("LLM 规划不是合法 JSON：{}", e.message)))?;
    let steps = value
        .get("steps")
        .and_then(Value::as_array)
        .ok_or_else(|| AppError::new("llmPlanParse", "LLM 规划缺少 steps 数组"))?;
    if steps.is_empty() {
        return Err(AppError::new("llmPlanParse", "LLM 规划 steps 为空"));
    }
    let mut out = Vec::with_capacity(steps.len());
    for (i, item) in steps.iter().enumerate() {
        let kind = match item.get("kind").and_then(Value::as_str).unwrap_or("Tool") {
            "Tool" => StepKind::Tool,
            "Llm" => StepKind::Llm,
            "Confirm" => StepKind::Confirm,
            "Output" => StepKind::Output,
            other => {
                return Err(AppError::new(
                    "llmPlanParse",
                    format!("LLM 规划含未知步骤类型：{other}"),
                ))
            }
        };
        out.push(Step {
            step_id: format!("l{}", i + 1),
            kind,
            tool: item.get("tool").and_then(Value::as_str).map(str::to_string),
            input: item.get("input").cloned().unwrap_or_else(|| json!({})),
            output: None,
            status: StepStatus::Pending,
            required_confirm: item
                .get("requiredConfirm")
                .and_then(Value::as_bool)
                .unwrap_or(false),
            confirmed: false,
        });
    }
    Ok(out)
}

/// LLM 规划（Phase C）：让模型按工具注册表生成 Steps；失败由调用方回退规则规划
pub async fn plan_with_llm(
    provider: &HttpLlmProvider,
    goal: &str,
) -> Result<Vec<Step>, AppError> {
    let system = format!(
        "你是任务规划器。把用户目标分解为工具调用步骤。只能使用以下工具，不要发明新工具：\n{}\n\
         输出严格 JSON（不要任何其他文字）：{{\"steps\":[{{\"kind\":\"Tool\",\"tool\":\"工具名\",\"input\":{{}},\"requiredConfirm\":false}}]}}\n\
         kind 只能是 Tool / Llm（用工具 llm.generate 做文本生成）/ Confirm / Output。\n\
         写操作工具（note.create、canvas.node.create、web.search）的 requiredConfirm 必须为 true。",
        tool_registry_json()
    );
    let user = format!("用户目标：{goal}");
    let text = provider.complete_prompt(&system, &user, 1024).await?;
    let mut plan = parse_llm_plan(&text)?;
    enforce_write_confirmation(&mut plan);
    Ok(plan)
}

/// 安全兜底：写类工具一律强制 required_confirm=true（无论模型是否按要求标注，写前人工确认）。
/// canvas.batch-create 例外：知识采集是全自动学习流程，落卡无需确认。
pub fn enforce_write_confirmation(plan: &mut [Step]) {
    for step in plan.iter_mut() {
        if matches!(
            step.tool.as_deref(),
            Some(
                "note.create"
                    | "note.update"
                    | "canvas.node.create"
                    | "canvas.save"
                    | "canvas.save-groups"
                    | "web.search"
            )
        ) {
            step.required_confirm = true;
        }
    }
}

// ── Executor + Observer ───────────────────────────────────────────────────────

/// 执行器 + 观察者：跑完 Task.plan 的待执行步骤，持久化并广播进度事件
pub struct TaskRunner<'a> {
    tasks: &'a AgentTaskStore,
    notes: NoteStore,
    llm: Option<HttpLlmProvider>,
    vectors: Option<&'a VectorStore>,
    canvas: Option<&'a CanvasStore>,
    /// None 用于测试（不 emit）
    app: Option<&'a AppHandle>,
}

impl<'a> TaskRunner<'a> {
    pub fn new(
        tasks: &'a AgentTaskStore,
        notes: NoteStore,
        llm: Option<HttpLlmProvider>,
        vectors: Option<&'a VectorStore>,
        canvas: Option<&'a CanvasStore>,
        app: Option<&'a AppHandle>,
    ) -> Self {
        Self {
            tasks,
            notes,
            llm,
            vectors,
            canvas,
            app,
        }
    }

    /// 执行任务。允许从 Planned / AwaitingConfirm（确认后恢复）启动；
    /// 遇到待确认步骤 → 状态置 AwaitingConfirm 并暂停返回，等 agent_task_confirm 恢复。
    pub async fn run(&self, task: &mut Task) -> Result<(), AppError> {
        // 每个任务进程内互斥：并发 run/confirm 只能有一个执行者，防止写步骤被重复执行
        let run_lock = task_run_lock(&task.task_id);
        let _run_guard = run_lock.lock().await;
        if !matches!(task.status, TaskStatus::Planned | TaskStatus::AwaitingConfirm) {
            return Err(AppError::new(
                "taskNotRunnable",
                format!("任务处于 {:?}，无法从该状态启动执行", task.status),
            ));
        }
        if task.plan.is_empty() {
            // 规划策略：
            // 1) 结构化目标（前端入口生成）与关键词命中的技能 → 走定制流水线（确定性、可测、带确认）；
            // 2) 其余自由目标且配置了 LLM → 尝试 LLM 规划（补足规则规划覆盖不到的场景），失败回退规则；
            // 3) 无 LLM → 规则规划（note.search 兜底）。
            let has_curated = structured_skill(&task.goal).is_some()
                || SKILLS
                    .iter()
                    .any(|skill| skill.name != "note.search" && (skill.matches)(&task.goal));
            if has_curated {
                task.plan = plan_for_goal(&task.goal);
            } else if let Some(provider) = self.llm.as_ref() {
                match plan_with_llm(provider, &task.goal).await {
                    Ok(plan) if !plan.is_empty() => task.plan = plan,
                    _ => task.plan = plan_for_goal(&task.goal),
                }
            } else {
                task.plan = plan_for_goal(&task.goal);
            }
        }
        self.transition(task, TaskStatus::Running)?;

        let mut last_hits: Vec<NoteMetadata> = Vec::new();
        // 有序输出表：按步骤完成顺序追加，保证 {previousOutput} / last_* 取到的是
        // 真正"最近完成"的步骤输出（HashMap 迭代顺序随机，会静默取错步骤）
        let mut outputs: Vec<(String, Value)> = Vec::new();
        // Resume 恢复：把已完成的步骤输出装回上下文，供后续步骤
        // （note.read "top" 哨兵、note.export 取上一步笔记）使用
        for step in &task.plan {
            if step.status != StepStatus::Done {
                continue;
            }
            if let Some(output) = &step.output {
                outputs.push((step.step_id.clone(), output.clone()));
                if step.tool.as_deref() == Some("note.search") {
                    if let Ok(hits) = serde_json::from_value::<Vec<NoteMetadata>>(output.clone()) {
                        last_hits = hits;
                    }
                }
            }
        }

        for index in 0..task.plan.len() {
            let step_id = task.plan[index].step_id.clone();
            if matches!(
                task.plan[index].status,
                StepStatus::Done | StepStatus::Cancelled | StepStatus::Failed
            ) {
                continue;
            }
            // 待确认步骤 → 暂停
            if task.plan[index].required_confirm && !task.plan[index].confirmed {
                self.log(task, &step_id, "等待用户确认")?;
                self.transition(task, TaskStatus::AwaitingConfirm)?;
                if let Some(app) = self.app {
                    let _ = app.emit(
                        "agent.awaiting_confirm",
                        json!({
                            "taskId": task.task_id,
                            "stepId": step_id,
                            "tool": task.plan[index].tool,
                            "input": task.plan[index].input,
                        }),
                    );
                }
                return Ok(());
            }

            self.log(task, &step_id, "开始执行")?;
            // 步骤进入 Running 态：前端进度面板据此显示 "…" 运行指示
            task.plan[index].status = StepStatus::Running;
            self.tasks.update(task)?;
            self.emit_step(task, index);
            let mut outcome = self
                .execute_step(&task.plan[index], &task.task_id, &outputs)
                .await;
            // Observer：失败重试 1 次。仅对只读/幂等步骤重试——
            // 写类工具（note.create/update/chapter、canvas.node.create/batch-create 等）
            // 首次失败可能已落盘，重试会造成重复笔记/重复落卡。
            if outcome.is_err() && step_retry_is_safe(&task.plan[index]) {
                outcome = self
                    .execute_step(&task.plan[index], &task.task_id, &outputs)
                    .await;
            }

            let tool_name = task.plan[index].tool.clone();
            match outcome {
                Ok(output) => {
                    if tool_name.as_deref() == Some("note.search") {
                        last_hits = serde_json::from_value(output.clone()).unwrap_or_default();
                    }
                    outputs.push((step_id.clone(), output.clone()));
                    task.plan[index].output = Some(output);
                    task.plan[index].status = StepStatus::Done;
                    self.log(task, &step_id, "完成")?;
                }
                Err(error) => {
                    task.plan[index].status = StepStatus::Failed;
                    self.log(task, &step_id, &format!("执行失败：{}", error.message))?;
                }
            }
            self.tasks.update(task)?;
            self.emit_step(task, index);
        }

        // 汇总：写回 context，落最终状态，输出总线广播
        let failed = task
            .plan
            .iter()
            .any(|step| step.status == StepStatus::Failed);
        let summary = self.build_summary(task, &last_hits);
        task.context = Some(json!({
            "summary": summary,
            "hitCount": last_hits.len(),
        }));
        self.transition(task, if failed { TaskStatus::Failed } else { TaskStatus::Done })?;
        // Phase E：输出总线（语音播报 + Live2D 反馈 + UI 事件）
        if failed {
            output_bus::live2d(self.app, &task.task_id, "alert", 100, &summary);
            output_bus::ui(
                self.app,
                &task.task_id,
                json!({ "kind": "taskFailed", "summary": summary }),
            );
        } else {
            output_bus::speech(self.app, &task.task_id, &summary);
            output_bus::live2d(self.app, &task.task_id, "complete", 80, &summary);
            output_bus::ui(
                self.app,
                &task.task_id,
                json!({ "kind": "taskDone", "summary": summary }),
            );
        }
        Ok(())
    }

    /// 按 StepKind 分发执行
    async fn execute_step(
        &self,
        step: &Step,
        task_id: &str,
        outputs: &[(String, Value)],
    ) -> Result<Value, AppError> {
        match step.kind {
            StepKind::Tool => self.execute_tool(step, task_id, outputs).await,
            StepKind::Llm => self.execute_llm(step, task_id, outputs).await,
            StepKind::Confirm => Err(AppError::new(
                "confirmStep",
                "Confirm 步骤不能直接执行，需要用户确认",
            )),
            StepKind::Output => self.execute_output(step, task_id),
        }
    }

    /// Tool 步骤 → Rust 工具函数（原子 + 组合 + 产出型）
    async fn execute_tool(
        &self,
        step: &Step,
        task_id: &str,
        outputs: &[(String, Value)],
    ) -> Result<Value, AppError> {
        match step.tool.as_deref() {
            Some("note.search") => {
                let query = step
                    .input
                    .get("query")
                    .and_then(Value::as_str)
                    .unwrap_or_default();
                let limit = step
                    .input
                    .get("limit")
                    .and_then(Value::as_u64)
                    .unwrap_or(5) as usize;
                let hits = note_search(&self.notes, query, limit)?;
                serde_json::to_value(&hits)
                    .map_err(|e| AppError::new("serializeSearch", format!("序列化检索结果失败：{e}")))
            }
            Some("note.read") => {
                let id = match step.input.get("id").and_then(Value::as_str) {
                    Some("top") => last_search_hit(outputs, &step.step_id)?,
                    Some(id) => id.to_string(),
                    None => return Err(AppError::new("missingInput", "note.read 缺少输入参数 id")),
                };
                let note = note_read(&self.notes, &id)?;
                serde_json::to_value(&note)
                    .map_err(|e| AppError::new("serializeRead", format!("序列化笔记失败：{e}")))
            }
            Some("note.create") => {
                let title = step.input.get("title").and_then(Value::as_str).unwrap_or("");
                let raw_content = step
                    .input
                    .get("content")
                    .and_then(Value::as_str)
                    .unwrap_or("");
                // 工具输入模板：{previousOutput} → 上游步骤输出文本（组卡成文的落盘内容）
                let content = resolve_previous_output(raw_content, outputs);
                if content.trim().is_empty() {
                    // 上游 LLM 失败/未生成内容时禁止落空笔记（否则留下无意义的空笔记且任务仍 Failed）
                    return Err(AppError::new(
                        "emptyNoteContent",
                        "生成内容为空，未创建笔记（请检查上游 LLM 步骤）",
                    ));
                }
                let category = step
                    .input
                    .get("category")
                    .and_then(Value::as_str)
                    .unwrap_or_default();
                let note = self.notes.create_note(SaveNoteRequest {
                    title: title.to_string(),
                    content: content.trim().to_string(),
                    category: category.to_string(),
                })?;
                // 记忆写入：Agent 产出（组卡成文等）落盘即入向量库，供后续检索引用
                if let Some(vectors) = self.vectors {
                    if let Err(index_error) =
                        rag::index_source(vectors, &format!("note:{}", note.id), &content).await
                    {
                        log::debug!("[memory] 索引 Agent 产出笔记失败: {}", index_error.message);
                    }
                }
                // 成文留痕：若上游读过画布节点（组卡成文链路），把参与节点标记 drafted_by=新笔记 id
                if let Some(canvas) = self.canvas {
                    let node_ids: Vec<String> = outputs
                        .iter()
                        .filter_map(|(_, value)| value.get("nodes"))
                        .filter_map(Value::as_array)
                        .flat_map(|nodes| {
                            nodes
                                .iter()
                                .filter_map(|node| node.get("id").and_then(Value::as_str))
                                .map(str::to_string)
                        })
                        .collect();
                    if !node_ids.is_empty() {
                        if let Ok(mut canvas_doc) = canvas.list().and_then(|mut docs| {
                            docs.pop().ok_or_else(|| {
                                AppError::new("canvasEmpty", "没有可写入的画布")
                            })
                        }) {
                            let id_set: std::collections::HashSet<&str> =
                                node_ids.iter().map(String::as_str).collect();
                            // 遍历所有参与节点打标记（注意不能用 any()——会短路只处理第一个）
                            let mut changed = false;
                            for node in canvas_doc
                                .nodes
                                .iter_mut()
                                .filter(|node| id_set.contains(node.id.as_str()))
                            {
                                if node.drafted_by.as_deref() != Some(note.id.as_str()) {
                                    node.drafted_by = Some(note.id.clone());
                                    changed = true;
                                }
                            }
                            if changed {
                                let _ = canvas.save(canvas_doc);
                            }
                        }
                    }
                }
                if let Some(app) = self.app {
                    let _ = app.emit("notes-changed", ());
                }
                serde_json::to_value(&note)
                    .map_err(|e| AppError::new("serializeNote", format!("序列化笔记失败：{e}")))
            }
            Some("note.update") => {
                // 章节续写等：更新既有笔记。mode=append 追加到末尾（默认 replace 覆盖）
                let id = step
                    .input
                    .get("id")
                    .and_then(Value::as_str)
                    .ok_or_else(|| AppError::new("missingInput", "note.update 缺少输入参数 id"))?;
                let mode = step
                    .input
                    .get("mode")
                    .and_then(Value::as_str)
                    .unwrap_or("replace");
                let raw_content = step
                    .input
                    .get("content")
                    .and_then(Value::as_str)
                    .unwrap_or("");
                let content = resolve_previous_output(raw_content, outputs);
                let mut note = self.notes.read_note(id)?;
                let content = if mode == "append" && !note.content.trim().is_empty() {
                    format!("{}\n\n{}", note.content.trim_end(), content.trim())
                } else {
                    content.trim().to_string()
                };
                let updated = self.notes.update_note(
                    id,
                    SaveNoteRequest {
                        title: note.title.clone(),
                        content,
                        category: note.category.clone(),
                    },
                )?;
                // 记忆更新：内容变更后重索引（先删源再写入）
                if let Some(vectors) = self.vectors {
                    if let Err(index_error) = rag::index_source(
                        vectors,
                        &format!("note:{}", updated.id),
                        &updated.content,
                    )
                    .await
                    {
                        log::debug!("[memory] 重索引续写笔记失败: {}", index_error.message);
                    }
                }
                if let Some(app) = self.app {
                    let _ = app.emit("notes-changed", ());
                }
                serde_json::to_value(&updated)
                    .map_err(|e| AppError::new("serializeNote", format!("序列化笔记失败：{e}")))
            }
            Some("canvas.read") => {
                let canvas = self
                    .canvas
                    .ok_or_else(|| AppError::new("noCanvasProvider", "画布存储未初始化"))?;
                let id = step
                    .input
                    .get("canvasId")
                    .and_then(Value::as_str)
                    .unwrap_or("first");
                let mut doc = if id == "first" {
                    canvas
                        .list()?
                        .into_iter()
                        .next()
                        .ok_or_else(|| AppError::new("canvasEmpty", "没有可读取的画布"))?
                } else {
                    canvas.get(id)?
                };
                // 组卡成文：按 nodeIds 过滤节点（未传则读全部，兼容旧调用）
                if let Some(node_ids) = step.input.get("nodeIds").and_then(Value::as_array) {
                    let ids: std::collections::HashSet<&str> =
                        node_ids.iter().filter_map(Value::as_str).collect();
                    if !ids.is_empty() {
                        doc.nodes.retain(|node| ids.contains(node.id.as_str()));
                    }
                }
                serde_json::to_value(&doc)
                    .map_err(|e| AppError::new("serializeCanvas", format!("序列化画布失败：{e}")))
            }
            Some("canvas.node.create") => {
                let canvas = self
                    .canvas
                    .ok_or_else(|| AppError::new("noCanvasProvider", "画布存储未初始化"))?;
                let content = step
                    .input
                    .get("content")
                    .and_then(Value::as_str)
                    .ok_or_else(|| AppError::new("missingInput", "canvas.node.create 缺少 content"))?;
                let id = step
                    .input
                    .get("canvasId")
                    .and_then(Value::as_str)
                    .unwrap_or("first");
                let mut doc = if id == "first" {
                    canvas.list()?.into_iter().next().unwrap_or_else(|| CanvasDocument {
                        id: format!("canvas-{}", chrono::Utc::now().timestamp_millis()),
                        note_id: None,
                        co_write_session_id: None,
                        nodes: Vec::new(),
                        edges: Vec::new(),
                        groups: Vec::new(),
                    })
                } else {
                    canvas.get(id)?
                };
                let node = CanvasNode {
                    id: format!("node-{}", chrono::Utc::now().timestamp_millis()),
                    node_type: "text".to_string(),
                    x: 0.0,
                    y: 0.0,
                    width: 240.0,
                    height: 80.0,
                    text: content.to_string(),
                    source: Some("agent".to_string()),
                    z_index: 0,
                    ..CanvasNode::default()
                };
                doc.nodes.push(node.clone());
                canvas.save(doc)?;
                serde_json::to_value(&node)
                    .map_err(|e| AppError::new("serializeCanvas", format!("序列化节点失败：{e}")))
            }
            Some("canvas.save-groups") => {
                // AI 自动分组写回：从上一步 LLM 输出解析分组，替换旧 AI 分组（group-ai-*），
                // 并更新节点归属。手动分组（非 group-ai-*）保留不动。
                let canvas = self
                    .canvas
                    .ok_or_else(|| AppError::new("noCanvasProvider", "画布存储未初始化"))?;
                let llm_text = last_llm_output_text(outputs)
                    .ok_or_else(|| AppError::new("groupParse", "缺少 LLM 分组结果"))?;
                let specs = parse_group_plan(&llm_text)?;
                let id = step
                    .input
                    .get("canvasId")
                    .and_then(Value::as_str)
                    .unwrap_or("first");
                let mut doc = if id == "first" {
                    canvas
                        .list()?
                        .into_iter()
                        .next()
                        .ok_or_else(|| AppError::new("canvasEmpty", "没有可写入的画布"))?
                } else {
                    canvas.get(id)?
                };
                // 先解除旧 AI 分组的节点归属，再写入新分组（apply_ai_groups 内处理）
                apply_ai_groups(&mut doc, &specs);
                canvas.save(doc.clone())?;
                serde_json::to_value(&doc)
                    .map_err(|e| AppError::new("serializeCanvas", format!("序列化画布失败：{e}")))
            }
            Some("canvas.batch-create") => {
                // 知识采集落卡：从上一步 LLM 输出解析知识卡，批量落入画布，
                // 同时落一张 question 卡并自动 cites 连线到各知识卡。
                let canvas = self
                    .canvas
                    .ok_or_else(|| AppError::new("noCanvasProvider", "画布存储未初始化"))?;
                let llm_text = last_llm_output_text(outputs)
                    .ok_or_else(|| AppError::new("collectParse", "缺少 LLM 提炼结果"))?;
                let cards = parse_collect_cards(&llm_text)?;
                let id = step
                    .input
                    .get("canvasId")
                    .and_then(Value::as_str)
                    .unwrap_or("first");
                let question = step
                    .input
                    .get("question")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .trim()
                    .to_string();
                let mut doc = if id == "first" {
                    canvas
                        .list()?
                        .into_iter()
                        .next()
                        .ok_or_else(|| AppError::new("canvasEmpty", "没有可写入的画布"))?
                } else {
                    canvas.get(id)?
                };
                let now = chrono::Utc::now().timestamp_millis();
                let mut question_id: Option<String> = None;
                if !question.is_empty() {
                    question_id = Some(format!("node-{now}-q"));
                    doc.nodes.push(CanvasNode {
                        id: question_id.clone().unwrap(),
                        node_type: "question".to_string(),
                        x: 80.0,
                        y: 80.0,
                        width: 240.0,
                        height: 90.0,
                        text: question.clone(),
                        source: Some("agent".to_string()),
                        z_index: 0,
                        fields: std::collections::HashMap::from([(
                            "status".to_string(),
                            "已答".to_string(),
                        )]),
                        ..CanvasNode::default()
                    });
                }
                let mut knowledge_ids: Vec<String> = Vec::new();
                for (index, card) in cards.iter().enumerate() {
                    let node_id = format!("node-{now}-k{index}");
                    let mut fields = std::collections::HashMap::new();
                    if !card.url.is_empty() {
                        fields.insert("url".to_string(), card.url.clone());
                    }
                    if !card.title.is_empty() {
                        fields.insert("title".to_string(), card.title.clone());
                    }
                    doc.nodes.push(CanvasNode {
                        id: node_id.clone(),
                        node_type: "knowledge".to_string(),
                        x: 80.0 + (index as f64 % 2.0) * 300.0,
                        y: 220.0 + (index as f64 / 2.0).floor() * 140.0,
                        width: 280.0,
                        height: 120.0,
                        text: card.text.clone(),
                        source: Some("agent".to_string()),
                        z_index: 0,
                        fields,
                        ..CanvasNode::default()
                    });
                    knowledge_ids.push(node_id);
                }
                // question 卡 → 各知识卡 cites 连线
                if let Some(qid) = &question_id {
                    for kid in &knowledge_ids {
                        doc.edges.push(CanvasEdge {
                            id: format!("edge-{now}-{kid}"),
                            from_node_id: qid.clone(),
                            to_node_id: kid.clone(),
                            style: "solid".to_string(),
                            relation_type: "cites".to_string(),
                            ..CanvasEdge::default()
                        });
                    }
                }
                canvas.save(doc.clone())?;
                let summary = format!(
                    "已采集 {} 条知识卡{}",
                    knowledge_ids.len(),
                    if question_id.is_some() { "（含问题卡与来源连线）" } else { "" }
                );
                serde_json::to_value(json!({ "ok": true, "summary": summary, "cardCount": knowledge_ids.len() }))
                    .map_err(|e| AppError::new("serializeCanvas", format!("序列化失败：{e}")))
            }
            Some("web.search") => {
                let query = step
                    .input
                    .get("query")
                    .and_then(Value::as_str)
                    .unwrap_or_default();
                let limit = step
                    .input
                    .get("limit")
                    .and_then(Value::as_u64)
                    .unwrap_or(5) as usize;
                let config = self.notes.load_config()?;
                if config.searxng_url.trim().is_empty() {
                    // 未配置 SearXNG：软降级而非报错——步骤照常完成并携带提示，
                    // 下游 LLM 步骤据此改为离线作答，避免知识采集/联网调研整条任务失败。
                    return Ok(json!({
                        "results": [],
                        "notice": "未配置 SearXNG 地址（设置 → AI 集成 → Web 搜索），本次基于模型自身知识作答（无来源链接）"
                    }));
                }
                // 搜索实例异常（宕机/限流/禁用 JSON）同样软降级，保证知识采集永远可用
                match searxng_search(&config.searxng_url, query, limit).await {
                    Ok(results) => serde_json::to_value(&results).map_err(|e| {
                        AppError::new("serializeSearch", format!("序列化搜索结果失败：{e}"))
                    }),
                    Err(error) => Ok(json!({
                        "results": [],
                        "notice": format!(
                            "联网搜索暂不可用（{}），本次基于模型自身知识作答（无来源链接）",
                            error.message
                        )
                    })),
                }
            }
            Some("note.export") => {
                // 产物型工具：把上一步 note.read 读到的笔记导出。
                // markdown → Rust 直接落盘；png/pdf → 前端接管渲染（Rust 不落盘，
                // 把内容随 agent.export 事件交给前端生成图片并保存，保证所见即所得）。
                let format = step
                    .input
                    .get("format")
                    .and_then(Value::as_str)
                    .unwrap_or("markdown");
                if !matches!(format, "markdown" | "png" | "pdf") {
                    return Err(AppError::new(
                        "unsupportedExportFormat",
                        format!("暂不支持的导出格式：{format}"),
                    ));
                }
                let note = last_read_note(outputs)?;
                let title = note["title"].as_str().unwrap_or("未命名笔记");
                let content = note["content"].as_str().unwrap_or_default();
                if format == "markdown" {
                    let export_dir = self.notes.base_dir().join("exports");
                    std::fs::create_dir_all(&export_dir).map_err(|e| {
                        AppError::new("exportWrite", format!("创建导出目录失败：{e}"))
                    })?;
                    // 同名文件不覆盖：追加序号（标题.md、标题-2.md、标题-3.md…）
                    let base = sanitize_filename(title);
                    let mut path = export_dir.join(format!("{base}.md"));
                    let mut counter = 2;
                    while path.exists() {
                        path = export_dir.join(format!("{base}-{counter}.md"));
                        counter += 1;
                    }
                    std::fs::write(&path, format!("# {title}\n\n{content}\n")).map_err(|e| {
                        AppError::new("exportWrite", format!("写入导出文件失败：{e}"))
                    })?;
                    if let Some(app) = self.app {
                        let _ = app.emit(
                            "agent.export",
                            json!({
                                "kind": "note",
                                "path": path.to_string_lossy(),
                                "format": format,
                                "title": title,
                            }),
                        );
                    }
                    Ok(json!({
                        "path": path.to_string_lossy(),
                        "format": format,
                        "title": title,
                    }))
                } else {
                    // PNG/PDF：前端接管渲染，事件携带完整内容（保真由前端渲染 + 单测兜底）
                    if let Some(app) = self.app {
                        let _ = app.emit(
                            "agent.export",
                            json!({
                                "kind": "note",
                                "format": format,
                                "title": title,
                                "content": content,
                            }),
                        );
                    }
                    Ok(json!({
                        "format": format,
                        "title": title,
                        "exportedBy": "frontend",
                    }))
                }
            }
            Some("canvas.organize") => {
                // 产出型工具：画布节点网格排版（每行 3 个、间距 40px），消除重叠
                let canvas = self
                    .canvas
                    .ok_or_else(|| AppError::new("noCanvasProvider", "画布存储未初始化"))?;
                let id = step
                    .input
                    .get("canvasId")
                    .and_then(Value::as_str)
                    .unwrap_or("first");
                let mut doc = if id == "first" {
                    canvas
                        .list()?
                        .into_iter()
                        .next()
                        .ok_or_else(|| AppError::new("canvasEmpty", "没有可整理的画布"))?
                } else {
                    canvas.get(id)?
                };                let mut x = 40.0f64;
                let mut y = 40.0f64;
                let mut col = 0usize;
                let mut row_height = 0.0f64;
                for node in doc.nodes.iter_mut() {
                    node.x = x;
                    node.y = y;
                    x += node.width + 40.0;
                    row_height = row_height.max(node.height);
                    col += 1;
                    if col >= 3 {
                        x = 40.0;
                        y += row_height + 40.0;
                        col = 0;
                        row_height = 0.0;
                    }
                }
                canvas.save(doc.clone())?;
                serde_json::to_value(&doc)
                    .map_err(|e| AppError::new("serializeCanvas", format!("序列化画布失败：{e}")))
            }
            Some("canvas.save") => {
                // 产出型工具：把上一步 LLM 输出写回画布（扩写/润色链路收尾）。
                // input.nodeId 命中 → 更新该节点文本；否则追加新 agent 文本节点。
                let canvas = self
                    .canvas
                    .ok_or_else(|| AppError::new("noCanvasProvider", "画布存储未初始化"))?;
                let id = step
                    .input
                    .get("canvasId")
                    .and_then(Value::as_str)
                    .unwrap_or("first");
                let node_id = step.input.get("nodeId").and_then(Value::as_str);
                let content = last_llm_output_text(outputs).ok_or_else(|| {
                    AppError::new(
                        "noLlmOutput",
                        "canvas.save 需要前置 LLM 步骤的生成结果（扩写/润色）",
                    )
                })?;
                let doc = canvas_write_back(&canvas, id, node_id, &content)?;
                if let Some(app) = self.app {
                    let _ = app.emit("canvas-changed", ());
                }
                serde_json::to_value(&doc)
                    .map_err(|e| AppError::new("serializeCanvas", format!("序列化画布失败：{e}")))
            }
            Some("llm.generate") => self.execute_llm(step, task_id, outputs).await,
            Some(other) => Err(AppError::new(
                "unknownTool",
                format!("未知工具：{other}"),
            )),
            None => Err(AppError::new("missingTool", "Tool 步骤缺少工具名")),
        }
    }

    /// Llm 步骤（Phase C）：记忆注入（Phase F）+ LLM 生成
    async fn execute_llm(
        &self,
        step: &Step,
        task_id: &str,
        outputs: &[(String, Value)],
    ) -> Result<Value, AppError> {
        let provider = self.llm.as_ref().ok_or_else(|| {
            AppError::new(
                "noLlmProvider",
                "未配置可用的 LLM 供应商（设置 → AI 集成）",
            )
        })?;
        let mut prompt = match step.input.get("prompt").and_then(Value::as_str) {
            Some(p) => p.to_string(),
            None => {
                let template = step
                    .input
                    .get("promptTemplate")
                    .and_then(Value::as_str)
                    .unwrap_or("请根据以下材料完成：\n{previousOutput}");
                // 有序输出表：最后一个即"最近完成的步骤"的输出（确定性）
                let previous = outputs
                    .last()
                    .map(|(_, value)| output_text(value))
                    .unwrap_or_default();
                template.replace("{previousOutput}", &previous)
            }
        };
        // Phase F：RAG 记忆注入（input.retrieve 触发语义检索）；
        // 召回内容随输出带回前端，任务面板可展示"记忆层"（透明可观察）
        let mut memory_context = String::new();
        if let Some(query) = step.input.get("retrieve").and_then(Value::as_str) {
            if !query.trim().is_empty() {
                let context = self.retrieve_context(query, 5).await?;
                if !context.is_empty() {
                    prompt = format!("相关笔记资料：\n{context}\n\n任务：\n{prompt}");
                    memory_context = context;
                }
            }
        }
        output_bus::live2d(self.app, task_id, "thinking", 40, "思考中…");
        let text = provider
            .complete_prompt(
                "你是花箴里的 AI 助手。回答要准确、简洁、贴合用户的本地笔记与画布内容，不要编造。",
                &prompt,
                2048,
            )
            .await?;
        Ok(json!({ "text": text, "context": memory_context }))
    }

    /// Phase F：从向量库检索相关块拼成上下文。
    /// 全程 best-effort：未配置 embedding 供应商 / 检索失败时返回空串，
    /// 绝不因记忆注入失败而拖垮整条任务（与 rag::index_source 的降级语义一致）。
    async fn retrieve_context(&self, query: &str, top_k: usize) -> Result<String, AppError> {
        let Some(vectors) = self.vectors else { return Ok(String::new()) };
        let Ok(config) = default_store().and_then(|store| store.load_config()) else {
            return Ok(String::new());
        };
        let Ok(endpoint) = resolve_endpoint(&config) else {
            return Ok(String::new());
        };
        let Ok(provider) = crate::services::agent::llm_provider::HttpEmbeddingProvider::new(endpoint)
        else {
            return Ok(String::new());
        };
        let model = provider.model().to_string();
        match rag::retrieve(vectors, &model, query, top_k, |text| provider.embed(text)).await {
            Ok(chunks) => Ok(rag::build_context(&chunks, 1500)),
            Err(error) => {
                log::debug!("[memory] 检索记忆上下文失败（已跳过注入）: {}", error.message);
                Ok(String::new())
            }
        }
    }

    /// Output 步骤（Phase E）：分发到输出总线
    fn execute_output(&self, step: &Step, task_id: &str) -> Result<Value, AppError> {
        let text = step.input.get("text").and_then(Value::as_str).unwrap_or_default();
        match step.input.get("action").and_then(Value::as_str) {
            Some("speech") => output_bus::speech(self.app, task_id, text),
            Some("live2d") => {
                let action = step
                    .input
                    .get("actionName")
                    .and_then(Value::as_str)
                    .unwrap_or("speak");
                let priority = step
                    .input
                    .get("priority")
                    .and_then(Value::as_i64)
                    .unwrap_or(50);
                output_bus::live2d(self.app, task_id, action, priority, text);
            }
            Some("ui") => {
                output_bus::ui(self.app, task_id, step.input.clone());
            }
            Some(other) => {
                return Err(AppError::new(
                    "unknownOutputAction",
                    format!("未知输出动作：{other}"),
                ))
            }
            None => output_bus::ui(self.app, task_id, step.input.clone()),
        }
        Ok(json!({ "ok": true }))
    }

    /// 状态机转移 + 持久化 + 广播任务状态
    fn transition(&self, task: &mut Task, status: TaskStatus) -> Result<(), AppError> {
        task.status = status;
        self.tasks.update(task)?;
        self.emit_task(task);
        Ok(())
    }

    /// 追加步骤日志（供 UI 进度面板）
    fn log(&self, task: &mut Task, step_id: &str, message: &str) -> Result<(), AppError> {
        task.logs.push(crate::services::agent::task_store::StepLog {
            step_id: step_id.to_string(),
            message: message.to_string(),
            timestamp: chrono::Utc::now().to_rfc3339(),
        });
        Ok(())
    }

    /// emit agent.step：单步进度（开始/完成/失败）
    fn emit_step(&self, task: &Task, index: usize) {
        let Some(app) = self.app else { return };
        let step = &task.plan[index];
        let message = task
            .logs
            .iter()
            .rev()
            .find(|log| log.step_id == step.step_id)
            .map(|log| log.message.clone())
            .unwrap_or_default();
        let _ = app.emit(
            "agent.step",
            json!({
                "taskId": task.task_id,
                "stepId": step.step_id,
                "tool": step.tool,
                "status": step.status,
                "message": message,
            }),
        );
    }

    /// emit agent.task：任务全量状态（状态机变更后广播，前端镜像展示）
    fn emit_task(&self, task: &Task) {
        if let Some(app) = self.app {
            let _ = app.emit("agent.task", task);
        }
    }

    /// 汇总执行结果，写进 context.summary
    fn build_summary(&self, task: &Task, last_hits: &[NoteMetadata]) -> String {
        // 知识采集：canvas.batch-create 自带落卡汇总（已采集 N 条知识卡）
        if let Some(summary) = task
            .plan
            .iter()
            .find(|step| step.tool.as_deref() == Some("canvas.batch-create"))
            .and_then(|step| step.output.as_ref())
            .and_then(|out| out.get("summary"))
            .and_then(Value::as_str)
            .filter(|s| !s.is_empty())
        {
            return summary.to_string();
        }
        // 新建笔记成功：报告笔记标题（总结/成文/调研等）
        if let Some(title) = task
            .plan
            .iter()
            .find(|step| step.tool.as_deref() == Some("note.create"))
            .and_then(|step| step.output.as_ref())
            .and_then(|out| out.get("title"))
            .and_then(Value::as_str)
            .filter(|t| !t.is_empty())
        {
            return format!("已生成笔记《{title}》");
        }
        let read_title = task
            .plan
            .iter()
            .find(|step| step.tool.as_deref() == Some("note.read"))
            .and_then(|step| {
                step.output
                    .as_ref()
                    .and_then(|out| out.get("title"))
                    .and_then(Value::as_str)
            })
            .map(str::to_string);
        let generated = task
            .plan
            .iter()
            .find(|step| matches!(step.kind, StepKind::Llm))
            .and_then(|step| step.output.as_ref())
            .and_then(|out| out.get("text"))
            .and_then(Value::as_str)
            .map(|s| s.chars().take(40).collect::<String>());
        match (generated, read_title) {
            (Some(g), Some(t)) => format!("已找到 {} 条相关笔记，读取《{t}》，生成：{g}…", last_hits.len()),
            (Some(g), None) => format!("已找到 {} 条相关笔记，生成：{g}…", last_hits.len()),
            (None, Some(t)) => format!("已找到 {} 条相关笔记，读取了《{t}》。", last_hits.len()),
            (None, None) => "未找到相关笔记。".to_string(),
        }
    }
}

/// 从 outputs 里找最近一次 note.read 读到的笔记（Note JSON 含 title + content）
fn last_read_note(outputs: &[(String, Value)]) -> Result<Value, AppError> {
    outputs
        .iter()
        .rev()
        .find(|(_, value)| value.get("title").is_some() && value.get("content").is_some())
        .map(|(_, value)| value.clone())
        .ok_or_else(|| AppError::new("noNoteRead", "导出前需要先读取笔记（note.read）"))
}

/// 文件名清洗：去掉 Windows 非法字符，空名回退"导出"
fn sanitize_filename(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .filter(|c| !matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' | '\0'))
        .collect();
    let trimmed = cleaned.trim();
    if trimmed.is_empty() {
        "导出".to_string()
    } else {
        trimmed.to_string()
    }
}

/// 从 outputs 里找最近一次 note.search 命中的第一条 id（供 "top" 哨兵）
fn last_search_hit(outputs: &[(String, Value)], current_step: &str) -> Result<String, AppError> {
    outputs
        .iter()
        .filter(|(id, _)| id.as_str() != current_step)
        .filter_map(|(_, value)| value.as_array())
        .flatten()
        .next()
        .and_then(|first| first.get("id"))
        .and_then(Value::as_str)
        .map(str::to_string)
        .ok_or_else(|| AppError::new("noteSearchEmpty", "检索没有命中，无法读取笔记"))
}

/// 把步骤输出转成喂给 LLM 的文本
fn output_text(value: &Value) -> String {
    if let Some(t) = value.get("text").and_then(Value::as_str) {
        return t.to_string();
    }
    if let Some(c) = value.get("content").and_then(Value::as_str) {
        return c.to_string();
    }
    // 画布文档（canvas.read 输出）：渲染成可读的卡片列表；有分组时按分组组织（成文按分组输出）
    if let Some(nodes) = value.get("nodes").and_then(Value::as_array) {
        // 分组 id → 标题 映射
        let group_titles: std::collections::HashMap<&str, &str> = value
            .get("groups")
            .and_then(Value::as_array)
            .map(|groups| {
                groups
                    .iter()
                    .filter_map(|g| {
                        let id = g.get("id").and_then(Value::as_str)?;
                        let title = g.get("title").and_then(Value::as_str).unwrap_or("");
                        Some((id, title))
                    })
                    .collect()
            })
            .unwrap_or_default();
        let mut lines: Vec<String> = Vec::new();
        for node in nodes {
            let text = node
                .get("text")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|s| !s.is_empty());
            let group_id = node.get("group").and_then(Value::as_str);
            let group_title = group_id
                .and_then(|id| group_titles.get(id).copied())
                .unwrap_or("");
            if !group_title.is_empty() {
                let header = format!("【{group_title}】");
                if lines.last().map(String::as_str) != Some(header.as_str()) {
                    lines.push(header);
                }
            }
            if let Some(text) = text {
                lines.push(format!("- {text}"));
            }
        }
        if !lines.is_empty() {
            return lines.join("\n");
        }
    }
    value.to_string()
}

/// 工具输入模板：{previousOutput} → 上游步骤输出文本（组卡成文的落盘内容）。
/// 输出为空时原样返回（避免把空内容写进笔记）。
pub fn resolve_previous_output(raw: &str, outputs: &[(String, Value)]) -> String {
    if raw.contains("{previousOutput}") {
        let previous = outputs
            .last()
            .map(|(_, value)| output_text(value))
            .unwrap_or_default();
        raw.replace("{previousOutput}", &previous)
    } else {
        raw.to_string()
    }
}

/// 从 outputs 里取最近一次 LLM 生成文本（扩写/润色链路中只有 LLM 步骤产出 {text}）
fn last_llm_output_text(outputs: &[(String, Value)]) -> Option<String> {
    outputs
        .iter()
        .rev()
        .find_map(|(_, value)| value.get("text").and_then(Value::as_str))
        .map(str::to_string)
}

/// 把 LLM 生成内容写回画布（canvas.save 工具核心）：
/// - node_id 命中 → 更新该节点文本并标记 source=agent
/// - 未提供/未命中 → 追加一个 agent 文本节点（兜底）
/// 返回写回后的完整画布文档。
pub fn canvas_write_back(
    canvas: &CanvasStore,
    canvas_id: &str,
    node_id: Option<&str>,
    content: &str,
) -> Result<CanvasDocument, AppError> {
    let mut doc = if canvas_id == "first" {
        canvas
            .list()?
            .into_iter()
            .next()
            .ok_or_else(|| AppError::new("canvasEmpty", "没有可写入的画布"))?
    } else {
        canvas.get(canvas_id)?
    };
    let trimmed = content.trim();
    if trimmed.is_empty() {
        return Err(AppError::new("emptyLlmOutput", "LLM 生成内容为空，未写回画布"));
    }
    if let Some(node_id) = node_id {
        let hit = doc
            .nodes
            .iter_mut()
            .find(|node| node.id == node_id)
            .ok_or_else(|| AppError::new("nodeNotFound", format!("画布中不存在节点：{node_id}")))?;
        hit.text = trimmed.to_string();
        hit.source = Some("agent".to_string());
    } else {
        doc.nodes.push(CanvasNode {
            id: format!("node-{}", chrono::Utc::now().timestamp_millis()),
            node_type: "text".to_string(),
            x: 0.0,
            y: 0.0,
            width: 240.0,
            height: 80.0,
            text: trimmed.to_string(),
            source: Some("agent".to_string()),
            z_index: 0,
            ..CanvasNode::default()
        });
    }
    canvas.save(doc.clone())?;
    Ok(doc)
}

// ── IPC ───────────────────────────────────────────────────────────────────────

/// 构造生产环境 runner（LLM 可选：配置缺失时规则规划兜底）
fn production_runner<'a>(
    app: &'a AppHandle,
    store: &'a AgentTaskStore,
    vectors: &'a VectorStore,
    canvas: &'a CanvasStore,
) -> Result<TaskRunner<'a>, AppError> {
    let notes = default_store()?;
    let llm = resolve_endpoint(&notes.load_config()?)
        .ok()
        .map(HttpLlmProvider::new);
    Ok(TaskRunner::new(
        store,
        notes,
        llm,
        Some(vectors),
        Some(canvas),
        Some(app),
    ))
}

/// IPC：创建并运行任务（最小闭环入口：TS 发目标 → Rust 规划执行 → 面板看进度）
#[tauri::command]
pub async fn agent_task_create_and_run(
    app: AppHandle,
    store: tauri::State<'_, AgentTaskStore>,
    vectors: tauri::State<'_, VectorStore>,
    canvas: tauri::State<'_, CanvasStore>,
    goal: String,
) -> Result<Task, AppError> {
    let mut task = Task::new(
        format!(
            "task-{}-{}",
            chrono::Utc::now().timestamp_millis(),
            uuid::Uuid::new_v4().simple().to_string().chars().take(6).collect::<String>()
        ),
        goal,
    );
    store.create(&task)?;
    let runner = production_runner(&app, &store, &vectors, &canvas)?;
    runner.run(&mut task).await?;
    Ok(task)
}

/// IPC：运行已存在的任务（agent_task_create 创建后触发执行）
#[tauri::command]
pub async fn agent_task_run(
    app: AppHandle,
    store: tauri::State<'_, AgentTaskStore>,
    vectors: tauri::State<'_, VectorStore>,
    canvas: tauri::State<'_, CanvasStore>,
    task_id: String,
) -> Result<Task, AppError> {
    let mut task = store
        .get(&task_id)?
        .ok_or_else(|| AppError::new("taskNotFound", format!("任务 {task_id} 不存在")))?;
    let runner = production_runner(&app, &store, &vectors, &canvas)?;
    runner.run(&mut task).await?;
    Ok(task)
}

/// IPC：确认/拒绝待确认步骤。ok=true → 标记确认并恢复执行；ok=false → 取消该步骤与任务。
/// payload 可选：确认 note.create 步骤时可携带 { title?, content? } 覆盖落盘内容（产出预览编辑后落盘）。
#[tauri::command]
pub async fn agent_task_confirm(
    app: AppHandle,
    store: tauri::State<'_, AgentTaskStore>,
    vectors: tauri::State<'_, VectorStore>,
    canvas: tauri::State<'_, CanvasStore>,
    task_id: String,
    step_id: String,
    ok: bool,
    payload: Option<Value>,
) -> Result<Task, AppError> {
    let mut task = store
        .get(&task_id)?
        .ok_or_else(|| AppError::new("taskNotFound", format!("任务 {task_id} 不存在")))?;
    // 安全校验：只有暂停等待确认的任务可以确认，且 step 必须是当前暂停的待确认步骤
    if task.status != TaskStatus::AwaitingConfirm {
        return Err(AppError::new(
            "taskNotAwaitingConfirm",
            format!("任务处于 {:?}，无法确认步骤", task.status),
        ));
    }
    let awaiting_step = task.plan.iter().find(|s| {
        s.required_confirm
            && !s.confirmed
            && !matches!(s.status, StepStatus::Done | StepStatus::Cancelled | StepStatus::Failed)
    });
    if !awaiting_step.is_some_and(|s| s.step_id == step_id) {
        return Err(AppError::new(
            "stepNotAwaiting",
            format!("步骤 {step_id} 不是当前待确认步骤"),
        ));
    }
    let step = task
        .plan
        .iter_mut()
        .find(|step| step.step_id == step_id)
        .expect("awaiting_step 已确认存在");
    step.confirmed = true;
    if !ok {
        step.status = StepStatus::Cancelled;
        task.status = TaskStatus::Cancelled;
        store.update(&task)?;
        return Ok(task);
    }
    // 产出预览覆盖：note.create 步骤允许用用户编辑后的 title/content 落盘
    if let Some(payload) = payload {
        if let (Some(obj), Some(input)) = (payload.as_object(), step.input.as_object_mut()) {
            if let Some(title) = obj.get("title").and_then(Value::as_str) {
                if !title.trim().is_empty() {
                    input.insert("title".into(), Value::String(title.trim().to_string()));
                }
            }
            if let Some(content) = obj.get("content").and_then(Value::as_str) {
                if !content.trim().is_empty() {
                    input.insert("content".into(), Value::String(content.trim().to_string()));
                }
            }
        }
    }
    store.update(&task)?;
    let runner = production_runner(&app, &store, &vectors, &canvas)?;
    runner.run(&mut task).await?;
    Ok(task)
}

/// IPC：列出全部产品 Agent 技能（名字 + 描述，供对话侧技能选择/技能面板展示）
#[tauri::command]
pub fn agent_skill_list() -> Vec<serde_json::Value> {
    skill_registry()
        .into_iter()
        .map(|skill| {
            json!({
                "name": skill.name,
                "description": skill.description,
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::agent::task_store::AgentTaskStore;
    use crate::services::notes::SaveNoteRequest;
    use std::path::PathBuf;

    fn temp_dir(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "floral_orchestrator_test_{}_{}",
            std::process::id(),
            name
        ))
    }

    fn notes_store(name: &str) -> NoteStore {
        let dir = temp_dir(name);
        let _ = std::fs::remove_dir_all(&dir);
        NoteStore::new(dir)
    }

    fn seed_note(store: &NoteStore, title: &str, content: &str, category: &str) -> String {
        store
            .create_note(SaveNoteRequest {
                title: title.into(),
                content: content.into(),
                category: category.into(),
            })
            .unwrap()
            .id
    }

    fn task_store(name: &str) -> AgentTaskStore {
        let path = temp_dir(name).join("tasks.sqlite");
        let _ = std::fs::remove_dir_all(temp_dir(name));
        AgentTaskStore::new(&path)
    }

    fn runner<'a>(
        tasks: &'a AgentTaskStore,
        notes: &NoteStore,
    ) -> TaskRunner<'a> {
        TaskRunner::new(tasks, notes.clone(), None, None, None, None)
    }

    #[test]
    fn extract_query_strips_prefixes_and_suffixes() {
        assert_eq!(extract_query("帮我找一下关于 RAG 的笔记"), "RAG");
        assert_eq!(extract_query("查找夏天的记忆"), "夏天的记忆");
        assert_eq!(extract_query("检索 向量检索 相关笔记"), "向量检索");
        assert_eq!(extract_query("帮我搜索 gsap 相关内容"), "gsap");
        assert_eq!(extract_query(""), "");
    }

    #[test]
    fn extract_query_strips_multiple_leading_verbs() {
        // 连续动词前缀要剥干净："请帮我搜索 X" → 先剥"请帮我"再剥"搜索"
        assert_eq!(extract_query("请帮我搜索 Tauri"), "Tauri");
        assert_eq!(extract_query("帮我搜索 RAG"), "RAG");
        assert_eq!(extract_query("帮我查找一下向量检索"), "向量检索");
    }

    #[test]
    fn extract_node_id_skips_junk_tokens() {
        // 前端格式：node- 前缀 id
        assert_eq!(extract_node_id("扩写节点 node-123 的内容：原文").as_deref(), Some("node-123"));
        // 无 node 前缀时取首个非虚词 token
        assert_eq!(extract_node_id("扩写节点 n1 的内容：原文").as_deref(), Some("n1"));
        // "扩写这个节点的内容：X" 不应解析出 id="的"
        assert_ne!(extract_node_id("扩写这个节点的内容：原文").as_deref(), Some("的"));
    }

    #[test]
    fn parse_first_json_ignores_trailing_garbage_with_braces() {
        let value = parse_first_json(
            "```json\n{\"cards\": [{\"text\": \"a\"}]}\n``` 以及补充说明：注意结尾 } 别被吃掉",
        )
        .unwrap();
        assert_eq!(value["cards"][0]["text"], "a");
        // 无 JSON 时明确报错而非乱截
        assert!(parse_first_json("没有 JSON 内容").is_err());
    }

    #[test]
    fn query_terms_filters_stopwords_and_short_tokens() {
        assert_eq!(query_terms("RAG 向量"), vec!["rag", "向量"]);
        assert_eq!(query_terms("关于 RAG 的笔记"), vec!["rag"]);
        assert_eq!(query_terms("a"), Vec::<String>::new());
    }

    #[test]
    fn plan_for_goal_builds_search_then_read_pipeline() {
        let plan = plan_for_goal("帮我找一下关于 Live2D 的笔记");
        assert_eq!(plan.len(), 2);
        assert_eq!(plan[0].tool.as_deref(), Some("note.search"));
        assert_eq!(plan[0].input["query"], "Live2D");
        assert_eq!(plan[1].tool.as_deref(), Some("note.read"));
        assert_eq!(plan[1].input["id"], "top");
        assert!(plan.iter().all(|step| step.status == StepStatus::Pending));
    }

    #[test]
    fn plan_for_goal_expands_summarize_pipeline() {
        let plan = plan_for_goal("总结一下关于 RAG 的笔记");
        assert_eq!(plan.len(), 4);
        assert_eq!(plan[0].tool.as_deref(), Some("note.search"));
        assert_eq!(plan[1].tool.as_deref(), Some("note.read"));
        assert!(plan[2].kind == StepKind::Llm);
        assert_eq!(plan[3].tool.as_deref(), Some("note.create"));
        assert!(plan[3].required_confirm);
    }

    #[test]
    fn plan_for_goal_expands_canvas_write_pipeline() {
        let plan = plan_for_goal("把画布整理成文章");
        assert_eq!(plan.len(), 3);
        assert_eq!(plan[0].tool.as_deref(), Some("canvas.read"));
        assert!(plan[1].kind == StepKind::Llm);
        assert_eq!(plan[2].tool.as_deref(), Some("note.create"));
        assert!(plan[2].required_confirm);
    }

    #[test]
    fn parses_llm_plan_json() {
        let text = r#"{
            "steps": [
                {"kind":"Tool","tool":"note.search","input":{"query":"RAG","limit":3}},
                {"kind":"Llm","tool":"llm.generate","input":{"prompt":"总结"}},
                {"kind":"Tool","tool":"note.create","input":{"title":"t"},"requiredConfirm":true}
            ]
        }"#;
        let plan = parse_llm_plan(text).unwrap();
        assert_eq!(plan.len(), 3);
        assert_eq!(plan[0].tool.as_deref(), Some("note.search"));
        assert_eq!(plan[0].input["query"], "RAG");
        assert!(plan[1].kind == StepKind::Llm);
        assert!(plan[2].required_confirm);
    }

    #[test]
    fn parse_llm_plan_strips_code_fence() {
        let text = "```json\n{\"steps\":[{\"kind\":\"Tool\",\"tool\":\"note.search\",\"input\":{\"query\":\"x\"}}]}\n```";
        let plan = parse_llm_plan(text).unwrap();
        assert_eq!(plan.len(), 1);
    }

    #[test]
    fn parse_llm_plan_rejects_garbage() {
        assert!(parse_llm_plan("不是 JSON").is_err());
    }

    #[test]
    fn note_search_matches_title_and_preview() {
        let store = notes_store("search");
        seed_note(&store, "RAG 落地记录", "今天把向量检索跑通了。", "技术");
        seed_note(&store, "买菜清单", "鸡蛋、西红柿。", "生活");
        seed_note(&store, "SQLite 笔记", "关于 vector 扩展的用法。", "技术");

        let hits = note_search(&store, "向量", 10).unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].title, "RAG 落地记录");

        let empty = note_search(&store, "不存在的词", 10).unwrap();
        assert!(empty.is_empty());
        let _ = std::fs::remove_dir_all(temp_dir("search"));
    }

    #[test]
    fn runner_executes_closed_loop_to_done() {
        let store = notes_store("loop_notes");
        let id = seed_note(
            &store,
            "RAG 落地记录",
            "今天把 sqlite-vec 检索跑通了，余弦 top-k 正常。",
            "技术",
        );
        let tasks = task_store("loop_tasks");
        let mut task = Task::new("t-loop", "帮我找一下关于 RAG 的笔记");
        tasks.create(&task).unwrap();

        let result = tauri::async_runtime::block_on(runner(&tasks, &store).run(&mut task));
        result.unwrap();

        assert_eq!(task.status, TaskStatus::Done);
        assert_eq!(task.plan.len(), 2);
        assert_eq!(task.plan[0].status, StepStatus::Done);
        assert_eq!(task.plan[1].status, StepStatus::Done);
        assert_eq!(task.plan[0].output.as_ref().unwrap()[0]["title"], "RAG 落地记录");
        assert_eq!(task.plan[1].output.as_ref().unwrap()["id"], id);
        assert!(task.logs.iter().any(|log| log.step_id == "s1" && log.message == "开始执行"));
        assert!(task.logs.iter().any(|log| log.step_id == "s2" && log.message == "完成"));
        let summary = task.context.as_ref().unwrap()["summary"].as_str().unwrap();
        assert!(summary.contains("RAG 落地记录"));

        let persisted = tasks.get("t-loop").unwrap().unwrap();
        assert_eq!(persisted.status, TaskStatus::Done);
        let _ = std::fs::remove_dir_all(temp_dir("loop_notes"));
        let _ = std::fs::remove_dir_all(temp_dir("loop_tasks"));
    }

    #[test]
    fn runner_fails_when_no_hits() {
        let store = notes_store("nohit_notes");
        let tasks = task_store("nohit_tasks");
        let mut task = Task::new("t-nohit", "查找绝对不存在的东西");
        tasks.create(&task).unwrap();

        tauri::async_runtime::block_on(runner(&tasks, &store).run(&mut task)).unwrap();

        assert_eq!(task.status, TaskStatus::Failed);
        assert_eq!(task.plan[0].status, StepStatus::Done);
        assert_eq!(task.plan[1].status, StepStatus::Failed);
        assert!(task.context.as_ref().unwrap()["summary"]
            .as_str()
            .unwrap()
            .contains("未找到"));
        let _ = std::fs::remove_dir_all(temp_dir("nohit_notes"));
        let _ = std::fs::remove_dir_all(temp_dir("nohit_tasks"));
    }

    #[test]
    fn runner_rejects_finished_task() {
        let store = notes_store("rerun_notes");
        let tasks = task_store("rerun_tasks");
        let mut task = Task::new("t-rerun", "搜索");
        task.status = TaskStatus::Done;
        tasks.create(&task).unwrap();

        let err =
            tauri::async_runtime::block_on(runner(&tasks, &store).run(&mut task)).unwrap_err();
        assert_eq!(err.code, "taskNotRunnable");
        let _ = std::fs::remove_dir_all(temp_dir("rerun_notes"));
        let _ = std::fs::remove_dir_all(temp_dir("rerun_tasks"));
    }

    #[test]
    fn runner_pauses_on_confirm_then_resumes() {
        let store = notes_store("confirm_notes");
        seed_note(&store, "RAG 落地记录", "今天把向量检索跑通了。", "技术");
        let tasks = task_store("confirm_tasks");
        // 手工构造一个带确认步骤的任务（总结流水线：read 无 llm → 用 create 确认步骤测试）
        let mut task = Task::new("t-confirm", "总结关于 RAG 的笔记");
        tasks.create(&task).unwrap();

        // 无 LLM provider → llm 步骤失败 → 但确认步骤会先触发暂停（在 llm 失败之后）
        // 因此直接把 plan 换成 search → read → create(confirm) 的简化版验证暂停语义
        task.plan = vec![
            tool_step("s1", "note.search", json!({"query": "RAG", "limit": 5})),
            tool_step("s2", "note.read", json!({"id": "top"})),
            tool_step_confirm(
                "s3",
                "note.create",
                json!({"title": "确认测试", "content": "{previousOutput}"}),
            ),
        ];
        tasks.update(&task).unwrap();

        // 第一轮：执行到 s3 前暂停
        tauri::async_runtime::block_on(runner(&tasks, &store).run(&mut task)).unwrap();
        assert_eq!(task.status, TaskStatus::AwaitingConfirm);
        assert_eq!(task.plan[0].status, StepStatus::Done);
        assert_eq!(task.plan[1].status, StepStatus::Done);
        assert_eq!(task.plan[2].status, StepStatus::Pending);

        // 模拟 agent_task_confirm：确认 s3 → 恢复执行到 Done
        task.plan[2].confirmed = true;
        tasks.update(&task).unwrap();
        tauri::async_runtime::block_on(runner(&tasks, &store).run(&mut task)).unwrap();
        assert_eq!(task.status, TaskStatus::Done);
        assert_eq!(task.plan[2].status, StepStatus::Done);
        // note.create 真的建了笔记
        let notes = store.list_notes().unwrap();
        assert_eq!(notes.len(), 2);

        let _ = std::fs::remove_dir_all(temp_dir("confirm_notes"));
        let _ = std::fs::remove_dir_all(temp_dir("confirm_tasks"));
    }

    #[test]
    fn runner_creates_canvas_node() {
        let dir = temp_dir("canvas");
        let _ = std::fs::remove_dir_all(&dir);
        let canvas = CanvasStore::new(dir);
        let tasks = task_store("canvas_tasks");
        let notes = notes_store("canvas_notes");

        let mut task = Task::new("t-canvas", "测试");
        task.plan = vec![tool_step_confirm(
            "k1",
            "canvas.node.create",
            json!({"canvasId": "first", "content": "画布节点内容"}),
        )];
        tasks.create(&task).unwrap();

        let test_runner = TaskRunner::new(&tasks, notes.clone(), None, None, Some(&canvas), None);
        tauri::async_runtime::block_on(test_runner.run(&mut task)).unwrap();

        // 无确认 → 暂停
        assert_eq!(task.status, TaskStatus::AwaitingConfirm);
        task.plan[0].confirmed = true;
        tasks.update(&task).unwrap();
        tauri::async_runtime::block_on(test_runner.run(&mut task)).unwrap();

        assert_eq!(task.status, TaskStatus::Done);
        let docs = canvas.list().unwrap();
        assert_eq!(docs.len(), 1);
        assert_eq!(docs[0].nodes.len(), 1);
        assert_eq!(docs[0].nodes[0].text, "画布节点内容");
        assert_eq!(docs[0].nodes[0].source.as_deref(), Some("agent"));

        let _ = std::fs::remove_dir_all(temp_dir("canvas"));
        let _ = std::fs::remove_dir_all(temp_dir("canvas_tasks"));
        let _ = std::fs::remove_dir_all(temp_dir("canvas_notes"));
    }

    #[test]
    fn last_search_hit_resolves_top_id() {
        let mut outputs: Vec<(String, Value)> = Vec::new();
        outputs.push((
            "s1".to_string(),
            json!([{"id": "n1", "title": "a"}, {"id": "n2", "title": "b"}]),
        ));
        assert_eq!(last_search_hit(&outputs, "s2").unwrap(), "n1");
        assert!(last_search_hit(&Vec::new(), "s2").is_err());
    }

    // ── 技能注册表 ──────────────────────────────────────────────────────────

    #[test]
    fn skill_registry_has_unique_names_and_descriptions() {
        let skills = skill_registry();
        assert_eq!(skills.len(), 11);
        let mut names: Vec<&str> = skills.iter().map(|s| s.name).collect();
        names.sort_unstable();
        let mut uniq = names.clone();
        uniq.dedup();
        assert_eq!(names, uniq, "技能名必须唯一");
        for s in &skills {
            assert!(!s.description.is_empty(), "技能 {} 缺描述", s.name);
        }
    }

    #[test]
    fn match_skill_dispatches_by_goal_keywords() {
        assert_eq!(match_skill("把画布整理成文章").name, "canvas.writeup");
        assert_eq!(match_skill("总结一下 RAG 的笔记").name, "note.summarize");
        assert_eq!(match_skill("帮我调研一下 Tauri 2").name, "research");
        assert_eq!(match_skill("把这篇文章导出").name, "note.export");
        assert_eq!(match_skill("把画布自动排版").name, "canvas.organize");
        assert_eq!(match_skill("扩写一下这个节点").name, "canvas.node.enhance");
        assert_eq!(match_skill("生成社交文案发朋友圈").name, "social.publish");
        assert_eq!(match_skill("随便找点东西").name, "note.search");
    }

    #[test]
    fn plan_for_goal_expands_export_pipeline() {
        let plan = plan_for_goal("把这篇笔记导出成文件");
        assert_eq!(plan.len(), 3);
        assert_eq!(plan[0].tool.as_deref(), Some("note.search"));
        assert_eq!(plan[1].tool.as_deref(), Some("note.read"));
        assert_eq!(plan[2].tool.as_deref(), Some("note.export"));
        assert!(plan[2].required_confirm);
    }

    #[test]
    fn plan_for_goal_expands_organize_pipeline() {
        let plan = plan_for_goal("把画布自动排版");
        assert_eq!(plan.len(), 2);
        assert_eq!(plan[0].tool.as_deref(), Some("canvas.read"));
        assert_eq!(plan[1].tool.as_deref(), Some("canvas.organize"));
        assert!(plan[1].required_confirm);
    }

    // ── 新产品技能端到端 ────────────────────────────────────────────────────

    #[test]
    fn runner_exports_note_to_markdown_file() {
        let store = notes_store("export_notes");
        seed_note(&store, "导出测试", "这是要导出的内容。", "技术");
        let tasks = task_store("export_tasks");
        let mut task = Task::new("t-export", "把这篇笔记导出");
        tasks.create(&task).unwrap();
        task.plan = vec![
            tool_step("e1", "note.search", json!({"query": "导出测试", "limit": 5})),
            tool_step("e2", "note.read", json!({"id": "top"})),
            tool_step_confirm("e3", "note.export", json!({"format": "markdown"})),
        ];
        tasks.update(&task).unwrap();

        let r = runner(&tasks, &store);
        tauri::async_runtime::block_on(r.run(&mut task)).unwrap();
        assert_eq!(task.status, TaskStatus::AwaitingConfirm);
        assert_eq!(task.plan[0].status, StepStatus::Done);
        assert_eq!(task.plan[1].status, StepStatus::Done);

        task.plan[2].confirmed = true;
        tasks.update(&task).unwrap();
        tauri::async_runtime::block_on(r.run(&mut task)).unwrap();
        assert_eq!(task.status, TaskStatus::Done);

        let out = task.plan[2].output.as_ref().unwrap();
        let path = out["path"].as_str().unwrap();
        assert!(path.ends_with("导出测试.md"), "导出路径应为 导出测试.md，实际: {path}");
        let content = std::fs::read_to_string(path).unwrap();
        assert!(content.contains("# 导出测试"));
        assert!(content.contains("这是要导出的内容"));

        let _ = std::fs::remove_dir_all(temp_dir("export_notes"));
        let _ = std::fs::remove_dir_all(temp_dir("export_tasks"));
    }

    #[test]
    fn runner_organizes_canvas_nodes_grid() {
        let dir = temp_dir("organize");
        let _ = std::fs::remove_dir_all(&dir);
        let canvas = CanvasStore::new(dir.clone());
        let doc = CanvasDocument {
            id: "canvas-1".into(),
            note_id: None,
            co_write_session_id: None,
            nodes: vec![
                CanvasNode { id: "n1".into(), node_type: "text".into(), x: 0.0, y: 0.0, width: 200.0, height: 80.0, text: "a".into(), source: None, z_index: 0, ..CanvasNode::default() },
                CanvasNode { id: "n2".into(), node_type: "text".into(), x: 0.0, y: 0.0, width: 200.0, height: 80.0, text: "b".into(), source: None, z_index: 0, ..CanvasNode::default() },
                CanvasNode { id: "n3".into(), node_type: "text".into(), x: 0.0, y: 0.0, width: 200.0, height: 80.0, text: "c".into(), source: None, z_index: 0, ..CanvasNode::default() },
                CanvasNode { id: "n4".into(), node_type: "text".into(), x: 0.0, y: 0.0, width: 200.0, height: 80.0, text: "d".into(), source: None, z_index: 0, ..CanvasNode::default() },
            ],
            edges: vec![],
            groups: vec![],
        };
        canvas.save(doc).unwrap();

        let tasks = task_store("organize_tasks");
        let notes = notes_store("organize_notes");
        let mut task = Task::new("t-organize", "整理画布");
        task.plan = vec![
            tool_step("o1", "canvas.read", json!({"canvasId": "first"})),
            tool_step_confirm("o2", "canvas.organize", json!({"canvasId": "first"})),
        ];
        tasks.create(&task).unwrap();
        let test_runner = TaskRunner::new(&tasks, notes.clone(), None, None, Some(&canvas), None);

        tauri::async_runtime::block_on(test_runner.run(&mut task)).unwrap();
        assert_eq!(task.status, TaskStatus::AwaitingConfirm);

        task.plan[1].confirmed = true;
        tasks.update(&task).unwrap();
        tauri::async_runtime::block_on(test_runner.run(&mut task)).unwrap();
        assert_eq!(task.status, TaskStatus::Done);

        let saved = canvas.get("canvas-1").unwrap();
        assert_eq!(saved.nodes.len(), 4);
        // 网格：每行 3 个 → n1(40,40) n2(280,40) n3(520,40) n4 换行(40,160)
        assert_eq!((saved.nodes[0].x, saved.nodes[0].y), (40.0, 40.0));
        assert_eq!((saved.nodes[1].x, saved.nodes[1].y), (280.0, 40.0));
        assert_eq!((saved.nodes[2].x, saved.nodes[2].y), (520.0, 40.0));
        assert_eq!((saved.nodes[3].x, saved.nodes[3].y), (40.0, 160.0));
        // 节点间不再重叠
        for i in 0..saved.nodes.len() {
            for j in (i + 1)..saved.nodes.len() {
                let a = &saved.nodes[i];
                let b = &saved.nodes[j];
                let overlap = (a.x - b.x).abs() < a.width.min(b.width)
                    && (a.y - b.y).abs() < a.height.min(b.height);
                assert!(!overlap, "节点 {i}/{j} 仍然重叠");
            }
        }

        let _ = std::fs::remove_dir_all(&dir);
        let _ = std::fs::remove_dir_all(temp_dir("organize_tasks"));
        let _ = std::fs::remove_dir_all(temp_dir("organize_notes"));
    }

    // ── P1-2：canvas.node.enhance 扩写链路 ───────────────────────────────────

    #[test]
    fn extract_node_id_and_text_from_enhance_goal() {
        assert_eq!(
            extract_node_id("扩写节点 node-123 的内容：做个决定").as_deref(),
            Some("node-123")
        );
        assert_eq!(
            extract_node_text("扩写节点 node-123 的内容：做个决定").as_deref(),
            Some("做个决定")
        );
        // 无节点前缀/无原文 → 兜底
        assert_eq!(extract_node_id("扩写一下这个节点"), None);
        assert_eq!(extract_node_text("扩写一下这个节点"), None);
    }

    #[test]
    fn plan_for_goal_expands_enhance_pipeline() {
        let plan = plan_for_goal("扩写节点 n1 的内容：先做实时同步");
        assert_eq!(plan.len(), 3);
        assert_eq!(plan[0].tool.as_deref(), Some("canvas.read"));
        assert!(plan[1].kind == StepKind::Llm);
        // h2 prompt 直接携带节点原文，LLM 无需依赖 previousOutput
        let prompt = plan[1].input["prompt"].as_str().unwrap();
        assert!(prompt.contains("先做实时同步"));
        assert_eq!(plan[2].tool.as_deref(), Some("canvas.save"));
        assert!(plan[2].required_confirm);
        assert_eq!(plan[2].input["nodeId"], "n1");
    }

    #[test]
    fn canvas_write_back_updates_target_node() {
        let dir = temp_dir("writeback");
        let _ = std::fs::remove_dir_all(&dir);
        let canvas = CanvasStore::new(dir.clone());
        canvas
            .save(CanvasDocument {
                id: "canvas-wb".into(),
                note_id: None,
                co_write_session_id: None,
                nodes: vec![
                    CanvasNode {
                        id: "n1".into(),
                        node_type: "text".into(),
                        x: 0.0,
                        y: 0.0,
                        width: 200.0,
                        height: 80.0,
                        text: "旧内容".into(),
                        source: None,
                        z_index: 0,
                        ..CanvasNode::default()
                    },
                    CanvasNode {
                        id: "n2".into(),
                        node_type: "text".into(),
                        x: 300.0,
                        y: 0.0,
                        width: 200.0,
                        height: 80.0,
                        text: "不动".into(),
                        source: None,
                        z_index: 0,
                        ..CanvasNode::default()
                    },
                ],
                edges: vec![],
                groups: vec![],
            })
            .unwrap();

        let doc = canvas_write_back(&canvas, "canvas-wb", Some("n1"), "扩写后的完整内容").unwrap();
        assert_eq!(doc.nodes[0].text, "扩写后的完整内容");
        assert_eq!(doc.nodes[0].source.as_deref(), Some("agent"));
        assert_eq!(doc.nodes[1].text, "不动", "未命中节点不应被改动");
        assert_eq!(doc.nodes.len(), 2, "命中节点应原地更新，不新增节点");

        // 落盘后可重读
        let reloaded = canvas.get("canvas-wb").unwrap();
        assert_eq!(reloaded.nodes[0].text, "扩写后的完整内容");

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn canvas_write_back_appends_node_when_no_id_or_missing() {
        let dir = temp_dir("writeback_append");
        let _ = std::fs::remove_dir_all(&dir);
        let canvas = CanvasStore::new(dir.clone());
        canvas
            .save(CanvasDocument {
                id: "canvas-wa".into(),
                note_id: None,
                co_write_session_id: None,
                nodes: vec![],
                edges: vec![],
                groups: vec![],
            })
            .unwrap();

        // 无 nodeId → 追加 agent 节点
        let doc = canvas_write_back(&canvas, "canvas-wa", None, "新增内容").unwrap();
        assert_eq!(doc.nodes.len(), 1);
        assert_eq!(doc.nodes[0].text, "新增内容");
        assert_eq!(doc.nodes[0].source.as_deref(), Some("agent"));

        // 未命中 nodeId → 报错（不静默乱写）
        let err = canvas_write_back(&canvas, "canvas-wa", Some("ghost"), "x").unwrap_err();
        assert_eq!(err.code, "nodeNotFound");

        // 空内容 → 报错
        let err = canvas_write_back(&canvas, "canvas-wa", None, "   ").unwrap_err();
        assert_eq!(err.code, "emptyLlmOutput");

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn runner_enhances_node_via_canvas_save_tool() {
        let dir = temp_dir("enhance_canvas");
        let _ = std::fs::remove_dir_all(&dir);
        let canvas = CanvasStore::new(dir.clone());
        canvas
            .save(CanvasDocument {
                id: "canvas-e1".into(),
                note_id: None,
                co_write_session_id: None,
                nodes: vec![CanvasNode {
                    id: "n1".into(),
                    node_type: "text".into(),
                    x: 0.0,
                    y: 0.0,
                    width: 200.0,
                    height: 80.0,
                    text: "原始节点".into(),
                    source: None,
                    z_index: 0,
                    ..CanvasNode::default()
                }],
                edges: vec![],
                groups: vec![],
            })
            .unwrap();

        let tasks = task_store("enhance_tasks");
        let notes = notes_store("enhance_notes");
        let mut task = Task::new("t-enhance", "扩写");
        // 手工构造：h1 读画布 → h2 伪造 LLM 输出（避免真实 LLM）→ h3 canvas.save 写回
        task.plan = vec![
            tool_step("h1", "canvas.read", json!({"canvasId": "canvas-e1"})),
            llm_step("h2", json!({"prompt": "扩写"})),
            tool_step_confirm(
                "h3",
                "canvas.save",
                json!({"canvasId": "canvas-e1", "nodeId": "n1"}),
            ),
        ];
        tasks.create(&task).unwrap();
        let test_runner = TaskRunner::new(&tasks, notes.clone(), None, None, Some(&canvas), None);

        // 第一轮：无 LLM provider → h2 失败 → h3 仍会执行（状态不阻止），先到确认暂停
        tauri::async_runtime::block_on(test_runner.run(&mut task)).unwrap();
        assert_eq!(task.status, TaskStatus::AwaitingConfirm);
        // h1 成功，h2 因无 LLM 失败（重试后仍失败），h3 待确认
        assert_eq!(task.plan[0].status, StepStatus::Done);
        assert_eq!(task.plan[1].status, StepStatus::Failed);
        assert_eq!(task.plan[2].status, StepStatus::Pending);

        // 模拟人工：确认 h3。由于 h2 无输出，canvas.save 报 noLlmOutput → 任务 Failed
        task.plan[2].confirmed = true;
        tasks.update(&task).unwrap();
        tauri::async_runtime::block_on(test_runner.run(&mut task)).unwrap();
        assert_eq!(task.status, TaskStatus::Failed);
        let node = canvas.get("canvas-e1").unwrap();
        assert_eq!(node.nodes[0].text, "原始节点", "写回失败时节点内容不应被改动");

        let _ = std::fs::remove_dir_all(&dir);
        let _ = std::fs::remove_dir_all(temp_dir("enhance_tasks"));
        let _ = std::fs::remove_dir_all(temp_dir("enhance_notes"));
    }

    // ── P1-3：note.export 前端接管（PNG/PDF） ────────────────────────────────

    #[test]
    fn runner_exports_note_png_delegates_to_frontend() {
        let store = notes_store("export_png_notes");
        seed_note(&store, "导出图片", "这是要导出成图片的内容。", "技术");
        let tasks = task_store("export_png_tasks");
        let mut task = Task::new("t-export-png", "把这篇笔记导出成图片");
        tasks.create(&task).unwrap();
        task.plan = vec![
            tool_step("e1", "note.search", json!({"query": "导出图片", "limit": 5})),
            tool_step("e2", "note.read", json!({"id": "top"})),
            tool_step_confirm("e3", "note.export", json!({"format": "png"})),
        ];
        tasks.update(&task).unwrap();

        let r = runner(&tasks, &store);
        tauri::async_runtime::block_on(r.run(&mut task)).unwrap();
        assert_eq!(task.status, TaskStatus::AwaitingConfirm);

        task.plan[2].confirmed = true;
        tasks.update(&task).unwrap();
        tauri::async_runtime::block_on(r.run(&mut task)).unwrap();
        assert_eq!(task.status, TaskStatus::Done);

        // 前端接管：不落盘，输出标记 exportedBy=frontend
        let out = task.plan[2].output.as_ref().unwrap();
        assert_eq!(out["format"], "png");
        assert_eq!(out["exportedBy"], "frontend");
        assert_eq!(out["title"], "导出图片");
        // 导出目录不应出现 png 文件
        let export_dir = store.base_dir().join("exports");
        if export_dir.exists() {
            assert!(
                std::fs::read_dir(&export_dir)
                    .unwrap()
                    .all(|entry| !entry.unwrap().path().extension().is_some_and(|e| e == "png")),
                "PNG 应由前端接管渲染，Rust 不应落盘"
            );
        }

        let _ = std::fs::remove_dir_all(temp_dir("export_png_notes"));
        let _ = std::fs::remove_dir_all(temp_dir("export_png_tasks"));
    }

    // ── 组卡成文（可产出 Agent）：goal 解析 / 流水线 / 模板 / 输出渲染 ──────────

    #[test]
    fn parse_writeup_goal_extracts_type_intent_cards() {
        let req = parse_writeup_goal(
            "把画布上的 3 张卡片整理成文：大纲；意图：突出主角成长线；卡片：n1, n2，n3",
        );
        assert_eq!(req.kind, "大纲");
        assert_eq!(req.intent, "突出主角成长线");
        assert_eq!(req.node_ids, vec!["n1", "n2", "n3"]);
    }

    #[test]
    fn parse_writeup_goal_handles_colon_and_fallbacks() {
        // 半角冒号 + 无卡片 → 回退读全画布；无类型 → 初稿
        let req = parse_writeup_goal("整理成文:设定集;意图:世界观的规则");
        assert_eq!(req.kind, "设定集");
        assert_eq!(req.intent, "世界观的规则");
        assert!(req.node_ids.is_empty());

        // 完全缺类型/意图/卡片
        let req = parse_writeup_goal("整理成文");
        assert_eq!(req.kind, "初稿");
        assert!(req.intent.is_empty());
        assert!(req.node_ids.is_empty());
    }

    #[test]
    fn plan_for_goal_expands_writeup_pipeline() {
        let goal = "把画布上的 2 张卡片整理成文：总结；意图：概括核心分歧；卡片：n1,n2";
        let plan = plan_for_goal(goal);
        assert_eq!(plan.len(), 3);
        assert_eq!(plan[0].tool.as_deref(), Some("canvas.read"));
        // 只读选中卡片
        let node_ids = plan[0].input["nodeIds"].as_array().unwrap();
        assert_eq!(node_ids.len(), 2);
        // RAG 记忆注入 + 类型模板
        let llm = &plan[1].input;
        assert!(llm["retrieve"].as_str().unwrap().contains("核心分歧"));
        let template = llm["promptTemplate"].as_str().unwrap();
        assert!(template.contains("凝练成一篇简洁的总结"));
        assert!(template.contains("{previousOutput}"));
        // 落盘步骤：内容模板 + 需确认
        assert_eq!(plan[2].tool.as_deref(), Some("note.create"));
        assert!(plan[2].required_confirm);
        assert_eq!(plan[2].input["content"], "{previousOutput}");
    }

    #[test]
    fn writeup_template_variants_cover_all_kinds() {
        assert!(writeup_template("大纲", "").contains("大纲"));
        assert!(writeup_template("初稿", "").contains("一篇文章"));
        assert!(writeup_template("设定集", "").contains("设定集"));
        assert!(writeup_template("图文贴", "").contains("小红书"));
        assert!(writeup_template("图文贴", "").contains("#"));
        assert!(writeup_template("主题总结", "").contains("来源"));
        assert!(writeup_template("要点清单", "").contains("要点清单"));
        // 意图注入
        assert!(writeup_template("大纲", "加入伏笔").contains("加入伏笔"));
        assert!(writeup_template("大纲", "加入伏笔").contains("{previousOutput}"));
    }

    #[test]
    fn resolve_previous_output_substitutes_llm_text() {
        let mut outputs: Vec<(String, Value)> = Vec::new();
        outputs.push(("w2".into(), json!({ "text": "这是生成的成文内容" })));
        let resolved = resolve_previous_output("{previousOutput}", &outputs);
        assert_eq!(resolved, "这是生成的成文内容");

        // 无占位符 → 原样返回；空输出 → 空替换不报错
        assert_eq!(resolve_previous_output("固定内容", &outputs), "固定内容");
        assert_eq!(resolve_previous_output("{previousOutput}", &Vec::new()), "");
    }

    #[test]
    fn resolve_previous_output_takes_most_recent_completed_step() {
        // 有序输出表必须取"最后完成的步骤"，而非 HashMap 随机顺序
        let outputs = vec![
            ("k1".to_string(), json!({"results": [], "notice": "搜索不可用"})),
            ("k2".to_string(), json!({"text": "LLM 提炼结果"})),
        ];
        assert_eq!(
            resolve_previous_output("{previousOutput}", &outputs),
            "LLM 提炼结果"
        );
        // 无 LLM 文本时回退到上一步原始输出
        let raw_only = vec![("k1".to_string(), json!([{"id": "n1", "title": "a"}]))];
        assert_eq!(
            resolve_previous_output("{previousOutput}", &raw_only),
            r#"[{"id":"n1","title":"a"}]"#
        );
    }

    #[test]
    fn output_text_renders_canvas_document_as_readable_list() {
        let doc = json!({
            "nodes": [
                { "id": "n1", "text": "主角动机" },
                { "id": "n2", "text": "雨夜重逢" },
                { "id": "n3", "text": "" }
            ]
        });
        let text = output_text(&doc);
        assert!(text.contains("- 主角动机"));
        assert!(text.contains("- 雨夜重逢"));
        assert!(!text.contains("n3"), "空文本节点应被过滤");
        // 非画布值仍走 to_string 兜底
        assert_eq!(output_text(&json!({"a": 1})), "{\"a\":1}");
    }

    #[test]
    fn runner_creates_note_with_vectors_indexes_best_effort() {
        let dir = temp_dir("note_index");
        let _ = std::fs::remove_dir_all(&dir);
        let vec_dir = temp_dir("note_index_vec");
        let _ = std::fs::remove_dir_all(&vec_dir);
        let vec_store = VectorStore::new(vec_dir.join("vectors.sqlite"));
        let tasks = task_store("note_index_tasks");
        let notes = notes_store("note_index_notes");

        let mut task = Task::new("t-index", "测试");
        task.plan = vec![tool_step_confirm(
            "n1",
            "note.create",
            json!({"title": "记忆笔记", "content": "这是一段应该被记住的内容。"}),
        )];
        tasks.create(&task).unwrap();

        let test_runner =
            TaskRunner::new(&tasks, notes.clone(), None, Some(&vec_store), None, None);
        tauri::async_runtime::block_on(test_runner.run(&mut task)).unwrap();
        assert_eq!(task.status, TaskStatus::AwaitingConfirm);

        task.plan[0].confirmed = true;
        tasks.update(&task).unwrap();
        tauri::async_runtime::block_on(test_runner.run(&mut task)).unwrap();
        assert_eq!(task.status, TaskStatus::Done);

        // 笔记确实落盘；索引为 best-effort（测试环境无 embedding 配置，静默失败不阻塞落盘）
        let listed = notes.list_notes().unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].title, "记忆笔记");

        let _ = std::fs::remove_dir_all(&dir);
        let _ = std::fs::remove_dir_all(temp_dir("note_index_tasks"));
        let _ = std::fs::remove_dir_all(temp_dir("note_index_notes"));
        let _ = std::fs::remove_dir_all(&vec_dir);
    }

    #[test]
    fn runner_writeup_marks_participating_nodes_drafted() {
        let dir = temp_dir("draft_canvas");
        let _ = std::fs::remove_dir_all(&dir);
        let canvas = CanvasStore::new(dir.clone());
        canvas
            .save(CanvasDocument {
                id: "canvas-d1".into(),
                note_id: None,
                co_write_session_id: None,
                nodes: vec![
                    CanvasNode { id: "n1".into(), node_type: "card".into(), x: 0.0, y: 0.0, width: 200.0, height: 80.0, text: "卡片一".into(), source: None, z_index: 0, ..CanvasNode::default() },
                    CanvasNode { id: "n2".into(), node_type: "card".into(), x: 0.0, y: 0.0, width: 200.0, height: 80.0, text: "卡片二".into(), source: None, z_index: 0, ..CanvasNode::default() },
                    CanvasNode { id: "n3".into(), node_type: "text".into(), x: 0.0, y: 0.0, width: 200.0, height: 80.0, text: "无关节点".into(), source: None, z_index: 0, ..CanvasNode::default() },
                ],
                edges: vec![],
                groups: vec![],
            })
            .unwrap();
        let tasks = task_store("draft_tasks");
        let notes = notes_store("draft_notes");

        // 组卡成文链路：读选中卡片 → 落成笔记（确认）
        let mut task = Task::new("t-draft", "把画布上的 2 张卡片整理成文：初稿；卡片：n1,n2");
        task.plan = vec![
            tool_step("w1", "canvas.read", json!({"canvasId": "first", "nodeIds": ["n1", "n2"]})),
            tool_step_confirm("w3", "note.create", json!({"title": "成文", "content": "成文内容"})),
        ];
        tasks.create(&task).unwrap();
        let test_runner = TaskRunner::new(&tasks, notes.clone(), None, None, Some(&canvas), None);

        tauri::async_runtime::block_on(test_runner.run(&mut task)).unwrap();
        assert_eq!(task.status, TaskStatus::AwaitingConfirm);
        task.plan[1].confirmed = true;
        tasks.update(&task).unwrap();
        tauri::async_runtime::block_on(test_runner.run(&mut task)).unwrap();
        assert_eq!(task.status, TaskStatus::Done);

        // 留痕：参与成文的 n1/n2 打 drafted_by（笔记 id），未参与的 n3 不动
        let saved = canvas.get("canvas-d1").unwrap();
        let note = notes.list_notes().unwrap()[0].clone();
        assert_eq!(saved.nodes[0].drafted_by.as_deref(), Some(note.id.as_str()));
        assert_eq!(saved.nodes[1].drafted_by.as_deref(), Some(note.id.as_str()));
        assert!(saved.nodes[2].drafted_by.is_none());

        let _ = std::fs::remove_dir_all(&dir);
        let _ = std::fs::remove_dir_all(temp_dir("draft_tasks"));
        let _ = std::fs::remove_dir_all(temp_dir("draft_notes"));
    }

    // ── 章节续写（note.chapter）：读原文 → LLM 续写 → 追加保存 ────────────────

    #[test]
    fn extract_chapter_note_id_parses_goal() {
        assert_eq!(
            extract_chapter_note_id("续写笔记 note-abc 的下一章（当前标题：第一章）").as_deref(),
            Some("note-abc")
        );
        assert_eq!(
            extract_chapter_note_id("续写笔记 n1 下一章").as_deref(),
            Some("n1")
        );
        assert_eq!(extract_chapter_note_id("没有目标"), None);
    }

    #[test]
    fn plan_for_goal_expands_chapter_pipeline() {
        let goal = "续写笔记 note-abc 的下一章（当前标题：雨夜重逢）";
        let plan = plan_for_goal(goal);
        assert_eq!(plan.len(), 3);
        assert_eq!(plan[0].tool.as_deref(), Some("note.read"));
        assert_eq!(plan[0].input["id"], "note-abc");
        assert!(plan[1].kind == StepKind::Llm);
        assert!(plan[1].input["promptTemplate"].as_str().unwrap().contains("续写下一章"));
        assert_eq!(plan[2].tool.as_deref(), Some("note.update"));
        assert!(plan[2].required_confirm);
        assert_eq!(plan[2].input["mode"], "append");
        assert_eq!(plan[2].input["content"], "{previousOutput}");
    }

    #[test]
    fn runner_appends_chapter_to_existing_note() {
        let dir = temp_dir("chapter_notes");
        let _ = std::fs::remove_dir_all(&dir);
        let store = notes_store("chapter_notes");
        let id = seed_note(&store, "雨夜重逢", "第一章：车站重逢。雨落在玻璃上。", "小说");
        let tasks = task_store("chapter_tasks");

        let mut task = Task::new("t-ch", &format!("续写笔记 {id} 的下一章（当前标题：雨夜重逢）"));
        task.plan = vec![
            tool_step("ch1", "note.read", json!({"id": id})),
            tool_step_confirm("ch3", "note.update", json!({"id": id, "mode": "append", "content": "第二章：街角的灯亮了。"})),
        ];
        tasks.create(&task).unwrap();
        let test_runner = runner(&tasks, &store);

        tauri::async_runtime::block_on(test_runner.run(&mut task)).unwrap();
        assert_eq!(task.status, TaskStatus::AwaitingConfirm);
        task.plan[1].confirmed = true;
        tasks.update(&task).unwrap();
        tauri::async_runtime::block_on(test_runner.run(&mut task)).unwrap();
        assert_eq!(task.status, TaskStatus::Done);

        // 内容追加到末尾，原内容保留
        let note = store.read_note(&id).unwrap();
        assert!(note.content.contains("第一章：车站重逢"));
        assert!(note.content.contains("第二章：街角的灯亮了。"));
        assert!(note.content.find("第一章").unwrap() < note.content.find("第二章").unwrap());

        let _ = std::fs::remove_dir_all(temp_dir("chapter_notes"));
        let _ = std::fs::remove_dir_all(temp_dir("chapter_tasks"));
    }

    // ── AI 自动分组（canvas.group）：LLM 分组 → 写回泳道 ──────────────────────

    #[test]
    fn parse_group_plan_extracts_groups_with_fences() {
        let text = "```json\n{\"groups\": [{\"title\": \"人物\", \"nodeIds\": [\"n1\", \"n2\"]}, {\"title\": \"世界观\", \"nodeIds\": [\"n3\"]}]}\n```";
        let specs = parse_group_plan(text).unwrap();
        assert_eq!(specs.len(), 2);
        assert_eq!(specs[0].title, "人物");
        assert_eq!(specs[0].node_ids, vec!["n1", "n2"]);
        assert_eq!(specs[1].title, "世界观");
        assert_eq!(specs[1].node_ids, vec!["n3"]);
    }

    #[test]
    fn parse_group_plan_rejects_invalid_or_empty() {
        assert!(parse_group_plan("不是 JSON").is_err());
        assert!(parse_group_plan("{\"groups\": []}").is_err());
        assert!(parse_group_plan("{\"groups\": [{\"title\": \"x\", \"nodeIds\": []}]}").is_err());
    }

    #[test]
    fn apply_ai_groups_writes_groups_and_preserves_manual() {
        let mut doc = CanvasDocument {
            id: "c".into(),
            note_id: None,
            co_write_session_id: None,
            nodes: vec![
                CanvasNode { id: "n1".into(), node_type: "card".into(), x: 0.0, y: 0.0, width: 200.0, height: 80.0, text: "a".into(), source: None, z_index: 0, ..CanvasNode::default() },
                CanvasNode { id: "n2".into(), node_type: "card".into(), x: 0.0, y: 0.0, width: 200.0, height: 80.0, text: "b".into(), source: None, z_index: 0, ..CanvasNode::default() },
                CanvasNode { id: "n3".into(), node_type: "card".into(), x: 0.0, y: 0.0, width: 200.0, height: 80.0, text: "c".into(), source: None, z_index: 0, group: Some("group-manual".into()), ..CanvasNode::default() },
            ],
            edges: vec![],
            groups: vec![CanvasGroup { id: "group-manual".into(), title: "手动组".into(), node_ids: vec!["n3".into()] }],
        };

        apply_ai_groups(
            &mut doc,
            &[GroupSpec { title: "人物".into(), node_ids: vec!["n1".into(), "n2".into()] }],
        );

        assert_eq!(doc.groups.len(), 2, "手动分组保留 + 1 个 AI 分组");
        assert!(doc.groups.iter().any(|g| g.id == "group-manual"));
        let ai = doc.groups.iter().find(|g| g.id.starts_with("group-ai-")).unwrap();
        assert_eq!(ai.title, "人物");
        assert_eq!(doc.nodes[0].group.as_deref(), Some(ai.id.as_str()));
        assert_eq!(doc.nodes[1].group.as_deref(), Some(ai.id.as_str()));
        assert_eq!(doc.nodes[2].group.as_deref(), Some("group-manual"), "手动分组的节点归属不变");

        // 再次执行 → 旧 AI 分组被替换，不膨胀
        apply_ai_groups(
            &mut doc,
            &[GroupSpec { title: "情节".into(), node_ids: vec!["n1".into()] }],
        );
        assert_eq!(doc.groups.len(), 2);
        let ais: Vec<&str> = doc.groups.iter().filter(|g| g.id.starts_with("group-ai-")).map(|g| g.id.as_str()).collect();
        assert_eq!(ais.len(), 1);
        assert_eq!(doc.nodes[1].group, None, "旧 AI 分组的节点归属被解除");
    }

    #[test]
    fn apply_ai_groups_drops_ghost_ids_and_dedupes_across_groups() {
        let dir = temp_dir("ai_groups_safe");
        let _ = std::fs::remove_dir_all(&dir);
        let mut doc = CanvasDocument {
            id: "c-safe".into(),
            note_id: None,
            co_write_session_id: None,
            nodes: vec![
                CanvasNode { id: "n1".into(), text: "A".into(), ..CanvasNode::default() },
                CanvasNode { id: "n2".into(), text: "B".into(), ..CanvasNode::default() },
            ],
            edges: vec![],
            groups: vec![],
        };
        // LLM 幻觉 id "ghost" 必须被丢弃；n1 同时出现在两组 → 只归第一组
        apply_ai_groups(
            &mut doc,
            &[
                GroupSpec { title: "第一组".into(), node_ids: vec!["n1".into(), "ghost".into()] },
                GroupSpec { title: "第二组".into(), node_ids: vec!["n1".into(), "n2".into()] },
            ],
        );
        assert_eq!(doc.groups.len(), 2);
        assert_eq!(doc.groups[0].node_ids, vec!["n1"]);
        assert_eq!(doc.groups[1].node_ids, vec!["n2"], "n1 已归第一组，不重复出现");
        let n1_group = doc.nodes.iter().find(|n| n.id == "n1").unwrap().group.clone();
        assert_eq!(n1_group.as_deref(), Some("group-ai-0"));
        // 全部为幻觉 id → 不生成幽灵分组
        let mut doc2 = CanvasDocument {
            id: "c-safe2".into(),
            note_id: None,
            co_write_session_id: None,
            nodes: vec![],
            edges: vec![],
            groups: vec![],
        };
        apply_ai_groups(&mut doc2, &[GroupSpec { title: "空组".into(), node_ids: vec!["ghost".into()] }]);
        assert!(doc2.groups.is_empty(), "全幻觉分组不应落盘");

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn enforce_write_confirmation_forces_confirm_on_write_tools() {
        let mut plan = vec![
            tool_step("p1", "note.search", json!({"query": "x"})),
            tool_step("p2", "note.create", json!({"title": "t"})),
            tool_step("p3", "web.search", json!({"query": "q"})),
            tool_step("p4", "canvas.read", json!({})),
            llm_step("p5", json!({})),
        ];
        enforce_write_confirmation(&mut plan);
        assert!(!plan[0].required_confirm, "只读工具不强制确认");
        assert!(plan[1].required_confirm, "note.create 必须确认");
        assert!(plan[2].required_confirm, "web.search 必须确认");
        assert!(!plan[3].required_confirm);
        assert!(!plan[4].required_confirm, "LLM 步骤不强制确认");
    }

    #[test]
    fn plan_for_goal_expands_group_pipeline() {
        let plan = plan_for_goal("自动分组画布卡片");
        assert_eq!(plan.len(), 3);
        assert_eq!(plan[0].tool.as_deref(), Some("canvas.read"));
        assert!(plan[1].kind == StepKind::Llm);
        assert!(plan[1].input["promptTemplate"].as_str().unwrap().contains("groups"));
        assert_eq!(plan[2].tool.as_deref(), Some("canvas.save-groups"));
        assert!(plan[2].required_confirm);
    }

    #[test]
    fn output_text_groups_cards_under_headers() {
        let doc = json!({
            "nodes": [
                { "id": "n1", "text": "主角动机", "group": "g1" },
                { "id": "n2", "text": "雨夜重逢", "group": "g1" },
                { "id": "n3", "text": "世界规则", "group": "g2" }
            ],
            "groups": [
                { "id": "g1", "title": "人物" },
                { "id": "g2", "title": "世界观" }
            ]
        });
        let text = output_text(&doc);
        let person_pos = text.find("【人物】").unwrap();
        let world_pos = text.find("【世界观】").unwrap();
        assert!(person_pos < world_pos, "按分组顺序输出");
        assert!(text.find("主角动机").unwrap() > person_pos);
        assert!(text.find("世界规则").unwrap() > world_pos);
    }

    // ── 知识采集（knowledge.collect）：检索 → 提炼 → 批量落卡 ────────────────

    #[test]
    fn extract_collect_query_parses_goal() {
        assert_eq!(extract_collect_query("知识采集：怎么学习番茄工作法"), "怎么学习番茄工作法");
        assert_eq!(extract_collect_query("知识采集:番茄工作法"), "番茄工作法");
        assert_eq!(extract_collect_query("随便聊聊"), "随便聊聊");
    }

    #[test]
    fn parse_collect_cards_extracts_knowledge() {
        let text = "```json\n{\"cards\": [{\"text\": \"番茄工作法：25 分钟专注\", \"url\": \"https://a.com/1\", \"title\": \"入门\"}, {\"text\": \"休息 5 分钟\", \"url\": \"\", \"title\": \"\"}]}\n```";
        let cards = parse_collect_cards(text).unwrap();
        assert_eq!(cards.len(), 2);
        assert_eq!(cards[0].text, "番茄工作法：25 分钟专注");
        assert_eq!(cards[0].url, "https://a.com/1");
        assert!(parse_collect_cards("不是 JSON").is_err());
        assert!(parse_collect_cards("{\"cards\": [{\"text\": \"  \"}]}").is_err());
    }

    #[test]
    fn plan_for_goal_expands_collect_pipeline() {
        let plan = plan_for_goal("知识采集：怎么学习番茄工作法");
        assert_eq!(plan.len(), 3);
        assert_eq!(plan[0].tool.as_deref(), Some("web.search"));
        assert_eq!(plan[0].input["query"], "怎么学习番茄工作法");
        assert!(plan[1].kind == StepKind::Llm);
        assert!(plan[1].input["promptTemplate"].as_str().unwrap().contains("cards"));
        assert_eq!(plan[2].tool.as_deref(), Some("canvas.batch-create"));
        // 知识采集是全自动流水线：落卡步骤不再要求用户确认
        assert!(!plan[2].required_confirm);
        assert_eq!(plan[2].input["question"], "怎么学习番茄工作法");
    }

    #[test]
    fn runner_batch_creates_knowledge_cards_with_question_link() {
        let dir = temp_dir("collect_canvas");
        let _ = std::fs::remove_dir_all(&dir);
        let canvas = CanvasStore::new(dir.clone());
        canvas
            .save(CanvasDocument {
                id: "canvas-c1".into(),
                note_id: None,
                co_write_session_id: None,
                nodes: vec![],
                edges: vec![],
                groups: vec![],
            })
            .unwrap();
        let tasks = task_store("collect_tasks");
        let notes = notes_store("collect_notes");

        let mut task = Task::new("t-collect", "知识采集：番茄工作法");
        let llm_output = json!({ "text": "{\"cards\": [{\"text\": \"25 分钟专注\", \"url\": \"https://a.com\", \"title\": \"入门\"}, {\"text\": \"5 分钟休息\"}]}" });
        task.plan = vec![
            Step {
                step_id: "k2".into(),
                kind: StepKind::Llm,
                tool: None,
                input: json!({}),
                output: Some(llm_output),
                status: StepStatus::Done,
                required_confirm: false,
                confirmed: true,
            },
            tool_step_confirm("k3", "canvas.batch-create", json!({"canvasId": "first", "question": "番茄工作法"})),
        ];
        tasks.create(&task).unwrap();
        let test_runner = TaskRunner::new(&tasks, notes.clone(), None, None, Some(&canvas), None);

        tauri::async_runtime::block_on(test_runner.run(&mut task)).unwrap();
        assert_eq!(task.status, TaskStatus::AwaitingConfirm);
        task.plan[1].confirmed = true;
        tasks.update(&task).unwrap();
        tauri::async_runtime::block_on(test_runner.run(&mut task)).unwrap();
        assert_eq!(task.status, TaskStatus::Done);

        let saved = canvas.get("canvas-c1").unwrap();
        assert_eq!(saved.nodes.len(), 3, "1 张问题卡 + 2 张知识卡");
        let question = saved.nodes.iter().find(|n| n.node_type == "question").unwrap();
        assert_eq!(question.text, "番茄工作法");
        assert_eq!(question.fields.get("status").map(String::as_str), Some("已答"));
        let knowledge: Vec<_> = saved.nodes.iter().filter(|n| n.node_type == "knowledge").collect();
        assert_eq!(knowledge.len(), 2);
        assert_eq!(knowledge[0].fields.get("url").map(String::as_str), Some("https://a.com"));
        // question → 每张知识卡一条 cites 连线
        assert_eq!(saved.edges.len(), 2);
        assert!(saved.edges.iter().all(|e| e.relation_type == "cites"));

        let _ = std::fs::remove_dir_all(&dir);
        let _ = std::fs::remove_dir_all(temp_dir("collect_tasks"));
        let _ = std::fs::remove_dir_all(temp_dir("collect_notes"));
    }

    #[test]
    fn runner_web_search_soft_degrades_without_searxng_or_when_unreachable() {
        // web.search 必须软降级：未配置 SearXNG / 实例连不上时都返回 Done + 空 results + notice，
        // 整条任务继续执行，而不是 "回答失败"。（配置写在 runner 注入的 notes store 里，无全局 env 竞态）
        let notes = notes_store("web_search_notes");
        let tasks = task_store("web_search_tasks");

        // 场景 1：未配置 SearXNG（用户清空地址）
        {
            let mut cfg = notes.load_config().unwrap();
            cfg.searxng_url = String::new();
            notes.save_config(cfg).unwrap();
        }
        let mut task = Task::new("t-ws-unconfigured", "知识采集：番茄工作法");
        task.plan = vec![tool_step(
            "k1",
            "web.search",
            json!({ "query": "番茄工作法", "limit": 6 }),
        )];
        tasks.create(&task).unwrap();
        let test_runner = runner(&tasks, &notes);
        tauri::async_runtime::block_on(test_runner.run(&mut task)).unwrap();
        assert_eq!(task.status, TaskStatus::Done);
        assert_eq!(task.plan[0].status, StepStatus::Done);
        let out = task.plan[0].output.as_ref().expect("web.search 有输出");
        assert_eq!(out["results"].as_array().map(Vec::len), Some(0));
        assert!(out["notice"].as_str().unwrap_or_default().contains("未配置"));

        // 场景 2：配置了地址但实例连不上（端口 1 → 立即连接拒绝）
        {
            let mut cfg = notes.load_config().unwrap();
            cfg.searxng_url = "http://127.0.0.1:1".to_string();
            notes.save_config(cfg).unwrap();
        }
        let mut task = Task::new("t-ws-down", "知识采集：番茄工作法");
        task.plan = vec![tool_step(
            "k1",
            "web.search",
            json!({ "query": "番茄工作法", "limit": 6 }),
        )];
        tasks.create(&task).unwrap();
        let test_runner = runner(&tasks, &notes);
        tauri::async_runtime::block_on(test_runner.run(&mut task)).unwrap();
        assert_eq!(task.status, TaskStatus::Done);
        assert_eq!(task.plan[0].status, StepStatus::Done);
        let out = task.plan[0].output.as_ref().expect("web.search 有输出");
        assert_eq!(out["results"].as_array().map(Vec::len), Some(0));
        assert!(out["notice"].as_str().unwrap_or_default().contains("暂不可用"));

        let _ = std::fs::remove_dir_all(temp_dir("web_search_tasks"));
        let _ = std::fs::remove_dir_all(temp_dir("web_search_notes"));
    }
}
