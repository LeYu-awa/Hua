import { useState } from "react";
import type { NodeViewProps } from "@tiptap/react";
import { NodeViewWrapper } from "@tiptap/react";

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
  "测评",
];

export function TopicTagNode(props: NodeViewProps) {
  const [showPicker, setShowPicker] = useState(false);
  const { node, updateAttributes, deleteNode, editor } = props;
  const tag = (node.attrs.tag as string) || "";
  const isEditable = editor?.isEditable ?? false;

  const handleSelectTag = (t: string) => {
    updateAttributes({ tag: t });
    setShowPicker(false);
  };

  const handleRemove = () => {
    deleteNode();
  };

  if (!isEditable) {
    return (
      <NodeViewWrapper>
        <span className="inline-flex items-center px-2 py-0.5 bg-blue-50 text-blue-600 rounded-full text-[13px]">
          #{tag}
        </span>
      </NodeViewWrapper>
    );
  }

  return (
    <NodeViewWrapper className="inline-flex items-center gap-1 relative">
      {tag ? (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-blue-50 text-blue-600 rounded-full text-[13px]">
          #{tag}
          <button
            type="button"
            onClick={handleRemove}
            className="text-blue-400 hover:text-blue-600 ml-0.5 text-[11px] cursor-pointer"
          >
            ✕
          </button>
        </span>
      ) : (
        <button
          type="button"
          onClick={() => setShowPicker(true)}
          className="px-2 py-0.5 text-[12px] text-ink-ghost border border-dashed border-paper-deep/30 rounded-full hover:border-bamboo/40 hover:text-bamboo transition-colors cursor-pointer"
        >
          + 添加话题标签
        </button>
      )}

      {showPicker && (
        <div className="absolute top-full left-0 mt-1 bg-paper border border-paper-deep/20 rounded-lg shadow-lg p-2 z-50 w-[200px]">
          <div className="flex flex-wrap gap-1">
            {SUGGESTED_TAGS.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => handleSelectTag(t)}
                className="px-2 py-0.5 text-[11px] bg-blue-50 text-blue-600 rounded-full hover:bg-blue-100 transition-colors cursor-pointer"
              >
                #{t}
              </button>
            ))}
          </div>
        </div>
      )}
    </NodeViewWrapper>
  );
}
