import type { AppView } from "../components/AppSidebar";

/** 全局视图切换事件名（AppShell 监听后更新 sidebarView） */
export const NAVIGATE_EVENT = "floral:navigate";

/** 请求主窗口切换到指定视图（供画布等深层组件跳转侧边栏视图） */
export function navigateTo(view: AppView): void {
  window.dispatchEvent(new CustomEvent<AppView>(NAVIGATE_EVENT, { detail: view }));
}
