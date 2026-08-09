import type { CanvasDocument } from "./types";

// ── 画布导出 PNG（前端接管，零第三方依赖） ──────────────────────────────────
// 导出链路：CanvasDocument → 自包含 SVG 字符串（内联样式，不依赖外部 CSS）→
// blob URL 载入 Image → canvas 光栅化 → PNG Blob → 触发下载。
// 保真由 buildCanvasSvg 的确定性输出 + 单测兜底（节点文本/位置/连线全部保留）。

/** 按字符数折行（对 CJK 友好）：`\n` 强制换行，超过 maxChars 自动截断折行 */
export function wrapText(text: string, maxChars: number): string[] {
  const limit = Math.max(1, Math.floor(maxChars));
  const lines: string[] = [];
  for (const rawLine of text.split("\n")) {
    let current = "";
    for (const ch of rawLine) {
      if (current.length >= limit) {
        lines.push(current);
        current = ch;
      } else {
        current += ch;
      }
    }
    lines.push(current);
  }
  return lines;
}

/** 近似估算某字号下每字符像素宽（CJK 全角约等于字号，ASCII 减半） */
export function approxCharWidth(char: string, fontSize: number): number {
  return /[\u2e80-\u9fff\uf900-\ufaff\u3000-\u303f\uff00-\uffef]/.test(char)
    ? fontSize
    : fontSize * 0.55;
}

/** 计算一行按像素宽度能容纳的字符数（混合 CJK/ASCII 时逐字符累计） */
export function charsFit(text: string, maxWidthPx: number, fontSize: number): number {
  let width = 0;
  let count = 0;
  for (const ch of text) {
    const w = approxCharWidth(ch, fontSize);
    if (width + w > maxWidthPx) break;
    width += w;
    count += 1;
  }
  return count;
}

/** 像素宽度约束的折行（用于画布节点与笔记渲染，保真核心） */
export function wrapTextByPixels(text: string, maxWidthPx: number, fontSize: number): string[] {
  const lines: string[] = [];
  for (const rawLine of text.split("\n")) {
    if (rawLine === "") {
      lines.push("");
      continue;
    }
    let remaining = rawLine;
    while (remaining.length > 0) {
      const n = charsFit(remaining, maxWidthPx, fontSize);
      if (n <= 0) break; // 单个字符都放不下，避免死循环
      lines.push(remaining.slice(0, n));
      remaining = remaining.slice(n);
    }
  }
  return lines;
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * 把画布文档渲染成自包含 SVG 字符串（内联样式 + 绝对定位，无外部 CSS/字体依赖）。
 * 这是 PNG 导出的「保真源」：节点文本、坐标、尺寸、连线样式全部显式保留。
 */
export function buildCanvasSvg(doc: CanvasDocument): string {
  const PAD = 40;
  const FONT_SIZE = 13;
  const LINE_HEIGHT = 16;

  const nodes = doc.nodes ?? [];
  if (nodes.length === 0) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${PAD * 2}" height="${PAD * 2}" viewBox="0 0 ${PAD * 2} ${PAD * 2}"><rect width="100%" height="100%" fill="#ffffff"/></svg>`;
  }

  const minX = Math.min(...nodes.map((n) => n.x));
  const minY = Math.min(...nodes.map((n) => n.y));
  const maxX = Math.max(...nodes.map((n) => n.x + n.width));
  const maxY = Math.max(...nodes.map((n) => n.y + n.height));
  const width = Math.ceil(maxX - minX + PAD * 2);
  const height = Math.ceil(maxY - minY + PAD * 2);
  const offsetX = -minX + PAD;
  const offsetY = -minY + PAD;

  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xml:space="preserve">`,
    `<rect width="100%" height="100%" fill="#ffffff"/>`,
  ];

  // 连线（虚线/实线样式保留）
  for (const edge of doc.edges ?? []) {
    const from = nodes.find((n) => n.id === edge.fromNodeId);
    const to = nodes.find((n) => n.id === edge.toNodeId);
    if (!from || !to) continue;
    parts.push(
      `<line x1="${from.x + from.width / 2 + offsetX}" y1="${from.y + from.height / 2 + offsetY}" ` +
        `x2="${to.x + to.width / 2 + offsetX}" y2="${to.y + to.height / 2 + offsetY}" ` +
        `stroke="#b8b3a8" stroke-width="1.5" ${edge.style === "dashed" ? 'stroke-dasharray="6 4"' : ""}/>`,
    );
  }

  // 节点（zIndex 升序 → 越靠后越在上层）
  for (const node of [...nodes].sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0))) {
    const x = node.x + offsetX;
    const y = node.y + offsetY;
    parts.push(
      `<rect x="${x}" y="${y}" width="${node.width}" height="${node.height}" rx="6" ` +
        `fill="#ffffff" stroke="#d8d3c8" stroke-width="1"/>`,
    );
    const fontSize = FONT_SIZE;
    const lineWidth = Math.max(16, node.width - 16);
    const maxLines = Math.max(1, Math.floor((node.height - 12) / LINE_HEIGHT));
    const lines = wrapTextByPixels(node.text || "", lineWidth, fontSize).slice(0, maxLines);
    lines.forEach((line, i) => {
      parts.push(
        `<text x="${x + 8}" y="${y + 15 + i * LINE_HEIGHT}" font-size="${fontSize}" ` +
          `font-family="system-ui, sans-serif" fill="#3a3a35">${escapeXml(line)}</text>`,
      );
    });
  }

  parts.push("</svg>");
  return parts.join("");
}

/** 把自包含 SVG 字符串渲染成 PNG Blob（2x 高清） */
export async function svgToPngBlob(svgText: string): Promise<Blob> {
  const svgBlob = new Blob([svgText], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(svgBlob);
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("SVG 渲染失败，无法导出 PNG"));
      img.src = url;
    });
    const scale = 2;
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, img.naturalWidth * scale);
    canvas.height = Math.max(1, img.naturalHeight * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("无法创建 2D 上下文");
    ctx.scale(scale, scale);
    ctx.drawImage(img, 0, 0);
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("PNG 编码失败"))), "image/png");
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** 触发浏览器下载（Tauri WebView2 下写入默认下载目录） */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ── 笔记导出 PNG（note.export 前端接管渲染） ────────────────────────────────

/** 笔记 PNG 的纯排版计算：返回标题 + 正文折行行（可单测保真） */
export function layoutNoteLines(
  title: string,
  content: string,
  maxWidthPx: number,
  fontSize: number,
): { titleLines: string[]; bodyLines: string[] } {
  const titleLines = wrapTextByPixels(title || "未命名笔记", maxWidthPx, Math.round(fontSize * 1.4));
  const bodyLines = wrapTextByPixels(content || "", maxWidthPx, fontSize);
  return { titleLines, bodyLines };
}

/**
 * 把笔记渲染成 PNG（前端接管 note.export 的 png/pdf 分支）：
 * 白底卡片 + 标题 + 正文，按像素宽度折行，无 markdown 解析依赖。
 */
export function renderNoteToPngBlob(title: string, content: string): Promise<Blob> {
  const scale = 2;
  const pad = 32;
  const titleSize = 20;
  const bodySize = 14;
  const lineHeight = 22;
  const maxTextWidth = 640;
  const { titleLines, bodyLines } = layoutNoteLines(title, content, maxTextWidth, bodySize);
  const contentHeight = (titleLines.length + bodyLines.length) * lineHeight + 12;
  const width = maxTextWidth + pad * 2;
  const height = Math.max(160, contentHeight + pad * 2);

  const canvas = document.createElement("canvas");
  canvas.width = width * scale;
  canvas.height = height * scale;
  const ctx = canvas.getContext("2d");
  if (!ctx) return Promise.reject(new Error("无法创建 2D 上下文"));
  ctx.scale(scale, scale);

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "#3a3a35";
  ctx.font = `600 ${titleSize}px system-ui, sans-serif`;
  let cursorY = pad + titleSize;
  for (const line of titleLines) {
    ctx.fillText(line, pad, cursorY);
    cursorY += titleSize + 6;
  }
  ctx.fillStyle = "#57534e";
  ctx.font = `${bodySize}px system-ui, sans-serif`;
  cursorY += 6;
  for (const line of bodyLines) {
    ctx.fillText(line, pad, cursorY);
    cursorY += lineHeight;
  }

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("PNG 编码失败"))), "image/png");
  });
}
