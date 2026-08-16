import type { ComplianceResult, ComplianceIssue } from "../types";

const SENSITIVE_WORDS: string[] = [
  "违禁",
  "赌博",
  "色情",
  "暴力",
  "毒品",
  "枪支",
  "代购",
  "刷单",
  "传销",
  "封建迷信",
];

const MAX_TEXT_LENGTH = 1000;
const MAX_TAGS = 10;
const MAX_IMAGES = 9;
const COVER_ASPECT_RATIO = 3 / 4; // 3:4 竖版

export function checkCompliance(
  text: string,
  tags: string[],
  imageCount: number,
  coverWidth?: number,
  coverHeight?: number,
): ComplianceResult {
  const issues: ComplianceIssue[] = [];

  // 敏感词检测
  for (const word of SENSITIVE_WORDS) {
    if (text.includes(word)) {
      issues.push({
        type: "sensitive_word",
        message: `正文包含敏感词「${word}」`,
        severity: "error",
      });
    }
  }

  // 封面尺寸校验
  if (coverWidth && coverHeight) {
    const ratio = coverWidth / coverHeight;
    if (Math.abs(ratio - COVER_ASPECT_RATIO) > 0.05) {
      issues.push({
        type: "cover_size",
        message: `封面比例 ${ratio.toFixed(2)}:1，建议 3:4 竖版 (如 1080×1440)`,
        severity: "warning",
      });
    }
  }

  // 正文长度
  if (text.length > MAX_TEXT_LENGTH) {
    issues.push({
      type: "text_length",
      message: `正文 ${text.length} 字，超过 ${MAX_TEXT_LENGTH} 字限制`,
      severity: "error",
    });
  }

  // 话题标签数量
  if (tags.length > MAX_TAGS) {
    issues.push({
      type: "tag_count",
      message: `话题标签 ${tags.length} 个，超过 ${MAX_TAGS} 个限制`,
      severity: "warning",
    });
  }

  // 图片数量
  if (imageCount > MAX_IMAGES) {
    issues.push({
      type: "image_count",
      message: `图片 ${imageCount} 张，超过 ${MAX_IMAGES} 张限制`,
      severity: "error",
    });
  }

  return {
    passed: issues.filter((i) => i.severity === "error").length === 0,
    issues,
  };
}
