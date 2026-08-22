import { LINGCHAT_PET_ANIMATION_ROOT, LINGCHAT_PET_AUDIO_ROOT } from "./companionConfig";

/**
 * LingChat 桌宠情绪资产映射（移植自 LingChat `controllers/emotion/config.ts`）。
 *
 * - avatarFile：立绘文件名（`characters/{role}/avatar/{file}.webp`）
 * - bubbleImage：气泡表情图文件名（`public/lingchat-pet/animation/{file}.webp`，`none` = 无）
 * - bubbleClass：气泡 CSS 类（angry / happy / shy）
 * - audio：气泡音效文件名（`public/lingchat-pet/audio_effects/{file}.wav`，`none` = 无）
 */
export interface LingChatEmotionAsset {
  avatarFile: string;
  animation: string;
  bubbleImage: string;
  bubbleClass: string;
  audio: string;
}

/** 中文情绪标签 → 立绘文件名（对标 EMOTION_CONFIG_EMO；平静回退正常，兼容无"平静"立绘的角色） */
const TAG_TO_AVATAR: Record<string, string> = {
  厌恶: "厌恶",
  高兴: "高兴",
  担心: "担心",
  生气: "生气",
  紧张: "紧张",
  害怕: "害怕",
  害羞: "害羞",
  慌张: "慌张",
  认真: "认真",
  无奈: "无奈",
  兴奋: "兴奋",
  疑惑: "疑惑",
  哭泣: "伤心",
  心动: "心动",
  调皮: "调皮",
  难为情: "羞耻",
  自信: "自信",
  惊讶: "惊讶",
  正常: "正常",
  平静: "正常",
};

/** 花笺 6 元 mood → 立绘文件名 */
const MOOD_TO_AVATAR: Record<string, string> = {
  happy: "高兴",
  neutral: "正常",
  sleepy: "正常",
  excited: "兴奋",
  worried: "担心",
  curious: "疑惑",
};

/** 解析立绘文件名：优先中文情绪标签，其次 mood，兜底"正常" */
export function resolvePetAvatarFile(emotion?: string, mood?: string): string {
  if (emotion) {
    const tag = emotion.trim();
    if (TAG_TO_AVATAR[tag]) return TAG_TO_AVATAR[tag];
  }
  if (mood && MOOD_TO_AVATAR[mood]) return MOOD_TO_AVATAR[mood];
  return "正常";
}

/** 情绪名（气泡顶部青色斜体行）展示用：mood 无中文名时回退空 */
export function petEmotionLabel(emotion?: string, mood?: string): string {
  if (emotion && emotion.trim()) return emotion.trim();
  const LABEL: Record<string, string> = {
    happy: "高兴",
    neutral: "平静",
    sleepy: "犯困",
    excited: "兴奋",
    worried: "担心",
    curious: "好奇",
  };
  return mood ? LABEL[mood] ?? "" : "";
}

const NONE = "none";

/** 情绪 → 气泡表情/音效/动画配置（对标 EMOTION_CONFIG，路径改为文件名） */
export const LINGCHAT_EMOTION_ASSETS: Record<string, LingChatEmotionAsset> = {
  厌恶: { avatarFile: "厌恶", animation: NONE, bubbleImage: "生气.webp", bubbleClass: "angry", audio: "厌恶.wav" },
  高兴: { avatarFile: "高兴", animation: "happy-bounce", bubbleImage: "高兴.webp", bubbleClass: "happy", audio: "喜悦.wav" },
  担心: { avatarFile: "担心", animation: NONE, bubbleImage: "流泪.webp", bubbleClass: NONE, audio: "伤心.wav" },
  生气: { avatarFile: "生气", animation: "angry-jump", bubbleImage: "生气2.webp", bubbleClass: "angry", audio: "生气.wav" },
  紧张: { avatarFile: "紧张", animation: NONE, bubbleImage: "紧张.webp", bubbleClass: NONE, audio: "尴尬.wav" },
  害怕: { avatarFile: "害怕", animation: NONE, bubbleImage: "惊讶.webp", bubbleClass: NONE, audio: "震惊.wav" },
  害羞: { avatarFile: "害羞", animation: NONE, bubbleImage: "害羞.webp", bubbleClass: "shy", audio: "害羞.wav" },
  慌张: { avatarFile: "慌张", animation: NONE, bubbleImage: "慌乱.webp", bubbleClass: NONE, audio: "震惊.wav" },
  认真: { avatarFile: "认真", animation: "serious-think", bubbleImage: NONE, bubbleClass: NONE, audio: NONE },
  无奈: { avatarFile: "无奈", animation: NONE, bubbleImage: "叹气.webp", bubbleClass: NONE, audio: "叹气.wav" },
  兴奋: { avatarFile: "兴奋", animation: "happy-bounce", bubbleImage: "聊天.webp", bubbleClass: NONE, audio: "聊天.wav" },
  疑惑: { avatarFile: "疑惑", animation: NONE, bubbleImage: "疑问.webp", bubbleClass: NONE, audio: "疑问.wav" },
  哭泣: { avatarFile: "伤心", animation: NONE, bubbleImage: "流泪.webp", bubbleClass: NONE, audio: "伤心.wav" },
  心动: { avatarFile: "心动", animation: "heart-beat", bubbleImage: "心动.webp", bubbleClass: NONE, audio: "喜爱.wav" },
  调皮: { avatarFile: "调皮", animation: "naughty-bounce", bubbleImage: "高兴.webp", bubbleClass: NONE, audio: "愉快.wav" },
  难为情: { avatarFile: "羞耻", animation: "embarrassed-emo", bubbleImage: "难为情.webp", bubbleClass: NONE, audio: "察觉.wav" },
  自信: { avatarFile: "自信", animation: NONE, bubbleImage: "高兴.webp", bubbleClass: NONE, audio: "愉快.wav" },
  惊讶: { avatarFile: "惊讶", animation: NONE, bubbleImage: "惊讶.webp", bubbleClass: NONE, audio: "察觉.wav" },
  平静: { avatarFile: "正常", animation: NONE, bubbleImage: NONE, bubbleClass: NONE, audio: NONE },
  正常: { avatarFile: "正常", animation: NONE, bubbleImage: NONE, bubbleClass: NONE, audio: NONE },
  AI思考: { avatarFile: "正常", animation: NONE, bubbleImage: "AI思考.webp", bubbleClass: NONE, audio: "无语.wav" },
};

export function resolveBubbleImageUrl(imageFile: string): string {
  return `${LINGCHAT_PET_ANIMATION_ROOT}/${imageFile}`;
}

export function resolveBubbleAudioUrl(audioFile: string): string {
  return `${LINGCHAT_PET_AUDIO_ROOT}/${audioFile}`;
}
