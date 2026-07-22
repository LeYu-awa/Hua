import { create } from 'zustand';
import type { GardenArticle } from '../../garden/types';
import type { 
  EditorMeta, InspirationDraft, 
  CollectedMaterial, CreationNote, ActivityEntry, KanbanColumn 
} from '../types';

interface StudioState {
  // 编辑器状态
  currentArticle: GardenArticle | null;
  editorMeta: EditorMeta;
  isDirty: boolean;
  isSaving: boolean;
  lastSavedAt: string | null;
  
  // 文章列表
  articles: GardenArticle[];
  filteredArticles: GardenArticle[];
  articleSearchQuery: string;
  
  // 创作管理
  activityLog: ActivityEntry[];
  inspirationDrafts: InspirationDraft[];
  collectedMaterials: CollectedMaterial[];
  creationNotes: CreationNote[];
  
  // 看板
  kanbanColumns: KanbanColumn[];
  kanbanView: boolean;
  
  // 分享
  showSharePanel: boolean;
  complianceResult: null | { passed: boolean; issues: unknown[] };
  
  // Actions
  setCurrentArticle: (article: GardenArticle | null) => void;
  setEditorMeta: (meta: Partial<EditorMeta>) => void;
  setIsDirty: (dirty: boolean) => void;
  setIsSaving: (saving: boolean) => void;
  setLastSavedAt: (time: string) => void;
  setArticles: (articles: GardenArticle[]) => void;
  setArticleSearchQuery: (query: string) => void;
  setActivityLog: (log: ActivityEntry[]) => void;
  addActivityEntry: (entry: ActivityEntry) => void;
  setInspirationDrafts: (drafts: InspirationDraft[]) => void;
  addInspirationDraft: (draft: InspirationDraft) => void;
  setCollectedMaterials: (materials: CollectedMaterial[]) => void;
  addCollectedMaterial: (material: CollectedMaterial) => void;
  setCreationNotes: (notes: CreationNote[]) => void;
  addCreationNote: (note: CreationNote) => void;
  setKanbanView: (view: boolean) => void;
  updateKanbanColumns: () => void;
  setShowSharePanel: (show: boolean) => void;
  setComplianceResult: (result: null | { passed: boolean; issues: unknown[] }) => void;
}

const STORE_INITIAL_COLUMNS: KanbanColumn[] = [
  { id: 'draft', title: '待创作', icon: '📝', articles: [] },
  { id: 'editing', title: '创作中', icon: '✏️', articles: [] },
  { id: 'reviewing', title: '待审核', icon: '🔍', articles: [] },
  { id: 'published', title: '已发布', icon: '✅', articles: [] },
];

export const useStudioStore = create<StudioState>((set, get: () => StudioState) => ({
  currentArticle: null,
  editorMeta: {
    title: '',
    tags: [],
    status: 'draft',
  },
  isDirty: false,
  isSaving: false,
  lastSavedAt: null,
  
  articles: [],
  filteredArticles: [],
  articleSearchQuery: '',
  
  activityLog: [],
  inspirationDrafts: [],
  collectedMaterials: [],
  creationNotes: [],
  
  kanbanColumns: [...STORE_INITIAL_COLUMNS],
  kanbanView: false,
  
  showSharePanel: false,
  complianceResult: null,
  
  setCurrentArticle: (article: GardenArticle | null) => set({ 
    currentArticle: article,
    editorMeta: article ? {
      id: article.id,
      title: article.title,
      summary: article.summary,
      coverUrl: article.coverImage,
      tags: article.tags ?? [],
      status: 'draft' as const,
      createdAt: String(article.createdAt),
      updatedAt: String(article.updatedAt),
    } : { title: '', tags: [], status: 'draft' },
  }),
  
  setEditorMeta: (meta: Partial<EditorMeta>) => set((state: StudioState) => ({ 
    editorMeta: { ...state.editorMeta, ...meta } 
  })),
  
  setIsDirty: (dirty: boolean) => set({ isDirty: dirty }),
  setIsSaving: (saving: boolean) => set({ isSaving: saving }),
  setLastSavedAt: (time: string) => set({ lastSavedAt: time }),
  setArticles: (articles: GardenArticle[]) => set({ 
    articles, 
    filteredArticles: articles,
    kanbanColumns: (() => {
      const cols = get().kanbanColumns;
      return cols.map((col: KanbanColumn) => ({
        ...col,
        articles: articles.slice(0, 5),
      }));
    })(),
  }),
  setArticleSearchQuery: (query: string) => set((state: StudioState) => ({
    articleSearchQuery: query,
    filteredArticles: query 
      ? state.articles.filter((a: GardenArticle) => 
          a.title?.toLowerCase().includes(query.toLowerCase())
        )
      : state.articles,
  })),
  setActivityLog: (log: ActivityEntry[]) => set({ activityLog: log }),
  addActivityEntry: (entry: ActivityEntry) => set((state: StudioState) => ({ 
    activityLog: [entry, ...state.activityLog] 
  })),
  setInspirationDrafts: (drafts: InspirationDraft[]) => set({ inspirationDrafts: drafts }),
  addInspirationDraft: (draft: InspirationDraft) => set((state: StudioState) => ({ 
    inspirationDrafts: [draft, ...state.inspirationDrafts] 
  })),
  setCollectedMaterials: (materials: CollectedMaterial[]) => set({ collectedMaterials: materials }),
  addCollectedMaterial: (material: CollectedMaterial) => set((state: StudioState) => ({ 
    collectedMaterials: [material, ...state.collectedMaterials] 
  })),
  setCreationNotes: (notes: CreationNote[]) => set({ creationNotes: notes }),
  addCreationNote: (note: CreationNote) => set((state: StudioState) => ({ 
    creationNotes: [note, ...state.creationNotes] 
  })),
  setKanbanView: (view: boolean) => set({ kanbanView: view }),
  updateKanbanColumns: () => set((state: StudioState) => ({
    kanbanColumns: state.kanbanColumns.map((col: KanbanColumn) => ({
      ...col,
      articles: state.articles.slice(0, 5),
    })),
  })),
  setShowSharePanel: (show: boolean) => set({ showSharePanel: show }),
  setComplianceResult: (result: null | { passed: boolean; issues: unknown[] }) => set({ complianceResult: result }),
}));
