import { useRef } from "react";
import type { NodeViewProps } from "@tiptap/react";
import { NodeViewWrapper } from "@tiptap/react";

export function CoverCropNode(props: NodeViewProps) {
  const { node, updateAttributes, editor } = props;
  const imageUrl = (node.attrs.src as string) || "";
  const isEditable = editor?.isEditable ?? false;
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    updateAttributes({ src: url });
  };

  return (
    <NodeViewWrapper className="my-3">
      <div className="border border-paper-deep/20 rounded-xl overflow-hidden bg-paper-warm/30">
        {!imageUrl ? (
          <div className="flex flex-col items-center justify-center p-8 text-center">
            <div className="w-16 h-20 bg-paper-deep/10 rounded-lg flex items-center justify-center text-[24px] text-ink-ghost mb-2">
              🖼️
            </div>
            <div className="text-[13px] text-ink-soft mb-1">封面图 (3:4 竖版)</div>
            <div className="text-[11px] text-ink-ghost mb-3">建议尺寸 1080×1440px</div>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="px-4 py-1.5 text-[12px] bg-bamboo text-cloud rounded-lg hover:bg-bamboo-light transition-colors cursor-pointer"
              disabled={!isEditable}
            >
              选择封面
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleFileSelect}
              className="hidden"
            />
          </div>
        ) : (
          <div className="relative">
            <img
              src={imageUrl}
              alt="封面预览"
              className="w-full object-cover"
              style={{ aspectRatio: "3/4", maxHeight: "400px" }}
            />
            <div className="absolute inset-0 bg-black/10 pointer-events-none" />
            {isEditable && (
              <button
                type="button"
                onClick={() => {
                  updateAttributes({ src: "" });
                }}
                className="absolute top-2 right-2 px-2 py-0.5 text-[11px] bg-black/50 text-white rounded hover:bg-black/70 transition-colors cursor-pointer"
              >
                更换
              </button>
            )}
          </div>
        )}
        <div className="px-3 py-1.5 text-[11px] text-ink-ghost border-t border-paper-deep/10 flex items-center gap-2">
          <span>3:4 竖版封面</span>
          <span>·</span>
          <span>点击可调整裁切区域</span>
        </div>
      </div>
    </NodeViewWrapper>
  );
}
