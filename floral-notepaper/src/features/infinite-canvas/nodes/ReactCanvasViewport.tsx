import { useRef, useCallback, useState, type ReactNode } from 'react';
import type { CanvasNodeData, CanvasNodeType } from '../types';

const NODE_COLORS: Record<CanvasNodeType, string> = {
  search_card: '#f0f7ee',
  article: '#fef8e7',
  journal: '#f0edfe',
  workflow: '#e8f4fd',
  note: '#faf5f0',
};

const NODE_BORDERS: Record<CanvasNodeType, string> = {
  search_card: '#6a9a5b',
  article: '#d4a85c',
  journal: '#8b7fd3',
  workflow: '#5b9bd5',
  note: '#c0b0a0',
};

const NODE_ICONS: Record<CanvasNodeType, string> = {
  search_card: '🔍',
  article: '📄',
  journal: '✍️',
  workflow: '⚙️',
  note: '📝',
};

interface ReactCanvasViewportProps {
  nodes: CanvasNodeData[];
  selectedNodeId: string | null;
  onNodeSelect: (id: string | null) => void;
  onNodeMove: (id: string, x: number, y: number) => void;
  onNodeDelete: (id: string) => void;
  onCanvasClick?: () => void;
  children?: ReactNode;
}

export function ReactCanvasViewport({
  nodes,
  selectedNodeId,
  onNodeSelect,
  onNodeMove,
  onNodeDelete,
  onCanvasClick,
}: ReactCanvasViewportProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [panX, setPanX] = useState(0);
  const [panY, setPanY] = useState(0);
  const isPanning = useRef(false);
  const lastPointer = useRef({ x: 0, y: 0 });
  const dragState = useRef<{ nodeId: string; startX: number; startY: number; nodeOrigX: number; nodeOrigY: number } | null>(null);

  // Zoom via wheel
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    const newScale = Math.max(0.1, Math.min(5, scale * delta));
    // Zoom centered on mouse position
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    setPanX(prev => mx - (mx - prev) * (newScale / scale));
    setPanY(prev => my - (my - prev) * (newScale / scale));
    setScale(newScale);
  }, [scale]);

  // Pan via middle mouse / space+drag
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    // Middle mouse button or left button on background
    if (e.button === 1 || (e.button === 0 && (e.target as HTMLElement).dataset?.canvasBg === 'true')) {
      isPanning.current = true;
      lastPointer.current = { x: e.clientX, y: e.clientY };
      e.preventDefault();
    }
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (isPanning.current) {
      setPanX(prev => prev + (e.clientX - lastPointer.current.x) / scale);
      setPanY(prev => prev + (e.clientY - lastPointer.current.y) / scale);
      lastPointer.current = { x: e.clientX, y: e.clientY };
      return;
    }
    // Node drag
    if (dragState.current) {
      const dx = (e.clientX - dragState.current.startX) / scale;
      const dy = (e.clientY - dragState.current.startY) / scale;
      onNodeMove(dragState.current.nodeId, dragState.current.nodeOrigX + dx, dragState.current.nodeOrigY + dy);
    }
  }, [scale, onNodeMove]);

  const handleMouseUp = useCallback(() => {
    isPanning.current = false;
    if (dragState.current) {
      // Final position is already updated via onNodeMove
      dragState.current = null;
    }
  }, []);

  // Node drag start
  const handleNodeMouseDown = useCallback((e: React.MouseEvent, node: CanvasNodeData) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    onNodeSelect(node.id);
    dragState.current = {
      nodeId: node.id,
      startX: e.clientX,
      startY: e.clientY,
      nodeOrigX: node.x,
      nodeOrigY: node.y,
    };
  }, [onNodeSelect]);

  // Keyboard delete
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if ((e.key === 'Delete' || e.key === 'Backspace') && selectedNodeId) {
      onNodeDelete(selectedNodeId);
      onNodeSelect(null);
    }
    if (e.key === 'Escape') {
      onNodeSelect(null);
    }
  }, [selectedNodeId, onNodeDelete, onNodeSelect]);

  // Canvas click (deselect)
  const handleBgClick = useCallback(() => {
    onNodeSelect(null);
    onCanvasClick?.();
  }, [onNodeSelect, onCanvasClick]);

  return (
    <div
      ref={containerRef}
      className="flex-1 relative overflow-hidden bg-[#f5f0eb]"
      onWheel={handleWheel}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onKeyDown={handleKeyDown}
      tabIndex={0}
    >
      {/* Grid background */}
      <svg
        className="absolute inset-0 w-full h-full pointer-events-none"
        data-canvas-bg="true"
        onClick={handleBgClick}
      >
        <defs>
          <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse"
            patternTransform={`translate(${panX % (40 * scale)}, ${panY % (40 * scale)}) scale(${scale})`}
          >
            <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#d4cdc4" strokeWidth="0.5" opacity="0.4" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#grid)" />
      </svg>

      {/* Canvas content (zoom/pan container) */}
      <div
        className="absolute top-0 left-0"
        style={{
          transform: `translate(${panX}px, ${panY}px) scale(${scale})`,
          transformOrigin: '0 0',
        }}
      >
        {/* Nodes */}
        {nodes.map(node => {
          const isSelected = selectedNodeId === node.id;
          const icon = NODE_ICONS[node.type] || '📝';
          const bgColor = NODE_COLORS[node.type] || NODE_COLORS.note;
          const borderColor = NODE_BORDERS[node.type] || NODE_BORDERS.note;
          const w = Math.max(180, node.width || 180);
          const h = node.height || 120;

          return (
            <div
              key={node.id}
              className="absolute select-none"
              style={{
                left: node.x,
                top: node.y,
                width: w,
                height: h,
              }}
            >
              <div
                className="w-full h-full rounded-xl p-3 flex flex-col cursor-grab active:cursor-grabbing transition-shadow hover:shadow-md"
                style={{
                  backgroundColor: bgColor,
                  border: `${isSelected ? 2.5 : 1.5}px solid ${isSelected ? '#6a9a5b' : borderColor}`,
                  boxShadow: isSelected ? '0 0 0 3px rgba(106,154,91,0.2)' : '0 1px 3px rgba(0,0,0,0.06)',
                }}
                onMouseDown={(e) => handleNodeMouseDown(e, node)}
              >
                {/* Title */}
                <div style={{ fontSize: 13, fontWeight: 500, color: '#4a3a2a', marginBottom: 4 }}>
                  {icon} {node.title || '未命名'}
                </div>
                {/* Summary */}
                <div style={{ fontSize: 11, color: '#8a7a6a', lineHeight: 1.4, overflow: 'hidden' }}>
                  {node.summary || node.content?.slice(0, 80) || ''}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
