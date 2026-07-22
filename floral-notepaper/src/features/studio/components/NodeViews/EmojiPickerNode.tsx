import { useState } from 'react';
import type { NodeViewProps } from '@tiptap/react';
import { NodeViewWrapper } from '@tiptap/react';

const EMOJI_LIST = ['✨', '🌟', '❤️', '🧡', '💛', '💚', '💙', '💜', '😊', '🥰', '😍', '🤗', '🌈', '🌸', '🌺', '🍀', '🌿', '🍎', '🍕', '🌍', '🗺️', '📸', '✈️'];

export function EmojiPickerNode(props: NodeViewProps) {
  const [showPicker, setShowPicker] = useState(false);
  const { node, updateAttributes, deleteNode, editor } = props;
  const emoji = node.attrs.emoji as string || '';
  const isEditable = editor?.isEditable ?? false;

  if (!isEditable) {
    return (
      <NodeViewWrapper>
        <span className="text-[20px]">{emoji}</span>
      </NodeViewWrapper>
    );
  }

  return (
    <NodeViewWrapper className="inline-flex items-center relative">
      <button
        type="button"
        onClick={() => setShowPicker(!showPicker)}
        className="cursor-pointer"
      >
        {emoji ? (
          <span className="text-[20px] hover:opacity-80 transition-opacity">{emoji}</span>
        ) : (
          <span className="px-2 py-0.5 text-[12px] text-ink-ghost border border-dashed border-paper-deep/30 rounded hover:border-bamboo/40 transition-colors">
            😊
          </span>
        )}
      </button>
      {emoji && (
        <button
          type="button"
          onClick={() => deleteNode()}
          className="text-[10px] text-ink-ghost hover:text-red-400 ml-0.5 cursor-pointer"
        >
          ✕
        </button>
      )}
      
      {showPicker && (
        <div className="absolute top-full left-0 mt-1 bg-paper border border-paper-deep/20 rounded-lg shadow-lg p-2 z-50 w-[200px]">
          <div className="flex flex-wrap gap-1">
            {EMOJI_LIST.map(e => (
              <button
                key={e}
                type="button"
                onClick={() => { updateAttributes({ emoji: e }); setShowPicker(false); }}
                className="w-7 h-7 flex items-center justify-center hover:bg-paper-warm/60 rounded cursor-pointer text-[16px]"
              >
                {e}
              </button>
            ))}
          </div>
        </div>
      )}
    </NodeViewWrapper>
  );
}
