import { useState, useCallback } from 'react';
import { useStudioStore } from '../stores/useStudioStore';
import { supabase } from '../../auth/supabase';

interface InspirationCollectorProps {
  onClose: () => void;
  onInsertToEditor: (content: string) => void;
}

export function InspirationCollector({ onClose, onInsertToEditor }: InspirationCollectorProps) {
  const [quickNote, setQuickNote] = useState('');
  const inspirationDrafts = useStudioStore((s: { inspirationDrafts: import('../types').InspirationDraft[] }) => s.inspirationDrafts);
  const addInspirationDraft = useStudioStore((s: { addInspirationDraft: (draft: import('../types').InspirationDraft) => void }) => s.addInspirationDraft);

  const handleSave = useCallback(async () => {
    if (!quickNote.trim()) return;
    
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const draft = {
      id: crypto.randomUUID(),
      userId: user.id,
      content: quickNote.trim(),
      source: 'quick_note' as const,
      isTask: false,
      createdAt: new Date().toISOString(),
    };

    addInspirationDraft(draft);
    setQuickNote('');

    try {
      await supabase.from('inspiration_drafts').insert({
        id: draft.id,
        user_id: user.id,
        content: draft.content,
        source: 'quick_note',
      });
    } catch (err) {
      console.error('[Inspiration] 保存失败:', err);
    }
  }, [quickNote, addInspirationDraft]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/20 backdrop-blur-sm" />
      <div className="relative bg-paper rounded-2xl shadow-2xl border border-paper-deep/20 w-[480px] max-h-[600px] flex flex-col" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-paper-deep/10">
          <div className="flex items-center gap-2">
            <span className="text-[18px]">💡</span>
            <span className="text-[14px] font-medium text-ink">灵感收集箱</span>
          </div>
          <button type="button" onClick={onClose} className="text-[18px] text-ink-ghost hover:text-ink-soft cursor-pointer">✕</button>
        </div>

        {/* Quick note input */}
        <div className="p-4 border-b border-paper-deep/10">
          <textarea
            value={quickNote}
            onChange={e => setQuickNote(e.target.value)}
            placeholder="快速记录灵感... (Ctrl+Enter 保存)"
            className="w-full h-[80px] px-3 py-2 text-[12px] bg-paper-warm/40 border border-paper-deep/10 rounded-lg resize-none focus:outline-none focus:border-bamboo/40"
            onKeyDown={e => { if (e.ctrlKey && e.key === 'Enter') { e.preventDefault(); handleSave(); } }}
          />
          <div className="flex justify-end mt-2">
            <button
              type="button"
              onClick={handleSave}
              disabled={!quickNote.trim()}
              className="px-4 py-1.5 text-[12px] bg-bamboo text-cloud rounded-lg hover:bg-bamboo-light disabled:opacity-40 transition-colors cursor-pointer"
            >
              保存灵感
            </button>
          </div>
        </div>

        {/* Draft list */}
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {inspirationDrafts.length === 0 ? (
            <div className="py-8 text-center text-[12px] text-ink-ghost">还没有灵感记录</div>
          ) : (
            inspirationDrafts.map((draft: import('../types').InspirationDraft) => (
              <div key={draft.id} className="bg-paper-warm/30 rounded-lg p-3 border border-paper-deep/10 group">
                <div className="text-[12px] text-ink leading-relaxed">{draft.content}</div>
                <div className="flex items-center justify-between mt-2">
                  <span className="text-[10px] text-ink-ghost">
                    {new Date(draft.createdAt).toLocaleString()}
                  </span>
                  <button
                    type="button"
                    onClick={() => { onInsertToEditor(draft.content); onClose(); }}
                    className="text-[10px] text-bamboo hover:underline opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                  >
                    插入编辑器
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
