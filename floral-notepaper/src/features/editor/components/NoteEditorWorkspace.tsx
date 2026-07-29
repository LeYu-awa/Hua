import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  HIGHLIGHT_COLOR_OPTIONS,
  TEXT_COLOR_OPTIONS,
  applyMarkdownFormat,
  pinTileButtonTitle,
  runEditorCommand,
  type FormatAction,
} from "../commands/markdownCommands";
import { cleanUnusedImages } from "../../images/api";
import { useImageBaseDir } from "../../images/useImageBaseDir";
import { useImagePaste } from "../../images/useImagePaste";
import { MarkdownPreview } from "../../markdown/MarkdownPreview";
import { getErrorMessage } from "../../notes/api";
import { countNoteChars, formatShortDate, formatTime } from "../../notes/noteUtils";
import type { ExternalFile, NoteMetadata } from "../../notes/types";
import type { AppConfig, ViewMode } from "../../settings/types";
import { ConnectionSuggestions } from "../../../components/ConnectionSuggestions";
import { DeepSeekChat } from "../../../components/DeepSeekChat";
import { SlidingButtonGroup } from "../../../components/SlidingButtonGroup";
import { WritingMoodIndicator } from "../../../components/WritingMoodIndicator";

export type SaveState = "idle" | "dirty" | "saving" | "saved" | "error";

interface NoteEditorWorkspaceProps {
  selectedId: string | null;
  title: string;
  content: string;
  selectedNote: NoteMetadata | null;
  selectedExternalFile: ExternalFile | null;
  settingsConfig: AppConfig | null;
  viewMode: ViewMode;
  sidebarCollapsed: boolean;
  noteTransitionKey: number;
  contentRef: React.RefObject<HTMLTextAreaElement | null>;
  contentRefValue: React.MutableRefObject<string>;
  saveStateRef: React.MutableRefObject<SaveState>;
  saveState: SaveState;
  isLoading: boolean;
  isExternal: boolean;
  errorMessage: string | null;
  selectedTilePinned: boolean;
  onToggleSidebar: () => void;
  onPinEntry: () => void;
  onSaveCurrentNote: () => void;
  onDeleteNote: () => void;
  onOpenNotepad: () => void;
  onOpenSettings: () => void;
  onViewModeChange: (mode: ViewMode) => void;
  setTitle: (value: string) => void;
  setContent: (value: string) => void;
  setSaveState: (value: SaveState) => void;
  setLastActivityAt: (value: number) => void;
  setErrorMessage: (value: string | null) => void;
  markDirty: () => void;
  ensureNoteSaved: () => Promise<string | null>;
  recordTextChange: (next: string, selectionStart: number, selectionEnd: number) => void;
  recordCursor: (selectionStart: number, selectionEnd: number) => void;
  recordPaste: (
    insertedText: string,
    newValue: string,
    index: number,
    selectionStart: number,
    selectionEnd: number,
  ) => void;
  flushInk: () => void | Promise<void>;
}

export function NoteEditorWorkspace({
  selectedId,
  title,
  content,
  selectedNote,
  selectedExternalFile,
  settingsConfig,
  viewMode,
  sidebarCollapsed,
  noteTransitionKey,
  contentRef,
  contentRefValue,
  saveStateRef,
  saveState,
  isLoading,
  isExternal,
  errorMessage,
  selectedTilePinned,
  onToggleSidebar,
  onPinEntry,
  onSaveCurrentNote,
  onDeleteNote,
  onOpenNotepad,
  onOpenSettings,
  onViewModeChange,
  setTitle,
  setContent,
  setSaveState,
  setLastActivityAt,
  setErrorMessage,
  markDirty,
  ensureNoteSaved,
  recordTextChange,
  recordCursor,
  recordPaste,
  flushInk,
}: NoteEditorWorkspaceProps) {
  const { t } = useTranslation();
  const [deepSeekOpen, setDeepSeekOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [deleteExiting, setDeleteExiting] = useState(false);
  const [selectedTextRange, setSelectedTextRange] = useState<{ start: number; end: number } | null>(
    null,
  );
  const [textColorPaletteOpen, setTextColorPaletteOpen] = useState(false);
  const [highlightPaletteOpen, setHighlightPaletteOpen] = useState(false);
  const [splitRatio, setSplitRatio] = useState(0.5);
  const [isResizingSplit, setIsResizingSplit] = useState(false);
  const splitContainerRef = useRef<HTMLDivElement>(null);
  const colorPaletteRef = useRef<HTMLDivElement>(null);
  const selectionRangeRef = useRef<{ start: number; end: number } | null>(null);
  const imageBaseDir = useImageBaseDir();

  const toolbarButtons = useMemo<
    { label: string; title: string; style: string; action: FormatAction }[]
  >(
    () => [
      {
        label: "B",
        title: t("main.toolbar.bold", { defaultValue: "粗体" }),
        style: "font-bold",
        action: "bold",
      },
      {
        label: "I",
        title: t("main.toolbar.italic", { defaultValue: "斜体" }),
        style: "italic",
        action: "italic",
      },
      {
        label: "H",
        title: t("main.toolbar.heading", { defaultValue: "标题" }),
        style: "font-bold",
        action: "heading",
      },
      {
        label: "—",
        title: t("main.toolbar.hr", { defaultValue: "分割线" }),
        style: "",
        action: "hr",
      },
      {
        label: "•",
        title: t("main.toolbar.ul", { defaultValue: "无序列表" }),
        style: "",
        action: "ul",
      },
      {
        label: "1.",
        title: t("main.toolbar.ol", { defaultValue: "有序列表" }),
        style: "font-mono text-[9px]",
        action: "ol",
      },
      {
        label: "<>",
        title: t("main.toolbar.code", { defaultValue: "代码" }),
        style: "font-mono text-[9px]",
        action: "code",
      },
      {
        label: "❝",
        title: t("main.toolbar.quote", { defaultValue: "引用" }),
        style: "",
        action: "quote",
      },
      {
        label: "∑",
        title: t("main.toolbar.inlineMath", { defaultValue: "行内公式" }),
        style: "font-mono text-[11px]",
        action: "inlineMath",
      },
      {
        label: "∫",
        title: t("main.toolbar.blockMath", { defaultValue: "块级公式" }),
        style: "font-mono text-[11px]",
        action: "blockMath",
      },
    ],
    [t],
  );

  const viewModeOptions = useMemo(
    () => [
      {
        value: "edit" as ViewMode,
        label: t("settings.defaultView.edit", { defaultValue: "编辑" }),
      },
      {
        value: "split" as ViewMode,
        label: t("settings.defaultView.split", { defaultValue: "分栏" }),
      },
      {
        value: "preview" as ViewMode,
        label: t("settings.defaultView.preview", { defaultValue: "预览" }),
      },
    ],
    [t],
  );

  const saveStateLabel = useMemo<Record<SaveState, string>>(
    () => ({
      idle: t("main.statusBar.saveState.idle", { defaultValue: "未选择" }),
      dirty: t("main.statusBar.saveState.dirty", { defaultValue: "未保存" }),
      saving: t("main.statusBar.saveState.saving", { defaultValue: "保存中" }),
      saved: t("main.statusBar.saveState.saved", { defaultValue: "已保存" }),
      error: t("main.statusBar.saveState.error", { defaultValue: "保存失败" }),
    }),
    [t],
  );

  const lineCount = useMemo(() => content.split("\n").length, [content]);
  const byteSize = useMemo(
    () => (new TextEncoder().encode(content).length / 1024).toFixed(1),
    [content],
  );
  const charCount = useMemo(() => countNoteChars(content), [content]);

  const {
    handlePaste: imagePasteHandler,
    handleDrop: imageDropHandler,
    handleDragOver: imageDragOverHandler,
  } = useImagePaste({
    noteId: selectedId,
    textareaRef: contentRef,
    setContent,
    markDirty,
    onEnsureNoteSaved: ensureNoteSaved,
    disabled: isExternal,
    onError: setErrorMessage,
    t,
  });

  const handleCleanUnusedImages = async () => {
    if (!selectedId || isExternal) return;
    try {
      const removed = await cleanUnusedImages(selectedId, content);
      if (removed.length > 0) {
        setErrorMessage(
          t("main.images.cleaned", {
            count: removed.length,
            defaultValue: "已清理 {{count}} 张图片",
          }),
        );
      } else {
        setErrorMessage(t("main.images.cleanedNone", { defaultValue: "没有需要清理的图片" }));
      }
      setTimeout(() => setErrorMessage(null), 3000);
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    }
  };

  const handleUndo = () => {
    if (!selectedId) return;
    const textarea = contentRef.current;
    if (runEditorCommand(textarea, "undo")) {
      setContent(textarea?.value ?? content);
      markDirty();
    }
  };

  const handleRedo = () => {
    if (!selectedId) return;
    const textarea = contentRef.current;
    if (runEditorCommand(textarea, "redo")) {
      setContent(textarea?.value ?? content);
      markDirty();
    }
  };

  const syncSelectedTextRange = useCallback(() => {
    const textarea = contentRef.current;
    if (!textarea) return;
    const start = textarea.selectionStart ?? 0;
    const end = textarea.selectionEnd ?? 0;
    const range = end > start ? { start, end } : null;
    selectionRangeRef.current = range;
    setSelectedTextRange(range);
  }, [contentRef]);

  const replaceSelectedTextWithSpan = useCallback(
    (style: string) => {
      const textarea = contentRef.current;
      const activeRange = selectedTextRange ?? selectionRangeRef.current;
      if (!textarea || !selectedId || !activeRange) return;

      const { start, end } = activeRange;
      if (end <= start) return;

      const value = textarea.value;
      const selected = value.slice(start, end);
      if (!selected) return;

      const wrapped = `<span style="${style}">${selected}</span>`;
      const result = `${value.slice(0, start)}${wrapped}${value.slice(end)}`;
      const selectionStart = start;
      const selectionEnd = start + wrapped.length;

      textarea.setRangeText(wrapped, start, end, "select");
      contentRefValue.current = result;
      saveStateRef.current = "dirty";
      setContent(result);
      setSaveState("dirty");
      selectionRangeRef.current = { start: selectionStart, end: selectionEnd };
      setSelectedTextRange({ start: selectionStart, end: selectionEnd });
      setTextColorPaletteOpen(false);
      setHighlightPaletteOpen(false);

      requestAnimationFrame(() => {
        const nextTextarea = contentRef.current;
        if (!nextTextarea) return;
        nextTextarea.focus();
        nextTextarea.setSelectionRange(selectionStart, selectionEnd);
      });
    },
    [contentRef, contentRefValue, saveStateRef, selectedId, selectedTextRange, setContent, setSaveState],
  );

  const handleApplyTextColor = useCallback(
    (color: string) => {
      replaceSelectedTextWithSpan(`color: ${color};`);
    },
    [replaceSelectedTextWithSpan],
  );

  const handleClearTextColor = useCallback(() => {
    replaceSelectedTextWithSpan("");
  }, [replaceSelectedTextWithSpan]);

  const handleApplyHighlightColor = useCallback(
    (color: string) => {
      replaceSelectedTextWithSpan(`background-color: ${color};`);
    },
    [replaceSelectedTextWithSpan],
  );

  const handleClearHighlightColor = useCallback(() => {
    replaceSelectedTextWithSpan("");
  }, [replaceSelectedTextWithSpan]);

  const toggleTextColorPalette = useCallback(() => {
    syncSelectedTextRange();
    setHighlightPaletteOpen(false);
    setTextColorPaletteOpen((prev) => !prev);
  }, [syncSelectedTextRange]);

  const toggleHighlightPalette = useCallback(() => {
    syncSelectedTextRange();
    setTextColorPaletteOpen(false);
    setHighlightPaletteOpen((prev) => !prev);
  }, [syncSelectedTextRange]);

  useEffect(() => {
    if (!selectedId) {
      selectionRangeRef.current = null;
      setSelectedTextRange(null);
      setTextColorPaletteOpen(false);
      setHighlightPaletteOpen(false);
    }
  }, [selectedId]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setTextColorPaletteOpen(false);
        setHighlightPaletteOpen(false);
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  useEffect(() => {
    if (!isResizingSplit) return;

    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";

    const onMouseMove = (e: globalThis.MouseEvent) => {
      const container = splitContainerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const ratio = (e.clientX - rect.left) / rect.width;
      setSplitRatio(Math.min(Math.max(ratio, 0.2), 0.8));
    };
    const onMouseUp = () => setIsResizingSplit(false);

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
    return () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    };
  }, [isResizingSplit]);

  return (
    <div className="flex-1 flex flex-col min-w-0">
      <div className="flex items-center justify-between px-4 h-10 border-b border-paper-deep/20 shrink-0 bg-paper/20">
        <div className="flex items-center gap-1">
          <button
            onClick={onToggleSidebar}
            className="w-7 h-7 flex items-center justify-center rounded-lg text-ink-ghost hover:text-ink-faint hover:bg-paper-warm transition-all cursor-pointer"
            title={
              sidebarCollapsed
                ? t("main.window.expandSidebar", { defaultValue: "展开侧栏" })
                : t("main.window.collapseSidebar", { defaultValue: "收起侧栏" })
            }
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
              <line x1="9" y1="3" x2="9" y2="21" />
            </svg>
          </button>

          <div className="h-4 w-px bg-paper-deep/30 mx-1" />

          <button
            onClick={onPinEntry}
            disabled={!selectedId}
            aria-label={pinTileButtonTitle(selectedTilePinned)}
            className={`w-7 h-7 flex items-center justify-center rounded-lg transition-all cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed ${
              selectedTilePinned
                ? "text-bamboo bg-bamboo-mist/40 hover:text-red-400 hover:bg-danger-bg"
                : "text-ink-ghost hover:text-bamboo hover:bg-bamboo-mist/50"
            }`}
            title={pinTileButtonTitle(selectedTilePinned)}
          >
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 17v5" />
              <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 1 1 0 0 0 1-1V4a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v1a1 1 0 0 0 1 1 1 1 0 0 1 1 1z" />
            </svg>
          </button>

          <button
            onMouseDown={(event) => event.preventDefault()}
            onClick={handleUndo}
            disabled={!selectedId}
            className="w-7 h-7 flex items-center justify-center rounded-lg text-ink-ghost hover:text-ink-faint hover:bg-paper-warm transition-all cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
            title={t("main.editor.undo", { defaultValue: "撤销（Ctrl+Z）" })}
            aria-label={t("main.editor.undoLabel", { defaultValue: "撤销" })}
          >
            <svg
              data-testid="main-editor-undo-icon"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M9 14 4 9l5-5" />
              <path d="M4 9h10a6 6 0 0 1 0 12h-1" />
            </svg>
          </button>

          <button
            onMouseDown={(event) => event.preventDefault()}
            onClick={handleRedo}
            disabled={!selectedId}
            className="w-7 h-7 flex items-center justify-center rounded-lg text-ink-ghost hover:text-ink-faint hover:bg-paper-warm transition-all cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
            title={t("main.editor.redo", { defaultValue: "重做（Ctrl+Y）" })}
            aria-label={t("main.editor.redoLabel", { defaultValue: "重做" })}
          >
            <svg
              data-testid="main-editor-redo-icon"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
              style={{ transform: "scaleX(-1)" }}
            >
              <path d="M9 14 4 9l5-5" />
              <path d="M4 9h10a6 6 0 0 1 0 12h-1" />
            </svg>
          </button>

          <button
            onClick={onSaveCurrentNote}
            disabled={!selectedId || saveState === "saving"}
            className="px-2.5 h-7 flex items-center justify-center rounded-lg text-[11px] text-ink-ghost hover:text-ink-faint hover:bg-paper-warm transition-all cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
            title={t("common.save", { defaultValue: "保存" })}
          >
            {t("common.save", { defaultValue: "保存" })}
          </button>

          {deleteConfirm ? (
            <div
              className={`flex items-center gap-1 ml-1 ${deleteExiting ? "animate-delete-confirm-exit" : "animate-delete-confirm"}`}
            >
              <span className="text-[11px] text-red-400 whitespace-nowrap">
                {t("main.editor.confirmDelete", { defaultValue: "确认删除？" })}
              </span>
              <button
                onClick={() => {
                  setDeleteExiting(true);
                  setTimeout(() => {
                    setDeleteExiting(false);
                    setDeleteConfirm(false);
                    onDeleteNote();
                  }, 150);
                }}
                className="px-2 h-6 rounded-md text-[11px] text-cloud bg-red-400 hover:bg-red-500 transition-colors cursor-pointer whitespace-nowrap"
              >
                {t("common.delete", { defaultValue: "删除" })}
              </button>
              <button
                onClick={() => {
                  setDeleteExiting(true);
                  setTimeout(() => {
                    setDeleteExiting(false);
                    setDeleteConfirm(false);
                  }, 150);
                }}
                className="px-2 h-6 rounded-md text-[11px] text-ink-faint hover:text-ink-soft hover:bg-paper-warm transition-colors cursor-pointer"
              >
                {t("common.cancel", { defaultValue: "取消" })}
              </button>
            </div>
          ) : (
            <button
              onClick={() => setDeleteConfirm(true)}
              disabled={!selectedId}
              className="w-7 h-7 flex items-center justify-center rounded-lg text-ink-ghost hover:text-red-400 hover:bg-danger-bg transition-all cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
              title={t("noteMenu.delete", { defaultValue: "删除笔记" })}
            >
              <svg
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="3,6 5,6 21,6" />
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              </svg>
            </button>
          )}
        </div>

        <div className="flex items-center gap-0.5">
          {errorMessage && (
            <span className="max-w-[160px] truncate text-[11px] text-red-400 mr-1">
              {errorMessage}
            </span>
          )}
          <button
            onClick={onOpenNotepad}
            className="w-7 h-7 flex items-center justify-center rounded-lg text-ink-ghost hover:text-bamboo hover:bg-bamboo-mist/50 transition-all cursor-pointer"
            title={t("main.window.quickNotepad", { defaultValue: "快捷便签" })}
          >
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M4 4h16v14H7l-3 3V4z" />
              <path d="M8 9h8M8 13h5" />
            </svg>
          </button>
          <button
            onClick={onOpenSettings}
            className="w-7 h-7 flex items-center justify-center rounded-lg text-ink-ghost hover:text-ink-faint hover:bg-paper-warm transition-all cursor-pointer"
            title={t("main.window.settings", { defaultValue: "设置" })}
          >
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </button>
          <button
            onClick={() => setDeepSeekOpen(true)}
            className="w-7 h-7 flex items-center justify-center rounded-lg text-ink-ghost hover:text-bamboo hover:bg-bamboo-mist/50 transition-all cursor-pointer"
            title="AI 助手"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              <path d="M8 10h.01M12 10h.01M16 10h.01" />
            </svg>
          </button>
          <div className="h-4 w-px bg-paper-deep/30 mx-0.5" />
          <SlidingButtonGroup
            options={viewModeOptions}
            value={viewMode}
            onChange={onViewModeChange}
            buttonClassName="px-3 py-1"
          />
        </div>
      </div>

      <div
        key={noteTransitionKey}
        className="animate-note-enter px-6 pt-4 pb-2 shrink-0 border-b border-paper-deep/15"
      >
        <input
          type="text"
          value={title}
          onChange={(event) => {
            setTitle(event.target.value);
            markDirty();
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              contentRef.current?.focus();
            }
          }}
          placeholder={t("common.untitledNote", { defaultValue: "无标题笔记" })}
          disabled={!selectedId}
          className="w-full text-[20px] font-display font-bold text-ink placeholder:text-ink-ghost/50 tracking-wide disabled:opacity-60"
        />
        <div className="flex items-center gap-3 mt-1.5">
          <span className="text-[10px] text-ink-ghost font-mono tabular-nums truncate max-w-[200px]">
            {selectedExternalFile
              ? t("main.externalFile.label", {
                  path: selectedExternalFile.filePath,
                  defaultValue: "外部文件 · {{path}}",
                })
              : selectedNote
                ? `${formatShortDate(selectedNote.updatedAt)} ${formatTime(selectedNote.updatedAt)}`
                : "--"}
          </span>
          <span className="text-[10px] text-ink-ghost/40">·</span>
          <span className="text-[10px] text-ink-ghost font-mono tabular-nums">
            {t("common.wordCount", { count: charCount, defaultValue: "{{count}} 字" })}
          </span>
          <span className="text-[10px] text-ink-ghost/40">·</span>
          <span
            className={`text-[10px] font-mono tabular-nums ${
              saveState === "error"
                ? "text-red-400"
                : saveState === "dirty"
                  ? "text-amber-500/70"
                  : "text-bamboo/60"
            }`}
          >
            {saveStateLabel[saveState]}
          </span>
        </div>
      </div>

      <div ref={splitContainerRef} className="flex-1 flex min-h-0">
        {!selectedId && !isLoading ? (
          <div className="flex-1 flex items-center justify-center text-[13px] text-ink-ghost">
            {t("main.editor.emptyHint", { defaultValue: "选择或新建一篇笔记" })}
          </div>
        ) : (
          <>
            {(viewMode === "edit" || viewMode === "split") && (
              <div
                className="flex flex-col min-h-0 shrink-0"
                style={{ width: viewMode === "split" ? `${splitRatio * 100}%` : "100%" }}
              >
                <div className="flex items-center gap-0.5 px-4 pt-2 pb-1 shrink-0">
                  {toolbarButtons.map((button) => (
                    <button
                      key={button.label}
                      title={button.title}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        if (contentRef.current) {
                          applyMarkdownFormat(
                            contentRef.current,
                            button.action,
                            {
                              boldText: t("main.formatSample.boldText", {
                                defaultValue: "粗体文本",
                              }),
                              italicText: t("main.formatSample.italicText", {
                                defaultValue: "斜体文本",
                              }),
                              headingText: t("main.formatSample.headingText", {
                                defaultValue: "标题",
                              }),
                              listItem: t("main.formatSample.listItem", {
                                defaultValue: "列表项",
                              }),
                              codeText: t("main.formatSample.codeText", {
                                defaultValue: "代码",
                              }),
                              quoteText: t("main.formatSample.quoteText", {
                                defaultValue: "引用文本",
                              }),
                            },
                            setContent,
                            markDirty,
                          );
                        }
                      }}
                      className={`w-6 h-6 flex items-center justify-center rounded text-[11px] text-ink-ghost hover:text-ink-faint hover:bg-paper-warm transition-all cursor-pointer ${button.style}`}
                    >
                      {button.label}
                    </button>
                  ))}
                  <div className="h-4 w-px bg-paper-deep/20 mx-0.5" />
                  <div
                    ref={colorPaletteRef}
                    className="flex items-center gap-0.5"
                    onMouseDown={(e) => e.stopPropagation()}
                  >
                    <button
                      onMouseDown={(e) => {
                        e.preventDefault();
                        syncSelectedTextRange();
                      }}
                      onClick={toggleTextColorPalette}
                      disabled={!selectedId}
                      className="w-6 h-6 flex items-center justify-center rounded text-ink-ghost hover:text-bamboo hover:bg-bamboo-mist/50 transition-all cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
                      title={selectionRangeRef.current ? "文字颜色" : "先在编辑区选中文本"}
                    >
                      <svg
                        width="12"
                        height="12"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                      >
                        <path d="M12 3l4 8-4 2-4-2 4-8z" />
                        <path d="M6 15a6 6 0 0 0 12 0" />
                        <path d="M9 19h6" />
                      </svg>
                    </button>
                    {textColorPaletteOpen && (
                      <div className="flex items-center gap-1 px-1.5 py-1 rounded-lg border border-paper-deep/20 bg-paper/95 shadow-sm">
                        <button
                          type="button"
                          disabled={!(selectedTextRange ?? selectionRangeRef.current)}
                          onMouseDown={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            if (!(selectedTextRange ?? selectionRangeRef.current)) return;
                            handleClearTextColor();
                          }}
                          className="px-1.5 h-4 rounded text-[9px] text-ink-soft hover:text-bamboo cursor-pointer disabled:opacity-35"
                        >
                          清除
                        </button>
                        {TEXT_COLOR_OPTIONS.map((color) => (
                          <button
                            key={color}
                            type="button"
                            disabled={!(selectedTextRange ?? selectionRangeRef.current)}
                            onMouseDown={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              if (!(selectedTextRange ?? selectionRangeRef.current)) return;
                              handleApplyTextColor(color);
                            }}
                            className="w-4 h-4 rounded-full border border-paper-deep/30 hover:scale-110 transition-transform cursor-pointer disabled:opacity-35"
                            style={{ backgroundColor: color }}
                          />
                        ))}
                      </div>
                    )}
                    <button
                      onMouseDown={(e) => {
                        e.preventDefault();
                        syncSelectedTextRange();
                      }}
                      onClick={toggleHighlightPalette}
                      disabled={!selectedId}
                      className="w-6 h-6 flex items-center justify-center rounded text-ink-ghost hover:text-bamboo hover:bg-bamboo-mist/50 transition-all cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
                      title={selectionRangeRef.current ? "荧光标记" : "先在编辑区选中文本"}
                    >
                      <svg
                        width="12"
                        height="12"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                      >
                        <path d="M6 16l8-8 4 4-8 8H6z" />
                        <path d="M14 6l4 4" />
                        <path d="M4 20h8" />
                      </svg>
                    </button>
                    {highlightPaletteOpen && (
                      <div className="flex items-center gap-1 px-1.5 py-1 rounded-lg border border-paper-deep/20 bg-paper/95 shadow-sm">
                        <button
                          type="button"
                          disabled={!(selectedTextRange ?? selectionRangeRef.current)}
                          onMouseDown={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            if (!(selectedTextRange ?? selectionRangeRef.current)) return;
                            handleClearHighlightColor();
                          }}
                          className="px-1.5 h-4 rounded text-[9px] text-ink-soft hover:text-bamboo cursor-pointer disabled:opacity-35"
                        >
                          清除
                        </button>
                        {HIGHLIGHT_COLOR_OPTIONS.map((color) => (
                          <button
                            key={color}
                            type="button"
                            disabled={!(selectedTextRange ?? selectionRangeRef.current)}
                            onMouseDown={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              if (!(selectedTextRange ?? selectionRangeRef.current)) return;
                              handleApplyHighlightColor(color);
                            }}
                            className="w-4 h-4 rounded-sm border border-paper-deep/30 hover:scale-110 transition-transform cursor-pointer disabled:opacity-35"
                            style={{ backgroundColor: color }}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex-1 overflow-hidden px-5 pb-4 relative">
                  <textarea
                    ref={contentRef}
                    data-tab-indent="true"
                    value={content}
                    onChange={(event) => {
                      const nextValue = event.target.value;
                      contentRefValue.current = nextValue;
                      setContent(nextValue);
                      markDirty();
                      setLastActivityAt(Date.now());
                      recordTextChange(
                        nextValue,
                        event.target.selectionStart,
                        event.target.selectionEnd,
                      );
                    }}
                    onSelect={(event) => {
                      syncSelectedTextRange();
                      setLastActivityAt(Date.now());
                      recordCursor(
                        event.currentTarget.selectionStart,
                        event.currentTarget.selectionEnd,
                      );
                    }}
                    onKeyUp={(event) => {
                      syncSelectedTextRange();
                      setLastActivityAt(Date.now());
                      const target = event.currentTarget;
                      recordCursor(target.selectionStart, target.selectionEnd);
                    }}
                    onMouseUp={(event) => {
                      syncSelectedTextRange();
                      setLastActivityAt(Date.now());
                      const target = event.currentTarget;
                      recordCursor(target.selectionStart, target.selectionEnd);
                    }}
                    onBlur={() => {
                      syncSelectedTextRange();
                      const textarea = contentRef.current;
                      if (textarea) {
                        recordCursor(textarea.selectionStart, textarea.selectionEnd);
                      }
                      void flushInk();
                    }}
                    onPaste={(event) => {
                      setLastActivityAt(Date.now());
                      const clipboardText = event.clipboardData.getData("text");
                      const textarea = contentRef.current;
                      if (clipboardText && textarea) {
                        const start = textarea.selectionStart;
                        const end = textarea.selectionEnd;
                        const value = textarea.value;
                        const newValue = `${value.slice(0, start)}${clipboardText}${value.slice(end)}`;
                        recordPaste(
                          clipboardText,
                          newValue,
                          start,
                          start + clipboardText.length,
                          start + clipboardText.length,
                        );
                      }
                      imagePasteHandler(event);
                    }}
                    onDrop={imageDropHandler}
                    onDragOver={imageDragOverHandler}
                    className="relative w-full h-full leading-[1.9] text-ink-soft caret-bamboo font-body placeholder:text-ink-ghost/40 bg-transparent selection:bg-bamboo/30"
                    style={{
                      fontSize: `${settingsConfig?.fontSize ?? 14}px`,
                      tabSize: `var(--tab-indent-size, 2)`,
                    }}
                    placeholder={t("main.editor.contentPlaceholder", {
                      defaultValue: "开始写作……",
                    })}
                    spellCheck={false}
                    disabled={!selectedId}
                  />
                  <ConnectionSuggestions
                    noteId={selectedId ?? ""}
                    noteTitle={title}
                    noteContent={content}
                    providers={settingsConfig?.providers ?? []}
                    enabled={Boolean(settingsConfig?.agentEnabled) && selectedId !== null}
                  />
                </div>
              </div>
            )}

            {viewMode === "split" && (
              <div
                className={`w-1.5 shrink-0 cursor-col-resize group relative flex items-center justify-center ${isResizingSplit ? "bg-bamboo/30" : "hover:bg-bamboo/20"} transition-colors`}
                onMouseDown={(e) => {
                  e.preventDefault();
                  setIsResizingSplit(true);
                }}
              >
                <div
                  className={`absolute inset-y-0 -left-1.5 -right-1.5 ${isResizingSplit ? "" : "group-hover:bg-bamboo/5"}`}
                />
                <div className="relative z-10 flex flex-col gap-[3px] opacity-0 group-hover:opacity-100 transition-opacity">
                  <div className="w-[3px] h-[3px] rounded-full bg-ink-ghost/60" />
                  <div className="w-[3px] h-[3px] rounded-full bg-ink-ghost/60" />
                  <div className="w-[3px] h-[3px] rounded-full bg-ink-ghost/60" />
                </div>
              </div>
            )}

            {(viewMode === "preview" || viewMode === "split") && (
              <div className="flex flex-col min-h-0 min-w-0 flex-1">
                {viewMode === "split" && (
                  <div className="px-4 pt-2.5 pb-1 shrink-0">
                    <span className="text-[10px] text-ink-ghost/60 font-mono tracking-widest uppercase">
                      {t("main.editor.previewLabel", { defaultValue: "Preview" })}
                    </span>
                  </div>
                )}
                <div
                  className={`flex-1 overflow-y-auto px-6 pb-6 ${
                    viewMode === "preview" ? "pt-3" : "pt-1"
                  }`}
                >
                  <MarkdownPreview
                    content={content}
                    fontSize={settingsConfig?.fontSize ?? 14}
                    renderHtml={true}
                    imageBaseDir={imageBaseDir ?? undefined}
                  />
                </div>
              </div>
            )}
          </>
        )}
      </div>

      <DeepSeekChat
        open={deepSeekOpen}
        onClose={() => setDeepSeekOpen(false)}
        docTitle={title}
        docContent={content}
        providers={settingsConfig?.providers ?? []}
        noteId={selectedId ?? undefined}
        agentEnabled={Boolean(settingsConfig?.agentEnabled)}
      />

      <div className="flex items-center justify-between px-4 h-7 border-t border-paper-deep/20 bg-paper/30 shrink-0">
        <div className="flex items-center gap-3">
          <WritingMoodIndicator
            noteId={selectedId ?? ""}
            enabled={Boolean(settingsConfig?.agentEnabled) && selectedId !== null}
          />
          <span className="text-[10px] text-ink-ghost/40">|</span>
          <span className="text-[10px] text-ink-ghost font-mono tabular-nums">
            {t("main.statusBar.lineNumber", {
              count: lineCount,
              defaultValue: "Ln {{count}}",
            })}
          </span>
          <span className="text-[10px] text-ink-ghost/40">|</span>
          <span className="text-[10px] text-ink-ghost font-mono">
            {t("main.statusBar.format", { defaultValue: "Markdown + LaTeX" })}
          </span>
        </div>
        <div className="flex items-center gap-3">
          {selectedId && !isExternal && content.includes("images/") && (
            <>
              <button
                type="button"
                onClick={() => void handleCleanUnusedImages()}
                className="text-[10px] text-ink-ghost hover:text-bamboo font-mono cursor-pointer transition-colors"
              >
                {t("main.images.cleanUnused", { defaultValue: "清理未使用图片" })}
              </button>
              <span className="text-[10px] text-ink-ghost/40">|</span>
            </>
          )}
          <span className="text-[10px] text-ink-ghost font-mono">
            {t("main.statusBar.encoding", { defaultValue: "UTF-8" })}
          </span>
          <span className="text-[10px] text-ink-ghost/40">|</span>
          <span className="text-[10px] text-ink-ghost font-mono tabular-nums">
            {t("main.statusBar.byteSize", { size: byteSize, defaultValue: "{{size}} KB" })}
          </span>
        </div>
      </div>
    </div>
  );
}
