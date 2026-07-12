import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  CoWriteIdentity,
  CoWriteSession,
  CoWriteSessionSummary,
} from "../features/cowrite/types";
import type { ProviderConfig } from "../features/settings/types";
import {
  createCoWriteSession,
  appendHumanText,
  appendAIText,
  getCoWriteSession,
  listCoWriteSessions,
  mergeToNote,
  deleteCoWriteSession,
  replaceLastAIText,
  undoLastTurn,
} from "../features/cowrite/api";
import {
  requestCoWriteAITurn,
  regenerateCoWriteAITurn,
  generateInspirations,
  type CoWriteInspiration,
} from "../features/cowrite/coWriteAI";
import { getNote } from "../features/notes/api";
import { computeCoWriteStats } from "../features/cowrite/coWriteUtils";
import { SCENARIO_PRESETS, getScenario } from "../features/cowrite/prompts";

export interface CoWritePageProps {
  providers: ProviderConfig[];
  noteId: string;
  noteContent: string;
  onNoteContentChange?: (content: string) => void;
}

const IDENTITY_OPTIONS: { key: CoWriteIdentity; label: string; desc: string }[] = [
  { key: "continuator", label: "续写者", desc: "顺着你的思路往下写" },
  { key: "questioner", label: "追问者", desc: "不断追问，帮你挖得更深" },
  { key: "opposer", label: "反对者", desc: "找反例、挑漏洞" },
  { key: "poetic", label: "诗意者", desc: "注入诗意和画面感" },
  { key: "custom", label: "自定义", desc: "自己定义 AI 的角色" },
];

function formatDuration(ms: number): string {
  if (ms <= 0) return "0 秒";
  const seconds = Math.floor(ms / 1000);
  const mins = Math.floor(seconds / 60);
  const hours = Math.floor(mins / 60);
  if (hours > 0) return `${hours} 小时 ${mins % 60} 分`;
  if (mins > 0) return `${mins} 分 ${seconds % 60} 秒`;
  return `${seconds} 秒`;
}

function formatRelativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  if (diff < 10_000) return "刚刚";
  const seconds = Math.floor(diff / 1000);
  const mins = Math.floor(seconds / 60);
  const hours = Math.floor(mins / 60);
  const days = Math.floor(hours / 24);
  if (days > 0) return `${days} 天前`;
  if (hours > 0) return `${hours} 小时前`;
  if (mins > 0) return `${mins} 分钟前`;
  return "刚刚";
}

export function CoWritePage({
  providers,
  noteId,
  noteContent,
  onNoteContentChange,
}: CoWritePageProps) {
  const [sessions, setSessions] = useState<CoWriteSessionSummary[]>([]);
  const [activeSession, setActiveSession] = useState<CoWriteSession | null>(null);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [showNewDialog, setShowNewDialog] = useState(false);
  const [selectedScenarioKey, setSelectedScenarioKey] = useState<string | null>(null);
  const [selectedIdentity, setSelectedIdentity] = useState<CoWriteIdentity>("continuator");
  const [customPrompt, setCustomPrompt] = useState("");
  const [humanInput, setHumanInput] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [selectedBlocks, setSelectedBlocks] = useState<Set<number>>(new Set());
  const [mergedBlockIndices, setMergedBlockIndices] = useState<Set<number>>(new Set());
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [noteTitle, setNoteTitle] = useState<string | null>(null);
  const [autoTurn, setAutoTurn] = useState(false);
  const [statsExpanded, setStatsExpanded] = useState(false);
  const [inspirations, setInspirations] = useState<CoWriteInspiration[]>([]);
  const [inspirationsLoading, setInspirationsLoading] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const editRef = useRef<HTMLDivElement>(null);

  // 新内容自动滚动到底部
  useEffect(() => {
    if (editRef.current) {
      editRef.current.scrollTo({
        top: editRef.current.scrollHeight,
        behavior: "smooth",
      });
    }
  }, [activeSession?.blocks.length]);

  // 加载当前笔记标题
  useEffect(() => {
    if (!noteId) {
      setNoteTitle(null);
      return;
    }
    getNote(noteId)
      .then((note) => setNoteTitle(note.title || null))
      .catch(() => setNoteTitle(null));
  }, [noteId]);

  // 切换到某个会话
  const loadSession = useCallback(async (sessionId: string) => {
    try {
      const session = await getCoWriteSession(sessionId);
      setActiveSession(session);
      setActiveSessionId(sessionId);
      setSelectedBlocks(new Set());
      setMergedBlockIndices(
        new Set(
          session.blocks.map((block, idx) => (block.merged ? idx : -1)).filter((idx) => idx >= 0),
        ),
      );
      setErrorMessage(null);
      setInspirations([]);
    } catch (e) {
      console.error(e);
      setErrorMessage(e instanceof Error ? e.message : "加载会话失败");
    }
  }, []);

  // 加载会话列表，笔记切换时清空当前会话避免串到其它笔记；
  // 如果有会话则自动加载最新的一条，避免下拉框默认选中但状态未同步。
  useEffect(() => {
    setErrorMessage(null);
    setActiveSession(null);
    setActiveSessionId(null);
    setSelectedBlocks(new Set());
    setMergedBlockIndices(new Set());
    setInspirations([]);
    listCoWriteSessions(noteId)
      .then((list) => {
        const sessions = Array.isArray(list) ? list : [];
        setSessions(sessions);
        if (sessions.length > 0) {
          void loadSession(sessions[0].id);
        }
      })
      .catch((e) => {
        console.error(e);
        setErrorMessage(e instanceof Error ? e.message : "加载会话列表失败");
      });
  }, [noteId, loadSession]);

  const runAITurn = useCallback(
    async (session: CoWriteSession) => {
      setAiLoading(true);
      setErrorMessage(null);
      try {
        const aiText = await requestCoWriteAITurn(
          session,
          session.identity,
          session.customPrompt,
          providers,
        );
        if (!aiText.trim()) {
          throw new Error("AI 返回内容为空");
        }
        const updated = await appendAIText(session.id, aiText);
        setActiveSession(updated);
      } catch (e) {
        console.error("[cowrite] AI turn failed", e);
        setErrorMessage(e instanceof Error ? e.message : "AI 调用失败");
      } finally {
        setAiLoading(false);
      }
    },
    [providers],
  );

  // 打开新建弹窗时，根据当前会话回显之前的 AI 角色/自定义 Prompt
  useEffect(() => {
    if (!showNewDialog) return;
    setSelectedScenarioKey(null);
    if (activeSession) {
      setSelectedIdentity(activeSession.identity);
      setCustomPrompt(activeSession.customPrompt ?? "");
    } else {
      setSelectedIdentity("continuator");
      setCustomPrompt("");
    }
  }, [showNewDialog, activeSession]);

  // 新建会话
  const handleCreate = useCallback(async () => {
    try {
      const scenario = selectedScenarioKey ? getScenario(selectedScenarioKey) : null;
      const identity = scenario?.identity ?? selectedIdentity;
      const prompt =
        scenario?.systemPrompt ?? (selectedIdentity === "custom" ? customPrompt : undefined);

      const session = await createCoWriteSession(noteId, identity, prompt);

      let currentSession = session;
      if (scenario) {
        currentSession = await appendAIText(session.id, scenario.openingLine);
      }

      setActiveSession(currentSession);
      setActiveSessionId(currentSession.id);
      setShowNewDialog(false);
      setSelectedScenarioKey(null);
      setCustomPrompt("");
      setErrorMessage(null);
      const list = await listCoWriteSessions(noteId);
      setSessions(list);
    } catch (e) {
      console.error(e);
      setErrorMessage(e instanceof Error ? e.message : "创建会话失败");
    }
  }, [noteId, selectedScenarioKey, selectedIdentity, customPrompt]);

  // 人类写一段
  const handleHumanSubmit = useCallback(async () => {
    if (!humanInput.trim() || !activeSessionId) return;
    try {
      const updated = await appendHumanText(activeSessionId, humanInput.trim());
      setActiveSession(updated);
      setHumanInput("");
      setErrorMessage(null);
      if (autoTurn) {
        await runAITurn(updated);
      }
    } catch (e) {
      console.error(e);
      setErrorMessage(e instanceof Error ? e.message : "提交失败");
    }
  }, [humanInput, activeSessionId, autoTurn, runAITurn]);

  // AI 续写（手动触发）
  const handleAITurn = useCallback(() => {
    if (!activeSession || aiLoading) return;
    void runAITurn(activeSession);
  }, [activeSession, aiLoading, runAITurn]);

  // 重新生成最后一段 AI
  const handleRegenerate = useCallback(async () => {
    if (!activeSession || aiLoading) return;
    const last = activeSession.blocks[activeSession.blocks.length - 1];
    if (!last || last.author !== "ai") {
      setErrorMessage("最后一段不是 AI 内容，无法重新生成");
      return;
    }
    setAiLoading(true);
    setErrorMessage(null);
    try {
      const aiText = await regenerateCoWriteAITurn(
        activeSession,
        activeSession.identity,
        activeSession.customPrompt,
        providers,
      );
      if (!aiText.trim()) {
        throw new Error("AI 返回内容为空");
      }
      const updated = await replaceLastAIText(activeSession.id, aiText);
      setActiveSession(updated);
    } catch (e) {
      console.error("[cowrite] regenerate failed", e);
      setErrorMessage(e instanceof Error ? e.message : "重新生成失败");
    } finally {
      setAiLoading(false);
    }
  }, [activeSession, aiLoading, providers]);

  // 撤回上一步
  const handleUndo = useCallback(async () => {
    if (!activeSession || activeSession.blocks.length === 0) return;
    const lastIndex = activeSession.blocks.length - 1;
    const last = activeSession.blocks[lastIndex];
    const desc = last.author === "ai" ? "AI 的最后一段回复" : "你最后的输入";
    if (!window.confirm(`确定要撤回${desc}吗？`)) return;
    try {
      const updated = await undoLastTurn(activeSession.id);
      setActiveSession(updated);
      setMergedBlockIndices((prev) => {
        if (!prev.has(lastIndex)) return prev;
        const next = new Set(prev);
        next.delete(lastIndex);
        return next;
      });
      setErrorMessage(null);
    } catch (e) {
      console.error(e);
      setErrorMessage(e instanceof Error ? e.message : "撤回失败");
    }
  }, [activeSession]);

  // 合并到笔记
  const handleMerge = useCallback(async () => {
    if (!activeSessionId || selectedBlocks.size === 0) return;
    try {
      const result = await mergeToNote(
        activeSessionId,
        Array.from(selectedBlocks).sort((a, b) => a - b),
      );
      onNoteContentChange?.(result.content);
      setActiveSession(result.session);
      setMergedBlockIndices(
        new Set(
          result.session.blocks
            .map((block, idx) => (block.merged ? idx : -1))
            .filter((idx) => idx >= 0),
        ),
      );
      setSelectedBlocks(new Set());
      setErrorMessage(null);
    } catch (e) {
      console.error(e);
      setErrorMessage(e instanceof Error ? e.message : "合并失败");
    }
  }, [activeSessionId, onNoteContentChange, selectedBlocks]);

  // 删除会话
  const handleDelete = useCallback(
    async (sessionId: string) => {
      try {
        await deleteCoWriteSession(sessionId);
        if (activeSessionId === sessionId) {
          setActiveSession(null);
          setActiveSessionId(null);
        }
        setErrorMessage(null);
        const list = await listCoWriteSessions(noteId);
        setSessions(list);
      } catch (e) {
        console.error(e);
        setErrorMessage(e instanceof Error ? e.message : "删除失败");
      }
    },
    [noteId, activeSessionId],
  );

  // 获取灵感
  const handleGetInspirations = useCallback(async () => {
    if (providers.length === 0) {
      setErrorMessage("没有可用的 AI 供应商");
      return;
    }
    setInspirationsLoading(true);
    setErrorMessage(null);
    try {
      const items = await generateInspirations(noteContent, providers);
      setInspirations(items);
    } catch (e) {
      console.error(e);
      setErrorMessage(e instanceof Error ? e.message : "获取灵感失败");
    } finally {
      setInspirationsLoading(false);
    }
  }, [noteContent, providers]);

  // 使用灵感
  const handleUseInspiration = useCallback(
    async (item: CoWriteInspiration) => {
      if (!activeSessionId) return;
      try {
        const updated = await appendHumanText(activeSessionId, item.snippet);
        setActiveSession(updated);
        setInspirations([]);
        setErrorMessage(null);
        // 灵感卡片点击后自动写入 human 开头并触发 AI 续写
        await runAITurn(updated);
      } catch (e) {
        console.error(e);
        setErrorMessage(e instanceof Error ? e.message : "使用灵感失败");
      }
    },
    [activeSessionId, runAITurn],
  );

  const toggleBlock = (index: number) => {
    if (mergedBlockIndices.has(index)) return;
    const next = new Set(selectedBlocks);
    if (next.has(index)) {
      next.delete(index);
    } else {
      next.add(index);
    }
    setSelectedBlocks(next);
  };

  const currentTurn = useMemo(() => {
    if (!activeSession || activeSession.blocks.length === 0) return "human";
    const last = activeSession.blocks[activeSession.blocks.length - 1];
    return last.author === "human" ? "ai" : "human";
  }, [activeSession]);

  const stats = useMemo(
    () => (activeSession ? computeCoWriteStats(activeSession) : null),
    [activeSession],
  );

  console.log("[cowrite] render", {
    noteId,
    activeSessionId,
    currentTurn,
    blocksCount: activeSession?.blocks.length,
  });

  const hasNote = Boolean(noteId);

  if (!hasNote) {
    return (
      <div className="cowrite-container">
        <div className="cowrite-main" style={{ width: "100%" }}>
          <div className="cowrite-placeholder">
            请先在左侧边栏点击“笔记”，选择一篇笔记后再开始共笔
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="cowrite-container">
      {/* 左侧共笔侧边栏 */}
      <div className={`cowrite-sidebar ${sidebarCollapsed ? "collapsed" : ""}`}>
        <div className="cowrite-sidebar-header">
          <h3>共笔</h3>
          <button
            className="cowrite-btn-toggle-sidebar"
            onClick={() => setSidebarCollapsed((v) => !v)}
            title={sidebarCollapsed ? "展开" : "收起"}
          >
            {sidebarCollapsed ? (
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="9 18 15 12 9 6" />
              </svg>
            ) : (
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="15 18 9 12 15 6" />
              </svg>
            )}
          </button>
        </div>

        <div className="cowrite-sidebar-body">
          {sessions.length === 0 ? (
            <div className="cowrite-empty-state">
              <p>暂无共笔会话</p>
              <button className="cowrite-btn-new" onClick={() => setShowNewDialog(true)}>
                + 新建共笔
              </button>
            </div>
          ) : (
            <>
              <div className="cowrite-session-toolbar">
                <select
                  className="cowrite-session-select"
                  value={activeSessionId ?? ""}
                  onChange={(e) => {
                    const id = e.target.value;
                    if (id) void loadSession(id);
                  }}
                >
                  {sessions.map((s) => (
                    <option key={s.id} value={s.id}>
                      {IDENTITY_OPTIONS.find((o) => o.key === s.identity)?.label ?? s.identity}·{" "}
                      {s.blockCount} 段
                    </option>
                  ))}
                </select>
                <button
                  className="cowrite-btn-icon"
                  title="删除当前会话"
                  onClick={() => {
                    if (activeSessionId) void handleDelete(activeSessionId);
                  }}
                  disabled={!activeSessionId}
                >
                  🗑
                </button>
                <button
                  className="cowrite-btn-new"
                  onClick={() => setShowNewDialog(true)}
                  title="新建共笔会话"
                >
                  +
                </button>
              </div>

              {errorMessage && <div className="cowrite-error-bar">{errorMessage}</div>}

              {!activeSession ? (
                <div className="cowrite-placeholder">选择一个共笔会话开始</div>
              ) : (
                <>
                  {/* 状态条（点击展开统计） */}
                  <div className="cowrite-status-bar" onClick={() => setStatsExpanded((v) => !v)}>
                    <span className="cowrite-status-identity">
                      {IDENTITY_OPTIONS.find((o) => o.key === activeSession.identity)?.label ??
                        activeSession.identity}
                    </span>
                    <span className="cowrite-status-turn">
                      {aiLoading ? "AI 思考中" : currentTurn === "human" ? "轮到你了" : "轮到 AI"}
                    </span>
                    <span className="cowrite-status-count">
                      {stats ? `${stats.humanChars + stats.aiChars} 字` : ""}
                    </span>
                  </div>

                  {/* 统计详情 */}
                  {stats && statsExpanded && (
                    <div className="cowrite-stats-detail">
                      <div className="cowrite-stats-row">
                        <span>
                          人：{stats.humanChars} 字 / {stats.humanBlocks} 段
                        </span>
                        <span>
                          AI：{stats.aiChars} 字 / {stats.aiBlocks} 段
                        </span>
                        <span>总轮次：{stats.totalTurns}</span>
                      </div>
                      <div className="cowrite-stats-bar-wrap">
                        <div
                          className="cowrite-stats-bar-human"
                          style={{
                            width: `${
                              stats.humanChars + stats.aiChars === 0
                                ? 50
                                : (stats.humanChars / (stats.humanChars + stats.aiChars)) * 100
                            }%`,
                          }}
                        />
                        <div
                          className="cowrite-stats-bar-ai"
                          style={{
                            width: `${
                              stats.humanChars + stats.aiChars === 0
                                ? 50
                                : (stats.aiChars / (stats.humanChars + stats.aiChars)) * 100
                            }%`,
                          }}
                        />
                      </div>
                      <div className="cowrite-stats-row">
                        <span>会话时长：{formatDuration(stats.durationMs)}</span>
                        <span>最后活跃：{formatRelativeTime(stats.lastActiveAt)}</span>
                      </div>
                    </div>
                  )}

                  {/* 灵感注入 */}
                  {activeSession.blocks.length === 0 && !aiLoading && (
                    <div className="cowrite-inspiration-area">
                      <p className="cowrite-inspiration-hint">不知道写什么？让 AI 给点灵感</p>
                      <button
                        className="cowrite-btn-inspiration"
                        onClick={() => handleGetInspirations()}
                        disabled={inspirationsLoading}
                      >
                        {inspirationsLoading ? "获取中…" : "获取灵感"}
                      </button>
                      {inspirations.length > 0 && (
                        <div className="cowrite-inspiration-list">
                          {inspirations.map((item, index) => (
                            <div
                              key={index}
                              className="cowrite-inspiration-card"
                              onClick={() => handleUseInspiration(item)}
                            >
                              <div className="cowrite-inspiration-title">{item.title}</div>
                              <div className="cowrite-inspiration-snippet">{item.snippet}</div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* 对话内容 */}
                  <div ref={editRef} className="cowrite-content">
                    {activeSession.blocks.map((block, i) => (
                      <div
                        key={i}
                        className={`cowrite-block cowrite-author-${block.author} ${
                          selectedBlocks.has(i) ? "selected" : ""
                        } ${mergedBlockIndices.has(i) ? "merged" : ""}`}
                        onClick={() => toggleBlock(i)}
                        title={mergedBlockIndices.has(i) ? "已合并到笔记" : ""}
                      >
                        <span className="cowrite-block-author">
                          {block.author === "human" ? "你" : "AI"}
                          {mergedBlockIndices.has(i) && (
                            <span className="cowrite-block-merged-badge">✓</span>
                          )}
                        </span>
                        <p className="cowrite-block-text">{block.text}</p>
                        {block.author === "ai" && (
                          <button
                            className="cowrite-btn-regenerate"
                            title="重新生成"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleRegenerate();
                            }}
                            disabled={aiLoading}
                          >
                            ⟳
                          </button>
                        )}
                      </div>
                    ))}
                    {activeSession.blocks.length === 0 && (
                      <div className="cowrite-content-empty">开始写第一段吧</div>
                    )}
                  </div>

                  {/* 输入区 */}
                  {currentTurn === "human" && !aiLoading && (
                    <div className="cowrite-input-area">
                      <textarea
                        className="cowrite-input"
                        value={humanInput}
                        onChange={(e) => setHumanInput(e.target.value)}
                        placeholder="写一段…"
                        rows={3}
                        disabled={aiLoading}
                      />
                      <div className="cowrite-input-actions">
                        <button
                          className="cowrite-btn-undo"
                          onClick={() => handleUndo()}
                          disabled={activeSession.blocks.length === 0}
                        >
                          撤回
                        </button>
                        <button
                          className={`cowrite-btn-auto ${autoTurn ? "active" : ""}`}
                          onClick={() => setAutoTurn((v) => !v)}
                        >
                          {autoTurn ? "手动模式" : "自动续写"}
                        </button>
                        <button
                          className="cowrite-btn-submit"
                          onClick={() => handleHumanSubmit()}
                          disabled={!humanInput.trim()}
                        >
                          提交
                        </button>
                        {!autoTurn && (
                          <button
                            className="cowrite-btn-ai"
                            onClick={() => handleAITurn()}
                            disabled={aiLoading}
                          >
                            轮到 AI
                          </button>
                        )}
                      </div>
                    </div>
                  )}

                  {currentTurn === "ai" && !aiLoading && (
                    <div className="cowrite-input-area">
                      <div className="cowrite-input-actions">
                        <button
                          className="cowrite-btn-undo"
                          onClick={() => handleUndo()}
                          disabled={activeSession.blocks.length === 0}
                        >
                          撤回
                        </button>
                        <button className="cowrite-btn-ai" onClick={() => handleAITurn()}>
                          轮到 AI
                        </button>
                      </div>
                    </div>
                  )}

                  {/* 合并操作 */}
                  {activeSession.blocks.length > 0 && (
                    <div className="cowrite-merge-bar">
                      <span className="cowrite-merge-hint">点击段落选中，合并到笔记</span>
                      <button
                        className="cowrite-btn-merge"
                        onClick={() => handleMerge()}
                        disabled={
                          selectedBlocks.size === 0 ||
                          Array.from(selectedBlocks).some((i) => mergedBlockIndices.has(i))
                        }
                      >
                        合并 ({selectedBlocks.size})
                      </button>
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </div>
      </div>

      {/* 右侧主界面：当前笔记原文 */}
      <div className="cowrite-main">
        <div className="cowrite-main-header">
          <div className="cowrite-main-title">
            <span className="cowrite-main-title-label">当前笔记</span>
            <span className="cowrite-main-title-text" title={noteTitle ?? noteId}>
              {noteTitle || "（无标题）"}
            </span>
          </div>
        </div>
        <div className="cowrite-note-content">
          {noteContent ? (
            <pre className="cowrite-note-content-text">{noteContent}</pre>
          ) : (
            <div className="cowrite-note-content-empty">暂无内容</div>
          )}
        </div>
      </div>

      {/* 新建会话弹窗 */}
      {showNewDialog && (
        <div className="cowrite-dialog-overlay" onClick={() => setShowNewDialog(false)}>
          <div className="cowrite-dialog" onClick={(e) => e.stopPropagation()}>
            <h3>新建共笔会话</h3>

            <div className="cowrite-section-label">选择场景（可选）</div>
            <div className="cowrite-scenario-grid">
              {SCENARIO_PRESETS.map((scenario) => (
                <div
                  key={scenario.key}
                  className={`cowrite-scenario-card ${
                    selectedScenarioKey === scenario.key ? "active" : ""
                  }`}
                  onClick={() => {
                    setSelectedScenarioKey(scenario.key);
                    setSelectedIdentity(scenario.identity);
                    setCustomPrompt(scenario.systemPrompt);
                  }}
                >
                  <div className="cowrite-scenario-icon">{scenario.icon}</div>
                  <div className="cowrite-scenario-label">{scenario.label}</div>
                  <div className="cowrite-scenario-desc">{scenario.description}</div>
                </div>
              ))}
            </div>

            <div className="cowrite-section-label">AI 身份</div>
            <div className="cowrite-identity-grid">
              {IDENTITY_OPTIONS.map((opt) => (
                <div
                  key={opt.key}
                  className={`cowrite-identity-card ${
                    selectedIdentity === opt.key ? "active" : ""
                  }`}
                  onClick={() => {
                    setSelectedIdentity(opt.key);
                    if (selectedScenarioKey) {
                      setSelectedScenarioKey(null);
                      if (opt.key !== "custom") setCustomPrompt("");
                    }
                  }}
                >
                  <div className="cowrite-identity-label">{opt.label}</div>
                  <div className="cowrite-identity-desc">{opt.desc}</div>
                </div>
              ))}
            </div>
            {selectedIdentity === "custom" && (
              <textarea
                className="cowrite-custom-prompt"
                value={customPrompt}
                onChange={(e) => setCustomPrompt(e.target.value)}
                placeholder="输入自定义 Prompt…"
                rows={3}
              />
            )}
            <div className="cowrite-dialog-actions">
              <button className="cowrite-btn-cancel" onClick={() => setShowNewDialog(false)}>
                取消
              </button>
              <button className="cowrite-btn-create" onClick={() => handleCreate()}>
                创建
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
