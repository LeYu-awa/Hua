export type CompanionMode = "embedded" | "floating";
export type CompanionRenderer = "sprite" | "live2d";
export type CompanionInputMode = "keyboard" | "gamepad" | "standard";
export type CompanionSkinId = "a-yuno-keyboard" | "a-yuno-gamepad" | "a-yuno-standard" | "bongocat-classic" | "haru-cdn" | "hiyori" | "aquarius-love" | "custom";
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
