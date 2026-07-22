import { useCallback } from 'react';
import { useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import CharacterCount from '@tiptap/extension-character-count';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import Highlight from '@tiptap/extension-highlight';
import Link from '@tiptap/extension-link';
import TextAlign from '@tiptap/extension-text-align';
import Underline from '@tiptap/extension-underline';
import { useStudioStore } from '../stores/useStudioStore';

export function useStudioEditor() {
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
        class: 'prose prose-sm max-w-none focus:outline-none min-h-[400px] px-0',
      },
    },
    onUpdate: () => {
      useStudioStore.getState().setIsDirty(true);
    },
  });

  const insertTopicTag = useCallback((tag: string) => {
    if (!editor) return;
    editor.chain().focus().insertContent({
      type: 'paragraph',
      content: [{ type: 'text', text: `#${tag} ` }],
    }).run();
  }, [editor]);

  const insertEmoji = useCallback((emoji: string) => {
    if (!editor) return;
    editor.chain().focus().insertContent(emoji).run();
  }, [editor]);

  const insertImage = useCallback((url: string) => {
    if (!editor) return;
    editor.chain().focus().insertContent(`![image](${url})`).run();
  }, [editor]);

  const getContentJSON = useCallback(() => {
    if (!editor) return null;
    return editor.getJSON();
  }, [editor]);

  const getContentText = useCallback(() => {
    if (!editor) return '';
    return editor.getText();
  }, [editor]);

  const clearContent = useCallback(() => {
    if (!editor) return;
    editor.commands.clearContent();
  }, [editor]);

  const setContent = useCallback((content: string | Record<string, unknown>) => {
    if (!editor) return;
    if (typeof content === 'string') {
      editor.commands.setContent(content);
    } else {
      editor.commands.setContent(content);
    }
  }, [editor]);

  return {
    editor,
    insertTopicTag,
    insertEmoji,
    insertImage,
    getContentJSON,
    getContentText,
    clearContent,
    setContent,
  };
}
