export type CanvasNodeType = 'search_card' | 'article' | 'journal' | 'workflow' | 'note';

export interface CanvasNodeData {
  id: string;
  type: CanvasNodeType;
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
  title: string;
  summary?: string;
  content?: string;
  createdAt: number;
  updatedAt: number;
  authorId?: string;
  sourceUrl?: string;
  workflowId?: string;
  tags?: string[];
  aiExpanded?: boolean;
  metadata?: Record<string, unknown>;
  canvasId?: string;
}

export interface CanvasSearchResult {
  id: string;
  title: string;
  summary: string;
  url?: string;
  source: 'supabase' | 'ai' | 'external';
}

export interface JournalEntry {
  id: string;
  content: string;
  aiExpanded?: string;
  createdAt: number;
  isPublished: boolean;
  articleId?: string;
}
