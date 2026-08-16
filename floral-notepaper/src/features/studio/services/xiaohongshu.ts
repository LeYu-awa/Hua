interface XiaohongshuPost {
  title: string;
  body: string;
  tags: string[];
  images: string[];
  coverIndex: number;
}

/** 编辑器 JSON 内容 → 小红书发布格式 */
export function convertToXiaohongshuFormat(
  title: string,
  blocks: unknown[],
  tags: string[],
  imageUrls: string[],
): XiaohongshuPost {
  const body = convertBlocksToText(blocks);

  return {
    title: title.slice(0, 20),
    body: body.slice(0, 1000),
    tags: tags.slice(0, 10),
    images: imageUrls.slice(0, 9),
    coverIndex: 0,
  };
}

function convertBlocksToText(blocks: unknown[]): string {
  if (!Array.isArray(blocks)) return "";

  return blocks
    .map((block: any) => {
      if (!block?.type) return "";

      switch (block.type) {
        case "heading1":
          return `**${block.text || ""}**\n\n`;
        case "heading2":
          return `**${block.text || ""}**\n`;
        case "paragraph":
          return `${block.text || ""}\n`;
        case "todo":
          return `✅ ${block.text || ""}\n`;
        case "topicTag":
          return `#${block.text || ""} `;
        case "emoji":
          return block.text || "";
        case "divider":
          return "---\n";
        case "blockquote":
          return `> ${block.text || ""}\n`;
        default:
          return `${block.text || ""}\n`;
      }
    })
    .join("");
}

/** 生成小红书预览文本 */
export function generatePreview(post: XiaohongshuPost): string {
  const tagText = post.tags.map((t) => `#${t}`).join(" ");
  return `${post.title}\n\n${post.body}\n\n${tagText}`;
}
