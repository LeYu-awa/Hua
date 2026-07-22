import { useEffect, useRef, useState, useCallback } from 'react';
import type { Editor } from '@tiptap/react';

interface SlashMenuItem {
  title: string;
  description: string;
  icon: string;
  action: (editor: Editor) => void;
}

const ITEMS: SlashMenuItem[] = [
  { title: '文本', description: '普通文本段落', icon: 'Aa', action: (e) => e.chain().focus().setParagraph().run() },
  { title: '大标题', description: '一级标题', icon: 'H1', action: (e) => e.chain().focus().toggleHeading({ level: 1 }).run() },
  { title: '中标题', description: '二级标题', icon: 'H2', action: (e) => e.chain().focus().toggleHeading({ level: 2 }).run() },
  { title: '小标题', description: '三级标题', icon: 'H3', action: (e) => e.chain().focus().toggleHeading({ level: 3 }).run() },
  { title: '待办', description: '添加待办事项', icon: '☐', action: (e) => e.chain().focus().toggleTaskList().run() },
  { title: '引用', description: '引用一段内容', icon: '❝', action: (e) => e.chain().focus().toggleBlockquote().run() },
  { title: '代码块', description: '插入代码片段', icon: '</>', action: (e) => e.chain().focus().toggleCodeBlock().run() },
  { title: '分割线', description: '插入水平分割线', icon: '—', action: (e) => e.chain().focus().setHorizontalRule().run() },
  { title: '话题标签', description: '插入小红书话题标签', icon: '#', action: (e) => e.chain().focus().insertContent('# ').run() },
];

interface SlashMenuProps {
  editor: Editor;
  onClose: () => void;
  position: { top: number; left: number };
}

export function SlashMenu({ editor, onClose, position }: SlashMenuProps) {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const menuRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = query
    ? ITEMS.filter(item => item.title.includes(query) || item.description.includes(query))
    : ITEMS;

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(i => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (filtered[selectedIndex]) {
        filtered[selectedIndex].action(editor);
        onClose();
      }
    } else if (e.key === 'Escape') {
      onClose();
    }
  }, [editor, filtered, selectedIndex, onClose]);

  return (
    <div
      ref={menuRef}
      className="absolute z-50 bg-paper border border-paper-deep/20 rounded-xl shadow-2xl p-2 w-[280px]"
      style={{ top: position.top, left: position.left }}
    >
      <input
        ref={inputRef}
        value={query}
        onChange={e => { setQuery(e.target.value); setSelectedIndex(0); }}
        onKeyDown={handleKeyDown}
        placeholder="搜索块类型..."
        className="w-full px-3 py-1.5 text-[12px] bg-paper-warm/50 border border-paper-deep/10 rounded-lg focus:outline-none focus:border-bamboo/40 mb-1"
      />
      <div className="max-h-[240px] overflow-y-auto">
        {filtered.map((item, i) => (
          <button
            key={item.title}
            type="button"
            onClick={() => { item.action(editor); onClose(); }}
            onMouseEnter={() => setSelectedIndex(i)}
            className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-left transition-colors cursor-pointer ${
              i === selectedIndex ? 'bg-bamboo-mist/20' : 'hover:bg-paper-warm/50'
            }`}
          >
            <span className="w-7 h-7 flex items-center justify-center bg-paper-warm/60 rounded-lg text-[13px] font-medium text-ink-soft">
              {item.icon}
            </span>
            <div className="flex-1 min-w-0">
              <div className="text-[12px] font-medium text-ink">{item.title}</div>
              <div className="text-[11px] text-ink-ghost truncate">{item.description}</div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
