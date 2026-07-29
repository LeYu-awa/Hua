import { useState, useCallback } from 'react';
import { supabase } from '../../auth/supabase';
import type { CanvasNodeData, CanvasNodeType } from '../types';

export function useCanvasNodes(userId?: string | null) {
  const [nodes, setNodes] = useState<CanvasNodeData[]>([]);

  const addNode = useCallback(async (type: CanvasNodeType, title: string, x: number, y: number) => {
    const newNode: CanvasNodeData = {
      id: crypto.randomUUID(),
      type,
      x, y,
      width: 240,
      height: 160,
      zIndex: nodes.length,
      title,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      authorId: userId ?? undefined,
      canvasId: 'default',
    };
    setNodes(prev => [...prev, newNode]);
    
    if (userId) {
      await supabase.from('canvas_nodes').insert({
        id: newNode.id,
        user_id: userId,
        type: newNode.type,
        x: newNode.x, y: newNode.y,
        width: newNode.width, height: newNode.height,
        z_index: newNode.zIndex,
        title: newNode.title,
        canvas_id: 'default',
      });
    }
    return newNode;
  }, [nodes.length, userId]);

  const updateNodePosition = useCallback((nodeId: string, x: number, y: number) => {
    setNodes(prev => prev.map(n => n.id === nodeId ? { ...n, x, y, updatedAt: Date.now() } : n));
  }, []);

  const deleteNode = useCallback(async (nodeId: string) => {
    setNodes(prev => prev.filter(n => n.id !== nodeId));
    if (userId) {
      await supabase.from('canvas_nodes').delete().eq('id', nodeId);
    }
  }, [userId]);

  const loadNodes = useCallback(async () => {
    if (!userId) return;
    const { data } = await supabase
      .from('canvas_nodes')
      .select('*')
      .eq('canvas_id', 'default')
      .order('created_at', { ascending: true });
    
    if (data) {
      setNodes(data.map((n: Record<string, unknown>) => ({
        id: String(n.id),
        type: String(n.type) as CanvasNodeType,
        x: Number(n.x),
        y: Number(n.y),
        width: Number(n.width),
        height: Number(n.height),
        zIndex: Number(n.z_index),
        title: String(n.title),
        summary: String(n.summary ?? ''),
        content: String(n.content ?? ''),
        sourceUrl: String(n.source_url ?? ''),
        workflowId: String(n.workflow_id ?? ''),
        tags: (n.tags as string[]) ?? [],
        aiExpanded: Boolean(n.ai_expanded),
        createdAt: new Date(String(n.created_at)).getTime(),
        updatedAt: new Date(String(n.updated_at)).getTime(),
        authorId: String(n.user_id),
        canvasId: String(n.canvas_id),
      })));
    }
  }, [userId]);

  return { nodes, addNode, updateNodePosition, deleteNode, loadNodes, setNodes };
}
