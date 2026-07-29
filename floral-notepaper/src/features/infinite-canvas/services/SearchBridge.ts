import { supabase } from '../../auth/supabase';
import type { CanvasSearchResult } from '../types';

export async function searchKnowledge(query: string): Promise<CanvasSearchResult[]> {
  // Search garden_articles and external knowledge
  const { data } = await supabase
    .from('garden_articles')
    .select('id, title, summary')
    .ilike('title', `%${query}%`)
    .limit(10);
  
  return (data ?? []).map(item => ({
    id: item.id,
    title: item.title,
    summary: item.summary ?? '',
    source: 'supabase' as const,
  }));
}
