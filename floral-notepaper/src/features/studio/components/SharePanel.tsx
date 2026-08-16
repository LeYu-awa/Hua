import { useState, useCallback } from "react";
import { useStudioStore } from "../stores/useStudioStore";
import { useShare } from "../hooks/useShare";
import type { ExportFormat } from "../types";

interface SharePanelProps {
  blocks: unknown[];
  imageUrls: string[];
  getTextContent: () => string;
  activityLogText?: string;
  notesText?: string;
  onClose: () => void;
}

export function SharePanel({
  blocks,
  imageUrls,
  getTextContent,
  activityLogText,
  notesText,
  onClose,
}: SharePanelProps) {
  const { complianceResult } = useStudioStore();
  const { previewXiaohongshu, runCompliance, exportTo, copied } = useShare();
  const [preview, setPreview] = useState("");
  const [showPreview, setShowPreview] = useState(false);
  const [exportFormat, setExportFormat] = useState<ExportFormat>("xiaohongshu");

  const handlePreview = useCallback(() => {
    const text = previewXiaohongshu(blocks, imageUrls);
    setPreview(text);
    setShowPreview(true);
  }, [blocks, imageUrls, previewXiaohongshu]);

  const handleCompliance = useCallback(() => {
    const text = getTextContent();
    const result = runCompliance(text, imageUrls.length);
    if (result.passed) {
      handlePreview();
    }
  }, [getTextContent, imageUrls.length, runCompliance, handlePreview]);

  const handleExport = useCallback(() => {
    const text = getTextContent();
    exportTo(exportFormat, text, activityLogText, notesText);
  }, [getTextContent, exportFormat, exportTo, activityLogText, notesText]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/20 backdrop-blur-sm" />
      <div
        className="relative bg-paper rounded-2xl shadow-2xl border border-paper-deep/20 w-[500px] max-h-[600px] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-paper-deep/10">
          <div className="flex items-center gap-2">
            <span className="text-[18px]">📤</span>
            <span className="text-[14px] font-medium text-ink">分享与发布</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-[18px] text-ink-ghost hover:text-ink-soft cursor-pointer"
          >
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* 格式选择 */}
          <div>
            <div className="text-[12px] font-medium text-ink mb-2">导出格式</div>
            <div className="flex gap-2">
              {[
                { value: "xiaohongshu" as const, label: "小红书图文", icon: "📕" },
                { value: "notion_markdown" as const, label: "Notion Markdown", icon: "📄" },
              ].map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setExportFormat(opt.value)}
                  className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-[12px] rounded-lg border transition-colors cursor-pointer ${
                    exportFormat === opt.value
                      ? "border-bamboo bg-bamboo-mist/20 text-bamboo"
                      : "border-paper-deep/20 text-ink-ghost hover:border-bamboo/40"
                  }`}
                >
                  <span>{opt.icon}</span>
                  <span>{opt.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* 合规预检 */}
          {exportFormat === "xiaohongshu" && (
            <div>
              <div className="text-[12px] font-medium text-ink mb-2">合规预检</div>
              <button
                type="button"
                onClick={handleCompliance}
                className="w-full px-3 py-2 text-[12px] bg-amber-50 text-amber-700 rounded-lg border border-amber-200 hover:bg-amber-100 transition-colors cursor-pointer"
              >
                🔍 运行发布前检查
              </button>

              {complianceResult && (
                <div className="mt-2 space-y-1">
                  {complianceResult.passed ? (
                    <div className="text-[12px] text-green-600 flex items-center gap-1">
                      ✅ 所有检查通过
                    </div>
                  ) : (
                    (complianceResult.issues as any[]).map((issue: any, i: number) => (
                      <div
                        key={i}
                        className={`text-[11px] flex items-center gap-1 ${
                          issue.severity === "error" ? "text-red-500" : "text-amber-600"
                        }`}
                      >
                        {issue.severity === "error" ? "❌" : "⚠️"} {issue.message}
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          )}

          {/* 预览 */}
          {showPreview && (
            <div>
              <div className="text-[12px] font-medium text-ink mb-2">预览</div>
              <div className="bg-paper-warm/40 rounded-lg p-3 text-[12px] text-ink whitespace-pre-wrap max-h-[200px] overflow-y-auto border border-paper-deep/10">
                {preview}
              </div>
            </div>
          )}

          {/* 包含创作轨迹选项 */}
          <div>
            <div className="text-[12px] font-medium text-ink mb-2">附加内容</div>
            <label className="flex items-center gap-2 text-[12px] text-ink-soft cursor-pointer">
              <input type="checkbox" className="accent-bamboo" />
              包含创作轨迹
            </label>
            <label className="flex items-center gap-2 text-[12px] text-ink-soft cursor-pointer mt-1">
              <input type="checkbox" className="accent-bamboo" />
              包含创作批注
            </label>
          </div>
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-paper-deep/10 flex justify-end gap-2">
          <button
            type="button"
            onClick={handlePreview}
            className="px-4 py-1.5 text-[12px] border border-paper-deep/20 text-ink-soft rounded-lg hover:bg-paper-warm/60 transition-colors cursor-pointer"
          >
            👁️ 预览
          </button>
          <button
            type="button"
            onClick={handleExport}
            className="px-4 py-1.5 text-[12px] bg-bamboo text-cloud rounded-lg hover:bg-bamboo-light transition-colors cursor-pointer"
          >
            {exportFormat === "xiaohongshu"
              ? copied
                ? "✅ 已复制"
                : "📋 复制到剪贴板"
              : "⬇️ 下载文件"}
          </button>
        </div>
      </div>
    </div>
  );
}
