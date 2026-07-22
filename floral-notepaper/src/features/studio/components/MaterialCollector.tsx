import { useState, useCallback } from 'react';
import { useStudioStore } from '../stores/useStudioStore';
import { parseUrlMaterial } from '../services/materialParser';
import { supabase } from '../../auth/supabase';

interface MaterialCollectorProps {
  onClose: () => void;
}

export function MaterialCollector({ onClose }: MaterialCollectorProps) {
  const [url, setUrl] = useState('');
  const [parsing, setParsing] = useState(false);
  const [parsedMaterial, setParsedMaterial] = useState<{ title: string; summary?: string; coverUrl?: string; sourceUrl?: string } | null>(null);
  const collectedMaterials = useStudioStore((s: { collectedMaterials: import('../types').CollectedMaterial[] }) => s.collectedMaterials);
  const addCollectedMaterial = useStudioStore((s: { addCollectedMaterial: (m: import('../types').CollectedMaterial) => void }) => s.addCollectedMaterial);

  const handleParse = useCallback(async () => {
    if (!url.trim()) return;
    setParsing(true);
    try {
      const result = await parseUrlMaterial(url);
      setParsedMaterial(result);
    } catch {
      setParsedMaterial({ title: url, sourceUrl: url });
    } finally {
      setParsing(false);
    }
  }, [url]);

  const handleSave = useCallback(async () => {
    if (!parsedMaterial) return;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const material = {
      id: crypto.randomUUID(),
      userId: user.id,
      title: parsedMaterial.title,
      summary: parsedMaterial.summary,
      coverUrl: parsedMaterial.coverUrl,
      sourceUrl: url,
      sourceType: 'web' as const,
      createdAt: new Date().toISOString(),
    };

    addCollectedMaterial(material);
    setUrl('');
    setParsedMaterial(null);

    try {
      await supabase.from('collected_materials').insert({
        id: material.id,
        user_id: user.id,
        title: material.title,
        summary: material.summary,
        cover_url: material.coverUrl,
        source_url: material.sourceUrl,
        source_type: 'web',
      });
    } catch (err) {
      console.error('[Material] 保存失败:', err);
    }
  }, [parsedMaterial, url, addCollectedMaterial]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/20 backdrop-blur-sm" />
      <div className="relative bg-paper rounded-2xl shadow-2xl border border-paper-deep/20 w-[520px] max-h-[600px] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-paper-deep/10">
          <div className="flex items-center gap-2">
            <span className="text-[18px]">📥</span>
            <span className="text-[14px] font-medium text-ink">素材收集箱</span>
          </div>
          <button type="button" onClick={onClose} className="text-[18px] text-ink-ghost hover:text-ink-soft cursor-pointer">✕</button>
        </div>

        {/* URL input */}
        <div className="p-4 border-b border-paper-deep/10">
          <div className="flex gap-2">
            <input
              value={url}
              onChange={e => setUrl(e.target.value)}
              placeholder="粘贴微信/浏览器链接..."
              className="flex-1 px-3 py-1.5 text-[12px] bg-paper-warm/40 border border-paper-deep/10 rounded-lg focus:outline-none focus:border-bamboo/40"
            />
            <button
              type="button"
              onClick={handleParse}
              disabled={!url.trim() || parsing}
              className="px-3 py-1.5 text-[12px] bg-bamboo text-cloud rounded-lg hover:bg-bamboo-light disabled:opacity-40 transition-colors cursor-pointer"
            >
              {parsing ? '解析中...' : '解析'}
            </button>
          </div>

          {parsedMaterial && (
            <div className="mt-3 flex gap-3 p-3 bg-paper-warm/40 rounded-lg border border-paper-deep/10">
              {parsedMaterial.coverUrl && (
                <img src={parsedMaterial.coverUrl} alt="" className="w-16 h-16 object-cover rounded-lg" />
              )}
              <div className="flex-1 min-w-0">
                <div className="text-[12px] font-medium text-ink truncate">{parsedMaterial.title}</div>
                {parsedMaterial.summary && (
                  <div className="text-[11px] text-ink-ghost mt-1 line-clamp-2">{parsedMaterial.summary}</div>
                )}
                <button
                  type="button"
                  onClick={handleSave}
                  className="mt-2 text-[11px] text-bamboo hover:underline cursor-pointer"
                >
                  + 收藏素材
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Material list */}
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {collectedMaterials.length === 0 ? (
            <div className="py-8 text-center text-[12px] text-ink-ghost">还没有收藏的素材</div>
          ) : (
            collectedMaterials.map((m: import('../types').CollectedMaterial) => (
              <div key={m.id} className="flex gap-3 p-3 bg-paper-warm/30 rounded-lg border border-paper-deep/10">
                {m.coverUrl && <img src={m.coverUrl} alt="" className="w-12 h-12 object-cover rounded-lg shrink-0" />}
                <div className="flex-1 min-w-0">
                  <div className="text-[12px] font-medium text-ink truncate">{m.title || m.sourceUrl}</div>
                  {m.summary && <div className="text-[11px] text-ink-ghost mt-0.5 line-clamp-1">{m.summary}</div>}
                  <div className="text-[10px] text-ink-ghost mt-1">
                    来源: {m.sourceType} · {new Date(m.createdAt).toLocaleDateString()}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
