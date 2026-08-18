import { useEffect, useMemo, useState } from "react";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { downloadBlob } from "../../canvas/canvasExport";
import { createArticle } from "../../garden/api";
import { useAuthGate } from "../../auth/authGate";
import {
  SOCIAL_PLATFORMS,
  checkSocialCompliance,
  type SocialPlatformId,
} from "../platformSpecs";
import {
  buildSocialCardSvg,
  composeSocialPostText,
  socialCardToPngBlob,
} from "../socialCard";

interface SocialPublishPageProps {
  /** 登录用户 id；未登录（游客）时为空，导出/复制可用，发布需登录 */
  userId?: string;
}

type PublishStatus =
  | { kind: "idle" }
  | { kind: "success"; message: string }
  | { kind: "error"; message: string };

function timestampLabel(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

/**
 * 社交发布面板：文字 → 可视化社交素材（SVG 卡片）→ 平台尺寸 PNG 导出 / 复制正文 /
 * 发布到内容聚合花园。端到端闭环的交互入口，与 Agent 的 social.generate 工具同源。
 */
export function SocialPublishPage({ userId }: SocialPublishPageProps) {
  const { ensureLogin } = useAuthGate();
  const [platform, setPlatform] = useState<SocialPlatformId>("xiaohongshu");
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [tagsText, setTagsText] = useState("");
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [status, setStatus] = useState<PublishStatus>({ kind: "idle" });
  const [busy, setBusy] = useState(false);

  // 接收画布「发布编排」生成的草稿：作品标题 / 编排正文 / 话题标签
  useEffect(() => {
    try {
      const raw = localStorage.getItem("floral.socialDraft");
      if (!raw) return;
      const draft = JSON.parse(raw) as { title?: string; text?: string; tags?: string[] };
      if (draft.title) setTitle(draft.title);
      if (draft.text) setText(draft.text);
      if (Array.isArray(draft.tags) && draft.tags.length > 0) {
        setTagsText(draft.tags.map((tag) => `#${tag}`).join(" "));
      }
      localStorage.removeItem("floral.socialDraft");
    } catch {
      // 草稿损坏时静默忽略，不阻断发布页
    }
  }, []);

  const spec = SOCIAL_PLATFORMS.find((item) => item.id === platform) ?? SOCIAL_PLATFORMS[0];
  const tags = useMemo(
    () =>
      tagsText
        .split(/[,，、\s]+/)
        .map((tag) => tag.replace(/^#/, "").trim())
        .filter(Boolean),
    [tagsText],
  );

  const compliance = useMemo(
    () => checkSocialCompliance(text, tags, 1, spec),
    [text, tags, spec],
  );

  const svgDataUrl = useMemo(() => {
    const svg = buildSocialCardSvg({ title, text, tags, platform, theme });
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  }, [title, text, tags, platform, theme]);

  const handleExport = async () => {
    setBusy(true);
    setStatus({ kind: "idle" });
    try {
      const blob = await socialCardToPngBlob({ title, text, tags, platform, theme });
      downloadBlob(blob, `社交卡片-${spec.name}-${timestampLabel()}.png`);
      setStatus({ kind: "success", message: `已导出 ${spec.canvas.width}×${spec.canvas.height} PNG（2x 高清）` });
    } catch (error) {
      setStatus({ kind: "error", message: String(error) });
    } finally {
      setBusy(false);
    }
  };

  const handleCopy = async () => {
    const post = composeSocialPostText(title, text, tags);
    if (!post.trim()) {
      setStatus({ kind: "error", message: "正文为空，无法复制" });
      return;
    }
    await writeText(post);
    setStatus({ kind: "success", message: "已复制完整发布正文（含话题标签）到剪贴板" });
  };

  const handlePublish = async () => {
    if (!ensureLogin("发布作品到花园需要登录")) return;
    if (!text.trim()) {
      setStatus({ kind: "error", message: "正文为空，无法发布" });
      return;
    }
    if (!compliance.passed) {
      setStatus({ kind: "error", message: "合规预检未通过，请先处理标红的需处理项" });
      return;
    }
    setBusy(true);
    setStatus({ kind: "idle" });
    try {
      const post = composeSocialPostText(title, text, tags);
      const article = await createArticle(
        {
          title: title.trim() || `社交动态 · ${new Date().toLocaleDateString("zh-CN")}`,
          summary: text.replace(/\s+/g, " ").slice(0, 80),
          content: post,
          tags,
          isPublic: true,
          categoryId: undefined,
        },
        userId as string,
      );
      setStatus(
        article
          ? { kind: "success", message: "已发布到内容聚合花园（garden_articles），可前往「花园」查看" }
          : { kind: "error", message: "发布失败：花园未返回记录" },
      );
    } catch (error) {
      setStatus({ kind: "error", message: `发布失败：${String(error)}` });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="h-full flex flex-col bg-paper">
      <header className="flex items-center justify-between border-b border-paper-deep/40 px-5 py-3">
        <div>
          <h1 className="text-[15px] font-semibold text-ink">社交发布</h1>
          <p className="text-[11px] text-ink-faint">
            文字内容 → 可视化社交素材 → 多平台发布闭环
          </p>
        </div>
        <div className="flex items-center gap-1 rounded-lg border border-paper-deep/40 bg-white/60 p-0.5">
          {SOCIAL_PLATFORMS.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setPlatform(item.id)}
              className={`rounded-md px-3 py-1 text-[12px] transition-colors ${
                platform === item.id
                  ? "bg-white text-ink shadow-sm"
                  : "text-ink-faint hover:text-ink"
              }`}
            >
              {item.name}
            </button>
          ))}
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* 编辑区 */}
        <div className="w-[46%] min-w-[360px] overflow-y-auto border-r border-paper-deep/40 p-5">
          <div className="space-y-4">
            <div>
              <label className="mb-1 block text-[12px] font-medium text-ink-faint">标题（选填）</label>
              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="一句话点题，会渲染在卡片顶部"
                className="w-full rounded-lg border border-paper-deep/50 bg-white px-3 py-2 text-[13px] text-ink outline-none transition-colors focus:border-ink-faint"
              />
            </div>

            <div>
              <div className="mb-1 flex items-center justify-between">
                <label className="text-[12px] font-medium text-ink-faint">正文（原创内容）</label>
                <span
                  className={`text-[11px] ${[...text].length > spec.maxTextLength ? "text-red-500" : "text-ink-faint"}`}
                >
                  {[...text].length} / {spec.maxTextLength} 字
                </span>
              </div>
              <textarea
                value={text}
                onChange={(event) => setText(event.target.value)}
                placeholder={"写下你想发布的原创内容…\n例如：今天在花园里读完了《小王子》，夕阳把纸页染成琥珀色。"}
                className="h-56 w-full resize-none rounded-lg border border-paper-deep/50 bg-white px-3 py-2 text-[13px] leading-relaxed text-ink outline-none transition-colors focus:border-ink-faint"
              />
            </div>

            <div>
              <label className="mb-1 block text-[12px] font-medium text-ink-faint">
                话题标签（逗号/空格分隔，# 可选）
              </label>
              <input
                value={tagsText}
                onChange={(event) => setTagsText(event.target.value)}
                placeholder="读书, 日落, 生活记录"
                className="w-full rounded-lg border border-paper-deep/50 bg-white px-3 py-2 text-[13px] text-ink outline-none transition-colors focus:border-ink-faint"
              />
            </div>

            <div className="flex items-center justify-between">
              <span className="text-[12px] font-medium text-ink-faint">卡片主题</span>
              <div className="flex items-center gap-1 rounded-lg border border-paper-deep/40 bg-white/60 p-0.5">
                {(["light", "dark"] as const).map((value) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setTheme(value)}
                    className={`rounded-md px-3 py-1 text-[12px] transition-colors ${
                      theme === value ? "bg-white text-ink shadow-sm" : "text-ink-faint hover:text-ink"
                    }`}
                  >
                    {value === "light" ? "浅色" : "深色"}
                  </button>
                ))}
              </div>
            </div>

            {/* 合规预检 */}
            <div
              className={`rounded-lg border px-3 py-2.5 ${
                compliance.passed
                  ? "border-emerald-200 bg-emerald-50/60"
                  : "border-amber-200 bg-amber-50/60"
              }`}
            >
              <div className="text-[12px] font-medium">
                {compliance.passed ? "合规预检通过" : `存在 ${compliance.issues.filter((i) => i.severity === "error").length} 个需处理项`}
              </div>
              {compliance.issues.length > 0 && (
                <ul className="mt-1.5 space-y-1 text-[12px]">
                  {compliance.issues.map((issue, index) => (
                    <li key={index} className={issue.severity === "error" ? "text-red-600" : "text-amber-600"}>
                      {issue.severity === "error" ? "需处理" : "提示"}：{issue.message}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* 操作按钮 */}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleExport}
                disabled={busy || !text.trim()}
                className="rounded-lg bg-ink px-4 py-2 text-[13px] font-medium text-paper transition-opacity hover:opacity-85 disabled:cursor-not-allowed disabled:opacity-40"
              >
                导出 PNG
              </button>
              <button
                type="button"
                onClick={handleCopy}
                disabled={busy}
                className="rounded-lg border border-paper-deep/60 bg-white px-4 py-2 text-[13px] font-medium text-ink transition-colors hover:border-ink-faint"
              >
                复制正文
              </button>
              <button
                type="button"
                onClick={handlePublish}
                disabled={busy || !text.trim()}
                className="rounded-lg px-4 py-2 text-[13px] font-medium text-white transition-opacity hover:opacity-85 disabled:cursor-not-allowed disabled:opacity-40"
                style={{ backgroundColor: spec.accent }}
              >
                {busy ? "处理中…" : "发布到花园"}
              </button>
            </div>

            {status.kind !== "idle" && (
              <div
                className={`rounded-lg border px-3 py-2 text-[12px] ${
                  status.kind === "success"
                    ? "border-emerald-200 bg-emerald-50/60 text-emerald-700"
                    : "border-red-200 bg-red-50/60 text-red-600"
                }`}
              >
                {status.message}
              </div>
            )}

            {/* 平台规范提示 */}
            <div className="rounded-lg border border-paper-deep/40 bg-white/60 p-3">
              <div className="mb-1.5 text-[12px] font-medium text-ink">
                {spec.name} · {spec.ratioLabel} · {spec.canvas.width}×{spec.canvas.height}
              </div>
              <ul className="space-y-1 text-[12px] text-ink-faint">
                {spec.tips.map((tip, index) => (
                  <li key={index} className="flex gap-1.5">
                    <span className="shrink-0">·</span>
                    <span>{tip}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>

        {/* 预览区 */}
        <div className="flex flex-1 flex-col items-center overflow-y-auto bg-paper-deep/20 p-6">
          <div className="mb-3 flex items-center gap-2 text-[11px] text-ink-faint">
            <span className="rounded border border-paper-deep/50 bg-white px-2 py-0.5">实时预览</span>
            <span>
              {spec.canvas.width}×{spec.canvas.height} · 导出为 2x 高清 PNG
            </span>
          </div>
          <div
            className="shrink-0 overflow-hidden rounded-lg shadow-lg ring-1 ring-black/5"
            style={{ width: Math.min(360, Math.round(spec.canvas.width / 3)), aspectRatio: `${spec.canvas.width} / ${spec.canvas.height}` }}
          >
            <img
              src={svgDataUrl}
              alt="社交卡片实时预览"
              className="h-full w-full object-cover"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
