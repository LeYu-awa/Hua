// ============================================
// 协作文档类型定义
// ============================================

/** 协作文档 */
export interface CollabDocument {
  id: string;
  conversation_id: string;
  title: string;
  parent_id: string | null;
  is_folder: boolean;
  created_by: string;
  updated_by: string;
  created_at: string;
  updated_at: string;
}

/** 文件树节点 */
export interface FileTreeNode {
  id: string;
  title: string;
  is_folder: boolean;
  children: FileTreeNode[];
  parent_id: string | null;
  created_by: string;
  updated_by: string;
  updated_at: string;
}
