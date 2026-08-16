import { useCallback, useState } from "react";
import { useStudioStore } from "../stores/useStudioStore";
import { convertToXiaohongshuFormat, generatePreview } from "../services/xiaohongshu";
import { checkCompliance } from "../services/complianceCheck";
import { exportToNotionMarkdown, downloadAsFile } from "../services/notionExport";
import type { ComplianceResult, ExportFormat } from "../types";

export function useShare() {
  const [copied, setCopied] = useState(false);
  const { editorMeta, setComplianceResult, setShowSharePanel } = useStudioStore();

  const previewXiaohongshu = useCallback(
    (blocks: unknown[], imageUrls: string[]) => {
      const post = convertToXiaohongshuFormat(editorMeta.title, blocks, editorMeta.tags, imageUrls);
      return generatePreview(post);
    },
    [editorMeta],
  );

  const runCompliance = useCallback(
    (
      text: string,
      imageCount: number,
      coverWidth?: number,
      coverHeight?: number,
    ): ComplianceResult => {
      const result = checkCompliance(text, editorMeta.tags, imageCount, coverWidth, coverHeight);
      setComplianceResult(result);
      return result;
    },
    [editorMeta.tags, setComplianceResult],
  );

  const exportTo = useCallback(
    (format: ExportFormat, content: string, activityLog?: string, notes?: string) => {
      if (format === "xiaohongshu") {
        navigator.clipboard.writeText(content).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        });
      } else if (format === "notion_markdown") {
        const md = exportToNotionMarkdown({
          title: editorMeta.title,
          content,
          tags: editorMeta.tags,
          coverUrl: editorMeta.coverUrl,
          createdAt: editorMeta.createdAt,
          includeActivityLog: !!activityLog,
          activityLog,
          includeNotes: !!notes,
          notes,
        });
        const filename = `${editorMeta.title.replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, "_")}_创作记录.md`;
        downloadAsFile(md, filename);
      }
    },
    [editorMeta],
  );

  const toggleSharePanel = useCallback(() => {
    setShowSharePanel(!useStudioStore.getState().showSharePanel);
  }, [setShowSharePanel]);

  return { previewXiaohongshu, runCompliance, exportTo, toggleSharePanel, copied };
}
