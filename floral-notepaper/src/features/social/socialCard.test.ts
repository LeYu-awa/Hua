import { describe, expect, it } from "vitest";
import { checkSocialCompliance, getPlatformSpec } from "./platformSpecs";
import { buildSocialCardSvg, layoutSocialCard, composeSocialPostText } from "./socialCard";

describe("checkSocialCompliance（平台内容审核预检）", () => {
  it("命中敏感词返回 error", () => {
    const spec = getPlatformSpec("xiaohongshu");
    const result = checkSocialCompliance("这里有赌博相关内容", [], 1, spec);
    expect(result.passed).toBe(false);
    expect(result.issues.some((issue) => issue.type === "sensitive_word")).toBe(true);
  });

  it("极限词仅对小红书生效", () => {
    const text = "这是全网最低价，绝对第一";
    const xhs = checkSocialCompliance(text, [], 1, getPlatformSpec("xiaohongshu"));
    expect(xhs.issues.some((issue) => issue.type === "extremism_word")).toBe(true);
    const wechat = checkSocialCompliance(text, [], 1, getPlatformSpec("wechat"));
    expect(wechat.issues.some((issue) => issue.type === "extremism_word")).toBe(false);
  });

  it("超过平台字数上限报 error", () => {
    const spec = getPlatformSpec("xiaohongshu");
    const long = "花".repeat(spec.maxTextLength + 1);
    const result = checkSocialCompliance(long, [], 1, spec);
    expect(result.issues.some((issue) => issue.type === "text_length")).toBe(true);
    expect(result.passed).toBe(false);
  });

  it("标签数与图片数超限给出提示", () => {
    const spec = getPlatformSpec("xiaohongshu");
    const result = checkSocialCompliance("正文", ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k"], 10, spec);
    expect(result.issues.some((issue) => issue.type === "tag_count")).toBe(true);
    expect(result.issues.some((issue) => issue.type === "image_count")).toBe(true);
  });

  it("合规内容通过预检", () => {
    const result = checkSocialCompliance("今天读了《小王子》，夕阳很美", ["读书"], 1, getPlatformSpec("xiaohongshu"));
    expect(result.passed).toBe(true);
  });
});

describe("layoutSocialCard（卡片排版）", () => {
  const xhs = getPlatformSpec("xiaohongshu");

  it("标题与正文按像素折行", () => {
    const layout = layoutSocialCard("标题", "这是一段正文内容", ["标签"], xhs);
    expect(layout.W).toBe(1242);
    expect(layout.H).toBe(1660);
    expect(layout.titleLines.length).toBeGreaterThan(0);
    expect(layout.bodyLines.join("")).toContain("这是一段正文内容");
    expect(layout.tagRows.length).toBeGreaterThan(0);
  });

  it("内容过长时自动缩小正文字号", () => {
    const short = layoutSocialCard("标题", "短正文", [], xhs);
    const long = layoutSocialCard("标题", "长文\n".repeat(200) + "正文", [], xhs);
    expect(long.bodySize).toBeLessThanOrEqual(short.bodySize);
  });

  it("标签按宽度折行，多个标签可能占多行", () => {
    const layout = layoutSocialCard("标题", "正文", ["读书", "日落", "生活记录", "随笔", "日常"], xhs);
    expect(layout.tagRows.flat().length).toBe(5);
  });
});

describe("buildSocialCardSvg（自包含 SVG 契约）", () => {
  it("输出平台尺寸 + 可访问语义角色", () => {
    const svg = buildSocialCardSvg({
      title: "标题",
      text: "正文内容",
      tags: ["读书"],
      platform: "xiaohongshu",
    });
    expect(svg).toContain('role="img"');
    expect(svg).toContain('aria-labelledby="card-title card-desc"');
    expect(svg).toContain('width="1242"');
    expect(svg).toContain('height="1660"');
    expect(svg).toContain("<title");
    expect(svg).toContain("<desc");
  });

  it("朋友圈使用 1:1 画布与平台主题色", () => {
    const svg = buildSocialCardSvg({
      title: "标题",
      text: "正文",
      tags: [],
      platform: "wechat",
    });
    expect(svg).toContain('width="1080"');
    expect(svg).toContain('height="1080"');
    expect(svg).toContain("#07c160");
  });

  it("深色主题使用深色纸面", () => {
    const svg = buildSocialCardSvg({
      title: "标题",
      text: "正文",
      tags: [],
      platform: "qq",
      theme: "dark",
    });
    expect(svg).toContain("#1a1b20");
  });
});

describe("composeSocialPostText（发布正文拼装）", () => {
  it("标题 + 正文 + # 标签组合", () => {
    const post = composeSocialPostText("标题", "正文内容", ["读书", "日落"]);
    expect(post).toContain("标题");
    expect(post).toContain("正文内容");
    expect(post).toContain("#读书 #日落");
  });

  it("无标签时不含标签行", () => {
    const post = composeSocialPostText("", "只有正文", []);
    expect(post).toBe("只有正文");
  });
});
