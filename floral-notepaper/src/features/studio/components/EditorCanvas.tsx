import { useCallback, useRef, useState } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import CharacterCount from '@tiptap/extension-character-count';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import Highlight from '@tiptap/extension-highlight';
import Link from '@tiptap/extension-link';
import TextAlign from '@tiptap/extension-text-align';
import Underline from '@tiptap/extension-underline';
import { EditorToolbar } from './EditorToolbar';
import { SlashMenu } from './SlashMenu';
import { useStudioStore } from '../stores/useStudioStore';
import { useAutoSave } from '../hooks/useAutoSave';

export function EditorCanvas() {
  const editorContainerRef = useRef<HTMLDivElement>(null);
  const [slashMenuPos, setSlashMenuPos] = useState<{ top: number; left: number } | null>(null);
  const isDirty = useStudioStore((s: { isDirty: boolean }) => s.isDirty);
  const isSaving = useStudioStore((s: { isSaving: boolean }) => s.isSaving);
  const lastSavedAt = useStudioStore((s: { lastSavedAt: string | null }) => s.lastSavedAt);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
      }),
      Placeholder.configure({
        placeholder: '开始创作... 输入 / 选择功能',
      }),
      CharacterCount,
      TaskList,
      TaskItem.configure({ nested: true }),
      Highlight,
      Link.configure({ openOnClick: false }),
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      Underline,
    ],
    editorProps: {
      attributes: {
        class: 'prose prose-sm max-w-none focus:outline-none min-h-[500px] px-8 py-6',
      },
      handleKeyDown: (view, event) => {
        if (event.key === '/' && !event.shiftKey && !event.ctrlKey && !event.metaKey) {
          const { state } = view;
          const { selection } = state;
          const { empty, $from } = selection;
          
          if (empty && $from.parent.type.name === 'paragraph' && $from.parent.content.size === 0) {
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

  const getContentJSON = useCallback(() => {
    if (!editor) return null;
    return editor.getJSON();
  }, [editor]);

  useAutoSave(getContentJSON);

  const insertTopicTag = useCallback((tag: string) => {
    if (!editor) return;
    editor.chain().focus().insertContent({ type: 'paragraph', content: [{ type: 'text', text: `#${tag} ` }] }).run();
  }, [editor]);

  const insertEmoji = useCallback((emoji: string) => {
    if (!editor) return;
    editor.chain().focus().insertContent(emoji).run();
  }, [editor]);

  return (
    <div ref={editorContainerRef} className="flex-1 flex flex-col min-h-0 relative bg-paper">
      <EditorToolbar editor={editor} onInsertTopicTag={insertTopicTag} onInsertEmoji={insertEmoji} />
      
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
        <div>
          {editor?.storage.characterCount?.characters?.() ?? 0} 字
        </div>
      </div>

      {/* 斜杠菜单 */}
      {slashMenuPos && editor && (
        <SlashMenu
          editor={editor}
          position={slashMenuPos}
          onClose={() => setSlashMenuPos(null)}
        />
      )}
    </div>
  );
}
