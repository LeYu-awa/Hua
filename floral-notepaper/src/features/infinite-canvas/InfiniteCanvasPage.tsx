import { useEffect, useRef, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ReactCanvasViewport } from './nodes/ReactCanvasViewport';
import { useCanvasNodes } from './hooks/useCanvasNodes';
import { useCanvasSearch } from './hooks/useCanvasSearch';
import { aiExpandContent } from './services/JournalService';
import { WorkflowNodeEmbed } from './nodes/WorkflowNodeEmbed';
import type { CanvasSearchResult } from './types';
import './InfiniteCanvasPage.css';

interface InfiniteCanvasPageProps {
  userId?: string | null;
  canvasId?: string;
}

export function InfiniteCanvasPage({ userId }: InfiniteCanvasPageProps) {
  const { t } = useTranslation();
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [showJournal, setShowJournal] = useState(false);
  const [journalContent, setJournalContent] = useState('');
  const [aiExpanding, setAiExpanding] = useState(false);
  const [aiExpandedText, setAiExpandedText] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [workflowNodeId, setWorkflowNodeId] = useState<string | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const { nodes, addNode, updateNodePosition, deleteNode, loadNodes } = useCanvasNodes(userId);
  const { searchResults, searching, search, addSearchResultAsNode, setSearchResults } = useCanvasSearch(addNode);

  // Focus search input when panel opens
  useEffect(() => {
    if (showSearch && searchInputRef.current) {
      setTimeout(() => searchInputRef.current?.focus(), 50);
    }
  }, [showSearch]);

  // Load nodes from Supabase on mount
  useEffect(() => {
    loadNodes();
  }, [loadNodes]);

  // Selected node data
  const selectedNode = nodes.find(n => n.id === selectedNodeId) ?? null;

  // Handle search
  const handleSearch = useCallback(async () => {
    if (!searchQuery.trim()) return;
    await search(searchQuery.trim());
  }, [searchQuery, search]);

  // Add search result as node
  const handleAddResultAsNode = useCallback(async (result: CanvasSearchResult) => {
    await addSearchResultAsNode(result, 200 + Math.random() * 300, 200 + Math.random() * 200);
    setSearchResults([]);
    setShowSearch(false);
    setSearchQuery('');
  }, [addSearchResultAsNode, setSearchResults]);

  // Create journal node
  const handleSaveJournal = useCallback(async () => {
    if (!journalContent.trim()) return;
    await addNode('journal', journalContent.trim(), 300 + Math.random() * 200, 300 + Math.random() * 200);
    setJournalContent('');
    setShowJournal(false);
    setAiExpandedText(null);
  }, [journalContent, addNode]);

  // AI Expand journal content
  const handleAiExpand = useCallback(async () => {
    if (!journalContent.trim()) return;
    setAiExpanding(true);
    try {
      const expanded = await aiExpandContent(journalContent.trim());
      setAiExpandedText(expanded);
    } finally {
      setAiExpanding(false);
    }
  }, [journalContent]);

  // Create note at random position
  const handleAddNote = useCallback(async () => {
    await addNode('note', t('canvas.newNote', '新笔记'), 200 + Math.random() * 400, 200 + Math.random() * 400);
  }, [addNode, t]);

  // Create workflow node
  const handleAddWorkflow = useCallback(async () => {
    const node = await addNode('workflow', t('canvas.newWorkflow', '新工作流'), 300, 200);
    setWorkflowNodeId(node.id);
  }, [addNode, t]);

  // Open workflow editor for selected node
  const handleOpenWorkflow = useCallback(() => {
    if (!selectedNode || selectedNode.type !== 'workflow') return;
    setWorkflowNodeId(selectedNode.id);
  }, [selectedNode]);

  // Delete selected node
  const handleDeleteSelected = useCallback((id: string) => {
    deleteNode(id);
    setSelectedNodeId(null);
  }, [deleteNode]);

  return (
    <div className="flex-1 flex min-h-0 bg-paper relative overflow-hidden">
      {/* Canvas Viewport */}
      <ReactCanvasViewport
        nodes={nodes}
        selectedNodeId={selectedNodeId}
        onNodeSelect={setSelectedNodeId}
        onNodeMove={updateNodePosition}
        onNodeDelete={handleDeleteSelected}
      />

      {/* Toolbar */}
      <div className="absolute top-4 left-4 z-10 flex items-center gap-2 px-3 py-2 rounded-xl bg-paper/90 backdrop-blur-sm border border-paper-deep/20 shadow-sm">
        <button
          onClick={() => { setShowSearch(!showSearch); setShowJournal(false); }}
          className="px-3 py-1.5 text-[12px] text-ink-soft bg-paper-warm/60 hover:bg-paper-warm rounded-lg transition-colors cursor-pointer"
        >
          🔍 {t('canvas.search', '搜索知识')}
        </button>
        <button
          onClick={() => { setShowJournal(!showJournal); setShowSearch(false); }}
          className="px-3 py-1.5 text-[12px] text-ink-soft bg-paper-warm/60 hover:bg-paper-warm rounded-lg transition-colors cursor-pointer"
        >
          ✍️ {t('canvas.journal', '记录灵感')}
        </button>
        <button onClick={handleAddNote} className="px-3 py-1.5 text-[12px] text-ink-soft bg-paper-warm/60 hover:bg-paper-warm rounded-lg transition-colors cursor-pointer">
          + {t('canvas.addNote', '笔记')}
        </button>
        <div className="w-px h-5 bg-paper-deep/20" />
        <button onClick={handleAddWorkflow} className="px-3 py-1.5 text-[12px] text-bamboo bg-bamboo-mist/50 hover:bg-bamboo-mist rounded-lg transition-colors cursor-pointer">
          ⚙️ {t('canvas.workflow', '工作流')}
        </button>
      </div>

      {/* Search Panel */}
      {showSearch && (
        <div className="absolute top-16 left-4 z-20 w-[340px] rounded-xl bg-paper/95 backdrop-blur-sm border border-paper-deep/20 shadow-lg p-3">
          <div className="flex items-center gap-2">
            <input
              ref={searchInputRef}
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleSearch(); }}
              className="flex-1 px-3 py-1.5 text-[13px] bg-paper-warm/80 rounded-lg border border-paper-deep/20 outline-none focus:border-bamboo/50"
              placeholder={t('canvas.searchPlaceholder', '搜索知识点或文章...')}
            />
            <button onClick={handleSearch} disabled={searching} className="px-3 py-1.5 text-[12px] bg-bamboo text-cloud rounded-lg hover:bg-bamboo-light disabled:opacity-50 transition-colors cursor-pointer">
              {searching ? '...' : t('common.search', '搜索')}
            </button>
          </div>
          {searchResults.length > 0 && (
            <div className="mt-2 space-y-1 max-h-[280px] overflow-y-auto">
              <div className="text-[11px] text-ink-faint/60 px-1 mb-1">
                {t('canvas.searchResults', '搜索结果')} ({searchResults.length})
              </div>
              {searchResults.map(result => (
                <button
                  key={result.id}
                  onClick={() => handleAddResultAsNode(result)}
                  className="w-full text-left px-3 py-2 rounded-lg hover:bg-bamboo-mist/40 transition-colors cursor-pointer group"
                >
                  <div className="text-[13px] text-ink-soft group-hover:text-bamboo">{result.title}</div>
                  <div className="text-[11px] text-ink-ghost/70 line-clamp-1">{result.summary}</div>
                  <div className="text-[10px] text-ink-ghost/40 mt-0.5">📚 已有文章</div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Journal Panel */}
      {showJournal && (
        <div className="absolute top-16 left-4 z-20 w-[360px] rounded-xl bg-paper/95 backdrop-blur-sm border border-paper-deep/20 shadow-lg p-3">
          <div className="text-[13px] font-medium text-ink-soft mb-2">
            {t('canvas.recordInspiration', '记录灵感与心得')}
          </div>
          <textarea
            autoFocus
            value={journalContent}
            onChange={e => { setJournalContent(e.target.value); setAiExpandedText(null); }}
            rows={5}
            className="w-full px-3 py-2 text-[13px] bg-paper-warm/60 rounded-lg border border-paper-deep/20 outline-none focus:border-bamboo/50 resize-none"
            placeholder={t('canvas.journalPlaceholder', '记录你的灵感或心得...')}
          />
          {aiExpandedText && (
            <div className="mt-2 p-3 rounded-lg bg-bamboo-mist/30 border border-bamboo/20">
              <div className="text-[11px] font-medium text-bamboo mb-1">✨ AI 扩写</div>
              <div className="text-[12px] text-ink-soft leading-relaxed whitespace-pre-wrap">{aiExpandedText}</div>
            </div>
          )}
          <div className="flex items-center gap-2 mt-2">
            <button onClick={handleSaveJournal} disabled={!journalContent.trim()} className="flex-1 px-3 py-1.5 text-[12px] bg-bamboo text-cloud rounded-lg hover:bg-bamboo-light disabled:opacity-50 transition-colors cursor-pointer">
              {t('canvas.saveToCanvas', '保存到画布')}
            </button>
            <button onClick={handleAiExpand} disabled={!journalContent.trim() || aiExpanding} className="px-3 py-1.5 text-[12px] text-bamboo border border-bamboo/30 rounded-lg hover:bg-bamboo-mist/50 disabled:opacity-50 transition-colors cursor-pointer">
              {aiExpanding ? '...' : '✨ ' + t('canvas.aiExpand', 'AI扩写')}
            </button>
          </div>
        </div>
      )}

      {/* Selected node info + actions */}
      {selectedNode && (
        <div className="absolute top-4 right-4 z-10 flex items-center gap-2 px-3 py-2 rounded-xl bg-paper/90 backdrop-blur-sm border border-paper-deep/20 shadow-sm">
          <span className="text-[12px] text-ink-ghost/80 max-w-[160px] truncate">
            {selectedNode.title || selectedNode.id.slice(0, 8)}
          </span>
          <div className="w-px h-4 bg-paper-deep/20" />
          {selectedNode.type === 'workflow' && (
            <button onClick={handleOpenWorkflow} className="px-2 py-1 text-[11px] text-bamboo hover:bg-bamboo-mist/40 rounded transition-colors cursor-pointer">
              ⚙️ {t('canvas.openWorkflow', '打开工作流')}
            </button>
          )}
          <button onClick={() => setSelectedNodeId(null)} className="px-2 py-1 text-[11px] text-ink-ghost hover:text-ink-soft rounded transition-colors cursor-pointer">
            {t('common.deselect', '取消')}
          </button>
          <button onClick={() => handleDeleteSelected(selectedNode.id)} className="px-2 py-1 text-[11px] text-red-400 hover:bg-red-50 rounded transition-colors cursor-pointer">
            {t('common.delete', '删除')}
          </button>
        </div>
      )}

      {/* Bottom status bar */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 px-4 py-1.5 rounded-full bg-paper/80 backdrop-blur-sm border border-paper-deep/10 text-[11px] text-ink-ghost/60 flex items-center gap-4">
        <span>{nodes.length} {t('canvas.nodes', '个节点')}</span>
        <span>·</span>
        <span>{t('canvas.dragHint', '拖拽移动 · 滚轮缩放 · 右键平移')}</span>
        <span>·</span>
        <span>{t('canvas.deleteHint', 'Delete 删除选中')}</span>
      </div>

      {/* Workflow Node Embed */}
      {workflowNodeId && (
        <WorkflowNodeEmbed nodeId={workflowNodeId} onClose={() => setWorkflowNodeId(null)} />
      )}
    </div>
  );
}
