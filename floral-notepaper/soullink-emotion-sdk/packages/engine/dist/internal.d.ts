import { P as PartialFACSLikeState, F as FACSLikeState, a as PartialFACSActionUnitState, b as FACSActionUnitState, c as FACSActionUnitKey, C as CharacterState, V as VADRuntimeState, S as SoullinkProactiveEvent, d as VADVector, E as EmotionArchetype, R as RuntimeExpressionKeyframe, M as ModelProfile, L as Live2DParamState, e as ParameterMapRule, f as SoullinkActionBeat, g as SoullinkParameterBeat, h as RuntimeExpression } from './index-D3NtF5pg.js';
export { A as ActionUnitDefinition, i as AdaptationCoverage, j as AudioLevelAnalyzer, k as CURRENT_SCHEMA_VERSION, l as CdiParamLike, m as CharacterPersonality, n as CoverageInput, o as EasingName, p as EmotionIntent, q as EmotionPersonality, r as EmotionStateController, s as EmotionVariant, t as ExpressionBinding, u as ExpressionGenerateInput, v as FACSKey, w as FACSKeyCoverage, x as FACSRangeMap, I as IdleActionDirection, y as IdleActionLabel, z as IdleActionScheduler, B as IdleActionSchedulerOptions, D as IdleActionSchedulerState, G as IdleActionUpdateContext, H as MappingSource, J as MessageReactionClassifier, K as ModelCapabilities, N as MotionBinding, O as MotionStyleOptions, Q as MotionStylePresetName, T as NativeAnimationCatalog, U as NativeAnimationDirective, W as NativeExpressionEntry, X as NativeMotionEntry, Y as NativeMotionPriority, Z as NullAudioLevelAnalyzer, _ as NumberRange, $ as ParameterBlendMode, a0 as ParameterMap, a1 as PrivateEmotionCategory, a2 as PrivateEmotionMap, a3 as PrivateEmotionMapping, a4 as PrivateEmotionVADRange, a5 as ProfileFallback, a6 as ProfileLoadResult, a7 as ProfileValidationResult, a8 as RandomSource, a9 as ResolvedMotionStyle, aa as RuntimeExpressionGenerator, ab as RuntimeSnapshot, ac as SoullinkExternalPlan, ad as SoullinkPlanRuntimeState, ae as SoullinkReflectionState, af as SoullinkRuntime, ag as SoullinkRuntimeOptions, ah as TriggerIntentOptions, ai as UnmappedCdiParameter, aj as VADPrivateParameterInfo, ak as VADPrivateParameterOverlay, al as VADPrivateParameterSummary, am as VADPrivateParameterUpdateContext, an as VoiceWaitingMotionController, ao as VoiceWaitingMotionOptions, ap as VoiceWaitingMotionStartInfo, aq as actionUnitDefinitions, ar as actionUnitKeys, as as addFACS, at as clamp, au as clamp01, av as clampFACSState, aw as clampFACSValue, ax as computeAdaptationCoverage, ay as createMotionSeed, az as deriveMotionSeed, aA as deriveNeutralParams, aB as deriveParameterRanges, aC as deriveParameterSmoothing, aD as detectCapabilities, aE as ease, aF as effectiveSchemaVersion, aG as emotionVADPresets, aH as facsKeys, aI as facsRangeForKey, aJ as getVADPreset, aK as guessFacsKey, aL as interpolateFACS, aM as isStandardId, aN as loadModelProfile, aO as mergeFACS, aP as migrateProfile, aQ as motionStylePresets, aR as neutralVAD, aS as normalizeFACS, aT as pickOne, aU as randomRange, aV as resolveMotionStyle, aW as resolveNativeAnimation, aX as scaleFACS, aY as scaleFACSFromNeutral, aZ as seededRandom, a_ as smoothingForFACS, a$ as validateModelProfile } from './index-D3NtF5pg.js';

declare function createDefaultFACSState(overrides?: PartialFACSLikeState): FACSLikeState;
declare const defaultFACSState: FACSLikeState;

declare function createDefaultActionUnitState(overrides?: PartialFACSActionUnitState): FACSActionUnitState;
declare const defaultActionUnitState: FACSActionUnitState;

declare function actionUnitRangeForKey(key: FACSActionUnitKey): [number, number];
declare function clampActionUnitValue(key: FACSActionUnitKey, value: number): number;
declare function clampActionUnitState<T extends PartialFACSActionUnitState>(state: T): T;
declare function normalizeActionUnits(partial: PartialFACSActionUnitState): FACSActionUnitState;
declare function addActionUnits(base: PartialFACSActionUnitState, overlay: PartialFACSActionUnitState, weight?: number): PartialFACSActionUnitState;

interface ProactiveControllerOptions {
    silenceThresholdSeconds?: number;
    longSilenceSeconds?: number;
    cooldownSeconds?: number;
    settledIntensityThreshold?: number;
    targetSettledIntensityThreshold?: number;
    settledHoldSeconds?: number;
    repeatOnSettledVAD?: boolean;
    repeatAxisThreshold?: number;
}
declare class ProactiveController {
    private silenceThresholdSeconds;
    private longSilenceSeconds;
    private cooldownSeconds;
    private settledIntensityThreshold;
    private targetSettledIntensityThreshold;
    private settledHoldSeconds;
    private repeatOnSettledVAD;
    private repeatAxisThreshold;
    private random;
    private lastUserInteractionAt;
    private lastEventAt;
    private settledSince;
    private firedSinceInteraction;
    private currentEvent;
    constructor(options?: ProactiveControllerOptions);
    setRepeatOnSettledVAD(enabled: boolean): void;
    get repeatEnabled(): boolean;
    reset(timeSeconds?: number): void;
    notifyUserInteraction(timeSeconds: number): void;
    consume(): void;
    update(timeSeconds: number, state: CharacterState, vad: VADRuntimeState): SoullinkProactiveEvent | null;
    private isVADSettled;
    private resolveSettledEmotion;
    private randomVADPresetEmotion;
}

interface ReflectionPulseInput {
    emotion?: string;
    vadTarget?: Partial<VADVector>;
    intensity?: number;
    seed?: number;
}
declare class ReflectionPulseController {
    private pulse;
    start(input: ReflectionPulseInput, timeSeconds: number): void;
    update(timeSeconds: number): PartialFACSLikeState;
    reset(): void;
    private envelope;
}

interface VADExpressionResidue {
    emotion: string;
    facs: PartialFACSLikeState;
}
interface VADExpressionMapperOptions {
    dominantEmotion?: string;
    residue?: VADExpressionResidue | null;
    styleGain?: number;
}
declare class VADExpressionMapper {
    toFACS(vad: VADVector, weight?: number, options?: VADExpressionMapperOptions): PartialFACSLikeState;
    private getArchetypeStyle;
    private applyStyle;
}

interface VADGestureOptions {
    enabled: boolean;
    bodyMotionGain?: number;
    frequency?: number;
    avoidRepeatWindow?: number;
}
interface VADGestureState {
    activeLabel: string | null;
    recentLabels: string[];
    nextAllowedGestureAt: number;
}
declare class VADGestureController {
    private readonly seed;
    private previousTarget;
    private gesture;
    private random;
    private nextAllowedGestureAt;
    private recentGestureLabels;
    constructor(seed?: number);
    reset(): void;
    getState(): VADGestureState;
    update(timeSeconds: number, vad: VADRuntimeState, options: VADGestureOptions): PartialFACSLikeState;
    private getTargetDelta;
    private maybeStartGesture;
    private evaluateGesture;
}

declare class VADMicroMotionController {
    private readonly seed;
    private previous;
    private pulse;
    private random;
    private nextAllowedPulseAt;
    private phases;
    constructor(seed?: number);
    reset(): void;
    update(timeSeconds: number, vad: VADVector, focusLevel: number, bodyMotionGain?: number): PartialFACSLikeState;
    private getDelta;
    private maybeStartPulse;
    private continuousLayer;
    private pulseLayer;
    private createPhases;
}

declare class ActionUnitSolver {
    solve(actionUnits: PartialFACSActionUnitState): PartialFACSLikeState;
    solvePartial(actionUnits: PartialFACSActionUnitState): PartialFACSLikeState;
    project(facs: PartialFACSLikeState): PartialFACSActionUnitState;
}

declare const emotionArchetypes: Record<string, EmotionArchetype>;
declare function getEmotionArchetype(emotion: string): EmotionArchetype;

declare function getTimelineDuration(timeline: RuntimeExpressionKeyframe[]): number;
declare function evaluateExpressionTimeline(timeline: RuntimeExpressionKeyframe[], elapsedSeconds: number): PartialFACSLikeState;

declare class ModelProfileAdapter {
    private profile;
    constructor(profile: ModelProfile);
    setProfile(profile: ModelProfile): void;
    getProfile(): ModelProfile;
    apply(facs: PartialFACSLikeState, customChannels?: Record<string, number>): Live2DParamState;
    private applyLegacy;
    private applyV2;
    private getTargets;
    private mapValue;
    private clampRuleValue;
}

type ResponseCurve = "linear" | "easeIn" | "easeOut" | "easeInOut" | "smoothstep";
/**
 * Map a FACS/custom-channel value through one profile rule.
 * Legacy rules intentionally keep the historical compose math byte-for-byte in shape.
 * v2 outputRange remaps the post-mode normalized value, then scale/offset still apply;
 * adapters remain responsible for final min/max clamping.
 */
declare function transformRuleValue(value: number, rule: ParameterMapRule): number;

declare function applyFallbackStrategies(facs: PartialFACSLikeState, profile: ModelProfile): PartialFACSLikeState;

interface IdleEngineStyle {
    seed?: number;
    gazeStability?: number;
    blinkRate?: number;
    breathRate?: number;
    breathVariance?: number;
    microMotionGain?: number;
}
interface IdleEngineOptions {
    enabled: boolean;
    focusLevel: number;
    profile: ModelProfile;
    bodyMotionGain?: number;
}
declare class IdleEngine {
    private blink;
    private gaze;
    private breathing;
    private microMotion;
    private bodySway;
    private bias;
    private style;
    constructor(style?: IdleEngineStyle);
    setBias(bias: PartialFACSLikeState, duration: number, timeSeconds: number): void;
    deferBlink(timeSeconds: number, duration: number): void;
    resetBias(): void;
    reset(): void;
    update(timeSeconds: number, options: IdleEngineOptions): PartialFACSLikeState;
}

declare class ActionPlanSequencer {
    private beats;
    private startedAt;
    private actionUnitSolver;
    start(beats: SoullinkActionBeat[] | undefined, timeSeconds: number): void;
    reset(): void;
    get beatCount(): number;
    get duration(): number;
    isComplete(timeSeconds: number): boolean;
    evaluate(timeSeconds: number): PartialFACSLikeState;
}

declare class ParameterPlanSequencer {
    private beats;
    private startedAt;
    private lastActiveSignature;
    start(beats: SoullinkParameterBeat[] | undefined, timeSeconds: number): void;
    reset(): void;
    get beatCount(): number;
    evaluate(timeSeconds: number): Live2DParamState;
    private logActiveBeatChange;
}

declare class ReactionSequencer {
    private expression;
    private startedAt;
    start(expression: RuntimeExpression, timeSeconds: number): void;
    reset(): void;
    get currentExpression(): RuntimeExpression | null;
    get duration(): number;
    elapsed(timeSeconds: number): number;
    isComplete(timeSeconds: number): boolean;
    evaluate(timeSeconds: number): PartialFACSLikeState;
    hold(weight?: number): PartialFACSLikeState;
}

declare class RecoveryController {
    private startedAt;
    private duration;
    private from;
    start(from: PartialFACSLikeState, duration: number, timeSeconds: number): void;
    reset(): void;
    get active(): boolean;
    isComplete(timeSeconds: number): boolean;
    update(timeSeconds: number): PartialFACSLikeState;
}

interface LipSyncOptions {
    enabled: boolean;
    speaking: boolean;
    intensity: number;
    /** Normalized RMS/audio level. Supplying this enables the measured path. */
    audioLevel?: number;
    /** Optional normalized instantaneous peak used for speech accents. */
    audioPeak?: number;
    /** Frame delta in seconds. The timestamp delta is used when omitted. */
    deltaSeconds?: number;
    /** Multiplier for small head/brow accents caused by local peaks. */
    speechAccentGain?: number;
}
declare class LipSyncController {
    private smoothedLevel;
    private previousLevel;
    private previousPeak;
    private accent;
    private accentDirection;
    private lastAccentTime;
    private lastTimeSeconds;
    update(timeSeconds: number, options: LipSyncOptions): PartialFACSLikeState;
    reset(): void;
    private updateProcedural;
    private updateMeasured;
}

declare function estimateMockSpeechDuration(message: string): number;

declare class CharacterStateMachine {
    private state;
    private enteredAt;
    get current(): CharacterState;
    get phaseStartedAt(): number;
    transition(next: CharacterState, timeSeconds: number, force?: boolean): void;
    reset(timeSeconds?: number): void;
    elapsed(timeSeconds: number): number;
}

interface MotionMixerInput {
    idle?: PartialFACSLikeState;
    emotion?: PartialFACSLikeState;
    reaction?: PartialFACSLikeState;
    speech?: PartialFACSLikeState;
    manual?: PartialFACSLikeState;
}
declare class MotionMixer {
    mix(input: MotionMixerInput): FACSLikeState;
    private applyLayer;
}

declare class LayeredParameterMixer {
    private current;
    reset(): void;
    smooth(target: Live2DParamState, deltaSeconds: number, speedByParam?: Record<string, number>): Live2DParamState;
}

declare const additiveFACSKeys: Set<keyof FACSLikeState>;
declare const maxFACSKeys: Set<keyof FACSLikeState>;

declare function lerp(from: number, to: number, t: number): number;

declare function smoothDamp(current: number, target: number, factor: number): number;
declare function smoothingFactor(speed: number, deltaSeconds: number): number;

export { ActionPlanSequencer, ActionUnitSolver, CharacterState, CharacterStateMachine, EmotionArchetype, FACSActionUnitKey, FACSActionUnitState, FACSLikeState, IdleEngine, type IdleEngineOptions, type IdleEngineStyle, LayeredParameterMixer, LipSyncController, type LipSyncOptions, Live2DParamState, ModelProfile, ModelProfileAdapter, MotionMixer, type MotionMixerInput, ParameterMapRule, ParameterPlanSequencer, PartialFACSActionUnitState, PartialFACSLikeState, ProactiveController, type ProactiveControllerOptions, ReactionSequencer, RecoveryController, ReflectionPulseController, type ReflectionPulseInput, type ResponseCurve, RuntimeExpression, RuntimeExpressionKeyframe, SoullinkActionBeat, SoullinkParameterBeat, SoullinkProactiveEvent, VADExpressionMapper, type VADExpressionMapperOptions, type VADExpressionResidue, VADGestureController, type VADGestureOptions, type VADGestureState, VADMicroMotionController, VADRuntimeState, VADVector, actionUnitRangeForKey, addActionUnits, additiveFACSKeys, applyFallbackStrategies, clampActionUnitState, clampActionUnitValue, createDefaultActionUnitState, createDefaultFACSState, defaultActionUnitState, defaultFACSState, emotionArchetypes, estimateMockSpeechDuration, evaluateExpressionTimeline, getEmotionArchetype, getTimelineDuration, lerp, maxFACSKeys, normalizeActionUnits, smoothDamp, smoothingFactor, transformRuleValue };
