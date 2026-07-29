import { useCallback, useRef, useState } from 'react';

export function useCanvasInteraction() {
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const isDragging = useRef(false);
  const dragStart = useRef({ x: 0, y: 0 });

  const handleWheel = useCallback((e: React.WheelEvent) => {
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    setScale(prev => Math.max(0.1, Math.min(5, prev * delta)));
  }, []);

  const handlePanStart = useCallback((e: React.MouseEvent) => {
    if (e.button === 1 || (e.button === 0 && !selectedNodeId)) {
      isDragging.current = true;
      dragStart.current = { x: e.clientX - offset.x, y: e.clientY - offset.y };
    }
  }, [offset.x, offset.y, selectedNodeId]);

  const handlePanMove = useCallback((e: React.MouseEvent) => {
    if (!isDragging.current) return;
    setOffset({ x: e.clientX - dragStart.current.x, y: e.clientY - dragStart.current.y });
  }, []);

  const handlePanEnd = useCallback(() => {
    isDragging.current = false;
  }, []);

  return {
    scale, offset, selectedNodeId,
    setSelectedNodeId, setScale, setOffset,
    handleWheel, handlePanStart, handlePanMove, handlePanEnd,
  };
}
