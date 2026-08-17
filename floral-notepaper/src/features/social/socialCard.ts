// ── 社交卡片生成器（diagram-design 集成 · 应用内模板） ──────────────────────
// 把用户原创文字内容渲染成自包含 SVG 社交卡片（平台尺寸、内联样式、零外部
// 依赖），复用画布导出的 svgToPngBlob 链路输出平台标准尺寸 PNG。
// 设计基准参考 diagram-design 的可访问 SVG 契约（role="img" + title/desc）与
// 语义角色（paper/ink/muted/accent）分层。

import { svgToPngBlob, wrapTextByPixels, approxCharWidth } from "../canvas/canvasExport";
import { getPlatformSpec, type SocialPlatformId } from "./platformSpecs";

export interface SocialCardParams {
  title: string;
  text: string;
  tags: string[];
  platform: SocialPlatformId;
  theme?: "light" | "dark";
}

interface CardTheme {
  paper: string;
  ink: string;
  muted: string;
  hairline: string;
  chipInk: string;
}

const THEMES: Record<"light" | "dark", CardTheme> = {
  light: {
    paper: "#faf8f3",
    ink: "#2d3142",
    muted: "#6b6660",
    hairline: "#e6e0d4",
    chipInk: "#ffffff",
  },
  dark: {
    paper: "#1a1b20",
    ink: "#f2efe9",
    muted: "#a8a29a",
    hairline: "#2e3038",
    chipInk: "#101116",
  },
};

const TITLE_FONT = `Georgia, "Songti SC", "STSong", serif`;
const BODY_FONT = `"PingFang SC", "Microsoft YaHei", system-ui, sans-serif`;

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** 纯排版计算（可单测）：返回标题/正文/标签的折行结果与最终字号 */
export function layoutSocialCard(
  title: string,
  text: string,
  tags: string[],
  spec: { canvas: { width: number; height: number } },
) {
  const { width: W, height: H } = spec.canvas;
  const pad = Math.round(W * 0.06);
  const titleSize = Math.round(W * 0.045);
  const bodyWidth = W - pad * 2;

  const titleLines = wrapTextByPixels(title || "无标题", bodyWidth, titleSize);

  let bodySize = Math.round(W * 0.028);
  const minBodySize = Math.round(W * 0.018);
  let bodyLines = wrapTextByPixels(text, bodyWidth, bodySize);
  let lineHeight = Math.round(bodySize * 1.6);

  const tagsSize = Math.round(W * 0.024);
  const tagRows = wrapTags(tags, tagsSize, bodyWidth);
  const tagBlockHeight = tagRows.length * Math.round(tagsSize * 2.3);

  const titleBlockHeight =
    titleLines.length * Math.round(titleSize * 1.35) + Math.round(W * 0.03);
  const footerBlockHeight = Math.round(W * 0.05);

  // 内容溢出时逐级缩小正文字号直到放得下（保底 minBodySize）
  const available =
    H - pad * 2 - titleBlockHeight - tagBlockHeight - footerBlockHeight - Math.round(W * 0.03);
  while (bodySize > minBodySize && bodyLines.length * lineHeight > available) {
    bodySize = Math.max(minBodySize, Math.round(bodySize * 0.92));
    lineHeight = Math.round(bodySize * 1.6);
    bodyLines = wrapTextByPixels(text, bodyWidth, bodySize);
  }

  return {
    W,
    H,
    pad,
    titleSize,
    bodySize,
    lineHeight,
    titleLines,
    bodyLines,
    tagsSize,
    tagRows,
    titleBlockHeight,
    footerBlockHeight,
  };
}

/** 把标签按像素宽度折行（chip 横向排列，超出换行） */
function wrapTags(tags: string[], fontSize: number, maxWidthPx: number): string[][] {
  const chipPad = Math.round(fontSize * 1.2);
  const gap = Math.round(fontSize * 0.7);
  const chipWidth = (tag: string) =>
    tag.split("").reduce((sum, ch) => sum + approxCharWidth(ch, fontSize), 0) + chipPad * 2;

  const rows: string[][] = [];
  let row: string[] = [];
  let rowWidth = 0;
  for (const tag of tags) {
    const need = chipWidth(tag) + (row.length > 0 ? gap : 0);
    if (row.length > 0 && rowWidth + need > maxWidthPx) {
      rows.push(row);
      row = [tag];
      rowWidth = chipWidth(tag);
    } else {
      row.push(tag);
      rowWidth += need;
    }
  }
  if (row.length > 0) rows.push(row);
  return rows;
}

/** 把社交卡片渲染成自包含 SVG 字符串（role="img" + title/desc，可访问） */
export function buildSocialCardSvg(params: SocialCardParams): string {
  const spec = getPlatformSpec(params.platform);
  const theme = THEMES[params.theme ?? "light"];
  const layout = layoutSocialCard(params.title, params.text, params.tags, spec);
  const { W, H, pad } = layout;

  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xml:space="preserve" role="img" aria-labelledby="card-title card-desc">`,
    `<title id="card-title">${escapeXml(params.title || "社交卡片")}</title>`,
    `<desc id="card-desc">${escapeXml(spec.name)}社交图文卡片 · 由花箴 AI 生成</desc>`,
    `<rect width="100%" height="100%" fill="${theme.paper}"/>`,
  ];

  const accent = spec.accent;
  const accentBarW = Math.round(W * 0.012);
  const accentBarH = Math.round(W * 0.055);
  const titleBlockTop = pad + Math.round(W * 0.02);

  // 顶部强调条 + 标题
  parts.push(
    `<rect x="${pad}" y="${titleBlockTop}" width="${accentBarW}" height="${accentBarH}" rx="${accentBarW / 2}" fill="${accent}"/>`,
  );
  const titleX = pad + accentBarW + Math.round(W * 0.02);
  layout.titleLines.forEach((line, i) => {
    const y = titleBlockTop + layout.titleSize + i * Math.round(layout.titleSize * 1.35);
    parts.push(
      `<text x="${titleX}" y="${y}" font-family="${TITLE_FONT}" font-size="${layout.titleSize}" font-weight="600" fill="${theme.ink}">${escapeXml(line)}</text>`,
    );
  });

  // 正文（超出可用高度的部分截断，末尾补省略号）
  const bodyTop = titleBlockTop + layout.titleBlockHeight;
  const maxVisibleLines = Math.max(
    0,
    Math.floor((H - pad - bodyTop - layout.footerBlockHeight) / layout.lineHeight),
  );
  const visibleLines = layout.bodyLines.slice(0, maxVisibleLines);
  visibleLines.forEach((line, i) => {
    const y = bodyTop + layout.lineHeight + i * layout.lineHeight;
    const isLast = i === visibleLines.length - 1;
    const truncated = isLast && layout.bodyLines.length > visibleLines.length;
    parts.push(
      `<text x="${pad}" y="${y}" font-family="${BODY_FONT}" font-size="${layout.bodySize}" fill="${theme.muted}">${escapeXml(truncated ? `${line}…` : line)}</text>`,
    );
  });

  // 标签 chips（自底部向上排布，保证不被正文覆盖）
  const tagRows = layout.tagRows;
  const chipHeight = Math.round(layout.tagsSize * 2.1);
  const chipGap = Math.round(layout.tagsSize * 0.7);
  const chipPad = Math.round(layout.tagsSize * 1.2);
  let tagBottom = H - pad - layout.footerBlockHeight;
  for (let rowIndex = tagRows.length - 1; rowIndex >= 0; rowIndex -= 1) {
    const row = tagRows[rowIndex];
    let cursorX = pad;
    for (const tag of row) {
      const chipWidth =
        tag.split("").reduce((sum, ch) => sum + approxCharWidth(ch, layout.tagsSize), 0) +
        chipPad * 2;
      const chipY = tagBottom - chipHeight;
      parts.push(
        `<rect x="${cursorX}" y="${chipY}" width="${chipWidth}" height="${chipHeight}" rx="${chipHeight / 2}" fill="${accent}" fill-opacity="0.14"/>`,
        `<text x="${cursorX + chipPad}" y="${chipY + chipHeight / 2 + Math.round(layout.tagsSize * 0.36)}" font-family="${BODY_FONT}" font-size="${layout.tagsSize}" font-weight="500" fill="${accent}">#${escapeXml(tag)}</text>`,
      );
      cursorX += chipWidth + chipGap;
    }
    tagBottom = tagBottom - chipHeight - chipGap;
  }

  // 底部：平台标识 + 生成信息
  const footerY = H - pad - Math.round(W * 0.015);
  const footerX = pad;
  parts.push(
    `<text x="${footerX}" y="${footerY}" font-family="${BODY_FONT}" font-size="${Math.round(W * 0.022)}" font-weight="600" fill="${accent}">${escapeXml(spec.shortName)}</text>`,
    `<text x="${footerX + Math.round(W * 0.08)}" y="${footerY}" font-family="${BODY_FONT}" font-size="${Math.round(W * 0.02)}" fill="${theme.muted}">${escapeXml(spec.name)} · ${new Date().toLocaleDateString("zh-CN")} · 花箴 AI 生成</text>`,
  );

  parts.push("</svg>");
  return parts.join("");
}

/** 社交卡片 → 平台尺寸 PNG Blob（复用画布 2x 高清导出链路） */
export function socialCardToPngBlob(params: SocialCardParams): Promise<Blob> {
  return svgToPngBlob(buildSocialCardSvg(params));
}

/** 社交卡片 → PNG data URL（用于对话内 markdown 图片预览） */
export async function socialCardToPngDataUrl(params: SocialCardParams): Promise<string> {
  const blob = await socialCardToPngBlob(params);
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("卡片预览编码失败"));
    reader.readAsDataURL(blob);
  });
}

/** 拼装最终发布正文：标题 + 正文 + 话题标签（符合各平台文末带 # 标签习惯） */
export function composeSocialPostText(title: string, text: string, tags: string[]): string {
  const sections: string[] = [];
  if (title.trim()) sections.push(title.trim());
  if (text.trim()) sections.push(text.trim());
  const tagLine = tags.map((tag) => `#${tag.trim()}`).join(" ");
  if (tagLine) sections.push(tagLine);
  return sections.join("\n\n");
}
