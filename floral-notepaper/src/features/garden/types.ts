export interface Category {
  id: string;
  name: string;
  icon?: string;
  color?: string;
  userId: string;
  parentId?: string;
  articleCount: number;
  createdAt: number;
}

export interface GardenArticle {
  id: string;
  title: string;
  summary: string;
  content: string;
  categoryId: string;
  tags: string[];
  authorId: string;
  isPublic: boolean;
  coverImage?: string;
  viewCount: number;
  likeCount: number;
  createdAt: number;
  updatedAt: number;
}

export interface GardenFolder {
  id: string;
  name: string;
  userId: string;
  parentId?: string;
  articleIds: string[];
  type: 'folder' | 'project';
  createdAt: number;
  updatedAt: number;
}
