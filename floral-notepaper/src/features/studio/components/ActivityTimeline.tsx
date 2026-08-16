import { useStudioStore } from "../stores/useStudioStore";

interface ActivityTimelineProps {
  onClose: () => void;
}

const ACTION_LABELS: Record<string, string> = {
  edit: "编辑了内容",
  create_draft: "新建了草稿",
  collect_material: "收藏了素材",
  add_note: "添加了批注",
  export_segment: "导出了片段",
  publish: "发布了文章",
};

const ACTION_ICONS: Record<string, string> = {
  edit: "✎",
  create_draft: "📄",
  collect_material: "📥",
  add_note: "📝",
  export_segment: "📤",
  publish: "✅",
};

export function ActivityTimeline({ onClose }: ActivityTimelineProps) {
  const activityLog = useStudioStore(
    (s: { activityLog: import("../types").ActivityEntry[] }) => s.activityLog,
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/20 backdrop-blur-sm" />
      <div
        className="relative bg-paper rounded-2xl shadow-2xl border border-paper-deep/20 w-[420px] max-h-[500px] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-paper-deep/10">
          <div className="flex items-center gap-2">
            <span className="text-[18px]">⏱️</span>
            <span className="text-[14px] font-medium text-ink">创作轨迹</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-[18px] text-ink-ghost hover:text-ink-soft cursor-pointer"
          >
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {activityLog.length === 0 ? (
            <div className="py-8 text-center text-[12px] text-ink-ghost">还没有创作记录</div>
          ) : (
            <div className="relative">
              {/* Timeline line */}
              <div className="absolute left-[11px] top-2 bottom-2 w-[2px] bg-paper-deep/10" />

              <div className="space-y-3">
                {activityLog.map((entry: import("../types").ActivityEntry) => (
                  <div key={entry.id} className="flex gap-3">
                    <div className="w-6 h-6 flex items-center justify-center bg-paper-warm/60 rounded-full border-2 border-paper text-[11px] shrink-0 z-10">
                      {ACTION_ICONS[entry.actionType] || "📌"}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[12px] text-ink">
                        {ACTION_LABELS[entry.actionType] || entry.actionType}
                      </div>
                      <div className="text-[10px] text-ink-ghost mt-0.5">
                        {new Date(entry.createdAt).toLocaleString()}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
