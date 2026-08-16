import { useYDoc } from "../../features/collab/useYDoc";

interface DocumentModeProps {
  selectedDocId: string | null;
  docTitle: string;
  onDocTitleChange: (title: string) => void;
}

export function DocumentMode({ selectedDocId, docTitle, onDocTitleChange }: DocumentModeProps) {
  const { content, setContent, saveState, provider } = useYDoc({
    documentId: selectedDocId,
    _title: docTitle,
  });

  if (!selectedDocId) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center text-ink-ghost">
          <p className="text-sm font-display font-medium">选择文档</p>
          <p className="text-[11px] mt-1">从右侧文件列表选择文档开始编辑</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* 文档标题栏 */}
      <div className="shrink-0 flex items-center justify-between h-11 px-4 border-b border-paper-deep/20 bg-paper/50">
        <input
          type="text"
          value={docTitle}
          onChange={(e) => onDocTitleChange(e.target.value)}
          className="text-[13px] font-medium text-ink bg-transparent border-none outline-none w-48 truncate"
          placeholder="文档标题"
        />
        <div className="flex items-center gap-2">
          {saveState === "syncing" && (
            <span className="text-[9px] text-amber-500 font-mono">保存中...</span>
          )}
          {saveState === "saved" && (
            <span className="text-[9px] text-bamboo font-mono">已保存</span>
          )}
          {provider && <span className="text-[9px] text-bamboo font-mono">● 在线</span>}
        </div>
      </div>

      {/* 编辑器 */}
      <div className="flex-1 flex flex-col min-h-0">
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          className="flex-1 w-full resize-none bg-transparent text-[13px] font-body text-ink leading-relaxed p-5 outline-none placeholder:text-ink-faint/30"
          placeholder="开始写点什么..."
          spellCheck={false}
        />
      </div>

      {/* 底部状态栏 */}
      <div className="shrink-0 flex items-center justify-between h-7 px-4 border-t border-paper-deep/10 bg-paper/40">
        <span className="text-[9px] font-mono text-ink-faint">{content.length} 字</span>
      </div>
    </div>
  );
}
