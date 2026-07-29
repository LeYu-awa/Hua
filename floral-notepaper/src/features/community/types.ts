/* ── 社区文章类型 ── */

export interface CommunityArticle {
  id: string;
  title: string;
  summary: string;
  content: string;          // 完整 Markdown / 富文本内容
  coverImage?: string;      // 可选封面图 URL
  coverRatio?: '1:1' | '3:4' | '16:9';
  categoryId: string;
  tags: string[];
  author: AuthorBrief;
  viewCount: number;
  likeCount: number;
  commentCount: number;
  bookmarkCount: number;
  shareCount: number;
  readTime: number;          // 阅读时长（分钟）
  isLiked: boolean;
  isBookmarked: boolean;
  createdAt: string;         // ISO 8601
  updatedAt: string;
}

export interface AuthorBrief {
  id: string;
  name: string;
  avatarUrl: string;
}

export interface Category {
  id: string;
  name: string;
  icon: string;              // emoji
  color: string;             // hex 色值
}

export type SortMode = 'recommend' | 'latest' | 'hot';

export interface CommunityFilters {
  categoryId: string | null; // null = 全部
  sort: SortMode;
}

/* ── 长按菜单操作 ── */
export type LongPressAction = 'readLater' | 'notInterested';

/* ── 底部 Tab ── */
export type BottomTab = 'home' | 'category' | 'write' | 'notifications' | 'profile';

/* ── 分页状态 ── */
export interface PaginationState {
  page: number;
  pageSize: number;
  hasMore: boolean;
  isLoading: boolean;
  isLoadingMore: boolean;
  isRefreshing: boolean;
}
