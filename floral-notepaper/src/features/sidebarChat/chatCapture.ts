import { toPng } from "html-to-image";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";

export interface ChatCaptureResult {
  status: "saved" | "canceled" | "failed";
  message: string;
}

/** 图片拉取失败时的占位（1x1 透明 PNG），避免整张截图因个别跨域图片而失败 */
const IMAGE_PLACEHOLDER =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

function resolveBackground(node: HTMLElement): string {
  const style = getComputedStyle(node);
  if (style.backgroundColor && !/rgba\(0, 0, 0, 0\)|transparent/.test(style.backgroundColor)) {
    return style.backgroundColor;
  }
  const warm = getComputedStyle(document.documentElement)
    .getPropertyValue("--color-paper-warm")
    .trim();
  return warm || "#f0f3f6";
}

/** 把跨域图片预取为 dataURL（避免导出时 canvas 被污染） */
async function collectImageDataUrls(node: HTMLElement): Promise<Map<string, string>> {
  const cache = new Map<string, string>();
  const images = Array.from(node.querySelectorAll<HTMLImageElement>("img"));
  await Promise.all(
    images.map(async (img) => {
      const url = img.currentSrc || img.src;
      if (!url || url.startsWith("data:") || url.startsWith("blob:")) return;
      if (cache.has(url)) return;
      try {
        const res = await fetch(url, { mode: "cors" });
        if (!res.ok) return;
        const blob = await res.blob();
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(blob);
        });
        cache.set(url, dataUrl);
      } catch {
        // 拉取失败（实例未开 CORS 等）保持原样，由 imagePlaceholder 兜底
      }
    }),
  );
  return cache;
}

async function captureChatAsPng(node: HTMLElement): Promise<string> {
  const imageDataUrls = await collectImageDataUrls(node);
  // 当前 html-to-image 版本无 onclone 钩子：临时把已预取的图片换成 dataURL，
  // 导出完成后立即恢复，避免截图期间闪现占位。
  const images = Array.from(node.querySelectorAll<HTMLImageElement>("img"));
  const originals = new Map<HTMLImageElement, string>();
  images.forEach((img) => {
    const url = img.currentSrc || img.src;
    const cached = imageDataUrls.get(url);
    if (cached && img.src !== cached) {
      originals.set(img, img.src);
      img.src = cached;
    }
  });
  try {
    return await toPng(node, {
      pixelRatio: 2,
      cacheBust: true,
      skipFonts: true,
      imagePlaceholder: IMAGE_PLACEHOLDER,
      backgroundColor: resolveBackground(node),
      width: node.offsetWidth,
      height: node.scrollHeight,
      style: {
        overflow: "visible",
        height: `${node.scrollHeight}px`,
      },
    });
  } finally {
    originals.forEach((src, img) => {
      img.src = src;
    });
  }
}

function timestampLabel(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

/**
 * 把对话面板节点导出为 PNG 并弹出保存对话框写入磁盘。
 * 返回 saved（含保存路径）/ canceled（用户取消）/ failed（含错误信息）。
 */
export async function saveChatScreenshot(node: HTMLElement): Promise<ChatCaptureResult> {
  try {
    const dataUrl = await captureChatAsPng(node);
    const path = await save({
      title: "导出对话截图",
      defaultPath: `对话截图-${timestampLabel()}.png`,
      filters: [{ name: "PNG 图片", extensions: ["png"] }],
    });
    if (!path) return { status: "canceled", message: "" };
    const bytes = new Uint8Array(await (await fetch(dataUrl)).arrayBuffer());
    await invoke("save_binary_file", { path, data: bytes });
    return { status: "saved", message: path };
  } catch (err) {
    return {
      status: "failed",
      message: err instanceof Error ? err.message : String(err),
    };
  }
}
