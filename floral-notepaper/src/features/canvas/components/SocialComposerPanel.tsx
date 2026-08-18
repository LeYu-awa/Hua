import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { summarizeContent } from "../contentVisualizer";
import { navigateTo } from "../../../app/navigation";

export interface SocialComposerBlock {
  id: string;
  /** image=图片 / textCard=文字卡片 / text=纯文本 */
  type: "image" | "textCard" | "text";
  text: string;
  imageUrl?: string;
}

interface SocialComposerPanelProps {
  /** 素材整理源：当前选中画布卡片的文本集合 */
  materials: string[];
  onClose: () => void;
}

function blockId(): string {
  return `compose-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

/** 按官方指引生成可用的配图 URL（prompt URL 编码） */
function buildGeneratedImageUrl(prompt: string): string {
  const p = encodeURIComponent(prompt.trim() || "简约清新的插画");
  return `https://coresg-normal.trae.ai/api/ide/v1/text_to_image?prompt=${p}&image_size=landscape_4_3`;
}

/**
 * 发布前创作工具链：文案编写 / 素材整理 / 文章整编 / 内容总结 / 绘图生成。
 * 支持「图片 / 文字卡片 / 纯文本」多类型内容块自由编排，最终生成符合
 * 小红书、朋友圈、QQ 空间等社交平台风格的作品内容，并流转到社交发布页。
 */
export function SocialComposerPanel({ materials, onClose }: SocialComposerPanelProps) {
  const { t } = useTranslation();
  const [blocks, setBlocks] = useState<SocialComposerBlock[]>([]);
  const [status, setStatus] = useState<string>("");
  const [title, setTitle] = useState("");

  const patchBlock = useCallback((id: string, patch: Partial<SocialComposerBlock>) => {
    setBlocks((prev) => prev.map((b) => (b.id === id ? { ...b, ...patch } : b)));
  }, []);

  const removeBlock = useCallback((id: string) => {
    setBlocks((prev) => prev.filter((b) => b.id !== id));
  }, []);

  const addTextBlock = useCallback(
    (text = "", type: "text" | "textCard" = "text") => {
      setBlocks((prev) => [...prev, { id: blockId(), type, text }]);
    },
    [],
  );

  const addImageBlock = useCallback((prompt = "") => {
    setBlocks((prev) => [
      ...prev,
      { id: blockId(), type: "image", text: prompt, imageUrl: buildGeneratedImageUrl(prompt) },
    ]);
  }, []);

  /** 素材整理：选中卡片 → 纯文本块 */
  const handleCollect = useCallback(() => {
    if (materials.length === 0) {
      setStatus(t("composer.noMaterial", "请先在画布上选中 1 张及以上卡片"));
      return;
    }
    setBlocks(materials.map((m) => ({ id: blockId(), type: "text", text: m })));
    setStatus(t("composer.collected", `已整理 ${materials.length} 条素材`));
  }, [materials, t]);

  /** 内容总结：全部素材 → 要点卡片 */
  const handleSummary = useCallback(() => {
    const all = blocks.filter((b) => b.type !== "image").map((b) => b.text).join("\n");
    if (!all.trim()) {
      setStatus(t("composer.empty", "没有可总结的内容，先添加素材"));
      return;
    }
    addTextBlock(summarizeContent(all), "textCard");
    setStatus(t("composer.summarized", "已生成内容总结卡片"));
  }, [blocks, addTextBlock, t]);

  /** 文案编写：素材 → 社交风格文案（标题 + 正文 + 话题标签） */
  const handleCopywrite = useCallback(() => {
    const all = blocks.filter((b) => b.type !== "image").map((b) => b.text).join("\n");
    const first = materials[0] ?? all.split("\n")[0] ?? "";
    const keywords = summarizeContent(all || first, 3)
      .split("\n")
      .slice(1)
      .map((line) => line.replace(/^\d+\.\s*/, "").trim())
      .filter(Boolean);
    const titleLine = title.trim() || (first.length > 18 ? `${first.slice(0, 18)}…` : first) || "今日分享";
    const tags = keywords
      .slice(0, 4)
      .map((k) => (k.length > 6 ? k.slice(0, 6) : k))
      .map((k) => `#${k}`)
      .join(" ");
    const copy = `【${titleLine}】\n\n${all.trim()}\n\n${tags}`;
    addTextBlock(copy.trim(), "textCard");
    setStatus(t("composer.copywritten", "已生成社交风格文案卡片（可编辑）"));
  }, [blocks, materials, title, addTextBlock, t]);

  /** 文章整编：素材 → 连贯文章卡片 */
  const handleAssemble = useCallback(() => {
    const all = blocks.filter((b) => b.type !== "image").map((b) => b.text).filter(Boolean);
    if (all.length === 0) {
      setStatus(t("composer.empty", "没有可整编的内容，先添加素材"));
      return;
    }
    const article = all.join("\n\n");
    addTextBlock(article, "textCard");
    setStatus(t("composer.assembled", "已按顺序整编为文章卡片"));
  }, [blocks, addTextBlock, t]);

  const postText = useMemo(() => {
    const head = title.trim() ? `【${title.trim()}】` : "";
    const body = blocks
      .map((b) => {
        if (b.type === "image") return b.imageUrl ? `[图片] ${b.imageUrl}` : "[图片]";
        return b.text;
      })
      .filter((s) => s.trim() && s.trim() !== "[图片]")
      .join("\n\n");
    return [head, body].filter(Boolean).join("\n\n");
  }, [title, blocks]);

  const handleCopyPost = async () => {
    if (!postText.trim()) {
      setStatus(t("composer.empty", "没有可复制的内容"));
      return;
    }
    await writeText(postText);
    setStatus(t("composer.copied", "已复制编排正文到剪贴板"));
  };

  /** 生成作品 → 存草稿并跳转社交发布页（登录校验由发布页承担） */
  const handleGoPublish = useCallback(() => {
    const tags = (postText.match(/#[^\s#]+/g) ?? []).map((tag) => tag.slice(1));
    try {
      localStorage.setItem(
        "floral.socialDraft",
        JSON.stringify({ title: title.trim(), text: postText, tags }),
      );
    } catch {
      // localStorage 不可用时降级：仅保留正文
    }
    navigateTo("social");
  }, [postText, title]);

  const actionBtn =
    "rounded-lg bg-bamboo/90 px-2.5 py-1.5 text-[12px] font-medium text-cloud transition-colors hover:bg-bamboo cursor-pointer disabled:opacity-50";
  const ghostBtn =
    "rounded-lg border border-paper-deep/25 px-2.5 py-1.5 text-[12px] text-ink-soft transition-colors hover:bg-paper-deep/10 cursor-pointer";

  return (
    <div className="canvas-floating-panel absolute top-16 right-4 z-20 w-[320px] p-3 flex flex-col min-h-0 max-h-[calc(100%-5rem)]">
      <div className="flex items-center justify-between mb-2">
        <span className="canvas-panel-title">
          {t("composer.title", "发布编排")}
        </span>
        <button
          type="button"
          onClick={onClose}
          className="canvas-icon-button canvas-button-ghost"
          title={t("common.close", "关闭")}
        >
          <span className="text-[13px] leading-none">✕</span>
        </button>
      </div>

      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder={t("composer.titlePlaceholder", "作品标题（发布文案用）")}
        className="mb-2 w-full px-2.5 py-1.5 text-[12px] bg-paper/80 rounded-lg border border-paper-deep/25 outline-none focus:border-bamboo/50 placeholder:text-ink-faint/70"
      />

      <div className="flex flex-wrap gap-1.5 mb-2">
        <button type="button" onClick={handleCollect} className={actionBtn}>
          {t("composer.collect", "素材整理")}
        </button>
        <button type="button" onClick={handleSummary} className={ghostBtn}>
          {t("composer.summary", "内容总结")}
        </button>
        <button type="button" onClick={handleCopywrite} className={ghostBtn}>
          {t("composer.copywrite", "文案编写")}
        </button>
        <button type="button" onClick={handleAssemble} className={ghostBtn}>
          {t("composer.assemble", "文章整编")}
        </button>
        <button type="button" onClick={() => addImageBlock("")} className={ghostBtn}>
          {t("composer.addImage", "+ 图片")}
        </button>
        <button type="button" onClick={() => addTextBlock("", "text")} className={ghostBtn}>
          {t("composer.addText", "+ 纯文本")}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto space-y-2 min-h-0 pr-0.5">
        {blocks.length === 0 && (
          <div className="rounded-xl border border-dashed border-paper-deep/30 px-3 py-6 text-center text-[12px] text-ink-ghost">
            {t("composer.hint", "用上方工具整理素材与生成文案，或直接添加内容块自由编排")}
          </div>
        )}
        {blocks.map((block) => (
          <div
            key={block.id}
            className="rounded-xl border border-paper-deep/20 bg-paper-warm/40 p-2"
          >
            <div className="flex items-center gap-1.5 mb-1.5">
              <select
                value={block.type}
                onChange={(e) =>
                  patchBlock(block.id, {
                    type: e.target.value as SocialComposerBlock["type"],
                  })
                }
                className="rounded-lg border border-paper-deep/25 bg-paper/80 px-1.5 py-1 text-[11px] text-ink-soft outline-none"
              >
                <option value="textCard">{t("composer.typeCard", "文字卡片")}</option>
                <option value="text">{t("composer.typeText", "纯文本")}</option>
                <option value="image">{t("composer.typeImage", "图片")}</option>
              </select>
              <span className="text-[10px] text-ink-faint">
                {block.type === "image"
                  ? t("composer.imagePrompt", "配图提示词")
                  : block.type === "textCard"
                    ? t("composer.cardContent", "卡片内容")
                    : t("composer.plainText", "正文段落")}
              </span>
              <button
                type="button"
                onClick={() => removeBlock(block.id)}
                className="ml-auto text-[11px] text-ink-ghost hover:text-rose-600 transition-colors cursor-pointer"
                title={t("composer.remove", "删除此块")}
              >
                ✕
              </button>
            </div>
            {block.type === "image" ? (
              <>
                <input
                  value={block.text}
                  onChange={(e) => patchBlock(block.id, { text: e.target.value })}
                  placeholder={t("composer.imagePromptPlaceholder", "描述想要的配图，例如：樱花树下的手帐桌")}
                  className="w-full px-2 py-1.5 text-[12px] bg-paper/80 rounded-lg border border-paper-deep/25 outline-none focus:border-bamboo/50 placeholder:text-ink-faint/70"
                />
                <div className="mt-1.5 flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => patchBlock(block.id, { imageUrl: buildGeneratedImageUrl(block.text) })}
                    className="rounded-lg bg-ink-soft/90 px-2 py-1 text-[11px] font-medium text-paper hover:opacity-90 cursor-pointer"
                  >
                    {t("composer.genImage", "生成配图")}
                  </button>
                  {block.imageUrl && (
                    <img
                      src={block.imageUrl}
                      alt={block.text || "配图"}
                      className="h-14 rounded-lg border border-paper-deep/20 object-cover"
                      loading="lazy"
                    />
                  )}
                </div>
              </>
            ) : (
              <textarea
                value={block.text}
                onChange={(e) => patchBlock(block.id, { text: e.target.value })}
                rows={block.type === "textCard" ? 5 : 3}
                className="w-full resize-y px-2 py-1.5 text-[12px] leading-relaxed bg-paper/80 rounded-lg border border-paper-deep/25 outline-none focus:border-bamboo/50"
              />
            )}
          </div>
        ))}
      </div>

      {status && <div className="mt-2 text-[11px] text-bamboo">{status}</div>}

      <div className="mt-2 flex items-center gap-1.5">
        <button type="button" onClick={handleCopyPost} className={ghostBtn}>
          {t("composer.copy", "复制正文")}
        </button>
        <button
          type="button"
          onClick={handleGoPublish}
          className="flex-1 rounded-lg bg-bamboo px-3 py-2 text-[12px] font-medium text-cloud transition-colors hover:bg-bamboo-light cursor-pointer"
        >
          {t("composer.goPublish", "生成作品 → 去发布")}
        </button>
      </div>
    </div>
  );
}
