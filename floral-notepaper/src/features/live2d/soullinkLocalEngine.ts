import {
  getVADPreset,
  loadModelProfile,
  motionStylePresets,
  type EmotionIntent,
  type Live2DParamState,
  type ModelProfile,
  type ParameterMap,
  type VADVector,
} from "@soullink-emotion/engine";
import {
  amanePersona,
  createManualClock,
  createSoullinkSession,
  type ManualClock,
  type PersonaConfig,
  type PlannerClient,
  type SoullinkSession,
} from "@soullink-emotion/runtime-core";
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
  browDown: { targets: ["ParamBrowLY", "ParamBrowRY"], mode: "subtract", min: -1, max: 1, scale: 0.6 },
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
    if (!client.configured) return null;

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
  /** LLM 生成的回复回调（用于展示气泡） */
  onReply?: (reply: string) => void;
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

  constructor(core: SoullinkCoreModelApi, modelPath: string, options: SoullinkLocalEngineOptions = {}) {
    const parameterIndex = createParameterIndex(core);
    this.indexById = parameterIndex.indexById;
    this.onReply = options.onReply;
    this.manualClock = createManualClock(0);

    this.session = createSoullinkSession({
      profile: createProfile(modelPath, core),
      persona: options.persona ?? buildPersona(modelPath),
      planner: options.planner ?? undefined,
      clock: this.manualClock,
      motionStyle: {
        ...motionStylePresets.lively,
        gestureFrequency: 0.85,
        idleActionGain: 0.72,
        microMotionGain: 0.78,
        blinkRate: 1,
        breathRate: 0.9,
      },
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

    const adapter = new SoullinkLocalEngineAdapter(core, modelPath, {
      persona: options.persona,
      planner,
      onReply: options.onReply,
    });

    try {
      const profileUrl = deriveProfileUrl(modelPath);
      const { profile } = await loadModelProfile(profileUrl);
      adapter.session.setProfile(profile);
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
    const absoluteTime = performance.now() / 1000;
    const timeSeconds = absoluteTime - this.startedAt;
    const deltaSeconds = clamp(deltaMs / 1000 || absoluteTime - this.previousTime, 0.001, 0.1);
    this.previousTime = absoluteTime;

    this.manualClock.tick(timeSeconds, deltaSeconds);
    const snapshot = this.session.getRuntimeSnapshot();
    if (snapshot) {
      this.applyParams(core, snapshot.live2dParams);
    }
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
