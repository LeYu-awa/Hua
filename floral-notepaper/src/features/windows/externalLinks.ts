import { openUrl } from "@tauri-apps/plugin-opener";

/**
 * 判断一个链接是否应交给系统默认浏览器打开（而不是在应用 webview 内导航）。
 * - http/https：仅当目标 origin 与应用不同源时视为外部链接
 * - mailto/tel：一律视为外部
 */
export function shouldOpenExternally(href: string, appOrigin = window.location.origin): boolean {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return false;
  }
  if (url.protocol === "mailto:" || url.protocol === "tel:") return true;
  return (url.protocol === "http:" || url.protocol === "https:") && url.origin !== appOrigin;
}

/**
 * 全局拦截裸外部链接点击。应用内 markdown（如 AI 助手回复、搜索结果）渲染出的
 * `<a href="https://...">` 没有 target="_blank"，默认行为会让 webview 直接导航到
 * 外部站点——主窗口被整页替换（"打开链接全屏占用窗口"）；随后浏览器级"返回"
 * 又回到应用地址、触发整个应用重新加载（"回退导致进程刷新重启"）。
 *
 * 此处理器统一把这类链接交给系统浏览器打开，同时保持 webview 历史干净。
 * 已由组件自身 onClick（如 MarkdownPreview 的锚点）或 opener 插件处理过的
 * 点击（defaultPrevented）会被跳过，避免重复打开。
 */
export function installExternalLinkHandler(): () => void {
  const handleClick = (event: MouseEvent) => {
    if (event.defaultPrevented || event.button !== 0) return;
    const anchor = event
      .composedPath()
      .find(
        (el): el is HTMLAnchorElement =>
          el instanceof HTMLAnchorElement && el.href.length > 0,
      );
    if (!anchor) return;
    if (!shouldOpenExternally(anchor.href)) return;
    event.preventDefault();
    void openUrl(anchor.href).catch(() => {});
  };
  window.addEventListener("click", handleClick);
  return () => window.removeEventListener("click", handleClick);
}
