import type { EmotionIntent, Live2DParamState, NativeAnimationDirective } from "@soullink-emotion/engine";
import { createScriptTagCubismLoader, Live2DRenderer } from "@soullink-emotion/live2d-pixi";
import type { Live2DModelController } from "./modelController";
import { SoullinkLocalEngineAdapter } from "./soullinkLocalEngine";
import type { SoullinkCoreModelApi, SoullinkLocalMood } from "./soullinkLocalEngine";

export interface OfficialLive2DControllerOptions {
  /** LLM 生成的回复回调（用于展示气泡） */
  onReply?: (reply: string) => void;
  /** Cubism 4 Core 脚本地址（默认与 README 教程一致的 /live2dcubismcore.min.js） */
  coreUrl?: string;
}

/**
 * 官方 Soullink Emotion SDK 渲染后端控制器。
 *
 * 底层使用 @soullink-emotion/live2d-pixi 的 Live2DRenderer（Pixi v7 + Cubism 4），
 * 帧循环严格遵循 SDK 官方测试项目（soullink-emotion-sdk/src/browser-test.js）：
 *
 *   runtime.update(timeSeconds, deltaSeconds)           → 由 SoullinkLocalEngineAdapter.tick 驱动
 *   仅 LISTENING / REACTING / SPEAKING 状态应用 snapshot.nativeAnimation（IDLE / RECOVERING 时传 null 复位表情）
 *   renderer.applyNativeAnimation(directive)
 *   renderer.setParameters(snapshot.live2dParams)
 *
 * 环境 idle（呼吸 / 眨眼 / FACS 微动作）完全由引擎 runtime 的参数级 IdleEngine 驱动，
 * 不再手动轮换原生 Idle 动作，与 SDK 官方用法一致。
 *
 * 对外仍暴露与 legacy 控制器一致的 {@link Live2DModelController} 接口，
 * 因此 Live2DCompanionLayer / signalBridge 的既有调用链无需改动。
 *
 * 注意：Live2DRenderer 与 legacy 场景都使用 Pixi v8，并按各自控制器生命周期创建/销毁。
 * 控制器被销毁/重建时各栈只加载自己那套，不会同时渲染两个模型。
 */
export function createOfficialLive2DController(
  container: HTMLElement,
  canvas: HTMLCanvasElement,
  options: OfficialLive2DControllerOptions = {},
): Live2DModelController {
  let renderer: Live2DRenderer | null = null;
  let engine: SoullinkLocalEngineAdapter | null = null;
  let loaded = false;
  let rafId: number | null = null;
  let prevFrameTime = performance.now();
  let manualToken = 0;
  let mouthValue = 0;
  let mouthTimer: number | null = null;
  let eyeFollowEnabled = false;
  let mouseFollowStrength = 1;
  let gazeExtra: Live2DParamState = {};
  let manual:
    | { expression: string | null; motion: { group: string; index: number; priority: "idle" | "normal" | "force" } | null }
    | null = null;

  const coreUrl = options.coreUrl ?? "/live2dcubismcore.min.js";

  // SoullinkLocalEngineAdapter 构造时仅用 core 枚举参数索引；
  // 官方渲染器按参数 ID 写入（setParameters → setParameterValueById），
  // 这里提供一个空 core 占位即可，profile 随后由 create() 覆盖加载。
  const emptyCore: SoullinkCoreModelApi = {
    getParameterCount: () => 0,
  };

  const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

  const clearMouthTimer = () => {
    if (mouthTimer !== null) {
      window.clearTimeout(mouthTimer);
      mouthTimer = null;
    }
  };

  /** 手动动作/表情指令：状态变化时递增 token，让渲染器重新应用一次。 */
  const setManual = (next: typeof manual) => {
    manual = next;
    manualToken += 1;
  };

  const buildDirective = (engineDirective: NativeAnimationDirective | null): NativeAnimationDirective | null => {
    if (!manual) return engineDirective;
    return {
      token: manualToken,
      expression: manual.expression,
      motion: manual.motion,
      suppressParamIds: engineDirective?.suppressParamIds ?? [],
    };
  };

  const startFrameLoop = () => {
    stopFrameLoop();
    prevFrameTime = performance.now();
    const frame = () => {
      if (!renderer || !engine) return;
      const now = performance.now();
      const deltaMs = Math.min(now - prevFrameTime, 100);
      prevFrameTime = now;

      // README 教程一帧循环：runtime.update → snapshot → 渲染器
      const snapshot = engine.tick(deltaMs);
      if (snapshot) {
        // SDK 官方帧循环：IDLE / RECOVERING 状态不应用原生动画（表情复位到中性），
        // 仅 LISTENING / REACTING / SPEAKING 等活跃状态应用 runtime 产出的指令。
        const autoDirective =
          snapshot.state === "IDLE" || snapshot.state === "RECOVERING"
            ? null
            : snapshot.nativeAnimation;
        renderer.applyNativeAnimation(buildDirective(autoDirective));
        const params: Live2DParamState = { ...snapshot.live2dParams, ...gazeExtra };
        if (mouthValue > 0) params.ParamMouthOpenY = mouthValue;
        renderer.setParameters(params);
      }

      if (mouthValue > 0) mouthValue = Math.max(0, mouthValue - deltaMs / 420);
      rafId = requestAnimationFrame(frame);
    };
    rafId = requestAnimationFrame(frame);
  };

  const stopFrameLoop = () => {
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  };

  const unload = () => {
    stopFrameLoop();
    clearMouthTimer();
    loaded = false;
    manual = null;
    gazeExtra = {};
    mouthValue = 0;
    if (engine) {
      engine.stop();
      engine = null;
    }
    if (renderer) {
      try {
        renderer.destroy();
      } catch {
        // 渲染器可能因 WebGL 上下文丢失而抛错，忽略以便重建
      }
      renderer = null;
    }
  };

  return {
    get model() {
      return loaded ? {} : null;
    },

    async load(modelUrl: string) {
      unload();

      renderer = new Live2DRenderer(container, {
        cubismLoader: createScriptTagCubismLoader(coreUrl),
        canvas,
      });

      try {
        // renderer.load 内部会注入 Cubism 4 Core 并创建 PIXI v7 场景与模型，
        // 返回的 motionParameters（各参数 min/max）交给会话做说话动作规划。
        const motionParameters = await renderer.load(modelUrl);

        engine = await SoullinkLocalEngineAdapter.create(emptyCore, modelUrl, {
          onReply: options.onReply,
        });
        engine.setSpeakingMotionParameters(motionParameters);

        loaded = true;
        startFrameLoop();
      } catch (cause) {
        unload();
        throw cause instanceof Error ? cause : new Error(String(cause));
      }
    },

    unload,

    setPosition() {
      // 位置由 Live2DCompanionLayer 通过 CSS left/top 控制（config.position）
    },

    setScale() {
      // 缩放由 Live2DCompanionLayer 通过 CSS transform: scale 控制（config.scale）
    },

    playMotion(group: string, index = 0) {
      if (!loaded) return;
      setManual({ expression: manual?.expression ?? null, motion: { group, index, priority: "normal" } });
    },

    async setExpression(expressionId: string) {
      if (!loaded) return;
      setManual({ expression: expressionId || null, motion: manual?.motion ?? null });
    },

    removeAllExpressions() {
      if (!loaded) return;
      setManual(manual?.motion ? { expression: "", motion: manual.motion } : null);
    },

    setMouthValue(value: number) {
      mouthValue = clamp(value, 0, 1);
      clearMouthTimer();
    },

    pulseMouth(durationMs = 220) {
      mouthValue = 1;
      clearMouthTimer();
      mouthTimer = window.setTimeout(() => {
        mouthValue = 0;
        mouthTimer = null;
      }, durationMs);
    },

    triggerEmotion(mood: SoullinkLocalMood, intensity = 0.75) {
      engine?.triggerEmotion(mood, intensity);
    },

    sendMessage(message: string): Promise<EmotionIntent | null> {
      return engine ? engine.sendMessage(message) : Promise.resolve(null);
    },

    focusAt(clientX: number, clientY: number) {
      if (!eyeFollowEnabled) return;
      const rect = container.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const nx = ((clientX - rect.left) / rect.width - 0.5) * 2;
      const ny = ((clientY - rect.top) / rect.height - 0.5) * 2;
      gazeExtra = {
        ParamEyeBallX: clamp(nx * mouseFollowStrength, -1, 1),
        ParamEyeBallY: clamp(ny * mouseFollowStrength, -1, 1),
      };
    },

    enableEyeFollow(enabled: boolean) {
      eyeFollowEnabled = enabled;
      if (!enabled) gazeExtra = {};
    },

    setMouseFollowStrength(strength: number) {
      mouseFollowStrength = clamp(strength, 0, 2);
    },

    destroy() {
      unload();
    },
  };
}
