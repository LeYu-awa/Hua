/**
 * LingChat 桌宠主动系统配置（移植自 LingChat settings_pet WindowTab，MIT）。
 * 原版通过后端环境变量控制主动消息；此处适配为 localStorage 持久化 +
 * 桌宠层定时广播（emitLive2DSpeak）。
 */

export interface LingChatProactiveConfig {
  enabled: boolean;
  /** 主动问候触发间隔（分钟） */
  intervalMin: number;
}

const STORAGE_KEY = "lingchat_pet_proactive";

export const DEFAULT_PROACTIVE_CONFIG: LingChatProactiveConfig = {
  enabled: false,
  intervalMin: 15,
};

export function loadProactiveConfig(): LingChatProactiveConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_PROACTIVE_CONFIG };
    const parsed = JSON.parse(raw) as Partial<LingChatProactiveConfig>;
    return {
      enabled: Boolean(parsed.enabled),
      intervalMin:
        Number(parsed.intervalMin) > 0 ? Number(parsed.intervalMin) : DEFAULT_PROACTIVE_CONFIG.intervalMin,
    };
  } catch {
    return { ...DEFAULT_PROACTIVE_CONFIG };
  }
}

export function saveProactiveConfig(config: LingChatProactiveConfig) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
}

/** 主动问候语池（带【情绪】标签驱动立绘） */
export const PET_PROACTIVE_GREETINGS: Array<{ text: string; emotion: string }> = [
  { text: "嗨，想我了吗？", emotion: "高兴" },
  { text: "在忙什么呀？要不要歇一会儿？", emotion: "调皮" },
  { text: "好久没和你说话啦，有点想你～", emotion: "害羞" },
  { text: "今天的灵感怎么样？我可以陪你一起写哦。", emotion: "认真" },
  { text: "咦，你怎么发呆啦？", emotion: "疑惑" },
];
