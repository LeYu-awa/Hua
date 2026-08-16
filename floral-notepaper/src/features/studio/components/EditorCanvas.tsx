import { useCallback, useEffect, useImperativeHandle, useRef, useState, forwardRef } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import type { Content } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import CharacterCount from "@tiptap/extension-character-count";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Highlight from "@tiptap/extension-highlight";
import Link from "@tiptap/extension-link";
import TextAlign from "@tiptap/extension-text-align";
import Underline from "@tiptap/extension-underline";
import { EditorToolbar } from "./EditorToolbar";
import { SlashMenu } from "./SlashMenu";
import { useStudioStore } from "../stores/useStudioStore";
import { useAutoSave } from "../hooks/useAutoSave";

export interface EditorCanvasHandle {
  getContentJSON: () => Record<string, unknown> | null;
  getContentText: () => string;
  insertText: (text: string) => void;
}

/** 把文章 content 字段解析成 TipTap 可加载的内容：JSON 字符串 → 解析；其它文本按纯文本载入 */
function parseArticleContent(raw: unknown): Content {
  if (typeof raw !== "string" || !raw.trim()) return "";
  const trimmed = raw.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      return JSON.parse(trimmed) as Content;
    } catch {
      // 不是合法 JSON → 按纯文本
    }
  }
  return trimmed;
}

export const EditorCanvas = forwardRef<EditorCanvasHandle>(function EditorCanvas(_props, ref) {
  const editorContainerRef = useRef<HTMLDivElement>(null);
  const [slashMenuPos, setSlashMenuPos] = useState<{ top: number; left: number } | null>(null);
  const isDirty = useStudioStore((s: { isDirty: boolean }) => s.isDirty);
  const isSaving = useStudioStore((s: { isSaving: boolean }) => s.isSaving);
  const lastSavedAt = useStudioStore((s: { lastSavedAt: string | null }) => s.lastSavedAt);
  const currentArticle = useStudioStore((s) => s.currentArticle);
  /** 编辑器当前已加载内容的文章 id；与选中文章不一致时禁止自动保存（防空白编辑器覆写） */
  const loadedArticleIdRef = useRef<string | null>(null);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
      }),
      Placeholder.configure({
        placeholder: "开始创作... 输入 / 选择功能",
      }),
      CharacterCount,
      TaskList,
      TaskItem.configure({ nested: true }),
      Highlight,
      Link.configure({ openOnClick: false }),
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      Underline,
    ],
    editorProps: {
      attributes: {
        class: "prose prose-sm max-w-none focus:outline-none min-h-[500px] px-8 py-6",
      },
      handleKeyDown: (view, event) => {
        if (event.key === "/" && !event.shiftKey && !event.ctrlKey && !event.metaKey) {
          const { state } = view;
          const { selection } = state;
          const { empty, $from } = selection;

          if (empty && $from.parent.type.name === "paragraph" && $from.parent.content.size === 0) {
            const coords = view.coordsAtPos($from.pos);
            const editorEl = editorContainerRef.current;
            if (editorEl) {
              const rect = editorEl.getBoundingClientRect();
              setSlashMenuPos({
                top: coords.top - rect.top + 24,
                left: Math.min(coords.left - rect.left, rect.width - 300),
              });
              return true; // 阻止输入 /
            }
          }
        }
        return false;
      },
    },
    onUpdate: () => {
      useStudioStore.getState().setIsDirty(true);
    },
  });

  // 切换文章（或新建草稿）时加载对应内容，避免"编辑器空白 + 自动保存覆写所选文章"
  useEffect(() => {
    if (!editor) return;
    if (!currentArticle) {
      editor.commands.setContent("");
      loadedArticleIdRef.current = null;
      useStudioStore.getState().setIsDirty(false);
      return;
    }
    editor.commands.setContent(parseArticleContent(currentArticle.content));
    loadedArticleIdRef.current = currentArticle.id;
    useStudioStore.getState().setIsDirty(false);
  }, [currentArticle, editor]);

  const getContentJSON = useCallback(() => {
    if (!editor) return null;
    // 编辑器未加载当前文章内容时禁止保存，避免把空白/旧内容写回其它文章
    const current = useStudioStore.getState().currentArticle;
    if (current?.id && loadedArticleIdRef.current !== current.id) return null;
    return editor.getJSON() as Record<string, unknown>;
  }, [editor]);

  const getContentText = useCallback(() => {
    return editor ? editor.getText() : "";
  }, [editor]);

  const insertText = useCallback(
    (text: string) => {
      if (!editor) return;
      editor.chain().focus().insertContent(text).run();
    },
    [editor],
  );

  useImperativeHandle(
    ref,
    () => ({
      getContentJSON,
      getContentText,
      insertText,
    }),
    [getContentJSON, getContentText, insertText],
  );

  useAutoSave(getContentJSON);

  const insertTopicTag = useCallback(
    (tag: string) => {
      if (!editor) return;
      editor
        .chain()
        .focus()
        .insertContent({ type: "paragraph", content: [{ type: "text", text: `#${tag} ` }] })
        .run();
    },
    [editor],
  );

  const insertEmoji = useCallback(
    (emoji: string) => {
      if (!editor) return;
      editor.chain().focus().insertContent(emoji).run();
    },
    [editor],
  );

  return (
    <div ref={editorContainerRef} className="flex-1 flex flex-col min-h-0 relative bg-paper">
      <EditorToolbar
        editor={editor}
        onInsertTopicTag={insertTopicTag}
        onInsertEmoji={insertEmoji}
      />

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-[720px] mx-auto">
          <EditorContent editor={editor} />
        </div>
      </div>

      {/* 状态栏 */}
      <div className="flex items-center justify-between px-4 py-1.5 border-t border-paper-deep/10 bg-paper-warm/20 text-[11px] text-ink-ghost shrink-0">
        <div className="flex items-center gap-2">
          {isSaving ? (
            <span className="text-bamboo">保存中...</span>
          ) : isDirty ? (
            <span>未保存</span>
          ) : lastSavedAt ? (
            <span>已保存 {new Date(lastSavedAt).toLocaleTimeString()}</span>
          ) : (
            <span>就绪</span>
          )}
        </div>
        <div>{editor?.storage.characterCount?.characters?.() ?? 0} 字</div>
      </div>

      {/* 斜杠菜单 */}
      {slashMenuPos && editor && (
        <SlashMenu editor={editor} position={slashMenuPos} onClose={() => setSlashMenuPos(null)} />
      )}
    </div>
  );
});
