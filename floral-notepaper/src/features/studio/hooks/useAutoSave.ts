import { useEffect, useRef, useCallback } from 'react';
import { useStudioStore } from '../stores/useStudioStore';
import { supabase } from '../../auth/supabase';

export function useAutoSave(getContent: () => Record<string, unknown> | null) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { currentArticle, isDirty, setIsDirty, setIsSaving, setLastSavedAt } = useStudioStore();

  const save = useCallback(async () => {
    const content = getContent();
    if (!content) return;
    
    setIsSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      if (currentArticle?.id) {
        await supabase
          .from('garden_articles')
          .update({
            content: content,
            updated_at: new Date().toISOString(),
          })
          .eq('id', currentArticle.id);
      } else {
        const { data } = await supabase
          .from('garden_articles')
          .insert({
            user_id: user.id,
            title: '未命名作品',
            content: content,
            status: 'draft',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .select()
          .single();
          
        if (data) {
          useStudioStore.getState().setCurrentArticle(data as any);
        }
      }
      
      setIsDirty(false);
      setLastSavedAt(new Date().toISOString());
    } catch (err) {
      console.error('[AutoSave] 自动保存失败:', err);
    } finally {
      setIsSaving(false);
    }
  }, [getContent, currentArticle, setIsDirty, setIsSaving, setLastSavedAt]);

  const scheduleSave = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(save, 2000);
  }, [save]);

  // 内容变更时触发自动保存
  useEffect(() => {
    if (isDirty) {
      scheduleSave();
    }
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [isDirty, scheduleSave]);

  // 页面关闭前强制保存
  useEffect(() => {
    const handleBeforeUnload = () => {
      if (useStudioStore.getState().isDirty) {
        save();
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [save]);

  return { save };
}
