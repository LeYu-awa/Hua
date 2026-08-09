/** 首次进入画布的引导流程（ob-1/ob-2/ob-3/ob-4）状态与类型定义 */

export type OnboardingPhase = "idle" | "intro" | "demo" | "done";

/** 四项基础操作引导步骤 */
export type DemoStepId = "pan" | "zoom" | "create" | "move";

export interface DemoStepDef {
  id: DemoStepId;
  title: string;
  desc: string;
  /** 高亮目标：canvas=画布中心 / toolbar=工具栏 / node=画布上的卡片 */
  target: "canvas" | "toolbar" | "node";
}

export const DEMO_STEPS: DemoStepDef[] = [
  {
    id: "pan",
    title: "拖拽画布",
    desc: "按住空白处拖动，像挪动桌面纸张一样平移画布。试试看！",
    target: "canvas",
  },
  {
    id: "zoom",
    title: "缩放视图",
    desc: "按 Ctrl + 滚轮，或在右上角用 +/- 按钮调整缩放，聚焦细节。",
    target: "toolbar",
  },
  {
    id: "create",
    title: "新建卡片",
    desc: "点击左上角工具栏的「卡片」按钮，在画布上创建一张内容卡片。",
    target: "toolbar",
  },
  {
    id: "move",
    title: "移动卡片",
    desc: "按住刚创建的卡片拖动，把它放到你想放的位置。",
    target: "node",
  },
];

export const ONBOARDING_DONE_KEY = "floral_canvas_onboarding_done";
export const ONBOARDING_SEEN_KEY = "floral_canvas_onboarding_seen";

export function loadOnboardingPhase(): OnboardingPhase {
  try {
    if (window.localStorage.getItem(ONBOARDING_DONE_KEY) === "1") return "done";
  } catch {
    // ignore
  }
  return "idle";
}

export function markOnboardingDone() {
  try {
    window.localStorage.setItem(ONBOARDING_DONE_KEY, "1");
    window.localStorage.setItem(ONBOARDING_SEEN_KEY, "1");
  } catch {
    // ignore
  }
}

export function markOnboardingSeen() {
  try {
    window.localStorage.setItem(ONBOARDING_SEEN_KEY, "1");
  } catch {
    // ignore
  }
}

/** 每个引导步骤对应的「让 AI 帮我创作」快捷提问 */
export function aiPromptForStep(stepId: DemoStepId): string {
  switch (stepId) {
    case "pan":
      return "帮我设计一张演示卡片布局，示范如何用无限画布组织一个创作主题。";
    case "zoom":
      return "帮我规划一个大画布的模块分区，并给出缩放导航建议。";
    case "create":
      return "帮我生成一批内容卡片，用来收集当前创作的初始想法。";
    case "move":
      return "帮我按主题整理画布上已有的卡片，规划它们的位置布局。";
  }
}
