import { useCallback, useEffect, useState } from "react";
import { getDocumentTree, createDocument, deleteDocument } from "../../features/collab/api";
import type { FileTreeNode } from "../../features/collab/types";

interface SharedFilesProps {
  conversationId: string | null;
  onDragStart?: (docId: string, title: string) => void;
}

export function SharedFiles({ conversationId, onDragStart }: SharedFilesProps) {
  const [documents, setDocuments] = useState<FileTreeNode[]>([]);
  const [loading, setLoading] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [newName, setNewName] = useState("");
  const [newIsFolder, setNewIsFolder] = useState(false);

  useEffect(() => {
    if (!conversationId) {
      setDocuments([]);
      return;
    }
    setLoading(true);
    getDocumentTree(conversationId)
      .then(setDocuments)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [conversationId]);

  const handleCreate = useCallback(async () => {
    if (!conversationId || !newName.trim()) return;
    try {
      await createDocument({
        conversation_id: conversationId,
        title: newName.trim(),
        is_folder: newIsFolder,
      });
      setNewName("");
      setShowNew(false);
      const tree = await getDocumentTree(conversationId);
      setDocuments(tree);
    } catch (e) {
      console.error(e);
    }
  }, [conversationId, newName, newIsFolder]);

  const handleDelete = useCallback(async (docId: string) => {
    if (!window.confirm("确定删除？")) return;
    try {
      await deleteDocument(docId);
      if (conversationId) {
        const tree = await getDocumentTree(conversationId);
        setDocuments(tree);
      }
    } catch (e) {
      console.error(e);
    }
  }, [conversationId]);

  const renderNode = (node: FileTreeNode, depth: number = 0) => (
    <div key={node.id}>
      <div
        className="flex items-center gap-1.5 px-2 py-1.5 rounded-md transition-colors hover:bg-paper-warm/60 text-ink-soft cursor-grab active:cursor-grabbing group"
        style={{ paddingLeft: `${8 + depth * 14}px` }}
        draggable={!node.is_folder}
        onDragStart={(e) => {
          e.dataTransfer.setData("text/plain", JSON.stringify({
            type: "collab-doc",
            docId: node.id,
            title: node.title,
          }));
          onDragStart?.(node.id, node.title);
        }}
      >
        {node.is_folder ? (
          <svg className="w-3 h-3 text-ink-faint shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
          </svg>
        ) : (
          <svg className="w-3 h-3 text-ink-faint shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
          </svg>
        )}
        <span className="text-[10px] truncate flex-1">
          {node.title}{node.is_folder ? "/" : ".md"}
        </span>
        {!node.is_folder && (
          <button
            onClick={(e) => { e.stopPropagation(); handleDelete(node.id); }}
            className="opacity-0 group-hover:opacity-100 text-[8px] text-ink-faint hover:text-red-400 transition-all cursor-pointer"
          >
            ×
          </button>
        )}
      </div>
      {node.is_folder && node.children.map((child) => renderNode(child, depth + 1))}
    </div>
  );

  if (!conversationId) {
    return (
      <div className="flex-1 flex items-center justify-center text-[10px] text-ink-faint px-2 text-center leading-relaxed">
        选择对话后<br />显示共享文件
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="shrink-0 flex items-center gap-1 px-2 py-1.5 border-b border-paper-deep/20">
        <button
          onClick={() => { setNewIsFolder(false); setNewName(""); setShowNew(true); }}
          className="px-1.5 py-0.5 rounded text-[9px] text-ink-ghost hover:text-ink hover:bg-paper-warm/60 transition-colors cursor-pointer"
        >
          + 文档
        </button>
        <button
          onClick={() => { setNewIsFolder(true); setNewName(""); setShowNew(true); }}
          className="px-1.5 py-0.5 rounded text-[9px] text-ink-ghost hover:text-ink hover:bg-paper-warm/60 transition-colors cursor-pointer"
        >
          + 文件夹
        </button>
      </div>

      {showNew && (
        <div className="shrink-0 px-2 py-1.5 flex items-center gap-1 border-b border-paper-deep/10 bg-paper-warm/30">
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleCreate();
              if (e.key === "Escape") setShowNew(false);
            }}
            placeholder={newIsFolder ? "文件夹名称" : "文档名称"}
            className="flex-1 h-6 px-1.5 rounded text-[10px] bg-paper border border-bamboo/30 outline-none text-ink placeholder:text-ink-faint/50"
            autoFocus
          />
          <button
            onClick={handleCreate}
            disabled={!newName.trim()}
            className="h-6 px-2 rounded text-[9px] font-medium text-cloud bg-bamboo/85 disabled:opacity-40 transition-colors cursor-pointer"
          >
            创建
          </button>
        </div>
      )}

      <div className="flex-1 overflow-y-auto py-1">
        {loading ? (
          <div className="text-[10px] text-ink-faint text-center py-6">加载中...</div>
        ) : documents.length === 0 ? (
          <div className="text-[10px] text-ink-faint text-center py-6">暂无文件</div>
        ) : (
          documents.map((node) => renderNode(node))
        )}
      </div>
    </div>
  );
}
