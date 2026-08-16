import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  TOOL_MENTIONS,
  formatNoteReferenceToken,
  getNoteReferenceDisplayTitle,
  normalizeToken,
  normalizeTokenForInsert,
  type NoteMention,
} from "./mentions";

/**
 * ChatGPT 式消息输入区：
 * - 输入 @ 唤起工具联想，输入 # 唤起本地笔记联想
 * - 文本中已插入的 @/# 提及以 chip 高亮（透明文字 textarea + 底层高亮层）
 * - 底部一行：模型选择（发送按钮左侧）+ 发送按钮
 */

export interface ModelPickerOption {
  providerId: string;
  providerName: string;
  modelId: string;
  modelLabel: string;
}

interface MentionComposerProps {
  input: string;
  onChange: (value: string) => void;
  onSend: () => void;
  loading: boolean;
  placeholder?: string;
  /** # 笔记联想数据 */
  noteOptions: NoteMention[];
  onRefreshNotes: () => void;
  /** 模型选择 */
  modelOptions: ModelPickerOption[];
  selectedProviderId: string;
  selectedModelId: string;
  onPickModel: (providerId: string, modelId: string) => void;
  activeLabel: string;
  hasModel: boolean;
  agentModeLabel?: string;
}

interface Trigger {
  kind: "@" | "#";
  query: string;
  /** 触发字符在 input 中的下标 */
  start: number;
}

/** 解析输入末尾正在输入的 @/# token（token 必须位于行首或空格后） */
function parseTrigger(value: string): Trigger | null {
  const match = value.match(/(?:^|\s)([@#])([^\s]*)$/);
  if (!match || match.index === undefined) return null;
  const start = match.index + match[0].length - match[2].length - 1;
  return { kind: match[1] as "@" | "#", query: match[2], start };
}

export function MentionComposer({
  input,
  onChange,
  onSend,
  loading,
  placeholder = "输入消息，@ 工具、# 引用笔记，Enter 发送",
  noteOptions,
  onRefreshNotes,
  modelOptions,
  selectedProviderId,
  selectedModelId,
  onPickModel,
  activeLabel,
  hasModel,
  agentModeLabel,
}: MentionComposerProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const [activeMenu, setActiveMenu] = useState<"@" | "#" | null>(null);
  const [mentionQuery, setMentionQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [modelOpen, setModelOpen] = useState(false);

  // 挂载时聚焦（面板展开后可直接输入）
  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  // 输入自动增高（textarea 撑起高度，底层高亮层 absolute inset-0 跟随）
  useLayoutEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${ta.scrollHeight}px`;
  }, [input]);

  // 点击组件外部时关闭浮层
  useEffect(() => {
    if (!activeMenu && !modelOpen) return;
    const handler = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setActiveMenu(null);
        setModelOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [activeMenu, modelOpen]);

  const handleChange = (value: string) => {
    onChange(value);
    const trigger = parseTrigger(value);
    if (trigger) {
      setActiveMenu(trigger.kind);
      setMentionQuery(trigger.query);
      if (trigger.kind === "#" && noteOptions.length === 0) onRefreshNotes();
    } else {
      setActiveMenu(null);
    }
    setActiveIndex(0);
  };

  const toolItems = useMemo(
    () =>
      TOOL_MENTIONS.filter(
        (t) => !mentionQuery || t.token.includes(mentionQuery) || t.desc.includes(mentionQuery),
      ),
    [mentionQuery],
  );

  const noteItems = useMemo(() => {
    const query = normalizeToken(mentionQuery);
    return noteOptions.filter(
      (n) =>
        !query ||
        normalizeToken(n.title).includes(query) ||
        normalizeToken(n.category ?? "").includes(query),
    );
  }, [noteOptions, mentionQuery]);

  const items = activeMenu === "@" ? toolItems : noteItems;
  const safeIndex = Math.min(activeIndex, Math.max(items.length - 1, 0));

  const commitMention = (
    kind: "@" | "#",
    item: string | NoteMention | (typeof TOOL_MENTIONS)[number],
  ) => {
    const trigger = parseTrigger(input);
    if (!trigger || trigger.kind !== kind) return;
    const token =
      kind === "@"
        ? typeof item === "string"
          ? item
          : "token" in item
            ? item.token
            : item.title
        : typeof item === "string"
          ? normalizeTokenForInsert(item)
          : "id" in item
            ? formatNoteReferenceToken(item.title, item.id)
            : normalizeTokenForInsert(item.token);
    const next =
      input.slice(0, trigger.start) +
      `${kind}${token} ` +
      input.slice(trigger.start + 1 + trigger.query.length);
    onChange(next);
    setActiveMenu(null);
    setActiveIndex(0);
    requestAnimationFrame(() => {
      const ta = textareaRef.current;
      if (ta) {
        ta.focus();
        const pos = next.length;
        ta.setSelectionRange(pos, pos);
      }
    });
  };

  /** @/# 按钮：在末尾插入触发符并唤起对应联想菜单 */
  const triggerMention = (kind: "@" | "#") => {
    if (loading) return;
    const ta = textareaRef.current;
    const needsSpace = input.length > 0 && !/\s$/.test(input);
    const next = input + (needsSpace ? " " : "") + kind;
    handleChange(next);
    requestAnimationFrame(() => {
      if (ta) {
        ta.focus();
        const pos = next.length;
        ta.setSelectionRange(pos, pos);
      }
    });
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) return;

    if (activeMenu && items.length > 0) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setActiveIndex((index) => (index + 1) % items.length);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setActiveIndex((index) => (index - 1 + items.length) % items.length);
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        const item = items[safeIndex];
        if (item) {
          commitMention(activeMenu, item as string | NoteMention | (typeof TOOL_MENTIONS)[number]);
        }
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setActiveMenu(null);
        return;
      }
    }

    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      onSend();
    }
  };

  const renderHighlight = (text: string) => {
    if (!text) return null;
    return text.split(/([@#][^\s]+)/g).map((part, index) => {
      if (!part) return null;
      if (part.startsWith("@")) {
        return (
          <span key={index} className="rounded-md bg-bamboo-mist/80 px-1 font-medium text-bamboo">
            {part}
          </span>
        );
      }
      if (part.startsWith("#")) {
        return (
          <span key={index} className="rounded-md bg-canvas-card-hover px-1 font-medium text-stone">
            #{getNoteReferenceDisplayTitle(part.slice(1))}
          </span>
        );
      }
      return <span key={index}>{part}</span>;
    });
  };

  return (
    <div ref={rootRef} className="relative">
      {/* @ 工具联想 */}
      {activeMenu === "@" && toolItems.length > 0 && (
        <div className="absolute bottom-full left-0 right-0 z-30 mb-2 max-h-[224px] overflow-y-auto rounded-2xl border border-paper-deep/20 bg-paper/95 py-1 shadow-[0_16px_40px_-12px_rgba(0,0,0,0.25)] backdrop-blur-sm">
          <div className="border-b border-paper-deep/10 px-2.5 py-1 text-[9px] text-ink-ghost">
            @ 调用工具
          </div>
          {toolItems.map((item, index) => (
            <button
              key={item.token}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => commitMention("@", item.token)}
              className={`flex w-full items-center justify-between gap-2 px-2.5 py-1.5 text-left transition-colors ${
                index === safeIndex ? "bg-bamboo-mist/60" : "hover:bg-paper-warm/80"
              }`}
            >
              <span className="shrink-0 text-[11.5px] font-medium text-bamboo">@ {item.token}</span>
              <span className="truncate text-[9.5px] text-ink-ghost">{item.desc}</span>
            </button>
          ))}
        </div>
      )}

      {/* # 笔记联想 */}
      {activeMenu === "#" && (
        <div className="absolute bottom-full left-0 right-0 z-30 mb-2 max-h-[224px] overflow-y-auto rounded-2xl border border-paper-deep/20 bg-paper/95 py-1 shadow-[0_16px_40px_-12px_rgba(0,0,0,0.25)] backdrop-blur-sm">
          <div className="border-b border-paper-deep/10 px-2.5 py-1 text-[9px] text-ink-ghost">
            # 引用笔记
          </div>
          {noteItems.length === 0 ? (
            <div className="px-3 py-3 text-center text-[10px] text-ink-ghost">
              {noteOptions.length === 0 ? "正在加载笔记…" : "无匹配笔记"}
            </div>
          ) : (
            noteItems.map((note, index) => (
              <button
                key={note.id}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => commitMention("#", note)}
                className={`flex w-full items-center gap-1.5 px-2.5 py-1.5 text-left transition-colors ${
                  index === safeIndex ? "bg-canvas-card-hover" : "hover:bg-paper-warm/80"
                }`}
              >
                <span className="min-w-0 flex-1 truncate text-[11.5px] text-ink">
                  # {note.title}
                </span>
                {note.category && (
                  <span className="shrink-0 rounded-full bg-paper-warm/70 px-1.5 py-0.5 text-[9px] text-ink-ghost">
                    {note.category}
                  </span>
                )}
              </button>
            ))
          )}
        </div>
      )}

      {/* 模型选择浮层 */}
      {modelOpen && hasModel && (
        <div className="absolute bottom-full right-0 z-30 mb-2 w-[212px] rounded-2xl border border-paper-deep/20 bg-paper/95 py-1 shadow-[0_16px_40px_-12px_rgba(0,0,0,0.25)] backdrop-blur-sm">
          {modelOptions.map((option) => {
            const active =
              option.providerId === selectedProviderId && option.modelId === selectedModelId;
            return (
              <button
                key={`${option.providerId}-${option.modelId}`}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onPickModel(option.providerId, option.modelId);
                  setModelOpen(false);
                }}
                className={`flex w-full items-center gap-2 px-2.5 py-1.5 text-left transition-colors ${
                  active ? "bg-bamboo-mist/60" : "hover:bg-paper-warm/80"
                }`}
              >
                <span className="min-w-0 flex-1 truncate font-mono text-[10.5px] text-ink-soft">
                  {option.providerName} · {option.modelLabel}
                </span>
                {active && (
                  <svg
                    width="11"
                    height="11"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="shrink-0 text-bamboo"
                  >
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                )}
              </button>
            );
          })}
          {agentModeLabel && (
            <div className="mt-1 border-t border-paper-deep/10 px-2.5 pb-1 pt-1.5 text-[9px] text-ink-ghost">
              当前模式：{agentModeLabel}
            </div>
          )}
        </div>
      )}

      <div className="relative rounded-2xl border border-paper-deep/25 bg-gradient-to-b from-cloud/70 to-paper-warm/90 shadow-sm shadow-shadow-deep/30 transition-shadow duration-200 focus-within:border-bamboo/40 focus-within:shadow-sm focus-within:shadow-bamboo/25 focus-within:ring-1 focus-within:ring-bamboo/15">
        <div className="relative">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => handleChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            rows={1}
            disabled={loading}
            className="relative z-10 block w-full resize-none overflow-hidden bg-transparent px-3.5 pb-1.5 pt-3 text-[12.5px] font-body leading-relaxed text-transparent caret-ink outline-none placeholder:text-ink-ghost/45 disabled:opacity-50"
          />
          {/* 高亮层：与 textarea 相同排版，把 @/# 提及渲染成 chip */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 z-0 overflow-hidden px-3.5 pb-1.5 pt-3 text-[12.5px] font-body leading-relaxed whitespace-pre-wrap break-words text-ink"
          >
            {renderHighlight(input)}
          </div>
        </div>

        <div className="flex items-center gap-0.5 px-2 pb-2 pt-1">
          {/* @/# 按钮：点击插入触发符并唤起联想 */}
          <button
            type="button"
            onClick={() => triggerMention("@")}
            disabled={loading}
            title="插入 @，调用工具"
            className="flex h-6 min-w-[26px] cursor-pointer items-center justify-center rounded-lg px-1 text-[12px] font-bold text-ink-faint transition-colors hover:bg-bamboo-mist/60 hover:text-bamboo disabled:cursor-not-allowed disabled:opacity-40"
          >
            @
          </button>
          <button
            type="button"
            onClick={() => triggerMention("#")}
            disabled={loading}
            title="插入 #，引用笔记"
            className="flex h-6 min-w-[26px] cursor-pointer items-center justify-center rounded-lg px-1 text-[12px] font-bold text-ink-faint transition-colors hover:bg-canvas-card-hover hover:text-stone disabled:cursor-not-allowed disabled:opacity-40"
          >
            #
          </button>
          <span className="mx-1 h-3.5 w-px bg-paper-deep/25" />
          <span className="select-none text-[9px] text-ink-ghost/70">Enter 发送</span>
          <div className="flex-1" />
          <button
            type="button"
            onClick={() => {
              setModelOpen((open) => !open);
              setActiveMenu(null);
            }}
            disabled={!hasModel}
            className={`flex h-6 max-w-[132px] items-center gap-1.5 rounded-full border px-2 font-mono text-[10px] transition-all ${
              hasModel
                ? "cursor-pointer border-paper-deep/25 bg-canvas-card/60 text-ink-faint hover:border-bamboo/35 hover:text-ink"
                : "cursor-not-allowed border-paper-deep/20 bg-paper-warm/40 text-ink-ghost/60"
            }`}
            title="选择模型"
          >
            <span
              className={`h-1.5 w-1.5 shrink-0 rounded-full ${hasModel ? "bg-bamboo" : "bg-ink-ghost/60"}`}
            />
            <span className="truncate">{activeLabel}</span>
            <svg
              width="9"
              height="9"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="shrink-0 opacity-70"
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
          <button
            type="button"
            onClick={onSend}
            disabled={!input.trim() || loading}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-bamboo-light to-bamboo text-cloud shadow-sm shadow-bamboo/30 transition-all hover:shadow-md hover:shadow-bamboo/40 hover:brightness-105 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
            title="发送"
          >
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="12" y1="19" x2="12" y2="5" />
              <polyline points="5 12 12 5 19 12" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
