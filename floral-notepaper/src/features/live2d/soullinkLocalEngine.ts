import {
  getVADPreset,
  loadModelProfile,
  motionStylePresets,
  type EmotionIntent,
  type ExpressionBinding,
  type Live2DParamState,
  type ModelProfile,
  type MotionBinding,
  type MotionStyleOptions,
  type MotionStylePresetName,
  type NativeAnimationCatalog,
  type NativeExpressionEntry,
  type ParameterMap,
  type RuntimeSnapshot,
  type VADVector,
} from "@soullink-emotion/engine";
import {
  amanePersona,
  createManualClock,
  createSoullinkSession,
  type ManualClock,
  type MessageClassifier,
  type PersonaConfig,
  type PlannerClient,
  type SoullinkSession,
} from "@soullink-emotion/runtime-core";
import {
  EmbeddingMessageClassifier,
  QwenEmbeddingClient,
} from "@soullink-emotion/classifier-embedding";
import type { Live2DMotionParameterInfo } from "@soullink-emotion/live2d-pixi";
import {
  OpenAICompatibleClient,
  SoullinkLLMPlanner,
  SoullinkReflectionPlanner,
  SoullinkSpeakingMotionPlanner,
} from "@soullink-emotion/planner-openai";
import { getConfig } from "../settings/api";
import type { ProviderConfig } from "../settings/types";

export type SoullinkLocalMood = "happy" | "neutral" | "sleepy" | "excited" | "worried" | "curious";

type Live2DCoreModelParameterId = {
  getString?: () => { s?: string } | string;
};

export type SoullinkCoreModelApi = {
  getParameterCount?: () => number;
  getParameterId?: (index: number) => Live2DCoreModelParameterId | string;
  getParameterValueByIndex?: (index: number) => number;
  setParameterValueByIndex?: (index: number, value: number, weight?: number) => void;
};

const MOOD_TO_ENGINE_EMOTION: Record<SoullinkLocalMood, string> = {
  happy: "happy",
  neutral: "neutral",
  sleepy: "tired",
  excited: "excited",
  worried: "anxiety",
  curious: "curious",
};

const MOOD_TO_VAD: Record<SoullinkLocalMood, VADVector> = {
  happy: { valence: 0.72, arousal: 0.42, dominance: 0.26 },
  neutral: { valence: 0, arousal: -0.18, dominance: 0 },
  sleepy: { valence: -0.08, arousal: -0.76, dominance: -0.3 },
  excited: { valence: 0.86, arousal: 0.82, dominance: 0.34 },
  worried: { valence: -0.58, arousal: 0.48, dominance: -0.48 },
  curious: { valence: 0.34, arousal: 0.42, dominance: 0.08 },
};

const PARAMETER_MAP: ParameterMap = {
  headX: { target: "ParamAngleX", min: -30, max: 30, scale: 18 },
  headY: { target: "ParamAngleY", min: -30, max: 30, scale: 14 },
  headZ: { target: "ParamAngleZ", min: -30, max: 30, scale: 16 },
  bodyX: { target: "ParamBodyAngleX", min: -10, max: 10, scale: 6 },
  bodyY: { target: "ParamBodyAngleY", min: -10, max: 10, scale: 5 },
  bodyZ: { target: "ParamBodyAngleZ", min: -10, max: 10, scale: 5 },
  gazeX: { target: "ParamEyeBallX", min: -1, max: 1, scale: 0.7 },
  gazeY: { target: "ParamEyeBallY", min: -1, max: 1, scale: 0.7 },
  eyeBlinkL: { target: "ParamEyeLOpen", mode: "inverse", min: 0, max: 1 },
  eyeBlinkR: { target: "ParamEyeROpen", mode: "inverse", min: 0, max: 1 },
  eyeSmile: { targets: ["ParamEyeLSmile", "ParamEyeRSmile"], min: 0, max: 1 },
  eyeSquint: { targets: ["ParamEyeLSmile", "ParamEyeRSmile"], min: 0, max: 1, scale: 0.55 },
  browInnerUp: { targets: ["ParamBrowLY", "ParamBrowRY"], min: -1, max: 1, scale: 0.55 },
  browOuterUp: { targets: ["ParamBrowLY", "ParamBrowRY"], min: -1, max: 1, scale: 0.35 },
  browDown: {
    targets: ["ParamBrowLY", "ParamBrowRY"],
    mode: "subtract",
    min: -1,
    max: 1,
    scale: 0.6,
  },
  mouthOpen: { target: "ParamMouthOpenY", min: 0, max: 1, scale: 0.85 },
  mouthSmile: { target: "ParamMouthForm", min: -1, max: 1, scale: 0.85 },
  mouthFrown: { target: "ParamMouthForm", mode: "subtract", min: -1, max: 1, scale: 0.7 },
  mouthPucker: { target: "ParamMouthForm", mode: "subtract", min: -1, max: 1, scale: 0.35 },
  breath: { target: "ParamBreath", min: -1, max: 1, scale: 0.75 },
  blush: { target: "ParamCheek", min: 0, max: 1, scale: 0.7 },
};

const IDLE_CONFIG: ModelProfile["idleConfig"] = {
  breath: [0.12, 0.5],
  headX: [-0.12, 0.12],
  headY: [-0.08, 0.08],
  headZ: [-0.08, 0.08],
  bodyX: [-0.08, 0.08],
  eyeBlinkL: [0, 1],
  eyeBlinkR: [0, 1],
  gazeX: [-0.45, 0.45],
  gazeY: [-0.28, 0.28],
};

/** 模型路径 → 专属人设（供 LLM 规划器与兜底台词使用） */
const PERSONA_DEFS: Record<string, { name: string; profile: string }> = {
  haru: {
    name: "Haru",
    profile:
      "你是一只温柔沉稳的白色兽耳少女 Haru，正在默默陪伴用户写作。你说话轻声细语，带着让人安心的温度；会主动关心用户的疲惫，也会好奇地凑近询问。回复简短、自然、口语化，像朋友一样。",
  },
  hiyori: {
    name: "Hiyori",
    profile:
      "你是活泼元气的小恶魔 Hiyori。你精力充沛，说话带着小小的俏皮和得意，喜欢逗用户开心；用户低落时你会立刻变得认真。回复简短、有活力、口语化。",
  },
  aquarius: {
    name: "水瓶座之恋",
    profile:
      "你是「水瓶座之恋」的温柔少女。你气质安静通透，像夜晚的星辰，擅长倾听，偶尔说出温暖又清醒的话。回复简短、柔和、口语化。",
  },
};

function detectModelKey(modelPath: string): string {
  const path = decodeURIComponent(modelPath);
  if (path.includes("haru")) return "haru";
  if (path.includes("hiyori")) return "hiyori";
  if (path.includes("aquarius")) return "aquarius";
  return "haru";
}

/** 由 .model3.json 路径推导相邻的 soullink.profile.json 路径 */
function deriveProfileUrl(modelPath: string): string {
  const base = modelPath.replace(/\.model3\.json$/i, "");
  return `${base}/soullink.profile.json`.replace(/\/\/+/g, "/");
}

function buildPersona(modelPath: string): PersonaConfig {
  const def = PERSONA_DEFS[detectModelKey(modelPath)] ?? PERSONA_DEFS.haru;
  return {
    name: def.name,
    profile: def.profile,
    variantByEmotion: amanePersona.variantByEmotion,
    fallbacks: amanePersona.fallbacks,
    proactiveFallbacks: amanePersona.proactiveFallbacks,
  };
}

function getParameterIdString(id: Live2DCoreModelParameterId | string | undefined) {
  if (typeof id === "string") return id;
  const value = id?.getString?.();
  return typeof value === "string" ? value : value?.s;
}

function listParameterIds(core: SoullinkCoreModelApi) {
  const count = core.getParameterCount?.() ?? 0;
  const ids: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const id = getParameterIdString(core.getParameterId?.(index));
    if (id) ids.push(id);
  }
  return ids;
}

function createNeutralParams(core: SoullinkCoreModelApi, ids: string[]) {
  const neutralParams: Record<string, number> = {};
  for (let index = 0; index < ids.length; index += 1) {
    const id = ids[index];
    if (!id) continue;

    const value = core.getParameterValueByIndex?.(index) ?? 0;
    neutralParams[id] = Number.isFinite(value) ? value : 0;
  }
  return neutralParams;
}

function createParameterIndex(core: SoullinkCoreModelApi) {
  const ids = listParameterIds(core);
  const indexById = new Map<string, number>();
  ids.forEach((id, index) => indexById.set(id, index));
  return { ids, indexById };
}

function createProfile(modelPath: string, core: SoullinkCoreModelApi): ModelProfile {
  const ids = listParameterIds(core);
  return {
    modelId: modelPath,
    displayName: "Floral Live2D Local Model",
    version: "1.0.0",
    modelPath,
    schemaVersion: 2,
    autoProfile: {
      provider: "manual",
      notes: ["Pure local Soullink adapter generated inside floral-notepaper."],
    },
    parameterMap: PARAMETER_MAP,
    idleConfig: IDLE_CONFIG,
    neutralParams: createNeutralParams(core, ids),
    parameterSmoothing: {
      ParamAngleX: 0.16,
      ParamAngleY: 0.16,
      ParamAngleZ: 0.14,
      ParamBodyAngleX: 0.2,
      ParamBodyAngleY: 0.2,
      ParamBodyAngleZ: 0.2,
      ParamMouthOpenY: 0.08,
      ParamMouthForm: 0.14,
      ParamBreath: 0.22,
    },
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

/** 把可空的部分 VAD 向量补全为完整向量 */
function toFullVAD(vad: Partial<VADVector> | undefined): VADVector | undefined {
  if (!vad) return undefined;
  return {
    valence: vad.valence ?? 0,
    arousal: vad.arousal ?? 0,
    dominance: vad.dominance ?? 0,
  };
}

/** 从配置的供应商中挑选一个 OpenAI 兼容 provider（优先 DeepSeek） */
function pickPlannerProvider(providers: ProviderConfig[]): ProviderConfig | null {
  const candidates = providers.filter(
    (p) => p.enabled && !!p.apiKey && !!p.baseUrl && p.models.length > 0,
  );
  if (candidates.length === 0) return null;
  return (
    candidates.find((p) => p.name.toLowerCase().includes("deepseek")) ??
    candidates.find((p) => p.name.toLowerCase().includes("openai")) ??
    candidates[0]
  );
}

/** 把 planner-openai 的三个规划器包装成 runtime-core 需要的 PlannerClient */
function buildPlanner(provider: ProviderConfig): PlannerClient | null {
  try {
    const model = provider.models[0]?.modelId ?? "deepseek-chat";
    const client = new OpenAICompatibleClient({
      apiKey: provider.apiKey,
      baseURL: provider.baseUrl,
      model,
      timeoutMs: 20000,
    });
    if (!client.isConfigured) return null;

    const reactionPlanner = new SoullinkLLMPlanner(client);
    const reflectionPlanner = new SoullinkReflectionPlanner(client);
    const speakingMotionPlanner = new SoullinkSpeakingMotionPlanner(client);

    return {
      planReaction: async (input) => {
        const plan = await reactionPlanner.plan({
          message: input.message,
          conversation: input.conversation,
          characterName: input.characterName,
          characterProfile: input.characterProfile,
          vad: toFullVAD(input.vad),
        });
        return {
          intent: plan.intent,
          replyDraft: plan.replyDraft,
          vadTarget: plan.vadTarget,
          vadDelta: plan.vadDelta,
          actionPlan: plan.actionPlan,
        };
      },
      planProactive: async (input) => {
        const plan = await reflectionPlanner.proactiveMessage({
          characterName: input.characterName,
          characterProfile: input.characterProfile,
          proactive: {
            emotion: input.proactive.emotion,
            intensity: input.proactive.intensity,
            silenceSeconds: input.proactive.silenceSeconds,
            suggestedMessage: input.proactive.suggestedMessage,
            systemPrompt: input.proactive.systemPrompt,
          },
          conversation: input.conversation,
          reflection: input.reflection
            ? {
                thought: input.reflection.thought,
                reason: input.reflection.reason,
                emotion: input.reflection.emotion,
                vadTarget: toFullVAD(input.reflection.vadTarget),
              }
            : undefined,
          vad: toFullVAD(input.vad),
        });
        return {
          message: plan.message,
          emotion: plan.emotion,
          reason: plan.reason,
          provider: plan.provider,
        };
      },
      planReflection: async (input) => {
        const plan = await reflectionPlanner.reflect({
          conversation: input.conversation,
          vad: toFullVAD(input.vad),
          topic: input.topic,
          characterName: input.characterName,
          characterProfile: input.characterProfile,
        });
        return {
          thought: plan.thought,
          reason: plan.reason,
          emotion: plan.emotion,
          vadTarget: toFullVAD(plan.vadTarget),
        };
      },
      planSpeakingMotion: async (input) => {
        const plan = await speakingMotionPlanner.plan({
          speechText: input.speechText,
          durationSec: input.durationSec,
          availableParameters: input.availableParameters,
          intent: input.intent,
          vad: toFullVAD(input.vad),
          expression: input.expression,
          characterName: input.characterName,
          characterProfile: input.characterProfile,
          userMessage: input.userMessage,
        });
        return { parameterPlan: plan.parameterPlan, provider: plan.provider };
      },
    };
  } catch {
    return null;
  }
}

export interface SoullinkLocalEngineOptions {
  /** 覆盖默认人设（默认按模型路径自动选择） */
  persona?: PersonaConfig;
  /** 显式指定规划器；undefined 时自动从配置的供应商构建 */
  planner?: PlannerClient | null;
  /**
   * 显式指定情绪分类器（MessageClassifier / 其 Promise，可空）。
   * undefined 时自动从配置中挑选 embedding 能力供应商构建；
   * null 表示关闭 embedding 分类，走引擎内置启发式。
   */
  classifier?: MessageClassifier | null | Promise<MessageClassifier | null>;
  /**
   * 动作风格预设（natural / lively / calm / shy）或部分覆盖；
   * 默认 lively。
   */
  motionStyle?: MotionStylePresetName | Partial<MotionStyleOptions>;
  /** LLM 生成的回复回调（用于展示气泡） */
  onReply?: (reply: string) => void;
}

const EMBEDDING_DEFAULT_TIMEOUT_MS = 45_000;

/** 从配置的供应商中挑选一个 embedding 供应商（模型声明 embedding 能力，或名称含 embed） */
function pickEmbeddingProvider(providers: ProviderConfig[]): ProviderConfig | null {
  const candidates = providers.filter(
    (p) => p.enabled && !!p.apiKey && !!p.baseUrl && p.models.length > 0,
  );
  if (candidates.length === 0) return null;
  const isEmbeddingModel = (m: ProviderConfig["models"][number]) =>
    m.capabilities?.some((c) => c.toLowerCase().includes("embedding")) ||
    m.modelTypes?.some((t) => t.toLowerCase().includes("embedding"));
  return (
    candidates.find((p) => p.models.some(isEmbeddingModel)) ??
    candidates.find((p) => p.name.toLowerCase().includes("embed")) ??
    null
  );
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      window.setTimeout(() => reject(new Error(`embedding init timeout after ${ms}ms`)), ms);
    }),
  ]);
}

/**
 * 从配置的供应商构建 Embedding 情绪分类器（README「不使用 LLM：直接接入 Embedding 分类」）。
 * 初始化失败 / 超时返回 null —— 会话层会自动降级到内置启发式分类，不影响主链路。
 */
async function buildEmbeddingClassifier(
  provider: ProviderConfig,
): Promise<MessageClassifier | null> {
  try {
    const isEmbeddingModel = (m: ProviderConfig["models"][number]) =>
      m.capabilities?.some((c) => c.toLowerCase().includes("embedding")) ||
      m.modelTypes?.some((t) => t.toLowerCase().includes("embedding"));
    const model = provider.models.find(isEmbeddingModel) ?? provider.models[0];
    const client = new QwenEmbeddingClient({
      baseURL: `${provider.baseUrl}${provider.apiPath}`.replace(/\/+$/, ""),
      apiKey: provider.apiKey,
      model: model.modelId,
      timeoutMs: 30000,
    });
    if (!client.isConfigured) return null;
    const classifier = new EmbeddingMessageClassifier(client, {
      initializationBatchSize: 128,
      queryCacheSize: 512,
    });
    await withTimeout(classifier.initialize(), EMBEDDING_DEFAULT_TIMEOUT_MS);
    return {
      classify: async (message) => ({ intent: await classifier.classify(message) }),
    };
  } catch {
    return null;
  }
}

/**
 * 无 OpenAI 时 profile-generator 只输出 nativeAnimations catalog（F01-F08、Idle/TapBody），
 * 不输出 emotion → expression/motion 映射；而 SoullinkRuntime 的 resolveNativeAnimation
 * 必须依赖 expressionMap/motionMap，否则情绪驱动的原生表情/动作永远不触发。
 * 这里用参数签名启发式从 catalog 派生映射，等价于 README 里「校准面板」要产出的内容。
 */
const EXPRESSION_SIGNATURES: Array<{
  emotions: string[];
  match: (params: string[]) => boolean;
}> = [
  // 害羞 / 恋爱 → 脸红表情（ParamTere / ParamCheek）
  {
    emotions: ["shy", "love", "embarrassed"],
    match: (p) => p.includes("ParamTere") || p.includes("ParamCheek"),
  },
  // 开心 / 愉悦 → 眉眼微笑表情（EyeLSmile / EyeRSmile）
  {
    emotions: ["happy", "cheerful", "delighted"],
    match: (p) => p.includes("ParamEyeLSmile") || p.includes("ParamEyeRSmile"),
  },
  // 兴奋 / 惊讶 → 睁眼 + 眼珠形态（EyeBallForm / EyeLOpen+ROpen）
  {
    emotions: ["excited", "surprised", "amazed"],
    match: (p) =>
      p.includes("ParamEyeBallForm") ||
      (p.includes("ParamEyeLOpen") && p.includes("ParamEyeROpen") && !p.includes("ParamEyeLSmile")),
  },
  // 悲伤 → 眉毛内侧 / 眉角
  {
    emotions: ["sad", "grief", "lonely"],
    match: (p) =>
      p.includes("ParamBrowLX") || p.includes("ParamBrowRX") || p.includes("ParamBrowLAngle"),
  },
  // 愤怒 → 张嘴 + 眉形
  {
    emotions: ["angry", "frustrated"],
    match: (p) =>
      p.includes("ParamMouthOpenY") &&
      (p.includes("ParamBrowLForm") || p.includes("ParamBrowRForm")),
  },
  // 平静 / 放松 → 参数最少的表情（最接近中性）
  { emotions: ["calm", "relaxed"], match: (p) => p.length <= 2 },
];

function deriveNativeAnimationMaps(catalog: NativeAnimationCatalog): {
  expressionMap: Record<string, ExpressionBinding | string>;
  motionMap: Record<string, MotionBinding>;
} {
  const expressions: NativeExpressionEntry[] = catalog.expressions ?? [];
  const motions = (catalog.motions ?? []).filter((m) => m.group !== "Idle");

  const pickExpression = (emotions: string[]) => {
    for (const sig of EXPRESSION_SIGNATURES) {
      if (!sig.emotions.some((e) => emotions.includes(e))) continue;
      const found = expressions.find((e) => sig.match(e.params ?? []));
      if (found) return found.name;
    }
    return undefined;
  };

  const expressionMap: Record<string, ExpressionBinding | string> = {};
  for (const sig of EXPRESSION_SIGNATURES) {
    const name = pickExpression(sig.emotions);
    if (!name) continue;
    for (const emotion of sig.emotions) expressionMap[emotion] = name;
  }

  // 未命中的情绪（neutral / tired / anxiety / curious / guilty / relieved / proud …）
  // 回退到参数最少的表情；calm 优先保留已命中的专属表情。
  const fallback = expressions.reduce<NativeExpressionEntry | undefined>(
    (best, e) =>
      !best ||
      (e.params?.length ?? Number.POSITIVE_INFINITY) <
        (best.params?.length ?? Number.POSITIVE_INFINITY)
        ? e
        : best,
    undefined,
  );
  if (fallback?.name) {
    expressionMap.neutral = fallback.name;
    expressionMap.tired = fallback.name;
    expressionMap.anxiety = fallback.name;
    expressionMap.curious = fallback.name;
    expressionMap.guilty = fallback.name;
    expressionMap.relieved = fallback.name;
    expressionMap.proud = fallback.name;
    expressionMap.calm ??= fallback.name;
    expressionMap.relaxed ??= fallback.name;
  }

  // 活泼情绪映射到非 Idle 动作（如 TapBody）作为情绪反应手势；悲伤/愤怒只做表情。
  const motionMap: Record<string, MotionBinding> = {};
  const firstMotion = motions[0];
  if (firstMotion) {
    const gesture: MotionBinding = {
      group: firstMotion.group,
      index: firstMotion.index,
      priority: "normal",
    };
    for (const e of ["happy", "excited", "surprised", "amazed", "cheerful", "delighted"]) {
      motionMap[e] = gesture;
    }
    const secondMotion = motions[1];
    if (secondMotion) {
      const shyGesture: MotionBinding = {
        group: secondMotion.group,
        index: secondMotion.index,
        priority: "normal",
      };
      motionMap.shy = shyGesture;
      motionMap.love = shyGesture;
    }
  }

  return { expressionMap, motionMap };
}

/**
 * 基于 @soullink-emotion/runtime-core 会话运行时的本地 Live2D 情绪引擎适配器。
 *
 * - 会话运行时拥有 SoullinkRuntime，并驱动 reaction / proactive / reflection 循环；
 * - 渲染循环通过 ManualClock 显式 tick（与现有每帧 update 结构一致）；
 * - 配置了 DeepSeek（或任意 OpenAI 兼容）供应商时，自动接入 planner-openai
 *   三个规划器，使回复/主动搭话/反思均由 LLM 规划。
 */
export class SoullinkLocalEngineAdapter {
  private readonly session: SoullinkSession;
  private readonly manualClock: ManualClock;
  private readonly onReply?: (reply: string) => void;
  private indexById: Map<string, number>;
  private startedAt = performance.now() / 1000;
  private previousTime = this.startedAt;
  private lastSeenReply = "";

  constructor(
    core: SoullinkCoreModelApi,
    modelPath: string,
    options: SoullinkLocalEngineOptions = {},
  ) {
    const parameterIndex = createParameterIndex(core);
    this.indexById = parameterIndex.indexById;
    this.onReply = options.onReply;
    this.manualClock = createManualClock(0);

    // 动作风格：字符串预设 or 部分覆盖（默认 lively），后续数值仅在未显式覆盖时兜底
    const baseMotionStyle: MotionStyleOptions =
      typeof options.motionStyle === "string"
        ? { ...motionStylePresets[options.motionStyle] }
        : { ...motionStylePresets.lively, ...options.motionStyle };
    const motionStyle: MotionStyleOptions = {
      ...baseMotionStyle,
      ...(baseMotionStyle.gestureFrequency === undefined ? { gestureFrequency: 0.85 } : {}),
      ...(baseMotionStyle.idleActionGain === undefined ? { idleActionGain: 0.72 } : {}),
      ...(baseMotionStyle.microMotionGain === undefined ? { microMotionGain: 0.78 } : {}),
      ...(baseMotionStyle.blinkRate === undefined ? { blinkRate: 1 } : {}),
      ...(baseMotionStyle.breathRate === undefined ? { breathRate: 0.9 } : {}),
    };

    // embedding 分类器可空、可异步：await 失败时抛错让会话回退内置启发式分类
    const classifierPort =
      options.classifier === undefined || options.classifier === null
        ? undefined
        : ({
            classify: async (message) => {
              const classifier = await options.classifier;
              if (!classifier) throw new Error("embedding-classifier-unavailable");
              return classifier.classify(message);
            },
          } satisfies MessageClassifier);

    this.session = createSoullinkSession({
      profile: createProfile(modelPath, core),
      persona: options.persona ?? buildPersona(modelPath),
      planner: options.planner ?? undefined,
      classifier: classifierPort,
      clock: this.manualClock,
      motionStyle,
      onSnapshot: (snapshot) => {
        // lastReply 会持久到下一次回复，仅在内容变化时回调一次
        if (snapshot.lastReply && snapshot.lastReply !== this.lastSeenReply && this.onReply) {
          this.lastSeenReply = snapshot.lastReply;
          this.onReply(snapshot.lastReply);
        }
      },
    });

    this.session.setParameterGain(1.08);
    this.session.setBodyMotionGain(0.72);
    this.session.start();
  }

  /**
   * 异步工厂：优先加载由 profile-generator 生成的模型专属 Profile，
   * 并自动从 Tauri 配置的供应商构建 LLM 规划器。
   */
  static async create(
    core: SoullinkCoreModelApi,
    modelPath: string,
    options: SoullinkLocalEngineOptions = {},
  ): Promise<SoullinkLocalEngineAdapter> {
    let planner: PlannerClient | null = null;
    if (options.planner !== undefined) {
      planner = options.planner;
    } else {
      try {
        const config = await getConfig();
        const provider = pickPlannerProvider(config.providers ?? []);
        if (provider) {
          planner = buildPlanner(provider);
        }
      } catch {
        planner = null;
      }
    }

    // 未显式指定分类器时，从配置中尝试构建 Embedding 情绪分类器
    let classifier: MessageClassifier | null | Promise<MessageClassifier | null> | undefined =
      options.classifier;
    if (classifier === undefined) {
      try {
        const config = await getConfig();
        const embeddingProvider = pickEmbeddingProvider(config.providers ?? []);
        classifier = embeddingProvider ? buildEmbeddingClassifier(embeddingProvider) : null;
      } catch {
        classifier = null;
      }
    }

    const adapter = new SoullinkLocalEngineAdapter(core, modelPath, {
      persona: options.persona,
      planner,
      classifier,
      motionStyle: options.motionStyle,
      onReply: options.onReply,
    });

    try {
      const profileUrl = deriveProfileUrl(modelPath);
      const { profile } = await loadModelProfile(profileUrl);
      if (profile.nativeAnimations) {
        // 生成器在无 OpenAI 时只输出 catalog，缺少 emotion → expression/motion 映射，
        // 会导致情绪驱动的原生表情/动作不触发；用参数签名启发式派生补全。
        const maps = deriveNativeAnimationMaps(profile.nativeAnimations);
        adapter.session.setProfile({
          ...profile,
          expressionMap: profile.expressionMap ?? maps.expressionMap,
          motionMap: profile.motionMap ?? maps.motionMap,
        });
      } else {
        adapter.session.setProfile(profile);
      }
    } catch {
      // 没有生成 profile 时沿用内置手动 profile
    }

    return adapter;
  }

  triggerEmotion(mood: SoullinkLocalMood, intensity = 0.75) {
    const emotion = MOOD_TO_ENGINE_EMOTION[mood];
    const vadTarget = MOOD_TO_VAD[mood] ?? getVADPreset(emotion);
    const intent: EmotionIntent = {
      emotion,
      naturalEmotion: emotion,
      naturalVAD: vadTarget,
      intensity: clamp(intensity, 0.15, 1),
      contextTags: ["floral-notepaper", "local-live2d-signal"],
    };

    this.session.triggerIntent(intent, { vadTarget });
  }

  /**
   * 把一条消息交给会话运行时：无分类器时走引擎内置启发式情绪反应，
   * 配置了 LLM 规划器时会先生成情绪/回复再驱动表情。
   */
  sendMessage(message: string): Promise<EmotionIntent | null> {
    return this.session.sendMessage(message);
  }

  setCore(core: SoullinkCoreModelApi, modelPath: string) {
    const parameterIndex = createParameterIndex(core);
    this.indexById = parameterIndex.indexById;
    this.session.setProfile(createProfile(modelPath, core));
    this.resetClock();
  }

  update(core: SoullinkCoreModelApi, deltaMs: number) {
    const snapshot = this.tick(deltaMs);
    if (snapshot) {
      this.applyParams(core, snapshot.live2dParams);
    }
  }

  /**
   * 单步推进会话运行时（README 教程一帧循环），返回最新 RuntimeSnapshot。
   * 官方 Live2DRenderer 路径用返回值驱动 setParameters / applyNativeAnimation；
   * legacy 路径仍走 {@link update} 的索引直写。
   */
  tick(deltaMs: number): RuntimeSnapshot | null {
    const absoluteTime = performance.now() / 1000;
    const timeSeconds = absoluteTime - this.startedAt;
    const deltaSeconds = clamp(deltaMs / 1000 || absoluteTime - this.previousTime, 0.001, 0.1);
    this.previousTime = absoluteTime;

    this.manualClock.tick(timeSeconds, deltaSeconds);
    return this.session.getRuntimeSnapshot();
  }

  /** 把渲染器扫描出的运动参数元数据注入会话（lipsync / 说话动作规划使用）。 */
  setSpeakingMotionParameters(parameters: Record<string, Live2DMotionParameterInfo>) {
    this.session.setSpeakingMotionParameters(parameters);
  }

  /**
   * 运行时切换动作风格（natural / lively / calm / shy 或部分覆盖），
   * 对应 README 的 runtime.setMotionStyle。
   */
  setMotionStyle(style: MotionStylePresetName | Partial<MotionStyleOptions>) {
    const resolved: MotionStyleOptions =
      typeof style === "string" ? { ...motionStylePresets[style] } : style;
    this.session.getRuntime()?.setMotionStyle(resolved);
  }

  /** 可用的动作风格预设名 */
  static get motionStylePresetNames(): MotionStylePresetName[] {
    return Object.keys(motionStylePresets) as MotionStylePresetName[];
  }

  resetClock() {
    this.startedAt = performance.now() / 1000;
    this.previousTime = this.startedAt;
    this.session.reset();
    this.session.start();
  }

  stop() {
    this.session.stop();
  }

  private applyParams(core: SoullinkCoreModelApi, params: Live2DParamState) {
    for (const [id, value] of Object.entries(params)) {
      const index = this.indexById.get(id);
      if (index === undefined || !Number.isFinite(value)) continue;
      core.setParameterValueByIndex?.(index, value, 1);
    }
  }
}
