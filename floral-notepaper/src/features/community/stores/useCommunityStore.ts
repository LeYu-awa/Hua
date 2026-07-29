import { create } from "zustand";
import type { CommunityArticle, Category, SortMode, CommunityFilters } from "../types";
import {
  fetchCategories,
  fetchArticles,
  toggleLike,
  toggleBookmark,
  reportNotInterested,
  addToReadLater,
} from "../api";

interface CommunityState {
  /* 状态 */
  categories: Category[];
  articles: CommunityArticle[];
  filters: CommunityFilters;
  page: number;
  hasMore: boolean;
  isLoading: boolean;
  isLoadingMore: boolean;
  isRefreshing: boolean;
  selectedArticle: CommunityArticle | null;
  showDetail: boolean;

  /* 分类切换方向（用于动画） */
  categorySlideDir: "left" | "right";

  /* 长按菜单 */
  longPressArticle: CommunityArticle | null;
  longPressX: number;
  longPressY: number;

  /* 搜索 */
  searchQuery: string;
  showSearch: boolean;

  /* Actions */
  loadCategories: () => Promise<void>;
  setCategory: (id: string) => void;
  setSort: (sort: SortMode) => void;
  loadArticles: (reset?: boolean) => Promise<void>;
  loadMore: () => Promise<void>;
  refresh: () => Promise<void>;
  toggleLikeArticle: (id: string, liked: boolean) => Promise<void>;
  toggleBookmarkArticle: (id: string, bookmarked: boolean) => Promise<void>;
  markNotInterested: (id: string) => void;
  addToReadLater: (id: string) => void;
  openDetail: (article: CommunityArticle) => void;
  closeDetail: () => void;
  openLongPress: (article: CommunityArticle, x: number, y: number) => void;
  closeLongPress: () => void;
  setSearchQuery: (query: string) => void;
  setShowSearch: (show: boolean) => void;
}

export const useCommunityStore = create<CommunityState>((set, get) => ({
  categories: [],
  articles: [],
  filters: { categoryId: "all", sort: "recommend" },
  page: 1,
  hasMore: true,
  isLoading: true,
  isLoadingMore: false,
  isRefreshing: false,
  selectedArticle: null,
  showDetail: false,
  categorySlideDir: "left",
  longPressArticle: null,
  longPressX: 0,
  longPressY: 0,
  searchQuery: "",
  showSearch: false,

  /* ── 加载分类 ── */
  loadCategories: async () => {
    const categories = await fetchCategories();
    set({ categories });
  },

  /* ── 切换分类 ── */
  setCategory: (id: string) => {
    const { filters } = get();
    const currentId = filters.categoryId;
    const dir = id > currentId ? "right" : "left";

    // 更新分类时要重置文章列表
    const newFilters = { ...filters, categoryId: id };
    set({
      filters: newFilters,
      categorySlideDir: dir,
      articles: [],
      page: 1,
      hasMore: true,
      isLoading: true,
    });

    // 异步加载
    get().loadArticles(true);
  },

  /* ── 切换排序 ── */
  setSort: (sort: SortMode) => {
    const { filters } = get();
    const newFilters = { ...filters, sort };
    set({
      filters: newFilters,
      articles: [],
      page: 1,
      hasMore: true,
      isLoading: true,
    });
    get().loadArticles(true);
  },

  /* ── 加载文章列表 ── */
  loadArticles: async (reset = false) => {
    const { filters } = get();
    const page = 1;
    set({ page, isLoading: true, articles: [] });
    const { data, hasMore } = await fetchArticles(filters, page);
    set({ articles: data, hasMore, isLoading: false });
  },

  /* ── 加载更多（上滑分页） ── */
  loadMore: async () => {
    const { filters, page, hasMore, isLoadingMore, isLoading } = get();
    if (isLoadingMore || isLoading || !hasMore) return;

    const nextPage = page + 1;
    set({ isLoadingMore: true });
    const { data, hasMore: more } = await fetchArticles(filters, nextPage);
    set((state) => ({
      articles: [...state.articles, ...data],
      page: nextPage,
      hasMore: more,
      isLoadingMore: false,
    }));
  },

  /* ── 下拉刷新 ── */
  refresh: async () => {
    const { filters } = get();
    set({ isRefreshing: true, articles: [], page: 1, hasMore: true });
    const { data, hasMore } = await fetchArticles(filters, 1);
    set({ articles: data, hasMore, isRefreshing: false });
  },

  /* ── 点赞 ── */
  toggleLikeArticle: async (id: string, liked: boolean) => {
    // 乐观更新
    set((state) => ({
      articles: state.articles.map((a) =>
        a.id === id
          ? { ...a, isLiked: liked, likeCount: a.likeCount + (liked ? 1 : -1) }
          : a,
      ),
    }));
    await toggleLike(id, liked);
  },

  /* ── 收藏 ── */
  toggleBookmarkArticle: async (id: string, bookmarked: boolean) => {
    set((state) => ({
      articles: state.articles.map((a) =>
        a.id === id
          ? {
              ...a,
              isBookmarked: bookmarked,
              bookmarkCount: a.bookmarkCount + (bookmarked ? 1 : -1),
            }
          : a,
      ),
    }));
    await toggleBookmark(id, bookmarked);
  },

  /* ── 不感兴趣 ── */
  markNotInterested: (id: string) => {
    set((state) => ({
      articles: state.articles.filter((a) => a.id !== id),
      longPressArticle: null,
    }));
    reportNotInterested(id);
  },

  /* ── 稍后读 ── */
  addToReadLater: (id: string) => {
    set({ longPressArticle: null });
    addToReadLater(id);
  },

  /* ── 文章详情 ── */
  openDetail: (article: CommunityArticle) => {
    set({ selectedArticle: article, showDetail: true });
  },
  closeDetail: () => {
    set({ showDetail: false });
    // 延迟清除选中文章，让退出动画播放
    setTimeout(() => set({ selectedArticle: null }), 300);
  },

  /* ── 长按菜单 ── */
  openLongPress: (article: CommunityArticle, x: number, y: number) => {
    set({ longPressArticle: article, longPressX: x, longPressY: y });
  },
  closeLongPress: () => {
    set({ longPressArticle: null });
  },

  /* ── 搜索 ── */
  setSearchQuery: (query: string) => set({ searchQuery: query }),
  setShowSearch: (show: boolean) => set({ showSearch: show }),
}));
