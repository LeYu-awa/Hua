import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent } from "react";
import { useTranslation } from "react-i18next";
import { emit, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { exportMarkdownNote, importMarkdownNote } from "../features/importExport/api";
import { NoteEditorWorkspace, type SaveState } from "../features/editor/components/NoteEditorWorkspace";
import {
  getLineChangeStats,
  type NoteChangeHistoryEntry,
} from "../features/editor/components/NoteChangeHistoryCard";
import {
  chooseNotesDirectory,
  getConfig,
  normalizeViewMode,
  saveConfig,
} from "../features/settings/api";
import type { AppConfig, ViewMode } from "../features/settings/types";
import { normalizeTileColor } from "../features/settings/tileColor";
import { BackgroundLayer } from "./BackgroundLayer";
import { SettingsPanel } from "./SettingsPanel";
import { WritingCompanion } from "./WritingCompanion";
import {
  createNote,
  createCategory,
  deleteCategory,
  deleteNote,
  getErrorMessage,
  getFileModifiedTime,
  getNote,
  listCategories,
  listNotes,
  moveNoteCategory,
  readExternalFile,
  renameCategory,
  saveExternalFile,
  updateNote,
} from "../features/notes/api";
import { useInkRecorder } from "../hooks/useInkRecorder";
import type { InkEvent } from "../features/ink/types";
import { assessAnxiety, DEFAULT_BASELINE } from "../features/agent/moodDetector";
import { CooldownTracker } from "../features/agent/ruleEngine";
import type { ExternalFile, Note, NoteMetadata } from "../features/notes/types";
import {
  filterNotes,
  formatShortDate,
  formatTime,
  getDisplayTitle,
  groupNotesByCategory,
  metadataFromNote,
} from "../features/notes/noteUtils";
import type { CategoryGroup } from "../features/notes/noteUtils";
import {
  getNoteContextMenuItems,
  type NoteContextMenuAction,
} from "../features/notes/noteContextMenu";
import { openNotepadWindow, takeStartupFile, toggleTileWindow } from "../features/windows/api";
import { setWindowDocumentEdited } from "../features/windows/controls";

import {
  TILE_WINDOW_CLOSED_EVENT,
  TILE_WINDOW_UNPINNED_EVENT,
  syncPinnedTileIds,
} from "../features/windows/tileWindowEvents";

interface NoteMenuState {
  x: number;
  y: number;
  noteId: string;
}

interface CategoryMenuState {
  x: number;
  y: number;
  category: string;
}

const NOTE_CHANGE_HISTORY_STORAGE_KEY = "note_change_history_v1";
const NOTE_CHANGE_HISTORY_LIMIT = 30;

interface MainWindowProps {
  initialSettingsOpen?: boolean;
  initialConfig?: AppConfig;
  initialErrorMessage?: string | null;
  onCurrentNoteChange?: (note: { id: string; content: string }) => void;
}

export function MainWindow({
  initialSettingsOpen = false,
  initialConfig = undefined,
  initialErrorMessage = null,
  onCurrentNoteChange,
}: MainWindowProps = {}) {
  const { t } = useTranslation();
  const [notes, setNotes] = useState<NoteMetadata[]>([]);
  const [externalFiles, setExternalFiles] = useState<ExternalFile[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [viewMode, setViewMode] = useState<ViewMode>(
    normalizeViewMode(initialConfig?.defaultViewMode ?? "split"),
  );
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [content, setContent] = useState("");
  const [title, setTitle] = useState("");
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(initialErrorMessage);
  const [noteMenu, setNoteMenu] = useState<NoteMenuState | null>(null);
  const [noteMenuClosing, setNoteMenuClosing] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(initialSettingsOpen);
  const [settingsConfig, setSettingsConfig] = useState<AppConfig | null>(initialConfig ?? null);
  const [savedNotesDir, setSavedNotesDir] = useState<string | null>(
    initialConfig?.notesDir ?? null,
  );
  const [noteTransitionKey, setNoteTransitionKey] = useState(0);
  const [pinnedTileIds, setPinnedTileIds] = useState<Set<string>>(new Set());
  const [categories, setCategories] = useState<string[]>([]);
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set());
  const [activeCategory, setActiveCategory] = useState<string>("");
  const [showCategoryInput, setShowCategoryInput] = useState(false);
  const [categoryInputValue, setCategoryInputValue] = useState("");
  const [noteMenuMode, setNoteMenuMode] = useState<"main" | "move">("main");
  const [renamingCategory, setRenamingCategory] = useState<string | null>(null);
  const [renameCategoryValue, setRenameCategoryValue] = useState("");
  const [dragOverCategory, setDragOverCategory] = useState<string | null>(null);
  const [settingsOverlay, setSettingsOverlay] = useState(() => window.innerWidth < 1080);
  const [lastActivityAt, setLastActivityAt] = useState<number>(Date.now());
  const [sidebarWidth, setSidebarWidth] = useState(200);
  const [isResizingSidebar, setIsResizingSidebar] = useState(false);
  const [categoryMenu, setCategoryMenu] = useState<CategoryMenuState | null>(null);
  const [categoryMenuClosing, setCategoryMenuClosing] = useState(false);
  const [categoryMenuConfirmDelete, setCategoryMenuConfirmDelete] = useState(false);
  const contentRef = useRef<HTMLTextAreaElement>(null);
  const externalFileMtimeRef = useRef<number>(0);
  const lastExternalSaveRef = useRef<number>(0);
  const saveStateRef = useRef(saveState);
  saveStateRef.current = saveState;
  const skipNextNotesChangedRef = useRef(false);
  const selectedIdRef = useRef(selectedId);
  selectedIdRef.current = selectedId;
  const lastSavedContentRef = useRef("");
  const [noteChangeHistory, setNoteChangeHistory] = useState<NoteChangeHistoryEntry[]>(() => {
    try {
      const saved = localStorage.getItem(NOTE_CHANGE_HISTORY_STORAGE_KEY);
      if (!saved) return [];
      const parsed = JSON.parse(saved) as NoteChangeHistoryEntry[];
      return Array.isArray(parsed) ? parsed.slice(0, NOTE_CHANGE_HISTORY_LIMIT) : [];
    } catch {
      return [];
    }
  });

  // 场景四：焦虑推断 + 主动干预。收集最近 5 分钟编辑事件，超基线阈值时给出关怀（带冷却）。
  const [anxietyMessage, setAnxietyMessage] = useState<string | null>(null);
  const recentInkEventsRef = useRef<InkEvent[]>([]);
  const anxietyCooldownRef = useRef(new CooldownTracker());
  const ANXIETY_CARE_MESSAGES = [
    "卡在这里了？先写别的段落也可以。",
    "要不要先停一下，我在这儿。",
    "别急，慢慢来就好。",
  ];
  const handleInkEvent = useCallback((event: InkEvent) => {
    const now = event.timestamp;
    const windowStart = now - 300_000;
    const buffer = recentInkEventsRef.current;
    buffer.push(event);
    // 只保留 5 分钟窗口，防止无限增长
    while (buffer.length > 0 && buffer[0].timestamp < windowStart) buffer.shift();

    const assessment = assessAnxiety(buffer, DEFAULT_BASELINE, now);
    if (assessment.shouldIntervene && anxietyCooldownRef.current.tryFire("anxiety", 180_000, now)) {
      // 关怀文案随机取一句，避免机械重复；语气只关心、不评价
      const idx = Math.abs(now) % ANXIETY_CARE_MESSAGES.length;
      setAnxietyMessage(ANXIETY_CARE_MESSAGES[idx]);
    }
  }, []);

  const inkRecorder = useInkRecorder({
    noteId: selectedId ?? "",
    source: "main",
    enabled: Boolean(settingsConfig?.agentEnabled),
    onEvent: handleInkEvent,
  });
  const {
    initValue: initInkValue,
    recordTextChange,
    recordCursor,
    recordPaste,
    flush: flushInk,
  } = inkRecorder;

  const selectedNote = useMemo(
    () => notes.find((note) => note.id === selectedId) ?? null,
    [notes, selectedId],
  );
  const selectedNoteRef = useRef(selectedNote);
  selectedNoteRef.current = selectedNote;

  const selectedExternalFile = useMemo(
    () => externalFiles.find((f) => f.id === selectedId) ?? null,
    [externalFiles, selectedId],
  );

  useEffect(() => {
    try {
      localStorage.setItem(
        NOTE_CHANGE_HISTORY_STORAGE_KEY,
        JSON.stringify(noteChangeHistory.slice(0, NOTE_CHANGE_HISTORY_LIMIT)),
      );
    } catch {
      // ignore
    }
  }, [noteChangeHistory]);

  const isExternal = selectedExternalFile !== null;

  const recordNoteChange = useCallback(
    (entry: Omit<NoteChangeHistoryEntry, "id" | "createdAt" | "additions" | "removals">) => {
      if (entry.beforeContent === entry.afterContent) return;
      const stats = getLineChangeStats(entry.beforeContent, entry.afterContent);
      if (stats.additions === 0 && stats.removals === 0) return;
      const nextEntry: NoteChangeHistoryEntry = {
        ...entry,
        ...stats,
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        createdAt: Date.now(),
      };
      setNoteChangeHistory((current) => [nextEntry, ...current].slice(0, NOTE_CHANGE_HISTORY_LIMIT));
    },
    [],
  );

  const currentNoteChange = useMemo<NoteChangeHistoryEntry | null>(() => {
    if (!selectedId || isExternal || content === lastSavedContentRef.current) return null;
    const stats = getLineChangeStats(lastSavedContentRef.current, content);
    if (stats.additions === 0 && stats.removals === 0) return null;
    return {
      id: "current",
      noteId: selectedId,
      title,
      pathLabel: selectedNote?.fileName ?? "本地笔记",
      beforeContent: lastSavedContentRef.current,
      afterContent: content,
      additions: stats.additions,
      removals: stats.removals,
      createdAt: Date.now(),
    };
  }, [content, isExternal, selectedId, selectedNote?.fileName, title]);

  const selectedNoteChangeHistory = useMemo(
    () => (selectedId ? noteChangeHistory.filter((entry) => entry.noteId === selectedId) : []),
    [noteChangeHistory, selectedId],
  );

  const noteMenuTarget = useMemo(
    () => notes.find((note) => note.id === noteMenu?.noteId) ?? null,
    [noteMenu?.noteId, notes],
  );
  const noteContextMenuItems = useMemo(() => getNoteContextMenuItems(t), [t]);

  const filteredNotes = useMemo(() => filterNotes(notes, searchQuery), [notes, searchQuery]);

  const categoryGroups = useMemo(
    () => groupNotesByCategory(filteredNotes, categories),
    [filteredNotes, categories],
  );

  const applyNote = useCallback(
    (note: Note, options?: { preserveDirty?: boolean }) => {
      if (
        options?.preserveDirty &&
        selectedIdRef.current === note.id &&
        saveStateRef.current === "dirty"
      ) {
        return;
      }
      setSelectedId(note.id);
      setTitle(note.title);
      contentRefValue.current = note.content;
      lastSavedContentRef.current = note.content;
      setContent(note.content);
      initInkValue(note.content);
      setSaveState("saved");
      setErrorMessage(null);
      console.log("[MainWindow] applyNote -> onCurrentNoteChange", {
        id: note.id,
        title: note.title,
      });
      onCurrentNoteChange?.({ id: note.id, content: note.content });
      if (selectedIdRef.current !== note.id) {
        setNoteTransitionKey((k) => k + 1);
      }
    },
    [onCurrentNoteChange, initInkValue],
  );

  const replaceNoteMetadata = useCallback((note: Note) => {
    const metadata = metadataFromNote(note);
    setNotes((current) => {
      const exists = current.some((item) => item.id === metadata.id);
      const next = exists
        ? current.map((item) => (item.id === metadata.id ? metadata : item))
        : [metadata, ...current];
      return [...next].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    });
  }, []);

  const loadNote = useCallback(
    async (id: string) => {
      setErrorMessage(null);
      const note = await getNote(id);
      applyNote(note, { preserveDirty: true });
      replaceNoteMetadata(note);
    },
    [applyNote, replaceNoteMetadata],
  );

  const refreshNotes = useCallback(async () => {
    const [loadedNotes, loadedCategories] = await Promise.all([listNotes(), listCategories()]);
    setNotes(loadedNotes);
    setCategories(loadedCategories);
    return loadedNotes;
  }, []);

  const clearCurrentNote = useCallback(() => {
    setSelectedId(null);
    setTitle("");
    setContent("");
    setSaveState("idle");
  }, []);

  const loadExternalFile = useCallback(async (filePath: string) => {
    setErrorMessage(null);
    try {
      const [fileContent, mtime] = await Promise.all([
        readExternalFile(filePath),
        getFileModifiedTime(filePath),
      ]);
      const fileName = filePath.split(/[\\/]/).pop() ?? filePath;
      const displayTitle = fileName.replace(/\.(md|txt)$/i, "");

      setExternalFiles((current) => {
        if (current.some((f) => f.id === filePath)) {
          return current;
        }
        return [
          ...current,
          {
            id: filePath,
            title: displayTitle,
            filePath,
          },
        ];
      });

      setSelectedId(filePath);
      setTitle(displayTitle);
      setContent(fileContent);
      setSaveState("saved");
      setNoteTransitionKey((k) => k + 1);
      externalFileMtimeRef.current = mtime;
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      setIsLoading(true);
      try {
        const [loadedConfig, loadedNotes, loadedCategories] = await Promise.all([
          getConfig(),
          listNotes(),
          listCategories(),
        ]);
        if (cancelled) return;
        setSettingsConfig(loadedConfig);
        setSavedNotesDir(loadedConfig.notesDir);
        setViewMode(normalizeViewMode(loadedConfig.defaultViewMode));
        setNotes(loadedNotes);
        setCategories(loadedCategories);
        setCollapsedCategories(new Set(loadedCategories));
        if (loadedNotes[0]) {
          const note = await getNote(loadedNotes[0].id);
          if (!cancelled) applyNote(note, { preserveDirty: true });
        } else {
          clearCurrentNote();
        }

        if (!cancelled) {
          const startupFile = await takeStartupFile();
          if (!cancelled && startupFile) {
            await loadExternalFile(startupFile);
          }
        }
      } catch (error) {
        if (!cancelled) setErrorMessage(getErrorMessage(error));
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    void bootstrap();
    return () => {
      cancelled = true;
    };
  }, [applyNote, clearCurrentNote]);

  useEffect(() => {
    let unlisten: Promise<() => void> | null = null;
    try {
      unlisten = listen("notes-changed", () => {
        if (skipNextNotesChangedRef.current) {
          skipNextNotesChangedRef.current = false;
          void refreshNotes();
          return;
        }
        void refreshNotes().then((loaded) => {
          const currentId = selectedIdRef.current;
          if (!currentId) return;
          const stillExists = loaded.some((n) => n.id === currentId);
          if (stillExists) {
            if (saveStateRef.current === "dirty" || saveStateRef.current === "saving") {
              return;
            }
            void getNote(currentId)
              .then((note) => {
                if (selectedIdRef.current !== currentId) return;
                if (saveStateRef.current === "dirty" || saveStateRef.current === "saving") return;
                //#region debug-point notes-changed-apply-note
                void fetch("http://127.0.0.1:7777/event", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    scope: "main-window",
                    point: "notes-changed-apply-note",
                    selectedId: currentId,
                    saveStateRef: saveStateRef.current,
                    noteContentPreview: note.content.slice(0, 200),
                  }),
                }).catch(() => undefined);
                //#endregion
                setTitle(note.title);
                setContent(note.content);
                setSaveState("saved");
              })
              .catch(() => undefined);
          } else if (selectedNoteRef.current) {
            if (loaded[0]) {
              void loadNote(loaded[0].id);
            } else {
              clearCurrentNote();
            }
          }
        });
      });
    } catch {
      unlisten = null;
    }
    return () => {
      void unlisten?.then((fn) => fn());
    };
  }, [refreshNotes, loadNote, clearCurrentNote]);

  useEffect(() => {
    function handleFocus() {
      void refreshNotes();
    }
    window.addEventListener("focus", handleFocus);
    return () => window.removeEventListener("focus", handleFocus);
  }, [refreshNotes]);

  useEffect(() => {
    const onResize = () => setSettingsOverlay(window.innerWidth < 1080);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    let unlisten: Promise<() => void> | null = null;
    try {
      unlisten = listen<string>("open-external-file", (event) => {
        void loadExternalFile(event.payload);
      });
    } catch {
      unlisten = null;
    }
    return () => {
      void unlisten?.then((fn) => fn());
    };
  }, [loadExternalFile]);

  useEffect(() => {
    let unlisten: Promise<() => void> | null = null;
    try {
      unlisten = listen<string>("open-note", (event) => {
        void loadNote(event.payload);
      });
    } catch {
      unlisten = null;
    }
    return () => {
      void unlisten?.then((fn) => fn());
    };
  }, [loadNote]);

  useEffect(() => {
    let unlisten: Promise<() => void> | null = null;
    try {
      unlisten = listen<string>("shortcut-register-failed", (event) => {
        setErrorMessage(event.payload);
      });
    } catch {
      unlisten = null;
    }
    return () => {
      void unlisten?.then((fn) => fn());
    };
  }, []);

  useEffect(() => {
    let unlisten: Promise<() => void> | null = null;
    try {
      unlisten = listen<string>(TILE_WINDOW_CLOSED_EVENT, (event) => {
        setPinnedTileIds((previous) => syncPinnedTileIds(previous, event.payload, false));
      });
    } catch {
      unlisten = null;
    }
    return () => {
      void unlisten?.then((fn) => fn());
    };
  }, []);

  useEffect(() => {
    let unlisten: Promise<() => void> | null = null;
    try {
      unlisten = listen<string>(TILE_WINDOW_UNPINNED_EVENT, (event) => {
        setPinnedTileIds((previous) => syncPinnedTileIds(previous, event.payload, false));
      });
    } catch {
      unlisten = null;
    }
    return () => {
      void unlisten?.then((fn) => fn());
    };
  }, []);

  useEffect(() => {
    if (!selectedExternalFile) return;

    const interval = window.setInterval(async () => {
      if (Date.now() - lastExternalSaveRef.current < 2000) return;
      try {
        const mtime = await getFileModifiedTime(selectedExternalFile.filePath);
        if (mtime !== externalFileMtimeRef.current) {
          externalFileMtimeRef.current = mtime;
          const fileContent = await readExternalFile(selectedExternalFile.filePath);
          setContent(fileContent);
          setSaveState("saved");
        }
      } catch {
        // file may have been deleted or become inaccessible
      }
    }, 1000);

    return () => window.clearInterval(interval);
  }, [selectedExternalFile]);

  useEffect(() => {
    function closeMenus() {
      setNoteMenuClosing(true);
      setCategoryMenuClosing(true);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") closeMenus();
    }

    document.addEventListener("mousedown", closeMenus);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", closeMenus);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  useEffect(() => {
    if (!noteMenuClosing || !noteMenu) return;
    const timer = window.setTimeout(() => {
      setNoteMenu(null);
      setNoteMenuClosing(false);
      setNoteMenuMode("main");
    }, 150);
    return () => window.clearTimeout(timer);
  }, [noteMenuClosing, noteMenu]);

  useEffect(() => {
    if (!categoryMenuClosing || !categoryMenu) return;
    const timer = window.setTimeout(() => {
      setCategoryMenu(null);
      setCategoryMenuClosing(false);
      setCategoryMenuConfirmDelete(false);
    }, 150);
    return () => window.clearTimeout(timer);
  }, [categoryMenuClosing, categoryMenu]);

  const contentRefValue = useRef(content);
  contentRefValue.current = content;

  const saveCurrentNote = useCallback(async () => {
    if (!selectedId) return null;

    if (isExternal && selectedExternalFile) {
      setSaveState("saving");
      try {
        const latestContent = contentRefValue.current;
        await saveExternalFile(selectedExternalFile.filePath, latestContent);
        lastExternalSaveRef.current = Date.now();
        const mtime = await getFileModifiedTime(selectedExternalFile.filePath);
        externalFileMtimeRef.current = mtime;
        setSaveState("saved");
        setErrorMessage(null);
        return { id: selectedId, title, content: latestContent } as Note;
      } catch (error) {
        setSaveState("error");
        setErrorMessage(getErrorMessage(error));
        return null;
      }
    }

    setSaveState("saving");
    const latestContent = contentRefValue.current;
    //#region debug-point save-current-note-start
    void fetch("http://127.0.0.1:7777/event", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        scope: "main-window",
        point: "save-current-note-start",
        selectedId,
        contentPreview: latestContent.slice(0, 200),
      }),
    }).catch(() => undefined);
    //#endregion
    try {
      const category = selectedNote?.category ?? "";
      const previousContent = lastSavedContentRef.current;
      const note = await updateNote(selectedId, { title, content: latestContent, category });
      recordNoteChange({
        noteId: selectedId,
        title,
        pathLabel: note.fileName,
        beforeContent: previousContent,
        afterContent: latestContent,
      });
      lastSavedContentRef.current = latestContent;
      skipNextNotesChangedRef.current = true;
      replaceNoteMetadata(note);
      saveStateRef.current = "saved";
      setSaveState("saved");
      setErrorMessage(null);
      onCurrentNoteChange?.({ id: selectedId, content: latestContent });
      return note;
    } catch (error) {
      setSaveState("error");
      setErrorMessage(getErrorMessage(error));
      return null;
    }
  }, [
    isExternal,
    onCurrentNoteChange,
    recordNoteChange,
    replaceNoteMetadata,
    selectedExternalFile,
    selectedId,
    selectedNote,
    title,
  ]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key === "s") {
        event.preventDefault();
        void saveCurrentNote();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [saveCurrentNote]);

  useEffect(() => {
    if (!selectedId || saveState !== "dirty") {
      return undefined;
    }

    const timer = window.setTimeout(() => {
      void saveCurrentNote();
    }, 900);

    return () => window.clearTimeout(timer);
  }, [saveCurrentNote, saveState, selectedId]);

  // Reflect unsaved state in the macOS native title bar (dot in the red button).
  useEffect(() => {
    void setWindowDocumentEdited(saveState === "dirty" || saveState === "saving").catch(
      () => undefined,
    );
  }, [saveState]);

  const saveCurrentNoteRef = useRef(saveCurrentNote);
  saveCurrentNoteRef.current = saveCurrentNote;

  // Save-on-close: flush unsaved edits when the window hides (close button) or
  // the app is about to quit. On macOS the window only hides (state preserved),
  // so the async save completes even after the window disappears.
  useEffect(() => {
    const flush = () => {
      if (saveStateRef.current === "dirty") {
        void saveCurrentNoteRef.current();
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flush();
    };
    document.addEventListener("visibilitychange", onVisibility);
    let unlisten: Promise<() => void> | undefined;
    try {
      unlisten = getCurrentWindow().onCloseRequested(() => flush());
    } catch {
      // not in a Tauri window (e.g. tests)
    }
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      void unlisten?.then((fn) => fn());
    };
  }, []);

  const handleNewNote = async () => {
    setErrorMessage(null);
    if (saveState === "dirty") {
      await saveCurrentNote();
    }
    try {
      const note = await createNote({ title: "", content: "", category: activeCategory });
      replaceNoteMetadata(note);
      applyNote(note, { preserveDirty: true });
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    }
  };

  const handleOpenSettings = async () => {
    if (settingsOpen) {
      setSettingsOpen(false);
      return;
    }
    setSettingsOpen(true);
    if (settingsConfig) return;

    setErrorMessage(null);
    try {
      const config = await getConfig();
      setSettingsConfig(config);
      setSavedNotesDir(config.notesDir);
      setViewMode(normalizeViewMode(config.defaultViewMode));
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    }
  };

  const handleChooseNotesDir = async () => {
    if (!settingsConfig) return;

    setErrorMessage(null);
    try {
      const notesDir = await chooseNotesDirectory();
      if (!notesDir) return;
      handleSettingsChange({ ...settingsConfig, notesDir });
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    }
  };

  const settingsSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const persistSettings = useCallback(
    (nextConfig: AppConfig) => {
      if (settingsSaveTimer.current) {
        clearTimeout(settingsSaveTimer.current);
      }
      settingsSaveTimer.current = setTimeout(async () => {
        const previousNotesDir = savedNotesDir ?? nextConfig.notesDir;
        const normalizedConfig = {
          ...nextConfig,
          defaultViewMode: normalizeViewMode(nextConfig.defaultViewMode),
          tileColor: normalizeTileColor(nextConfig.tileColor),
        };
        try {
          const savedConfig = await saveConfig(normalizedConfig);
          setSettingsConfig(savedConfig);
          setSavedNotesDir(savedConfig.notesDir);
          setViewMode(normalizeViewMode(savedConfig.defaultViewMode));

          if (savedConfig.notesDir !== previousNotesDir) {
            const loadedNotes = await refreshNotes();
            if (loadedNotes[0]) {
              await loadNote(loadedNotes[0].id);
            } else {
              clearCurrentNote();
            }
          }
        } catch (error) {
          setErrorMessage(getErrorMessage(error));
        }
      }, 300);
    },
    [savedNotesDir, refreshNotes, loadNote, clearCurrentNote],
  );

  const handleSettingsChange = useCallback(
    (nextConfig: AppConfig) => {
      setSettingsConfig(nextConfig);
      void emit("config-changed", nextConfig);
      persistSettings(nextConfig);
    },
    [persistSettings],
  );

  const handleCloseSettings = useCallback(() => {
    setSettingsOpen(false);
  }, []);

  const handleImportNote = async () => {
    setErrorMessage(null);
    try {
      if (selectedId && saveState === "dirty") {
        const saved = await saveCurrentNote();
        if (!saved) return;
      }

      const note = await importMarkdownNote(activeCategory);
      if (!note) return;

      replaceNoteMetadata(note);
      applyNote(note, { preserveDirty: true });
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    }
  };

  const handleSelectNote = async (id: string) => {
    if (id === selectedId) return;
    if (saveState === "dirty") {
      await saveCurrentNote();
    }

    try {
      await loadNote(id);
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    }
  };

  const handleSelectExternalFile = async (id: string) => {
    if (id === selectedId) return;
    if (saveState === "dirty") {
      await saveCurrentNote();
    }

    const file = externalFiles.find((f) => f.id === id);
    if (!file) return;

    try {
      const [fileContent, mtime] = await Promise.all([
        readExternalFile(file.filePath),
        getFileModifiedTime(file.filePath),
      ]);
      setSelectedId(id);
      setTitle(file.title);
      setContent(fileContent);
      setSaveState("saved");
      setErrorMessage(null);
      setNoteTransitionKey((k) => k + 1);
      externalFileMtimeRef.current = mtime;
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    }
  };

  const handleRemoveExternalFile = async (id: string) => {
    if (selectedId === id && saveState === "dirty") {
      const shouldSave = window.confirm(
        t("main.confirm.unsavedExternalFile", {
          title: title || t("common.untitledFile", { defaultValue: "未命名文件" }),
          defaultValue: "「{{title}}」有未保存的更改，是否保存到原文件？",
        }),
      );
      if (shouldSave) {
        const saved = await saveCurrentNote();
        if (!saved) return;
      }
    }
    setExternalFiles((current) => current.filter((f) => f.id !== id));
    if (selectedId === id) {
      clearCurrentNote();
    }
  };

  const handleDeleteNote = async (noteId = selectedId) => {
    if (!noteId) return;

    setErrorMessage(null);
    try {
      await deleteNote(noteId);
      const remaining = await refreshNotes();
      if (noteId === selectedId && remaining[0]) {
        await loadNote(remaining[0].id);
      } else if (noteId === selectedId) {
        clearCurrentNote();
      }
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    }
  };

  const handleOpenNoteMenu = (event: MouseEvent<HTMLElement>, noteId: string) => {
    event.preventDefault();
    event.stopPropagation();

    const menuWidth = 168;
    const menuHeight = 76;
    const x = Math.min(event.clientX, window.innerWidth - menuWidth - 4);
    const y = Math.min(event.clientY, window.innerHeight - menuHeight - 4);

    setNoteMenuClosing(false);
    setHoveredId(noteId);
    setNoteMenu({
      x: Math.max(4, x),
      y: Math.max(4, y),
      noteId,
    });
  };

  const handleExportNote = async (note: NoteMetadata) => {
    setErrorMessage(null);
    try {
      if (note.id === selectedId && saveState === "dirty") {
        const saved = await saveCurrentNote();
        if (!saved) return;
      }

      await exportMarkdownNote({
        id: note.id,
        title: note.id === selectedId ? title : note.title,
      });
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    }
  };

  const handleNoteMenuAction = (action: NoteContextMenuAction) => {
    const note = noteMenuTarget;
    if (!note) return;

    if (action === "export") {
      setNoteMenuClosing(true);
      void handleExportNote(note);
      return;
    }

    if (action === "move") {
      setNoteMenuMode("move");
      return;
    }

    setNoteMenuClosing(true);
    void handleDeleteNote(note.id);
  };

  const handleMoveNote = async (noteId: string, targetCategory: string) => {
    setNoteMenuClosing(true);
    setErrorMessage(null);
    try {
      await moveNoteCategory(noteId, targetCategory);
      await refreshNotes();
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    }
  };

  const handleCreateCategory = async () => {
    const name = categoryInputValue.trim();
    if (!name) {
      setShowCategoryInput(false);
      return;
    }
    setErrorMessage(null);
    try {
      await createCategory(name);
      setCategories((prev) => [...prev, name].sort());
      setShowCategoryInput(false);
      setCategoryInputValue("");
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    }
  };

  const handleRenameCategory = async (oldName: string) => {
    const newName = renameCategoryValue.trim();
    if (!newName || newName === oldName) {
      setRenamingCategory(null);
      return;
    }
    setErrorMessage(null);
    try {
      await renameCategory(oldName, newName);
      await refreshNotes();
      setRenamingCategory(null);
      setRenameCategoryValue("");
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    }
  };

  const handleDeleteCategory = async (name: string) => {
    setErrorMessage(null);
    try {
      await deleteCategory(name);
      await refreshNotes();
      if (activeCategory === name) {
        setActiveCategory("");
      }
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    }
  };

  const toggleCategoryCollapse = (category: string) => {
    setCollapsedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(category)) {
        next.delete(category);
      } else {
        next.add(category);
      }
      return next;
    });
  };

  const markDirty = () => {
    if (selectedId) setSaveState("dirty");
  };

  const ensureNoteSaved = useCallback(async (): Promise<string | null> => {
    if (selectedId) return selectedId;
    try {
      const note = await createNote({ title, content, category: activeCategory });
      replaceNoteMetadata(note);
      applyNote(note, { preserveDirty: true });
      return note.id;
    } catch {
      return null;
    }
  }, [selectedId, title, content, activeCategory, replaceNoteMetadata, applyNote]);

  const handleOpenNotepad = async () => {
    setErrorMessage(null);
    try {
      await openNotepadWindow();
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    }
  };

  useEffect(() => {
    if (!isResizingSidebar) return;

    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";

    const onMouseMove = (e: globalThis.MouseEvent) => {
      const rightInset = settingsConfig && settingsOpen && !settingsOverlay ? 360 : 0;
      const sidebarRightEdge = window.innerWidth - rightInset;
      const newWidth = Math.min(Math.max(sidebarRightEdge - e.clientX, 240), 560);
      setSidebarWidth(newWidth);
    };
    const onMouseUp = () => setIsResizingSidebar(false);

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
    return () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    };
  }, [isResizingSidebar, settingsConfig, settingsOpen, settingsOverlay]);

  const handlePinEntry = async () => {
    if (!selectedId) return;
    const isPinned = pinnedTileIds.has(selectedId);
    if (!isPinned && saveState === "dirty") {
      await saveCurrentNote();
    }

    setErrorMessage(null);
    try {
      const pinned = await toggleTileWindow(selectedId);
      setPinnedTileIds((previous) => {
        return syncPinnedTileIds(previous, selectedId, pinned);
      });
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    }
  };

  const selectedTilePinned = selectedId ? pinnedTileIds.has(selectedId) : false;

  return (
    <div className="w-full h-full flex flex-col">
      <div className="relative bg-paper overflow-hidden flex flex-col flex-1">
        <BackgroundLayer config={settingsConfig} />
        <div className="relative z-10 flex flex-1 min-h-0">
          <div
            className="order-3 border-l border-paper-deep/30 shrink-0 overflow-hidden transition-[width] duration-[600ms]"
            style={{ width: sidebarCollapsed ? 0 : sidebarWidth }}
          >
            <div className="flex flex-col h-full" style={{ width: `${sidebarWidth}px` }}>
              <div className="px-3 pt-3 pb-2 shrink-0">
                <div className="flex items-center gap-2 px-2.5 h-8 rounded-lg bg-paper-warm/80 border border-paper-deep/40 focus-within:border-bamboo/30 focus-within:bg-cloud transition-all">
                  <svg
                    width="13"
                    height="13"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    className="text-ink-ghost shrink-0"
                  >
                    <circle cx="11" cy="11" r="8" />
                    <path d="m21 21-4.35-4.35" />
                  </svg>
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                    placeholder={t("main.sidebar.searchPlaceholder", { defaultValue: "搜索笔记…" })}
                    className="flex-1 text-[12px] font-body text-ink placeholder:text-ink-ghost/60 bg-transparent"
                  />
                  {searchQuery && (
                    <button
                      onClick={() => setSearchQuery("")}
                      className="text-ink-ghost hover:text-ink-faint transition-colors cursor-pointer"
                      title={t("main.sidebar.clearSearch", { defaultValue: "清空搜索" })}
                    >
                      <svg
                        width="10"
                        height="10"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="3"
                        strokeLinecap="round"
                      >
                        <path d="M18 6L6 18M6 6l12 12" />
                      </svg>
                    </button>
                  )}
                </div>
              </div>

              <div className="px-4 pb-3 shrink-0 space-y-1.5">
                <button
                  onClick={handleNewNote}
                  className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[12px] font-body text-bamboo hover:bg-bamboo-mist/60 transition-all cursor-pointer group"
                >
                  <svg
                    width="13"
                    height="13"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    className="group-hover:rotate-90 transition-transform duration-200"
                  >
                    <path d="M12 5v14M5 12h14" />
                  </svg>
                  <span>{t("main.sidebar.newNote", { defaultValue: "新建笔记" })}</span>
                </button>
                <button
                  onClick={() => void handleImportNote()}
                  className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[12px] font-body text-ink-faint hover:text-bamboo hover:bg-bamboo-mist/50 transition-all cursor-pointer group"
                >
                  <svg
                    width="13"
                    height="13"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M12 3v12" />
                    <path d="m7 10 5 5 5-5" />
                    <path d="M5 21h14" />
                  </svg>
                  <span>{t("main.sidebar.importMarkdown", { defaultValue: "导入 Markdown" })}</span>
                </button>
              </div>

              <div className="flex items-center justify-between px-5 pb-1.5 shrink-0">
                <span className="text-[10px] text-ink-ghost font-mono tracking-wider uppercase">
                  {t("common.noteCount", {
                    count: filteredNotes.length,
                    defaultValue: "{{count}} 篇笔记",
                  })}
                  {externalFiles.length > 0
                    ? ` · ${t("common.externalFileCount", {
                        count: externalFiles.length,
                        defaultValue: "{{count}} 个外部文件",
                      })}`
                    : ""}
                </span>
                <button
                  onClick={() => setShowCategoryInput(true)}
                  className="text-[10px] text-ink-ghost hover:text-bamboo transition-colors cursor-pointer"
                  title={t("main.category.new", { defaultValue: "新建分类" })}
                >
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                  >
                    <path d="M12 5v14M5 12h14" />
                  </svg>
                </button>
              </div>

              {showCategoryInput && (
                <div className="px-3 pb-2 shrink-0">
                  <input
                    type="text"
                    autoFocus
                    value={categoryInputValue}
                    onChange={(e) => setCategoryInputValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void handleCreateCategory();
                      if (e.key === "Escape") {
                        setShowCategoryInput(false);
                        setCategoryInputValue("");
                      }
                    }}
                    onBlur={() => void handleCreateCategory()}
                    placeholder={t("main.category.placeholder", { defaultValue: "输入分类名…" })}
                    className="w-full px-2.5 h-7 rounded-lg text-[12px] font-body text-ink bg-paper-warm/80 border border-paper-deep/40 focus:border-bamboo/30 placeholder:text-ink-ghost/60"
                  />
                </div>
              )}

              <div className="flex-1 overflow-y-auto px-2 pb-3">
                <div className="space-y-2">
                  {externalFiles.length > 0 && (
                    <>
                      <div className="px-3 py-1.5 text-[10px] text-ink-ghost/50 font-mono tracking-wider uppercase">
                        {t("main.externalFiles.title", { defaultValue: "外部文件" })}
                      </div>
                      {externalFiles.map((file) => {
                        const isSelected = file.id === selectedId;
                        const isHovered = file.id === hoveredId;

                        return (
                          <button
                            key={file.id}
                            onClick={() => void handleSelectExternalFile(file.id)}
                            onMouseEnter={() => setHoveredId(file.id)}
                            onMouseLeave={() => setHoveredId(null)}
                            className={`w-full text-left rounded-2xl px-3.5 py-4 transition-all duration-[600ms] cursor-pointer group relative shadow-[0_10px_30px_rgba(0,0,0,0.03)] ${
                              isSelected
                                ? "bg-bamboo-mist/70"
                                : isHovered
                                  ? "bg-paper-warm/70"
                                  : "bg-transparent"
                            }`}
                          >
                            <div
                              className={`absolute left-0 top-1/2 -translate-y-1/2 w-[3px] rounded-r-full bg-bamboo/60 transition-all duration-[600ms] ${
                                isSelected ? "h-5 opacity-100" : "h-0 opacity-0"
                              }`}
                            />

                            <div className="flex items-baseline justify-between mb-0.5">
                              <span
                                className={`text-[13px] font-display font-medium truncate pr-2 transition-colors flex items-center gap-1.5 ${
                                  isSelected ? "text-bamboo" : "text-ink-soft"
                                }`}
                              >
                                <svg
                                  width="12"
                                  height="12"
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="2"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  className="shrink-0 opacity-60"
                                >
                                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                                  <polyline points="14 2 14 8 20 8" />
                                </svg>
                                {file.title}
                              </span>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleRemoveExternalFile(file.id);
                                }}
                                className="opacity-0 group-hover:opacity-100 text-ink-ghost hover:text-red-400 transition-all p-0.5"
                                title={t("main.externalFiles.remove", {
                                  defaultValue: "从列表移除",
                                })}
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
                                  <line x1="18" y1="6" x2="6" y2="18" />
                                  <line x1="6" y1="6" x2="18" y2="18" />
                                </svg>
                              </button>
                            </div>

                            <p className="text-[11px] text-ink-ghost leading-relaxed line-clamp-2 group-hover:text-ink-faint transition-colors pl-[18px]">
                              {file.filePath}
                            </p>
                          </button>
                        );
                      })}
                    </>
                  )}

                  {categoryGroups.map((group: CategoryGroup) => {
                    if (!group.category) {
                      return (
                        <div
                          key="__uncategorized__"
                          className={`rounded-lg transition-all duration-200 ${
                            dragOverCategory === "" ? "bg-bamboo/10 ring-1 ring-bamboo/20" : ""
                          }`}
                          onDragOver={(e) => {
                            e.preventDefault();
                            e.dataTransfer.dropEffect = "move";
                            setDragOverCategory("");
                          }}
                          onDragLeave={(e) => {
                            if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                              setDragOverCategory(null);
                            }
                          }}
                          onDrop={(e) => {
                            e.preventDefault();
                            setDragOverCategory(null);
                            const noteId = e.dataTransfer.getData("text/plain");
                            if (noteId) void handleMoveNote(noteId, "");
                          }}
                        >
                          {group.notes.map((note) => {
                            const isSelected = note.id === selectedId;
                            const isHovered = note.id === hoveredId;
                            return (
                              <div
                                key={note.id}
                                draggable
                                onDragStart={(e) => {
                                  e.dataTransfer.setData("text/plain", note.id);
                                  e.dataTransfer.setData(
                                    "application/x-floral-note",
                                    JSON.stringify({ type: "note", id: note.id, title: note.title || "笔记" }),
                                  );
                                  e.dataTransfer.effectAllowed = "move";
                                }}
                                onClick={() => void handleSelectNote(note.id)}
                                onContextMenu={(event) => handleOpenNoteMenu(event, note.id)}
                                onMouseEnter={() => setHoveredId(note.id)}
                                onMouseLeave={() => setHoveredId(null)}
                                className={`w-full text-left rounded-xl px-3 py-2.5 transition-all duration-[600ms] cursor-pointer group relative ${
                                  isSelected
                                    ? "bg-bamboo-mist/70"
                                    : isHovered
                                      ? "bg-paper-warm/70"
                                      : "bg-transparent"
                                }`}
                              >
                                <div
                                  className={`absolute left-0 top-1/2 -translate-y-1/2 w-[3px] rounded-r-full bg-bamboo/60 transition-all duration-[600ms] ${
                                    isSelected ? "h-5 opacity-100" : "h-0 opacity-0"
                                  }`}
                                />
                                <div className="flex items-baseline justify-between mb-0.5">
                                  <span
                                    className={`text-[13px] font-display font-medium truncate pr-2 transition-colors ${
                                      isSelected ? "text-bamboo" : "text-ink-soft"
                                    }`}
                                  >
                                    {getDisplayTitle(note, t)}
                                  </span>
                                  <span className="text-[10px] text-ink-ghost font-mono tabular-nums shrink-0">
                                    {formatShortDate(note.updatedAt)}
                                  </span>
                                </div>
                                <p className="text-[11px] text-ink-ghost leading-relaxed line-clamp-2 group-hover:text-ink-faint transition-colors">
                                  {note.preview ||
                                    t("common.blankNote", { defaultValue: "空白笔记" })}
                                </p>
                                <div className="flex items-center gap-2 mt-1">
                                  <span className="text-[10px] text-ink-ghost/60 font-mono tabular-nums">
                                    {formatTime(note.updatedAt)}
                                  </span>
                                  <span className="text-[10px] text-ink-ghost/40">·</span>
                                  <span className="text-[10px] text-ink-ghost/60 font-mono tabular-nums">
                                    {t("common.wordCount", {
                                      count: note.wordCount,
                                      defaultValue: "{{count}} 字",
                                    })}
                                  </span>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      );
                    }

                    const isCollapsed = collapsedCategories.has(group.category);

                    return (
                      <div key={group.category} className="px-2 mb-px">
                        <div
                          className={`flex items-center gap-2 px-3 py-2 rounded-xl group/cat cursor-pointer select-none transition-all duration-200 ${
                            dragOverCategory === group.category
                              ? "bg-bamboo/10 ring-1 ring-bamboo/20"
                              : isCollapsed
                                ? "bg-paper-warm/70"
                                : "bg-paper-warm/80 rounded-b-none"
                          }`}
                          onClick={() => toggleCategoryCollapse(group.category)}
                          onContextMenu={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setCategoryMenu({
                              x: e.clientX,
                              y: e.clientY,
                              category: group.category,
                            });
                            setCategoryMenuClosing(false);
                            setCategoryMenuConfirmDelete(false);
                          }}
                          onDragOver={(e) => {
                            e.preventDefault();
                            e.dataTransfer.dropEffect = "move";
                            setDragOverCategory(group.category);
                          }}
                          onDragLeave={() => setDragOverCategory(null)}
                          onDrop={(e) => {
                            e.preventDefault();
                            setDragOverCategory(null);
                            const noteId = e.dataTransfer.getData("text/plain");
                            if (noteId) void handleMoveNote(noteId, group.category);
                          }}
                        >
                          <svg
                            width="10"
                            height="10"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            className={`text-ink-ghost shrink-0 transition-transform duration-200 ${isCollapsed ? "" : "rotate-90"}`}
                          >
                            <polyline points="9 18 15 12 9 6" />
                          </svg>
                          <svg
                            width="12"
                            height="12"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            className="text-ink-ghost shrink-0"
                          >
                            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                          </svg>
                          {renamingCategory === group.category ? (
                            <input
                              type="text"
                              autoFocus
                              value={renameCategoryValue}
                              onChange={(e) => setRenameCategoryValue(e.target.value)}
                              onKeyDown={(e) => {
                                e.stopPropagation();
                                if (e.key === "Enter") void handleRenameCategory(group.category);
                                if (e.key === "Escape") setRenamingCategory(null);
                              }}
                              onBlur={() => void handleRenameCategory(group.category)}
                              onClick={(e) => e.stopPropagation()}
                              className="flex-1 min-w-0 px-1 text-[10px] font-mono text-ink bg-paper-warm/80 border border-bamboo/30 rounded"
                            />
                          ) : (
                            <span className="text-[11px] text-ink-soft font-semibold truncate tracking-[0.01em]">
                              {group.category}
                            </span>
                          )}
                          <span className="text-[9px] text-ink-ghost/60 font-mono ml-auto shrink-0 px-1.5 py-0.5 rounded-full bg-paper/45">
                            {group.notes.length}
                          </span>
                        </div>

                        <div className={`category-body ${isCollapsed ? "" : "expanded"}`}>
                          <div
                            className="category-body-inner bg-paper/30 border border-t-0 border-paper-deep/20 rounded-b-xl pb-2 pt-1.5"
                            onDragOver={(e) => {
                              e.preventDefault();
                              e.dataTransfer.dropEffect = "move";
                              setDragOverCategory(group.category);
                            }}
                            onDragLeave={(e) => {
                              if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                                setDragOverCategory(null);
                              }
                            }}
                            onDrop={(e) => {
                              e.preventDefault();
                              setDragOverCategory(null);
                              const noteId = e.dataTransfer.getData("text/plain");
                              if (noteId) void handleMoveNote(noteId, group.category);
                            }}
                          >
                            {group.notes.length === 0 ? (
                              <div className="px-3 py-3 text-center text-[11px] text-ink-ghost/50">
                                {t("main.category.emptyFolder", { defaultValue: "空文件夹" })}
                              </div>
                            ) : (
                              group.notes.map((note) => {
                                const isSelected = note.id === selectedId;
                                const isHovered = note.id === hoveredId;

                                return (
                                  <div
                                    key={note.id}
                                    draggable
                                    onDragStart={(e) => {
                                      e.dataTransfer.setData("text/plain", note.id);
                                      e.dataTransfer.setData(
                                        "application/x-floral-note",
                                        JSON.stringify({ type: "note", id: note.id, title: note.title || "笔记" }),
                                      );
                                      e.dataTransfer.effectAllowed = "move";
                                    }}
                                    onClick={() => void handleSelectNote(note.id)}
                                    onContextMenu={(event) => handleOpenNoteMenu(event, note.id)}
                                    onMouseEnter={() => setHoveredId(note.id)}
                                    onMouseLeave={() => setHoveredId(null)}
                                    className={`w-full text-left rounded-xl mx-1.5 px-3 py-3 transition-all duration-[600ms] cursor-pointer group relative ${
                                      isSelected
                                        ? "bg-bamboo-mist/70"
                                        : isHovered
                                          ? "bg-paper-warm/70"
                                          : "bg-transparent"
                                    }`}
                                    style={{ width: "calc(100% - 8px)" }}
                                  >
                                    <div
                                      className={`absolute left-0 top-1/2 -translate-y-1/2 w-[3px] rounded-r-full bg-bamboo/60 transition-all duration-[600ms] ${
                                        isSelected ? "h-5 opacity-100" : "h-0 opacity-0"
                                      }`}
                                    />

                                    <div className="flex items-baseline justify-between mb-0.5">
                                      <span
                                        className={`text-[13px] font-display font-medium truncate pr-2 transition-colors ${
                                          isSelected ? "text-bamboo" : "text-ink-soft"
                                        }`}
                                      >
                                        {getDisplayTitle(note, t)}
                                      </span>
                                      <span className="text-[10px] text-ink-ghost font-mono tabular-nums shrink-0">
                                        {formatShortDate(note.updatedAt)}
                                      </span>
                                    </div>

                                    <p className="text-[11px] text-ink-ghost leading-relaxed line-clamp-2 group-hover:text-ink-faint transition-colors">
                                      {note.preview ||
                                        t("common.blankNote", { defaultValue: "空白笔记" })}
                                    </p>

                                    <div className="flex items-center gap-2 mt-1">
                                      <span className="text-[10px] text-ink-ghost/60 font-mono tabular-nums">
                                        {formatTime(note.updatedAt)}
                                      </span>
                                      <span className="text-[10px] text-ink-ghost/40">·</span>
                                      <span className="text-[10px] text-ink-ghost/60 font-mono tabular-nums">
                                        {t("common.wordCount", {
                                          count: note.wordCount,
                                          defaultValue: "{{count}} 字",
                                        })}
                                      </span>
                                    </div>
                                  </div>
                                );
                              })
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}

                  {!isLoading && filteredNotes.length === 0 && externalFiles.length === 0 && (
                    <div className="px-3 py-8 text-center text-[12px] text-ink-ghost leading-relaxed">
                      {searchQuery
                        ? t("main.search.noResults", { defaultValue: "没有匹配的笔记" })
                        : t("main.search.empty", { defaultValue: "还没有笔记" })}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {!sidebarCollapsed && (
            <div
              className={`order-2 w-1 shrink-0 cursor-col-resize group relative ${isResizingSidebar ? "bg-bamboo/30" : "hover:bg-bamboo/20"} transition-colors`}
              onMouseDown={(e) => {
                e.preventDefault();
                setIsResizingSidebar(true);
              }}
            >
              <div
                className={`absolute inset-y-0 -left-1 -right-1 ${isResizingSidebar ? "" : "group-hover:bg-bamboo/5"}`}
              />
            </div>
          )}

          <NoteEditorWorkspace
            selectedId={selectedId}
            title={title}
            content={content}
            selectedNote={selectedNote}
            selectedExternalFile={selectedExternalFile}
            settingsConfig={settingsConfig}
            viewMode={viewMode}
            sidebarCollapsed={sidebarCollapsed}
            noteTransitionKey={noteTransitionKey}
            contentRef={contentRef}
            contentRefValue={contentRefValue}
            saveStateRef={saveStateRef}
            saveState={saveState}
            isLoading={isLoading}
            isExternal={isExternal}
            errorMessage={errorMessage}
            selectedTilePinned={selectedTilePinned}
            onToggleSidebar={() => setSidebarCollapsed(!sidebarCollapsed)}
            onPinEntry={() => void handlePinEntry()}
            onSaveCurrentNote={() => void saveCurrentNote()}
            onDeleteNote={() => void handleDeleteNote()}
            onOpenNotepad={() => void handleOpenNotepad()}
            onOpenSettings={() => void handleOpenSettings()}
            onViewModeChange={setViewMode}
            setTitle={setTitle}
            setContent={setContent}
            setSaveState={setSaveState}
            setLastActivityAt={setLastActivityAt}
            setErrorMessage={setErrorMessage}
            markDirty={markDirty}
            ensureNoteSaved={ensureNoteSaved}
            recordTextChange={recordTextChange}
            recordCursor={recordCursor}
            recordPaste={recordPaste}
            flushInk={flushInk}
            currentNoteChange={currentNoteChange}
            noteChangeHistory={selectedNoteChangeHistory}
          />
          {settingsConfig && settingsOpen && settingsOverlay && (
            <div className="absolute inset-0 z-20" onClick={handleCloseSettings} />
          )}
          {settingsConfig && (
            <div
              className={`order-4 transition-all duration-[600ms] overflow-hidden h-full ${
                settingsOverlay
                  ? `absolute right-0 top-0 bottom-0 z-30 ${settingsOpen ? "w-[360px] shadow-xl" : "w-0"}`
                  : `relative shrink-0 ${settingsOpen ? "w-[360px]" : "w-0"}`
              }`}
            >
              <div className="w-[360px] h-full">
                <SettingsPanel
                  config={settingsConfig}
                  onChange={handleSettingsChange}
                  onChooseNotesDir={() => void handleChooseNotesDir()}
                  onClose={handleCloseSettings}
                />
              </div>
            </div>
          )}
        </div>
      </div>
      {noteMenu && noteMenuTarget && (
        <div
          className={`fixed z-[9999] min-w-[168px] py-1.5 bg-paper/95 backdrop-blur-sm border border-paper-deep/50 rounded-lg overflow-hidden select-none ${noteMenuClosing ? "animate-menu-exit" : "animate-menu-enter"}`}
          style={{ left: noteMenu.x, top: noteMenu.y }}
          onMouseDown={(event) => event.stopPropagation()}
        >
          {noteMenuMode === "main" ? (
            <div key="main" className="animate-menu-slide-right">
              {noteContextMenuItems.map((item, index) => (
                <button
                  key={item.action}
                  onClick={() => handleNoteMenuAction(item.action)}
                  className={`w-full flex items-center justify-between px-3 py-1.5 text-[12px] font-body transition-colors cursor-pointer ${
                    item.tone === "danger"
                      ? "text-red-400 hover:bg-danger-bg hover:text-red-500"
                      : "text-ink-soft hover:bg-bamboo-mist/60 hover:text-bamboo"
                  } ${index > 0 ? "border-t border-paper-deep/20" : ""}`}
                >
                  <span>{item.label}</span>
                </button>
              ))}
            </div>
          ) : (
            <div key="move" className="animate-menu-slide-left">
              <button
                onClick={() => setNoteMenuMode("main")}
                className="w-full flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-body text-ink-ghost hover:bg-paper-warm transition-colors cursor-pointer border-b border-paper-deep/20"
              >
                <svg
                  width="10"
                  height="10"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="15 18 9 12 15 6" />
                </svg>
                <span>{t("common.back", { defaultValue: "返回" })}</span>
              </button>
              <button
                onClick={() => void handleMoveNote(noteMenuTarget.id, "")}
                className="w-full text-left px-3 py-1.5 text-[12px] font-body text-ink-soft hover:bg-bamboo-mist/60 hover:text-bamboo transition-colors cursor-pointer"
              >
                {t("main.category.uncategorized", { defaultValue: "未分类" })}
              </button>
              {categories.map((cat) => (
                <button
                  key={cat}
                  onClick={() => void handleMoveNote(noteMenuTarget.id, cat)}
                  className="w-full text-left px-3 py-1.5 text-[12px] font-body text-ink-soft hover:bg-bamboo-mist/60 hover:text-bamboo transition-colors cursor-pointer"
                >
                  {cat}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {categoryMenu && (
        <div
          className={`fixed z-[9999] min-w-[140px] py-1.5 bg-paper/95 backdrop-blur-sm border border-paper-deep/50 rounded-lg overflow-hidden select-none ${categoryMenuClosing ? "animate-menu-exit" : "animate-menu-enter"}`}
          style={{ left: categoryMenu.x, top: categoryMenu.y }}
          onMouseDown={(event) => event.stopPropagation()}
        >
          {categoryMenuConfirmDelete ? (
            <div className="animate-menu-slide-left">
              <div className="px-3 py-1.5 text-[11px] font-body text-ink-faint border-b border-paper-deep/20">
                {t("main.category.confirmDelete", {
                  category: categoryMenu.category,
                  defaultValue: "确认删除「{{category}}」？",
                })}
              </div>
              <button
                onClick={() => {
                  void handleDeleteCategory(categoryMenu.category);
                  setCategoryMenuClosing(true);
                }}
                className="w-full text-left px-3 py-1.5 text-[12px] font-body text-red-400 hover:bg-danger-bg hover:text-red-500 transition-colors cursor-pointer"
              >
                {t("main.category.confirmDeleteAction", { defaultValue: "确认删除" })}
              </button>
              <button
                onClick={() => setCategoryMenuConfirmDelete(false)}
                className="w-full text-left px-3 py-1.5 text-[12px] font-body text-ink-soft hover:bg-bamboo-mist/60 hover:text-bamboo transition-colors cursor-pointer"
              >
                {t("common.cancel", { defaultValue: "取消" })}
              </button>
            </div>
          ) : (
            <div className="animate-menu-slide-right">
              <button
                onClick={() => {
                  setCategoryMenuClosing(true);
                  setRenamingCategory(categoryMenu.category);
                  setRenameCategoryValue(categoryMenu.category);
                }}
                className="w-full text-left px-3 py-1.5 text-[12px] font-body text-ink-soft hover:bg-bamboo-mist/60 hover:text-bamboo transition-colors cursor-pointer"
              >
                {t("main.category.rename", { defaultValue: "重命名" })}
              </button>
              <button
                onClick={() => setCategoryMenuConfirmDelete(true)}
                className="w-full text-left px-3 py-1.5 text-[12px] font-body text-red-400 hover:bg-danger-bg hover:text-red-500 transition-colors cursor-pointer border-t border-paper-deep/20"
              >
                {t("main.category.delete", { defaultValue: "删除分类" })}
              </button>
            </div>
          )}
        </div>
      )}
      <WritingCompanion
        enabled={Boolean(settingsConfig?.agentEnabled) && selectedId !== null}
        thresholdMs={settingsConfig?.agentNudgeThresholdMs ?? 20_000}
        lastActivityAt={lastActivityAt}
        hidden={settingsOpen}
        alertMessage={anxietyMessage}
        onAlertDismiss={() => setAnxietyMessage(null)}
      />
    </div>
  );
}
