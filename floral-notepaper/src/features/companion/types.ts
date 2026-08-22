export type CompanionMode = "embedded" | "floating";
export type CompanionRenderer = "sprite" | "live2d" | "lingchat";
export type CompanionInputMode = "keyboard" | "gamepad" | "standard";
export type CompanionSkinId =
  | "a-yuno-keyboard"
  | "a-yuno-gamepad"
  | "a-yuno-standard"
  | "bongocat-classic"
  | "haru-cdn"
  | "hiyori"
  | "aquarius-love"
  | "miku"
  | "lingchat-nuoyi"
  | "lingchat-fengxue"
  | "lingchat-deepseek"
  | "custom";
/** 桌宠粒子特效（对标 LingChat PetTab：None / StarField / BA） */
export type PetEffectId = "none" | "starfield" | "ba";
export type Live2DCarouselOrder = "sequential" | "reverse" | "random";

export type CompanionAction =
  | "idle"
  | "typing"
  | "pause"
  | "delete"
  | "save"
  | "complete"
  | "effect"
  | "moveLeft"
  | "moveRight"
  | "moveUp"
  | "moveDown"
  | "hide";

export type PawState = "none" | "left" | "right" | "both";

export interface CompanionSensitivity {
  inputDebounceMs: number;
  idleTimeoutMs: number;
  typingIntensity: number;
  mouseFollowStrength: number;
  motionCooldownMs: number;
}

export interface BongocatMotionMap {
  idle: string;
  typingLeft: string;
  typingRight: string;
  typingBoth: string;
  pause: string;
  delete: string;
  save: string;
  complete: string;
  hidden: string;
}

export interface Live2DCarouselConfig {
  enabled: boolean;
  images: string[];
  intervalMs: number;
  order: Live2DCarouselOrder;
  currentIndex: number;
}

/** LingChat 桌宠角色配置（渲染器为 lingchat 时生效） */
export interface LingChatPetConfig {
  /** 角色文件夹名（诺一钦灵 / 风雪 / DeepSeek），对应 public/lingchat-pet/characters/ 下的目录 */
  roleFolder: string;
  /** 服装名（诺一钦灵有"泳装"子目录，默认空 = 根目录立绘） */
  clothesName: string;
  /** 粒子特效：None / StarField / BA */
  effect: PetEffectId;
  /** 气泡表情音效音量 0~100 */
  bubbleVolume: number;
  /** 角色语音音量 0~100 */
  characterVolume: number;
  /** 气泡打字机速度（字符/秒） */
  typeWriterSpeed: number;
}

export interface CompanionConfig {
  enabled: boolean;
  mode: CompanionMode;
  renderer: CompanionRenderer;
  inputMode: CompanionInputMode;
  skinId: CompanionSkinId;
  skinRevision: string;
  modelPath: string;
  visible: boolean;
  alwaysOnTop: boolean;
  position: { x: number; y: number };
  scale: number;
  opacity: number;
  sensitivity: CompanionSensitivity;
  carousel: Live2DCarouselConfig;
  motionMap: BongocatMotionMap;
  pet: LingChatPetConfig;
}

export interface CompanionInputEvent {
  type:
    | "input"
    | "delete"
    | "save"
    | "complete"
    | "effect"
    | "moveLeft"
    | "moveRight"
    | "moveUp"
    | "moveDown"
    | "pause"
    | "hide"
    | "show";
  timestamp: number;
}

export interface BongocatActionState {
  action: CompanionAction;
  paw: PawState;
  intensity: number;
  lastEventAt: number;
}
