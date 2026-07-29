import { useState, useCallback, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { LiteGraphWorkflow } from '../../../components/workflow/LiteGraphWorkflow';
import type { WorkflowDocument } from '../../workflow/types';

interface WorkflowNodeEmbedProps {
  nodeId: string;
  workflowId?: string;
  onClose: () => void;
}

export function WorkflowNodeEmbed({ nodeId, workflowId, onClose }: WorkflowNodeEmbedProps) {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [workflowDoc, setWorkflowDoc] = useState<WorkflowDocument | undefined>(undefined);

  // Sync workflow doc changes from LiteGraphWorkflow
  const handleWorkflowChange = useCallback((doc: WorkflowDocument) => {
    setWorkflowDoc(doc);
  }, []);

  const handleRun = useCallback(() => {
    setIsRunning(true);
    setTimeout(() => setIsRunning(false), 2000);
  }, []);

  // Prevent body scroll when modal is open
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center" onClick={onClose}>
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" />

      {/* Modal */}
      <div
        ref={containerRef}
        className="relative w-[90vw] h-[85vh] max-w-[1200px] max-h-[900px] bg-paper rounded-2xl shadow-2xl border border-paper-deep/20 flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-paper-deep/10 shrink-0">
          <div className="flex items-center gap-2.5">
            <span className="w-8 h-8 flex items-center justify-center rounded-lg bg-bamboo-mist/50 text-[16px]">⚙️</span>
            <span className="text-[15px] font-medium text-ink-soft">
              {t('canvas.workflowEditor', '工作流编辑器')}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleRun}
              disabled={isRunning}
              className="px-4 py-1.5 text-[12px] bg-bamboo text-cloud rounded-lg hover:bg-bamboo-light disabled:opacity-50 transition-colors cursor-pointer"
            >
              {isRunning ? '⏳ ' + t('common.running', '运行中') : '▶ ' + t('common.run', '运行')}
            </button>
            <button
              onClick={onClose}
              className="px-3 py-1.5 text-[12px] text-ink-ghost hover:text-ink-soft hover:bg-paper-warm/60 rounded-lg transition-colors cursor-pointer"
            >
              ✕ {t('common.close', '关闭')}
            </button>
          </div>
        </div>

        {/* LiteGraph Workflow - takes remaining space */}
        <div className="flex-1 min-h-0">
          <LiteGraphWorkflow
            workflow={workflowDoc}
            documentId={`canvas-workflow-${workflowId || nodeId}`}
            onChange={handleWorkflowChange}
          />
        </div>
      </div>
    </div>
  );
}
