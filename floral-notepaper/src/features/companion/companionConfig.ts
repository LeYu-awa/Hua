import type {
  BongocatActionState,
  CompanionConfig,
  CompanionInputMode,
  CompanionSkinId,
} from "./types";

export const BUILT_IN_YUNO_SKIN_REVISION = "yuno-resource-manifest-v4";
export const BUILT_IN_YUNO_ASSET_ROOT = "/live2d/yuno-official-no-expression/A-尤诺/img";
export const BUILT_IN_YUNO_LEGACY_ASSET_ROOT = "/live2d/yuno-no-expression/A-尤诺/img";
export const BUILT_IN_YUNO_ASSET_BASE = `${BUILT_IN_YUNO_ASSET_ROOT}/standard`;
export const BUILT_IN_YUNO_KEYBOARD_BASE = `${BUILT_IN_YUNO_ASSET_ROOT}/keyboard`;
export const BUILT_IN_YUNO_GAMEPAD_BASE = `${BUILT_IN_YUNO_ASSET_ROOT}/gamepad`;
export const BUILT_IN_YUNO_MODEL_PATH = `${BUILT_IN_YUNO_ASSET_BASE}/cat_model/cat.model3.json`;
export const BUILT_IN_YUNO_KEYBOARD_MODEL_PATH = `${BUILT_IN_YUNO_KEYBOARD_BASE}/cat_model/cat.model3.json`;
export const BUILT_IN_YUNO_GAMEPAD_MODEL_PATH = `${BUILT_IN_YUNO_GAMEPAD_BASE}/cat_model/cat.model3.json`;

/** Haru 本地模型地址 */
export const HARU_LOCAL_BASE = "/live2d/haru";
export const HARU_LOCAL_MODEL_PATH = `${HARU_LOCAL_BASE}/Haru.model3.json`;

/** 水瓶座之恋本地模型地址 */
export const AQUARIUS_LOCAL_BASE = "/live2d/aquarius-love/model-4096";
export const AQUARIUS_LOCAL_MODEL_PATH = `${AQUARIUS_LOCAL_BASE}/aquarius.model3.json`;

/** Hiyori 官方样例模型地址 */
export const HIYORI_LOCAL_BASE = "/live2d/hiyori";
export const HIYORI_LOCAL_MODEL_PATH = `${HIYORI_LOCAL_BASE}/Hiyori.model3.json`;

/** Miku 本地模型地址 */
export const MIKU_LOCAL_BASE = "/live2d/miku";
export const MIKU_LOCAL_MODEL_PATH = `${MIKU_LOCAL_BASE}/miku.model3.json`;

export const BUILT_IN_LIVE2D_MODEL_OPTIONS = [
  {
    skinId: "haru-cdn",
    label: "Haru",
    revision: "haru-local-v2",
    modelPath: HARU_LOCAL_MODEL_PATH,
  },
  {
    skinId: "hiyori",
    label: "Hiyori",
    revision: "hiyori-local-v1",
    modelPath: HIYORI_LOCAL_MODEL_PATH,
  },
  {
    skinId: "aquarius-love",
    label: "水瓶座之恋",
    revision: "aquarius-love-local-v2",
    modelPath: AQUARIUS_LOCAL_MODEL_PATH,
  },
  { skinId: "miku", label: "Miku", revision: "miku-local-v1", modelPath: MIKU_LOCAL_MODEL_PATH },
] satisfies Array<{ skinId: CompanionSkinId; label: string; revision: string; modelPath: string }>;

// ---- LingChat 桌宠角色（2D 情绪立绘，非 Live2D）----
export const LINGCHAT_PET_ASSET_ROOT = "/lingchat-pet";
export const LINGCHAT_PET_CHARACTERS_ROOT = `${LINGCHAT_PET_ASSET_ROOT}/characters`;
export const LINGCHAT_PET_ANIMATION_ROOT = `${LINGCHAT_PET_ASSET_ROOT}/animation`;
export const LINGCHAT_PET_AUDIO_ROOT = `${LINGCHAT_PET_ASSET_ROOT}/audio_effects`;

export const BUILT_IN_LINGCHAT_PET_OPTIONS = [
  {
    skinId: "lingchat-nuoyi",
    label: "诺一钦灵",
    roleFolder: "诺一钦灵",
    revision: "lingchat-nuoyi-v1",
  },
  {
    skinId: "lingchat-fengxue",
    label: "风雪",
    roleFolder: "风雪",
    revision: "lingchat-fengxue-v1",
  },
  {
    skinId: "lingchat-deepseek",
    label: "DeepSeek",
    roleFolder: "DeepSeek",
    revision: "lingchat-deepseek-v1",
  },
] satisfies Array<{
  skinId: CompanionSkinId;
  label: string;
  roleFolder: string;
  revision: string;
}>;

/** 解析角色立绘 URL：clothesName 非空时指向其子目录（如 诺一钦灵/avatar/泳装/高兴.webp） */
export function resolveLingChatAvatarUrl(roleFolder: string, clothesName: string, emotion: string) {
  const clothes = clothesName && clothesName !== "默认" ? `${clothesName}/` : "";
  return `${LINGCHAT_PET_CHARACTERS_ROOT}/${encodeURIComponent(roleFolder)}/avatar/${clothes}${encodeURIComponent(emotion)}.webp`;
}

const KEYBOARD_HAND_FRAMES = [0, 1, 2, 3, "leftup", "rightup"];
export const BUILT_IN_YUNO_STANDARD_HAND_IMAGES = Array.from(
  { length: 90 },
  (_, index) => `${BUILT_IN_YUNO_ASSET_BASE}/hand/${index}.png`,
);
export const BUILT_IN_YUNO_STANDARD_CAROUSEL_IMAGES = [
  `${BUILT_IN_YUNO_ASSET_BASE}/cat.png`,
  `${BUILT_IN_YUNO_ASSET_BASE}/mousebg.png`,
  `${BUILT_IN_YUNO_ASSET_BASE}/tabletbg.png`,
  `${BUILT_IN_YUNO_ASSET_BASE}/mouse.png`,
  `${BUILT_IN_YUNO_ASSET_BASE}/mouse_left.png`,
  `${BUILT_IN_YUNO_ASSET_BASE}/mouse_right.png`,
  `${BUILT_IN_YUNO_ASSET_BASE}/mouse_side.png`,
  `${BUILT_IN_YUNO_ASSET_BASE}/tablet.png`,
  `${BUILT_IN_YUNO_ASSET_BASE}/tablet_left.png`,
  `${BUILT_IN_YUNO_ASSET_BASE}/tablet_right.png`,
  `${BUILT_IN_YUNO_ASSET_BASE}/arm.png`,
  `${BUILT_IN_YUNO_ASSET_BASE}/arm副本.png`,
  `${BUILT_IN_YUNO_ASSET_BASE}/righthand.png`,
  `${BUILT_IN_YUNO_ASSET_BASE}/up.png`,
  ...BUILT_IN_YUNO_STANDARD_HAND_IMAGES,
];
export const BUILT_IN_YUNO_CAROUSEL_IMAGES = [
  `${BUILT_IN_YUNO_KEYBOARD_BASE}/cat.png`,
  `${BUILT_IN_YUNO_KEYBOARD_BASE}/bg.png`,
  ...Array.from(
    { length: 7 },
    (_, index) => `${BUILT_IN_YUNO_KEYBOARD_BASE}/keyboard/${index}.png`,
  ),
  ...KEYBOARD_HAND_FRAMES.map((frame) => `${BUILT_IN_YUNO_KEYBOARD_BASE}/lefthand/${frame}.png`),
  ...KEYBOARD_HAND_FRAMES.map((frame) => `${BUILT_IN_YUNO_KEYBOARD_BASE}/righthand/${frame}.png`),
  `${BUILT_IN_YUNO_KEYBOARD_BASE}/face/0.png`,
  `${BUILT_IN_YUNO_KEYBOARD_BASE}/face/1.png`,
  `${BUILT_IN_YUNO_KEYBOARD_BASE}/face/2.png`,
  `${BUILT_IN_YUNO_KEYBOARD_BASE}/face/3.png`,
];
export const BUILT_IN_YUNO_GAMEPAD_CAROUSEL_IMAGES = [
  `${BUILT_IN_YUNO_GAMEPAD_BASE}/cat.png`,
  `${BUILT_IN_YUNO_GAMEPAD_BASE}/bg.png`,
  `${BUILT_IN_YUNO_GAMEPAD_BASE}/left_stick.png`,
  `${BUILT_IN_YUNO_GAMEPAD_BASE}/left_stick_down.png`,
  `${BUILT_IN_YUNO_GAMEPAD_BASE}/right_stick.png`,
  `${BUILT_IN_YUNO_GAMEPAD_BASE}/right_stick_down.png`,
  `${BUILT_IN_YUNO_GAMEPAD_BASE}/arm_L.png`,
  `${BUILT_IN_YUNO_GAMEPAD_BASE}/arm_R.png`,
  ...Array.from(
    { length: 12 },
    (_, index) => `${BUILT_IN_YUNO_GAMEPAD_BASE}/keyboard/${index}.png`,
  ),
  `${BUILT_IN_YUNO_GAMEPAD_BASE}/face/0.png`,
  `${BUILT_IN_YUNO_GAMEPAD_BASE}/face/1.png`,
  `${BUILT_IN_YUNO_GAMEPAD_BASE}/face/2.png`,
  `${BUILT_IN_YUNO_GAMEPAD_BASE}/face/3.png`,
];

const LEGACY_YUNO_ASSET_ROOTS = [
  ["/live2d/yuno-official-no-expression/a-yuno/img", BUILT_IN_YUNO_ASSET_ROOT],
  ["/live2d/yuno-no-expression/a-yuno/img", BUILT_IN_YUNO_LEGACY_ASSET_ROOT],
] as const;
const STORAGE_KEY = "hanasu_bongocat_companion_config";
const CONFIG_EVENT = "companion-config-changed";
const ACTION_STATE_KEY = "hanasu_bongocat_companion_action_state";
const ACTION_STATE_EVENT = "companion-action-state-changed";

export const DEFAULT_COMPANION_CONFIG: CompanionConfig = {
  enabled: true,
  mode: "embedded",
  renderer: "live2d",
  inputMode: "keyboard",
  skinId: "haru-cdn",
  skinRevision: "haru-local-v2",
  modelPath: HARU_LOCAL_MODEL_PATH,
  visible: true,
  alwaysOnTop: false,
  position: { x: 24, y: 24 },
  scale: 0.82,
  opacity: 0.92,
  sensitivity: {
    inputDebounceMs: 80,
    idleTimeoutMs: 1600,
    typingIntensity: 0.72,
    mouseFollowStrength: 0.75,
    motionCooldownMs: 120,
  },
  carousel: {
    enabled: false,
    images: [],
    intervalMs: 2400,
    order: "sequential",
    currentIndex: 0,
  },
  motionMap: {
    idle: "Idle",
    typingLeft: "TapBody",
    typingRight: "TapBody",
    typingBoth: "TapBody",
    pause: "Idle",
    delete: "Idle",
    save: "Idle",
    complete: "TapBody",
    hidden: "Idle",
  },
  pet: {
    roleFolder: "诺一钦灵",
    clothesName: "",
    effect: "none",
    bubbleVolume: 70,
    characterVolume: 80,
    typeWriterSpeed: 30,
  },
};

export const DEFAULT_COMPANION_ACTION_STATE: BongocatActionState = {
  action: "idle",
  paw: "none",
  intensity: 0,
  lastEventAt: 0,
};

export function loadCompanionConfig() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return { ...DEFAULT_COMPANION_CONFIG };
    return mergeCompanionConfig(JSON.parse(saved));
  } catch {
    return { ...DEFAULT_COMPANION_CONFIG };
  }
}

export function saveCompanionConfig(config: CompanionConfig) {
  const next = mergeCompanionConfig({ ...config, mode: "embedded" });
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  window.dispatchEvent(new Event(CONFIG_EVENT));
}

export function saveCompanionPosition(position: CompanionConfig["position"]) {
  const latest = loadCompanionConfig();
  const next = { ...latest, position: sanitizePosition(position, latest.position) };
  saveCompanionConfig(next);
  return next;
}

export function subscribeCompanionConfig(callback: (config: CompanionConfig) => void) {
  const emit = () => callback(loadCompanionConfig());
  const handleStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY) emit();
  };

  window.addEventListener(CONFIG_EVENT, emit);
  window.addEventListener("storage", handleStorage);
  return () => {
    window.removeEventListener(CONFIG_EVENT, emit);
    window.removeEventListener("storage", handleStorage);
  };
}

export function loadCompanionActionState(): BongocatActionState {
  try {
    const saved = localStorage.getItem(ACTION_STATE_KEY);
    return saved ? JSON.parse(saved) : DEFAULT_COMPANION_ACTION_STATE;
  } catch {
    return DEFAULT_COMPANION_ACTION_STATE;
  }
}

export function saveCompanionActionState(state: BongocatActionState) {
  localStorage.setItem(ACTION_STATE_KEY, JSON.stringify(state));
  window.dispatchEvent(new Event(ACTION_STATE_EVENT));
}

export function subscribeCompanionActionState(callback: (state: BongocatActionState) => void) {
  const emit = () => callback(loadCompanionActionState());
  const handleStorage = (event: StorageEvent) => {
    if (event.key === ACTION_STATE_KEY) emit();
  };

  window.addEventListener(ACTION_STATE_EVENT, emit);
  window.addEventListener("storage", handleStorage);
  return () => {
    window.removeEventListener(ACTION_STATE_EVENT, emit);
    window.removeEventListener("storage", handleStorage);
  };
}

export function getBuiltInYunoCarouselImages(inputMode: CompanionInputMode) {
  if (inputMode === "standard") return BUILT_IN_YUNO_STANDARD_CAROUSEL_IMAGES;
  if (inputMode === "gamepad") return BUILT_IN_YUNO_GAMEPAD_CAROUSEL_IMAGES;
  return BUILT_IN_YUNO_CAROUSEL_IMAGES;
}

export function getBuiltInYunoModelPath(inputMode: CompanionInputMode) {
  if (inputMode === "standard") return BUILT_IN_YUNO_MODEL_PATH;
  if (inputMode === "gamepad") return BUILT_IN_YUNO_GAMEPAD_MODEL_PATH;
  return BUILT_IN_YUNO_KEYBOARD_MODEL_PATH;
}

export function getBuiltInYunoSkinId(inputMode: CompanionInputMode): CompanionSkinId {
  if (inputMode === "standard") return "a-yuno-standard";
  if (inputMode === "gamepad") return "a-yuno-gamepad";
  return "a-yuno-keyboard";
}

export function normalizeCompanionAssetPath(path: string) {
  let next = typeof path === "string" ? path.trim() : "";
  if (!next) return "";

  for (const [legacyRoot, targetRoot] of LEGACY_YUNO_ASSET_ROOTS) {
    next = next.split(legacyRoot).join(targetRoot);
  }

  return next.split("\\").join("/");
}

export const COMPANION_MIN_SCALE = 0.5;
export const COMPANION_MAX_SCALE = 2;

function sanitizeScale(scale: unknown) {
  const value = Number(scale);
  if (!Number.isFinite(value)) return DEFAULT_COMPANION_CONFIG.scale;
  return (
    Math.round(Math.min(COMPANION_MAX_SCALE, Math.max(COMPANION_MIN_SCALE, value)) * 100) / 100
  );
}

function mergeCompanionConfig(value: Partial<CompanionConfig>): CompanionConfig {
  const merged = {
    ...DEFAULT_COMPANION_CONFIG,
    ...value,
    scale: sanitizeScale(value.scale ?? DEFAULT_COMPANION_CONFIG.scale),
    position: sanitizePosition(value.position, DEFAULT_COMPANION_CONFIG.position),
    sensitivity: { ...DEFAULT_COMPANION_CONFIG.sensitivity, ...value.sensitivity },
    carousel: { ...DEFAULT_COMPANION_CONFIG.carousel, ...value.carousel },
    motionMap: { ...DEFAULT_COMPANION_CONFIG.motionMap, ...value.motionMap },
    pet: { ...DEFAULT_COMPANION_CONFIG.pet, ...value.pet },
  };
  const isLegacyConfig = !value.skinId;
  const isBuiltInSkin = isBuiltInYunoSkin(merged.skinId);
  const builtInLive2DOption = getBuiltInLive2DModelOption(merged.skinId);
  const lingChatOption = getBuiltInLingChatPetOption(merged.skinId);
  const isStaleBuiltInSkin =
    value.skinRevision !== BUILT_IN_YUNO_SKIN_REVISION &&
    value.skinId !== "custom" &&
    !builtInLive2DOption &&
    !lingChatOption;
  const isLegacySpriteSkin = merged.renderer === "sprite" || merged.skinId === "bongocat-classic";

  if (isLegacyConfig || isBuiltInSkin || isStaleBuiltInSkin || isLegacySpriteSkin) {
    return {
      ...merged,
      mode: "embedded",
      renderer: "live2d",
      inputMode: "keyboard",
      skinId: "haru-cdn",
      skinRevision: "haru-local-v2",
      modelPath: HARU_LOCAL_MODEL_PATH,
      carousel: {
        ...merged.carousel,
        enabled: false,
        images: [],
        currentIndex: 0,
      },
    };
  }

  if (builtInLive2DOption) {
    return {
      ...merged,
      mode: "embedded",
      renderer: "live2d",
      inputMode: "keyboard",
      skinId: builtInLive2DOption.skinId,
      skinRevision: builtInLive2DOption.revision,
      modelPath: builtInLive2DOption.modelPath,
      carousel: {
        ...merged.carousel,
        enabled: false,
        images: [],
        currentIndex: 0,
      },
    };
  }

  if (lingChatOption) {
    // LingChat 桌宠：2D 情绪立绘渲染，无 Live2D 模型路径
    return {
      ...merged,
      mode: "embedded",
      renderer: "lingchat",
      inputMode: "keyboard",
      skinId: lingChatOption.skinId,
      skinRevision: lingChatOption.revision,
      modelPath: "",
      pet: { ...merged.pet, roleFolder: lingChatOption.roleFolder, clothesName: "" },
      carousel: {
        ...merged.carousel,
        enabled: false,
        images: [],
        currentIndex: 0,
      },
    };
  }

  return {
    ...merged,
    mode: "embedded",
    inputMode: normalizeInputMode(merged.inputMode),
    skinRevision: merged.skinRevision || BUILT_IN_YUNO_SKIN_REVISION,
    modelPath: normalizeCompanionAssetPath(merged.modelPath || BUILT_IN_YUNO_GAMEPAD_MODEL_PATH),
    carousel: {
      ...merged.carousel,
      images: normalizeCarouselImages(merged.carousel.images, merged.inputMode),
    },
  };
}

function normalizeCarouselImages(images: string[], inputMode: CompanionInputMode) {
  const unique = new Set<string>();

  for (const image of images) {
    const normalized = normalizeCompanionAssetPath(image);
    if (!normalized) continue;
    unique.add(normalizeBuiltInCarouselImage(normalized, inputMode));
  }

  return Array.from(unique);
}

function normalizeBuiltInCarouselImage(image: string, _inputMode: CompanionInputMode) {
  return image;
}

function normalizeInputMode(inputMode: CompanionInputMode | undefined): CompanionInputMode {
  if (inputMode === "standard" || inputMode === "keyboard" || inputMode === "gamepad")
    return inputMode;
  return "gamepad";
}

function isBuiltInYunoSkin(skinId: CompanionSkinId) {
  return (
    skinId === "a-yuno-keyboard" || skinId === "a-yuno-gamepad" || skinId === "a-yuno-standard"
  );
}

export function getBuiltInLive2DModelOption(skinId: CompanionSkinId) {
  return BUILT_IN_LIVE2D_MODEL_OPTIONS.find((option) => option.skinId === skinId);
}

export function getBuiltInLingChatPetOption(skinId: CompanionSkinId) {
  return BUILT_IN_LINGCHAT_PET_OPTIONS.find((option) => option.skinId === skinId);
}

/** 是否内置 LingChat 桌宠角色 */
export function isBuiltInLingChatPet(skinId: CompanionSkinId) {
  return Boolean(getBuiltInLingChatPetOption(skinId));
}

function sanitizePosition(
  position: Partial<CompanionConfig["position"]> | undefined,
  fallback: CompanionConfig["position"],
) {
  const x = Number(position?.x);
  const y = Number(position?.y);
  return {
    x: Number.isFinite(x) ? Math.round(x) : fallback.x,
    y: Number.isFinite(y) ? Math.round(y) : fallback.y,
  };
}
