import type { AppView } from "../components/AppSidebar";

/** 全局视图切换事件名（AppShell 监听后更新 sidebarView） */
export const NAVIGATE_EVENT = "floral:navigate";

/** 桌宠「设置」按钮事件：设置页已挂载时用于切到「桌宠」tab */
export const OPEN_PET_SETTINGS_EVENT = "floral:open-pet-settings";

/** 请求主窗口切换到指定视图（供画布等深层组件跳转侧边栏视图） */
export function navigateTo(view: AppView): void {
  window.dispatchEvent(new CustomEvent<AppView>(NAVIGATE_EVENT, { detail: view }));
}

let pendingPetSettings: { section: "elysia"; tab: "pet" } | null = null;

/** 桌宠「设置」按钮：跳到设置页并打开桌宠 tab（LingChat 立绘左侧齿轮） */
export function openPetSettings(): void {
  pendingPetSettings = { section: "elysia", tab: "pet" };
  navigateTo("settings");
  window.setTimeout(() => {
    window.dispatchEvent(new CustomEvent(OPEN_PET_SETTINGS_EVENT));
  }, 0);
}

/** 设置页挂载时消费深链（取一次即清空） */
export function consumePetSettingsDeepLink(): { section: "elysia"; tab: "pet" } | null {
  const link = pendingPetSettings;
  pendingPetSettings = null;
  return link;
}
