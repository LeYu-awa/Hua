// ============================================
// 协作文档 API
// ============================================

import { supabase } from "../auth/supabase";
import type { CollabDocument, FileTreeNode } from "./types";

async function getCurrentUserId(): Promise<string> {
  const { data } = await supabase.auth.getUser();
  if (!data.user?.id) throw new Error("未登录");
  return data.user.id;
}

/** 获取会话的文件树 */
export async function getDocumentTree(conversationId: string): Promise<FileTreeNode[]> {
  const { data, error } = await supabase
    .from("collab_documents")
    .select("*")
    .eq("conversation_id", conversationId)
    .order("is_folder", { ascending: false })
    .order("title", { ascending: true });

  if (error) throw new Error(error.message);

  return buildTree(data as CollabDocument[]);
}

/** 将扁平列表构建为树结构 */
function buildTree(docs: CollabDocument[]): FileTreeNode[] {
  const map = new Map<string, FileTreeNode>();
  const roots: FileTreeNode[] = [];

  for (const doc of docs) {
    map.set(doc.id, { ...doc, children: [] });
  }

  for (const node of map.values()) {
    if (node.parent_id && map.has(node.parent_id)) {
      map.get(node.parent_id)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  return roots;
}

/** 创建文档或文件夹 */
export async function createDocument(params: {
  conversation_id: string;
  title: string;
  parent_id?: string | null;
  is_folder?: boolean;
}): Promise<CollabDocument> {
  const userId = await getCurrentUserId();

  const { data, error } = await supabase
    .from("collab_documents")
    .insert({
      conversation_id: params.conversation_id,
      title: params.title,
      parent_id: params.parent_id ?? null,
      is_folder: params.is_folder ?? false,
      created_by: userId,
      updated_by: userId,
    })
    .select()
    .single();

  if (error) throw new Error(error.message);
  return data;
}

/** 获取文档内容 */
export async function getDocumentContent(
  documentId: string,
): Promise<{ title: string; content: string } | null> {
  // 文档内容暂存在 notes_sync 中（与笔记系统共用）
  // 后续 Yjs 集成后再使用独立存储
  const { data, error } = await supabase
    .from("collab_documents")
    .select("title")
    .eq("id", documentId)
    .single();

  if (error) return null;
  if (!data) return null;

  // 从 notes_sync 读取内容（临时方案）
  const { data: note } = await supabase
    .from("notes_sync")
    .select("content")
    .eq("id", documentId)
    .single();

  return {
    title: data.title,
    content: note?.content ?? "",
  };
}

/** 保存文档内容 */
export async function saveDocumentContent(documentId: string, content: string): Promise<void> {
  const userId = await getCurrentUserId();

  // 更新 collab_documents
  await supabase
    .from("collab_documents")
    .update({ updated_by: userId, updated_at: new Date().toISOString() })
    .eq("id", documentId);

  // 写入 notes_sync（临时方案）
  const { error } = await supabase.from("notes_sync").upsert(
    {
      id: documentId,
      user_id: userId,
      title: "",
      content,
      file_name: "",
    },
    { onConflict: "id,user_id" },
  );

  if (error) throw new Error(error.message);
}

/** 重命名文档/文件夹 */
export async function renameDocument(documentId: string, title: string): Promise<void> {
  const userId = await getCurrentUserId();

  const { error } = await supabase
    .from("collab_documents")
    .update({ title, updated_by: userId, updated_at: new Date().toISOString() })
    .eq("id", documentId);

  if (error) throw new Error(error.message);
}

/** 删除文档/文件夹 */
export async function deleteDocument(documentId: string): Promise<void> {
  const { error } = await supabase.from("collab_documents").delete().eq("id", documentId);

  if (error) throw new Error(error.message);
}
