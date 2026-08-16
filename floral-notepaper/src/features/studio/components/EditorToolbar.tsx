import { useState } from "react";
import type { Editor } from "@tiptap/react";

interface EditorToolbarProps {
  editor: Editor | null;
  onInsertTopicTag: (tag: string) => void;
  onInsertEmoji: (emoji: string) => void;
}

const EMOJI_CATEGORIES: Record<string, string[]> = {
  日常: ["✨", "🌟", "💫", "⭐", "☀️", "🌈", "🌸", "🌺", "🍀", "🌿"],
  心情: ["❤️", "🧡", "💛", "💚", "💙", "💜", "😊", "🥰", "😍", "🤗"],
  美食: ["🍎", "🍊", "🍋", "🍇", "🍓", "🫐", "🍕", "🍔", "🌮", "🍜"],
  旅行: ["🌍", "🌎", "🌏", "🗺️", "🏔️", "🏖️", "🌊", "🏕️", "📸", "✈️"],
};

const SUGGESTED_TAGS = [
  "日常",
  "分享",
  "穿搭",
  "美妆",
  "美食",
  "旅行",
  "健身",
  "好物推荐",
  "探店",
  "Vlog",
  "开箱",
  "教程",
  "干货",
];

export function EditorToolbar({ editor, onInsertTopicTag, onInsertEmoji }: EditorToolbarProps) {
  const [showEmoji, setShowEmoji] = useState(false);
  const [showTags, setShowTags] = useState(false);
  const [emojiCategory, setEmojiCategory] = useState("日常");

  if (!editor) return null;

  const ToolbarButton = ({
    onClick,
    active,
    title,
    children,
  }: {
    onClick: () => void;
    active?: boolean;
    title: string;
    children: React.ReactNode;
  }) => (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`px-2 py-1 text-[12px] rounded transition-colors cursor-pointer ${
        active
          ? "bg-bamboo-mist text-bamboo"
          : "text-ink-ghost hover:text-ink-soft hover:bg-paper-warm/60"
      }`}
    >
      {children}
    </button>
  );

  return (
    <div className="flex items-center gap-1 px-4 py-2 border-b border-paper-deep/10 bg-paper-warm/30 flex-wrap shrink-0">
      {/* 文本格式 */}
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleBold().run()}
        active={editor.isActive("bold")}
        title="加粗"
      >
        <strong>B</strong>
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleItalic().run()}
        active={editor.isActive("italic")}
        title="斜体"
      >
        <em>I</em>
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleUnderline().run()}
        active={editor.isActive("underline")}
        title="下划线"
      >
        <span style={{ textDecoration: "underline" }}>U</span>
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleStrike().run()}
        active={editor.isActive("strike")}
        title="删除线"
      >
        <span style={{ textDecoration: "line-through" }}>S</span>
      </ToolbarButton>

      <div className="w-[1px] h-4 bg-paper-deep/10 mx-1" />

      {/* 标题 */}
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
        active={editor.isActive("heading", { level: 1 })}
        title="大标题"
      >
        H1
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        active={editor.isActive("heading", { level: 2 })}
        title="中标题"
      >
        H2
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
        active={editor.isActive("heading", { level: 3 })}
        title="小标题"
      >
        H3
      </ToolbarButton>

      <div className="w-[1px] h-4 bg-paper-deep/10 mx-1" />

      {/* 对齐 */}
      <ToolbarButton
        onClick={() => editor.chain().focus().setTextAlign("left").run()}
        active={editor.isActive({ textAlign: "left" })}
        title="左对齐"
      >
        ≡
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().setTextAlign("center").run()}
        active={editor.isActive({ textAlign: "center" })}
        title="居中"
      >
        ≣
      </ToolbarButton>

      <div className="w-[1px] h-4 bg-paper-deep/10 mx-1" />

      {/* 列表 */}
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleBulletList().run()}
        active={editor.isActive("bulletList")}
        title="无序列表"
      >
        •列
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
        active={editor.isActive("orderedList")}
        title="有序列表"
      >
        1.列
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleTaskList().run()}
        active={editor.isActive("taskList")}
        title="待办"
      >
        ☐
      </ToolbarButton>

      <div className="w-[1px] h-4 bg-paper-deep/10 mx-1" />

      {/* 小红书专属工具 */}
      <div className="relative">
        <ToolbarButton
          onClick={() => {
            setShowTags(!showTags);
            setShowEmoji(false);
          }}
          title="插入话题标签"
        >
          #
        </ToolbarButton>
        {showTags && (
          <div className="absolute top-full left-0 mt-1 bg-paper border border-paper-deep/20 rounded-lg shadow-lg p-2 z-50 w-[200px]">
            <div className="text-[11px] text-ink-ghost mb-1.5 px-1">选择话题标签</div>
            <div className="flex flex-wrap gap-1">
              {SUGGESTED_TAGS.map((tag) => (
                <button
                  key={tag}
                  type="button"
                  onClick={() => {
                    onInsertTopicTag(tag);
                    setShowTags(false);
                  }}
                  className="px-2 py-0.5 text-[11px] bg-bamboo-mist/30 text-bamboo rounded-full hover:bg-bamboo-mist/60 transition-colors cursor-pointer"
                >
                  #{tag}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="relative">
        <ToolbarButton
          onClick={() => {
            setShowEmoji(!showEmoji);
            setShowTags(false);
          }}
          title="插入表情"
        >
          😊
        </ToolbarButton>
        {showEmoji && (
          <div className="absolute top-full left-0 mt-1 bg-paper border border-paper-deep/20 rounded-lg shadow-lg p-2 z-50 w-[240px]">
            <div className="flex gap-1 mb-1.5 border-b border-paper-deep/10 pb-1">
              {Object.keys(EMOJI_CATEGORIES).map((cat) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setEmojiCategory(cat)}
                  className={`px-2 py-0.5 text-[11px] rounded transition-colors cursor-pointer ${
                    emojiCategory === cat
                      ? "bg-bamboo-mist/40 text-bamboo"
                      : "text-ink-ghost hover:text-ink-soft"
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap gap-1">
              {EMOJI_CATEGORIES[emojiCategory].map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => {
                    onInsertEmoji(emoji);
                  }}
                  className="w-7 h-7 flex items-center justify-center hover:bg-paper-warm/60 rounded cursor-pointer text-[16px]"
                >
                  {emoji}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="flex-1" />

      {/* 字数统计 */}
      <span className="text-[11px] text-ink-ghost">
        {editor.storage.characterCount?.characters?.() ?? 0} 字
      </span>
    </div>
  );
}
