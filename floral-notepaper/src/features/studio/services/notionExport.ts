interface NotionExportOptions {
  title: string;
  content: string;
  tags: string[];
  coverUrl?: string;
  createdAt?: string;
  includeActivityLog?: boolean;
  activityLog?: string;
  includeNotes?: boolean;
  notes?: string;
}

/** 导出为 Notion 兼容的 Markdown */
export function exportToNotionMarkdown(options: NotionExportOptions): string {
  const frontmatter = [
    "---",
    `title: "${options.title}"`,
    `tags: [${options.tags.map((t) => `"${t}"`).join(", ")}]`,
    options.createdAt ? `created_at: ${options.createdAt}` : "",
    options.coverUrl ? `cover_url: ${options.coverUrl}` : "",
    "---",
    "",
  ]
    .filter(Boolean)
    .join("\n");

  const sections: string[] = [frontmatter, options.content];

  if (options.includeActivityLog && options.activityLog) {
    sections.push("", "## 创作轨迹", "", options.activityLog);
  }

  if (options.includeNotes && options.notes) {
    sections.push("", "## 创作批注", "", options.notes);
  }

  return sections.join("\n");
}

/** 下载为文件 */
export function downloadAsFile(content: string, filename: string): void {
  const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
