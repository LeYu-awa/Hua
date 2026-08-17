// ── 社交平台内容规范（diagram-design 集成 · 应用内资源） ────────────────────
// 汇集 QQ说说 / 微信朋友圈 / 小红书 的图文格式、尺寸与内容审核基准，
// 作为社交素材生成（social.generate）与社交发布面板（SocialPublishPage）的
// 统一数据源，保证 Agent 生成的图文素材符合各平台规范。

export type SocialPlatformId = "xiaohongshu" | "wechat" | "qq";

export interface SocialPlatformSpec {
  id: SocialPlatformId;
  name: string;
  shortName: string;
  /** 成品卡片画布尺寸（像素，即导出 PNG 的原生尺寸） */
  canvas: { width: number; height: number };
  ratioLabel: string;
  maxTextLength: number;
  maxTags: number;
  maxImages: number;
  /** 平台主题色（卡片强调色） */
  accent: string;
  tips: string[];
}

export const SOCIAL_PLATFORMS: SocialPlatformSpec[] = [
  {
    id: "xiaohongshu",
    name: "小红书",
    shortName: "XHS",
    canvas: { width: 1242, height: 1660 },
    ratioLabel: "3:4 竖版",
    maxTextLength: 1000,
    maxTags: 10,
    maxImages: 9,
    accent: "#ff2442",
    tips: [
      "封面建议 3:4 竖版（1242×1660），1:1 会被裁剪",
      "正文不超过 1000 字，注意段落留白与 emoji 适度",
      "话题标签 ≤ 10 个，置于文末并用 # 开头",
      "图片 ≤ 9 张，首图即封面",
      "禁用「最/第一/国家级/绝对」等极限词",
    ],
  },
  {
    id: "wechat",
    name: "微信朋友圈",
    shortName: "WX",
    canvas: { width: 1080, height: 1080 },
    ratioLabel: "1:1 方图",
    maxTextLength: 2000,
    maxTags: 9,
    maxImages: 9,
    accent: "#07c160",
    tips: [
      "配图建议 1:1 方形（1080×1080），多图时首图作封面",
      "正文偏短更佳，长文建议折叠为「全文」引导",
      "图片 ≤ 9 张，视频 ≤ 1 个（30s 内）",
      "慎用营销导流词，避免诱导分享/关注",
    ],
  },
  {
    id: "qq",
    name: "QQ 说说",
    shortName: "QQ",
    canvas: { width: 1080, height: 1080 },
    ratioLabel: "1:1 通用",
    maxTextLength: 2000,
    maxTags: 10,
    maxImages: 9,
    accent: "#12b7f5",
    tips: [
      "说说无严格字数/尺寸限制，1:1 或 3:4 配图均可",
      "图片 ≤ 9 张，可配音乐/位置丰富内容",
      "善用 @好友 与话题 # 提升互动",
    ],
  },
];

export function getPlatformSpec(id: SocialPlatformId): SocialPlatformSpec {
  return SOCIAL_PLATFORMS.find((spec) => spec.id === id) ?? SOCIAL_PLATFORMS[0];
}

// ── 内容审核预检（复用创作台敏感词基准，叠加平台专属规则） ─────────────────

export type SocialIssueType =
  | "sensitive_word"
  | "extremism_word"
  | "text_length"
  | "tag_count"
  | "image_count";

export interface SocialComplianceIssue {
  type: SocialIssueType;
  message: string;
  severity: "error" | "warning";
}

export interface SocialComplianceResult {
  passed: boolean;
  issues: SocialComplianceIssue[];
}

const SENSITIVE_WORDS = [
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

/** 小红书明确禁用的极限/夸大宣传词（命中即 error） */
const EXTREMISM_WORDS = [
  "最",
  "第一",
  "国家级",
  "世界级",
  "顶级",
  "极致",
  "绝对",
  "百分百",
  "全网最低",
  "销量第一",
];

export function checkSocialCompliance(
  text: string,
  tags: string[],
  imageCount: number,
  spec: SocialPlatformSpec,
): SocialComplianceResult {
  const issues: SocialComplianceIssue[] = [];

  for (const word of SENSITIVE_WORDS) {
    if (text.includes(word)) {
      issues.push({
        type: "sensitive_word",
        message: `正文包含敏感词「${word}」，请删除后重试`,
        severity: "error",
      });
    }
  }

  if (spec.id === "xiaohongshu") {
    for (const word of EXTREMISM_WORDS) {
      if (text.includes(word)) {
        issues.push({
          type: "extremism_word",
          message: `正文疑似包含极限词「${word}」，可能触发平台审核`,
          severity: "error",
        });
      }
    }
  }

  const chars = [...text].length;
  if (chars > spec.maxTextLength) {
    issues.push({
      type: "text_length",
      message: `正文 ${chars} 字，超出 ${spec.name} 的 ${spec.maxTextLength} 字限制`,
      severity: "error",
    });
  }

  if (tags.length > spec.maxTags) {
    issues.push({
      type: "tag_count",
      message: `话题标签 ${tags.length} 个，超出 ${spec.name} 的 ${spec.maxTags} 个限制`,
      severity: "warning",
    });
  }

  if (imageCount > spec.maxImages) {
    issues.push({
      type: "image_count",
      message: `图片 ${imageCount} 张，超出 ${spec.name} 的 ${spec.maxImages} 张限制`,
      severity: "error",
    });
  }

  return {
    passed: issues.filter((issue) => issue.severity === "error").length === 0,
    issues,
  };
}
