import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { convertFileSrc } from "@tauri-apps/api/core";
import { openPath } from "@tauri-apps/plugin-opener";
import {
  HIGHLIGHT_COLOR_OPTIONS,
  TEXT_COLOR_OPTIONS,
  applyMarkdownFormat,
  pinTileButtonTitle,
  runEditorCommand,
  type FormatAction,
} from "../commands/markdownCommands";
import { callChatCompletion } from "../../cowrite/coWriteAI";
import { cleanUnusedImages } from "../../images/api";
import { useImageBaseDir } from "../../images/useImageBaseDir";
import { useImagePaste } from "../../images/useImagePaste";
import { MarkdownPreview } from "../../markdown/MarkdownPreview";
import { MarkdownEditorHighlight } from "./MarkdownEditorHighlight";
import { getErrorMessage } from "../../notes/api";
import {
  countNoteChars,
  formatShortDate,
  formatTime,
  getFileExtension,
} from "../../notes/noteUtils";
import type { ExternalFile, NoteMetadata } from "../../notes/types";
import type { AppConfig, ViewMode } from "../../settings/types";
import { NoteChangeHistoryPage, type NoteChangeHistoryEntry } from "./NoteChangeHistoryCard";
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
  currentNoteChange?: NoteChangeHistoryEntry | null;
  noteChangeHistory?: NoteChangeHistoryEntry[];
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
  currentNoteChange = null,
  noteChangeHistory = [],
}: NoteEditorWorkspaceProps) {
  const { t } = useTranslation();
  const [deepSeekOpen, setDeepSeekOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [deleteExiting, setDeleteExiting] = useState(false);
  const [selectedTextRange, setSelectedTextRange] = useState<{ start: number; end: number } | null>(
    null,
  );
  const [textColorPaletteOpen, setTextColorPaletteOpen] = useState(false);
  const [highlightPaletteOpen, setHighlightPaletteOpen] = useState(false);
  const [splitRatio, setSplitRatio] = useState(0.5);
  const [editorFontSize, setEditorFontSize] = useState(() => settingsConfig?.fontSize ?? 14);
  const [isResizingSplit, setIsResizingSplit] = useState(false);
  const [splitScrollLocked, setSplitScrollLocked] = useState(true);
  const [isFormattingMarkdown, setIsFormattingMarkdown] = useState(false);
  const splitContainerRef = useRef<HTMLDivElement>(null);
  const previewScrollRef = useRef<HTMLDivElement>(null);
  const editorHighlightRef = useRef<HTMLPreElement>(null);
  const editorHighlightScrollFrameRef = useRef<number | null>(null);
  const isSyncingScrollRef = useRef(false);
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
  const selectedFileName = selectedExternalFile?.fileName ?? selectedNote?.fileName ?? "";
  const selectedFilePath = selectedExternalFile?.filePath ?? selectedNote?.filePath ?? "";
  const selectedFileExtension = getFileExtension(selectedFileName).toLowerCase();
  const isMarkdownNote = !selectedFileExtension || selectedFileExtension === ".md";
  const isPdfNote = selectedFileExtension === ".pdf";
  const isWordNote = selectedFileExtension === ".doc" || selectedFileExtension === ".docx";
  const isManagedAttachment = Boolean(selectedNote && !isMarkdownNote);
  const effectiveViewMode = isManagedAttachment ? "preview" : viewMode;
  const fileAssetUrl = useMemo(
    () => (selectedFilePath ? convertFileSrc(selectedFilePath) : ""),
    [selectedFilePath],
  );

  const handleOpenFilePath = useCallback(async () => {
    if (!selectedFilePath) return;
    try {
      await openPath(selectedFilePath);
      setErrorMessage(null);
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    }
  }, [selectedFilePath, setErrorMessage]);

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
    disabled: isExternal || isManagedAttachment,
    onError: setErrorMessage,
    t,
  });

  const handleCleanUnusedImages = async () => {
    if (!selectedId || isExternal || isManagedAttachment) return;
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
    [
      contentRef,
      contentRefValue,
      saveStateRef,
      selectedId,
      selectedTextRange,
      setContent,
      setSaveState,
    ],
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

  const syncEditorHighlightLayout = useCallback(() => {
    const textarea = contentRef.current;
    const highlight = editorHighlightRef.current;
    if (!textarea || !highlight) return;

    highlight.style.width = `${textarea.clientWidth}px`;
    highlight.style.minHeight = `${textarea.scrollHeight}px`;
    highlight.style.fontSize = `${editorFontSize}px`;
    highlight.style.transform = `translate(${-textarea.scrollLeft}px, ${-textarea.scrollTop}px)`;
  }, [contentRef, editorFontSize]);

  const scheduleEditorHighlightSync = useCallback(() => {
    if (editorHighlightScrollFrameRef.current !== null) {
      cancelAnimationFrame(editorHighlightScrollFrameRef.current);
    }
    editorHighlightScrollFrameRef.current = requestAnimationFrame(() => {
      editorHighlightScrollFrameRef.current = null;
      syncEditorHighlightLayout();
    });
  }, [syncEditorHighlightLayout]);

  const syncSplitScroll = useCallback(
    (source: "editor" | "preview") => {
      if (!splitScrollLocked || effectiveViewMode !== "split" || isSyncingScrollRef.current) return;
      const editor = contentRef.current;
      const preview = previewScrollRef.current;
      if (!editor || !preview) return;

      const sourceElement = source === "editor" ? editor : preview;
      const targetElement = source === "editor" ? preview : editor;
      const sourceScrollable = sourceElement.scrollHeight - sourceElement.clientHeight;
      const targetScrollable = targetElement.scrollHeight - targetElement.clientHeight;
      if (sourceScrollable <= 0 || targetScrollable <= 0) return;

      isSyncingScrollRef.current = true;
      targetElement.scrollTop = (sourceElement.scrollTop / sourceScrollable) * targetScrollable;
      requestAnimationFrame(() => {
        isSyncingScrollRef.current = false;
      });
    },
    [contentRef, splitScrollLocked, effectiveViewMode],
  );

  const handleLazyMarkdownFormat = useCallback(async () => {
    if (!selectedId || isExternal || isManagedAttachment || isFormattingMarkdown) return;
    if (!settingsConfig?.providers?.length) {
      setErrorMessage("请先在设置中配置可用的 AI 模型");
      return;
    }

    const source = contentRefValue.current.trim();
    if (!source) {
      setErrorMessage("当前笔记为空，无法排版");
      return;
    }

    setIsFormattingMarkdown(true);
    setErrorMessage("正在一键排版当前笔记...");
    try {
      const markdown = await callChatCompletion(
        settingsConfig.providers,
        [
          {
            role: "system",
            content:
              "你是专业 Markdown 排版助手。用户给你的内容已经是当前笔记正文，可能没有规范使用 Markdown。你的任务是只做结构化排版：完整保留原文所有信息、顺序、层级关系、专有名词、数字、代码和链接；不要总结、删减、扩写或改写事实；不要编造内容；按语义补充合适的标题、列表、引用、代码围栏、表格、分割线和加粗。只输出排版后的 Markdown 正文，不要解释。",
          },
          {
            role: "user",
            content: `请把下面这篇当前笔记一键排版为规范 Markdown，必须完整保留所有内容信息：\n\n${source}`,
          },
        ],
        0.15,
        5000,
      );
      const nextContent =
        markdown
          .replace(/^```(?:markdown|md)?\s*/i, "")
          .replace(/```$/i, "")
          .trim() || source;

      contentRefValue.current = nextContent;
      saveStateRef.current = "dirty";
      setContent(nextContent);
      setSaveState("dirty");
      markDirty();
      setLastActivityAt(Date.now());
      setErrorMessage("当前笔记已完成 Markdown 排版");
      setTimeout(() => setErrorMessage(null), 3000);
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    } finally {
      setIsFormattingMarkdown(false);
    }
  }, [
    contentRefValue,
    isExternal,
    isManagedAttachment,
    isFormattingMarkdown,
    markDirty,
    saveStateRef,
    selectedId,
    setContent,
    setErrorMessage,
    setLastActivityAt,
    setSaveState,
    settingsConfig?.providers,
  ]);

  useEffect(() => {
    return () => {
      if (editorHighlightScrollFrameRef.current !== null) {
        cancelAnimationFrame(editorHighlightScrollFrameRef.current);
      }
    };
  }, []);

  useEffect(() => {
    setEditorFontSize(settingsConfig?.fontSize ?? 14);
  }, [settingsConfig?.fontSize]);

  useEffect(() => {
    if (!selectedId) {
      selectionRangeRef.current = null;
      setSelectedTextRange(null);
      setTextColorPaletteOpen(false);
      setHighlightPaletteOpen(false);
      setHistoryOpen(false);
      setIsFormattingMarkdown(false);
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

  const hasHistoryChanges = Boolean(currentNoteChange) || noteChangeHistory.length > 0;

  return (
    <div className="flex-1 flex flex-col min-w-0">
      <div className="flex min-h-10 shrink-0 flex-wrap items-center justify-between gap-x-2 gap-y-1 border-b border-paper-deep/20 bg-paper/20 px-3 py-1">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1 justify-end">
          <button
            onClick={onPinEntry}
            disabled={!selectedId || isManagedAttachment}
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
            disabled={!selectedId || isManagedAttachment}
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
            disabled={!selectedId || isManagedAttachment}
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
            disabled={!selectedId || isManagedAttachment || saveState === "saving"}
            className="px-2.5 h-7 flex items-center justify-center rounded-lg text-[11px] text-ink-ghost hover:text-ink-faint hover:bg-paper-warm transition-all cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
            title={t("common.save", { defaultValue: "保存" })}
          >
            {t("common.save", { defaultValue: "保存" })}
          </button>

          <button
            type="button"
            onClick={() => void handleLazyMarkdownFormat()}
            disabled={!selectedId || isExternal || isFormattingMarkdown}
            className="px-2.5 h-7 flex items-center justify-center rounded-lg text-[11px] text-ink-ghost hover:text-bamboo hover:bg-bamboo-mist/50 transition-all cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
            title="懒人一键排版当前笔记为规范 Markdown"
          >
            {isFormattingMarkdown ? "排版中" : "一键排版"}
          </button>

          <button
            onClick={() => setHistoryOpen((prev) => !prev)}
            disabled={!selectedId}
            className={`px-2.5 h-7 flex items-center justify-center rounded-lg text-[11px] transition-all cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed ${
              historyOpen
                ? "text-bamboo"
                : "text-ink-ghost hover:text-bamboo hover:bg-bamboo-mist/50"
            }`}
            title={
              historyOpen
                ? "关闭历史变更"
                : hasHistoryChanges
                  ? "查看当前笔记历史更改"
                  : "暂无历史更改，点击查看所在位置"
            }
          >
            历史变更
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

        <div className="flex min-w-0 flex-wrap items-center justify-end gap-0.5">
          {errorMessage && (
            <span className="max-w-[120px] truncate text-[11px] text-red-400 mr-1">
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
          <div className="h-4 w-px bg-paper-deep/15 mx-0.5" />
          <SlidingButtonGroup
            options={viewModeOptions}
            value={effectiveViewMode}
            onChange={isManagedAttachment ? () => undefined : onViewModeChange}
            buttonClassName="px-2.5 py-1 whitespace-nowrap"
          />
          {effectiveViewMode === "split" && (
            <button
              type="button"
              onClick={() => setSplitScrollLocked((prev) => !prev)}
              className={`px-2.5 h-7 rounded-lg text-[11px] transition-all cursor-pointer ${
                splitScrollLocked
                  ? "text-bamboo bg-bamboo-mist/30"
                  : "text-ink-ghost hover:text-bamboo hover:bg-bamboo-mist/50"
              }`}
              title={splitScrollLocked ? "锁定滚动：双栏同步对齐" : "解锁滚动：双栏独立滑动"}
            >
              {splitScrollLocked ? "同步锁定" : "独立滚动"}
            </button>
          )}
          <div className="h-4 w-px bg-paper-deep/15 mx-0.5" />
          <button
            onClick={onToggleSidebar}
            className="w-7 h-7 flex items-center justify-center rounded-lg text-ink-ghost hover:text-ink-faint hover:bg-paper-warm transition-all cursor-pointer"
            title={
              sidebarCollapsed
                ? t("main.window.expandSidebar", { defaultValue: "展开右侧笔记栏" })
                : t("main.window.collapseSidebar", { defaultValue: "收起右侧笔记栏" })
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
              <line x1="15" y1="3" x2="15" y2="21" />
            </svg>
          </button>
        </div>
      </div>

      {historyOpen ? (
        <NoteChangeHistoryPage currentChange={currentNoteChange} history={noteChangeHistory} />
      ) : (
        <>
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
            {isManagedAttachment ? (
              <div className="flex flex-col min-h-0 min-w-0 flex-1">
                <div className="flex items-center justify-between gap-3 px-6 py-2 border-b border-paper-deep/15 shrink-0">
                  <div className="min-w-0">
                    <div className="text-[11px] text-ink-ghost font-mono uppercase tracking-wider">
                      {selectedFileExtension.replace(".", "") || "FILE"}
                    </div>
                    <div className="text-[12px] text-ink-faint truncate">{selectedFilePath}</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleOpenFilePath()}
                    className="shrink-0 px-3 h-7 rounded-lg text-[11px] text-bamboo hover:bg-bamboo-mist/50 transition-all cursor-pointer"
                  >
                    {t("main.editor.openWithSystem", { defaultValue: "用系统应用打开" })}
                  </button>
                </div>

                {isPdfNote && fileAssetUrl ? (
                  <iframe
                    title={title || selectedFileName}
                    src={fileAssetUrl}
                    className="flex-1 w-full bg-cloud"
                  />
                ) : (
                  <div className="flex-1 flex items-center justify-center px-8 text-center">
                    <div className="max-w-sm rounded-2xl border border-paper-deep/30 bg-paper-warm/60 px-6 py-8 shadow-sm">
                      <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-bamboo-mist/70 text-bamboo font-mono text-[13px] uppercase">
                        {selectedFileExtension.replace(".", "") || "file"}
                      </div>
                      <h3 className="text-[16px] font-display font-semibold text-ink mb-2">
                        {isWordNote
                          ? t("main.editor.wordPreviewTitle", {
                              defaultValue: "Word 文件已存入笔记库",
                            })
                          : t("main.editor.filePreviewTitle", { defaultValue: "文件已存入笔记库" })}
                      </h3>
                      <p className="text-[12px] leading-relaxed text-ink-ghost mb-5">
                        {isWordNote
                          ? t("main.editor.wordPreviewHint", {
                              defaultValue:
                                "当前采用轻量预览：Word 文件可统一管理、移动、删除和导出，预览请使用系统应用打开。",
                            })
                          : t("main.editor.filePreviewHint", {
                              defaultValue: "该文件可统一管理、移动、删除和导出。",
                            })}
                      </p>
                      <button
                        type="button"
                        onClick={() => void handleOpenFilePath()}
                        className="px-4 h-8 rounded-lg text-[12px] text-cloud bg-bamboo hover:bg-bamboo-light transition-all cursor-pointer"
                      >
                        {t("main.editor.openWithSystem", { defaultValue: "用系统应用打开" })}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ) : !selectedId && !isLoading ? (
              <div className="flex-1 flex items-center justify-center text-[13px] text-ink-ghost">
                {t("main.editor.emptyHint", { defaultValue: "选择或新建一篇笔记" })}
              </div>
            ) : (
              <>
                {(effectiveViewMode === "edit" || effectiveViewMode === "split") && (
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

                    <div className="flex-1 overflow-hidden px-5 pb-4 relative markdown-editor-highlight-shell">
                      <MarkdownEditorHighlight
                        ref={editorHighlightRef}
                        content={content}
                        fontSize={editorFontSize}
                      />
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
                        onScroll={() => {
                          scheduleEditorHighlightSync();
                          syncSplitScroll("editor");
                        }}
                        onWheel={(event) => {
                          if (!event.ctrlKey) return;
                          event.preventDefault();
                          setEditorFontSize((current) => {
                            const delta = event.deltaY < 0 ? 1 : -1;
                            return Math.min(28, Math.max(10, current + delta));
                          });
                          scheduleEditorHighlightSync();
                        }}
                        className="relative z-10 w-full h-full leading-[1.9] text-ink caret-bamboo font-mono placeholder:text-ink-ghost/40 bg-transparent selection:bg-bamboo/30 markdown-editor-input"
                        style={{
                          fontSize: `${editorFontSize}px`,
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

                {effectiveViewMode === "split" && (
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

                {(effectiveViewMode === "preview" || effectiveViewMode === "split") && (
                  <div className="flex flex-col min-h-0 min-w-0 flex-1">
                    {effectiveViewMode === "split" && (
                      <div className="px-4 pt-2.5 pb-1 shrink-0">
                        <span className="text-[10px] text-ink-ghost/60 font-mono tracking-widest uppercase">
                          {t("main.editor.previewLabel", { defaultValue: "Preview" })}
                        </span>
                      </div>
                    )}
                    <div
                      ref={previewScrollRef}
                      onScroll={() => syncSplitScroll("preview")}
                      className={`flex-1 overflow-y-auto px-6 pb-6 ${
                        effectiveViewMode === "preview" ? "pt-3" : "pt-1"
                      }`}
                    >
                      <MarkdownPreview
                        content={content}
                        fontSize={editorFontSize}
                        renderHtml={Boolean(settingsConfig?.renderHtmlMarkdown)}
                        imageBaseDir={imageBaseDir ?? undefined}
                      />
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </>
      )}

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
            {isManagedAttachment
              ? t("main.statusBar.format.file", { defaultValue: "附件预览" })
              : t("main.statusBar.format", { defaultValue: "Markdown + LaTeX" })}
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
