interface FACSLikeState {
    browInnerUp: number;
    browOuterUp: number;
    browDown: number;
    eyeOpen: number;
    eyeSmile: number;
    eyeSquint: number;
    eyeBlinkL: number;
    eyeBlinkR: number;
    mouthSmile: number;
    mouthFrown: number;
    mouthOpen: number;
    mouthPucker: number;
    gazeX: number;
    gazeY: number;
    headX: number;
    headY: number;
    headZ: number;
    bodyX: number;
    bodyY: number;
    bodyZ: number;
    blush: number;
    tear: number;
    sweat: number;
    breath: number;
}
type FACSKey = keyof FACSLikeState;
type PartialFACSLikeState = Partial<FACSLikeState>;
type Live2DParamState = Record<string, number>;

interface FACSActionUnitState {
    au01InnerBrowRaiser: number;
    au02OuterBrowRaiser: number;
    au04BrowLowerer: number;
    au05UpperLidRaiser: number;
    au06CheekRaiser: number;
    au07LidTightener: number;
    au09NoseWrinkler: number;
    au10UpperLipRaiser: number;
    au12LipCornerPuller: number;
    au14Dimpler: number;
    au15LipCornerDepressor: number;
    au17ChinRaiser: number;
    au18LipPucker: number;
    au20LipStretcher: number;
    au23LipTightener: number;
    au24LipPressor: number;
    au25LipsPart: number;
    au26JawDrop: number;
    au27MouthStretch: number;
    au45Blink: number;
    gazeX: number;
    gazeY: number;
    headX: number;
    headY: number;
    headZ: number;
    bodyX: number;
    bodyY: number;
    bodyZ: number;
    blush: number;
    tear: number;
    sweat: number;
    breath: number;
}
type FACSActionUnitKey = keyof FACSActionUnitState;
type PartialFACSActionUnitState = Partial<FACSActionUnitState>;
interface ActionUnitDefinition {
    key: FACSActionUnitKey;
    code: string;
    label: string;
    group: "brow" | "eye" | "midface" | "mouth" | "extension";
    min: number;
    max: number;
}
declare const actionUnitDefinitions: ActionUnitDefinition[];
declare const actionUnitKeys: (keyof FACSActionUnitState)[];

declare const facsKeys: FACSKey[];
declare function facsRangeForKey(key: FACSKey): [number, number];
declare function clampFACSValue(key: FACSKey, value: number): number;
declare function normalizeFACS(partial: PartialFACSLikeState): FACSLikeState;
declare function clampFACSState<T extends PartialFACSLikeState>(state: T): T;
declare function mergeFACS(base: PartialFACSLikeState, overlay: PartialFACSLikeState): PartialFACSLikeState;
declare function addFACS(base: PartialFACSLikeState, overlay: PartialFACSLikeState, weight?: number): PartialFACSLikeState;
declare function scaleFACS(state: PartialFACSLikeState, scale: number): PartialFACSLikeState;
declare function scaleFACSFromNeutral(state: PartialFACSLikeState, scale: number): PartialFACSLikeState;
declare function interpolateFACS(from: PartialFACSLikeState, to: PartialFACSLikeState, t: number): PartialFACSLikeState;

interface VADVector {
    valence: number;
    arousal: number;
    dominance: number;
}
interface VADRuntimeState {
    current: VADVector;
    target: VADVector;
    dominantEmotion: string;
    intensity: number;
    ambient?: VADVector;
    holdSeconds?: number;
    decayRate?: number;
}

declare const neutralVAD: VADVector;
declare const emotionVADPresets: Record<string, VADVector>;
declare function getVADPreset(emotion: string, variant?: string): VADVector;

interface EmotionIntent {
    emotion: string;
    variant?: string;
    naturalEmotion?: string;
    naturalVariant?: string;
    naturalVAD?: Partial<VADVector>;
    intensity: number;
    contextTags: string[];
    sourceMessage?: string;
}

interface EmotionPersonality {
    baseline?: Partial<VADVector>;
    reactivity?: number;
    targetApproachRate?: number;
    decayRate?: number;
    emotionHoldSeconds?: number;
    emotionBias?: Partial<Record<string, number>>;
    ambientDriftStrength?: number;
}
declare class EmotionStateController {
    private current;
    private target;
    private baseline;
    private ambientDrift;
    private ambientTarget;
    private ambientDriftStrength;
    private driftClock;
    private nextDriftAt;
    private random;
    private reactivity;
    private targetApproachRate;
    private decayRate;
    private emotionHoldSeconds;
    private holdRemainingSeconds;
    private emotionBias;
    private dominantEmotion;
    constructor(personality?: EmotionPersonality);
    configure(personality: EmotionPersonality): void;
    getDecayRate(): number;
    setBaseline(baseline: Partial<VADVector>): void;
    nudge(intent: EmotionIntent): void;
    blendTo(target: Partial<VADVector>, amount?: number): void;
    nudgeVAD(delta: Partial<VADVector>, amount?: number): void;
    reset(): void;
    update(deltaSeconds: number): VADRuntimeState;
    private inferDominantEmotion;
    private inferSubtleEmotion;
    private updateAmbientDrift;
    private pickAmbientTarget;
    private withAmbientDrift;
    private extendHold;
    private completeVAD;
}

type CharacterState = "IDLE" | "LISTENING" | "REACTING" | "SPEAKING" | "RECOVERING";

interface SoullinkActionBeat {
    time: number;
    duration: number;
    label: string;
    intensity: number;
    facs?: PartialFACSLikeState;
    actionUnits?: PartialFACSActionUnitState;
}
interface SoullinkParameterBeat {
    time: number;
    duration: number;
    label?: string;
    parameters: Live2DParamState;
}
interface SoullinkExternalPlan {
    intent: EmotionIntent;
    replyDraft?: string;
    vadTarget?: Partial<VADVector>;
    vadDelta?: Partial<VADVector>;
    actionPlan?: SoullinkActionBeat[];
    parameterPlan?: SoullinkParameterBeat[];
    provider?: string;
}
interface SoullinkReflectionState {
    thought: string;
    reason: string;
    vadTarget?: Partial<VADVector>;
    emotion?: string;
    createdAt: number;
}
interface SoullinkProactiveEvent {
    id: string;
    emotion: string;
    intensity: number;
    silenceSeconds: number;
    suggestedMessage: string;
    systemPrompt: string;
    reason: string;
    createdAt: number;
}
interface SoullinkPlanRuntimeState {
    provider: string;
    replyDraft: string;
    actionBeatCount: number;
    parameterBeatCount?: number;
    startedAt: number;
}

interface NativeExpressionEntry {
    name: string;
    file: string;
    params?: string[];
}
interface NativeMotionEntry {
    group: string;
    index: number;
    file: string;
}
interface NativeAnimationCatalog {
    expressions?: NativeExpressionEntry[];
    motions?: NativeMotionEntry[];
}
type NativeMotionPriority = "idle" | "normal" | "force";
interface ExpressionBinding {
    expression: string;
    minIntensity?: number;
}
interface MotionBinding {
    group: string;
    index?: number;
    priority?: NativeMotionPriority;
}
interface NativeAnimationDirective {
    token: number;
    expression: string | null;
    motion: MotionBinding | null;
    suppressParamIds: string[];
}
type ParameterBlendMode = "set" | "add" | "subtract" | "inverse";
interface ParameterMapRule {
    target?: string;
    targets?: string[];
    mode?: ParameterBlendMode;
    scale?: number;
    offset?: number;
    min?: number;
    max?: number;
    curve?: "linear" | "easeIn" | "easeOut" | "easeInOut" | "smoothstep";
    gamma?: number;
    deadzone?: number;
    inputRange?: [number, number];
    outputRange?: [number, number];
    invertAround?: number;
}
type ParameterMap = Partial<Record<FACSKey, ParameterMapRule>>;
type PrivateEmotionCategory = "positiveEye" | "blush" | "tear" | "shadow" | "anger" | "sweat" | "surprise" | "privateEffect";
interface PrivateEmotionVADRange {
    valence?: [number, number];
    arousal?: [number, number];
    dominance?: [number, number];
}
interface PrivateEmotionMapping {
    target?: string;
    targets?: string[];
    /** Built-in VAD response curve used when no explicit trigger is supplied. */
    category?: PrivateEmotionCategory;
    /** Dominant-emotion names that activate this mapping. */
    emotions?: string[];
    /** Optional inclusive VAD activation window. */
    vadRange?: PrivateEmotionVADRange;
    triggerMode?: "any" | "all";
    activeValue?: number;
    neutralValue?: number;
    intensity?: number;
    /** Higher values win within the same exclusive group. */
    priority?: number;
    exclusiveGroup?: string;
    source?: "heuristic" | "llm" | "manual";
    confidence?: number;
}
type PrivateEmotionMap = Record<string, PrivateEmotionMapping>;
interface ModelCapabilities {
    headControl: boolean;
    bodyControl: boolean;
    eyeBlink: boolean;
    eyeSmile: boolean;
    gazeControl: boolean;
    mouthOpen: boolean;
    mouthSmile: boolean;
    browControl: boolean;
    blush: boolean;
    tear: boolean;
    sweat: boolean;
    breath: boolean;
}
interface ModelProfile {
    modelId: string;
    displayName: string;
    version: string;
    modelPath: string;
    sourceSignature?: {
        modelDir?: string;
        model3File?: string;
        cdi3File?: string;
        hash: string;
        generatedAt?: string;
    };
    autoProfile?: {
        provider: "openai-compatible" | "heuristic" | "existing" | "manual";
        promptVersion?: string;
        generatedAt?: string;
        notes?: string[];
    };
    schemaVersion?: number;
    capabilities?: ModelCapabilities;
    parameterMap: ParameterMap;
    customParams?: Record<string, ParameterMapRule>;
    privateEmotionMap?: PrivateEmotionMap;
    idleConfig: Partial<Record<FACSKey, [number, number]>>;
    reactionBias?: Record<string, Record<string, number>>;
    neutralParams?: Record<string, number>;
    parameterSmoothing?: Record<string, number>;
    nativeAnimations?: NativeAnimationCatalog;
    expressionMap?: Record<string, ExpressionBinding | string>;
    motionMap?: Record<string, MotionBinding>;
}
interface ProfileLoadResult {
    profile: ModelProfile;
    sourceUrl: string;
}
type ProfileFallback = (facs: PartialFACSLikeState, profile: ModelProfile) => PartialFACSLikeState;

interface VADPrivateParameterInfo {
    name?: string;
    groupId?: string;
    groupName?: string;
    min: number;
    max: number;
    default: number;
}
interface VADPrivateParameterSummary {
    totalParameters: number;
    candidateCount: number;
    categories: Record<string, number>;
}
interface VADPrivateParameterUpdateContext {
    /** Semantic intent may be more specific than the VAD-derived label (for example, confused). */
    intentEmotion?: string;
    intentVariant?: string;
}
declare class VADPrivateParameterOverlay {
    private candidates;
    private declaredCandidates;
    private totalParameters;
    private activeExclusiveCategory;
    private activeVariantByCategory;
    setParameters(parameters: Record<string, VADPrivateParameterInfo>, privateEmotionMap?: PrivateEmotionMap, profileMappedIds?: ReadonlySet<string>): void;
    getSummary(): VADPrivateParameterSummary;
    update(vadState: VADRuntimeState, weight?: number, context?: VADPrivateParameterUpdateContext): Live2DParamState;
}

type EasingName = "linear" | "easeIn" | "easeOut" | "easeInOut";
declare function ease(name: EasingName, t: number): number;

type RandomSource = () => number;
declare function seededRandom(seed: number): RandomSource;

type NumberRange = [number, number];
declare function randomRange(range: NumberRange, random: RandomSource): number;
declare function pickOne<T>(items: T[], random: RandomSource): T;

type FACSRangeMap = Partial<Record<FACSKey, NumberRange>>;
interface EmotionVariant {
    ranges: FACSRangeMap;
    tags?: string[];
}
interface EmotionArchetype {
    emotion: string;
    baseTendency: FACSRangeMap;
    variants: Record<string, EmotionVariant>;
}
interface RuntimeExpressionKeyframe {
    time: number;
    duration: number;
    easing: EasingName;
    facs: PartialFACSLikeState;
    weight?: number;
}
interface RuntimeExpression {
    emotion: string;
    variant: string;
    intensity: number;
    timeline: RuntimeExpressionKeyframe[];
    peakFACS: PartialFACSLikeState;
    idleBias?: PartialFACSLikeState;
    recoveryDuration: number;
}

interface CharacterPersonality {
    expressiveness: number;
    softness: number;
    shyness: number;
    gazeStability: number;
}
interface ExpressionGenerateInput {
    emotion: string;
    variant?: string;
    intensity: number;
    contextTags: string[];
    personality: CharacterPersonality;
    previousState: FACSLikeState;
    seed: number;
}
declare class RuntimeExpressionGenerator {
    generate(input: ExpressionGenerateInput): RuntimeExpression;
    private mergeRanges;
    private sampleFACS;
    private applyContextBias;
    private buildTimeline;
    private createTransitionStart;
    private createTransitionTarget;
    private createLivingVariant;
    private isActiveFromNeutral;
    private createIdleBias;
}

declare const CURRENT_SCHEMA_VERSION = 2;
declare function effectiveSchemaVersion(profile: ModelProfile): number;
interface ProfileValidationResult {
    ok: boolean;
    profile: ModelProfile;
    errors: string[];
    warnings: string[];
}
declare function validateModelProfile(raw: unknown): ProfileValidationResult;
declare function migrateProfile(raw: unknown): {
    profile: ModelProfile;
    fromVersion: number;
    toVersion: number;
    changes: string[];
};

declare function loadModelProfile(url: string, fetcher?: typeof fetch): Promise<ProfileLoadResult>;

/** Return the FACS key families that share a smoothing value */
declare function smoothingForFACS(key: FACSKey): number;
type ProfileRules = Pick<ModelProfile, "parameterMap" | "customParams">;
/** Derive neutral parameter values from the profile's parameterMap and customParams.
 *  eyeOpen targets → 1, breath target → 0.5, all others → 0.
 *  Returns {} if parameterMap/customParams are empty. */
declare function deriveNeutralParams(profile: Pick<ModelProfile, "parameterMap"> & Partial<Pick<ModelProfile, "customParams">>): Record<string, number>;
/** Derive per-parameter smoothing values from the profile's parameterMap and customParams. */
declare function deriveParameterSmoothing(profile: ProfileRules): Record<string, number>;
/** Derive per-parameter {min, max} ranges from the profile's parameterMap/customParams (for gain clamping). */
declare function deriveParameterRanges(profile: ProfileRules): Record<string, {
    min?: number;
    max?: number;
}>;

declare function detectCapabilities(profile: ModelProfile): ModelCapabilities;

type MappingSource = "standard-group" | "standard-id" | "name-match" | "llm" | "derived" | "unmapped" | "unknown";
interface FACSKeyCoverage {
    key: string;
    status: "mapped" | "unmapped";
    source: MappingSource;
    targets: string[];
    confidence: "high" | "medium" | "low";
    capability?: string;
}
interface UnmappedCdiParameter {
    id: string;
    name: string;
    groupId: string;
    groupName: string;
    guessedFacsKey?: string;
}
interface AdaptationCoverage {
    schemaVersion: 1;
    modelDir: string;
    facsKeyCount: number;
    mappedKeyCount: number;
    perKey: FACSKeyCoverage[];
    unmappedKeys: string[];
    lowConfidenceKeys: string[];
    cdiParameterCount: number;
    usedCdiParameterCount: number;
    unmappedCdiParameters: UnmappedCdiParameter[];
    capabilities: ModelCapabilities;
    provider: string;
}
interface CdiParamLike {
    id: string;
    name: string;
    groupId: string;
    groupName: string;
}
interface CoverageInput {
    modelDir: string;
    provider?: string;
    provenance?: Record<string, MappingSource>;
}
/** Membership check over the standard Cubism parameter ids. */
declare function isStandardId(id: string): boolean;
/**
 * Best-effort hint: guess which FACS key an unmapped CDI parameter probably
 * corresponds to, from simple name needles over id + name + groupName.
 * Returns undefined when nothing matches. Hint only — never authoritative.
 */
declare function guessFacsKey(param: CdiParamLike): string | undefined;
/**
 * Compute a response-only adaptation-coverage diagnostic for a model profile.
 * Pure: never mutates inputs and never touches disk. This must never be written
 * into soullink.profile.json.
 */
declare function computeAdaptationCoverage(profile: ModelProfile, params: CdiParamLike[], input: CoverageInput): AdaptationCoverage;

/**
 * Resolves the active NativeAnimationDirective for a given EmotionIntent
 * against the profile's expressionMap / motionMap.
 *
 * Returns null when:
 *   - The profile has neither an expressionMap nor a motionMap, OR
 *   - No entry in the maps matches the intent (including minIntensity gates).
 *
 * Lookup order for both maps:
 *   1. `<emotion>:<variant>` composite key (when intent.variant is present)
 *   2. `<emotion>` plain key fallback
 *
 * suppressParamIds is populated from the matching expression's catalog entry
 * (nativeAnimations.expressions[].params). It is empty when no expression is
 * active or the catalog entry has no params list.
 *
 * KEY COMPAT RULE: profiles without expressionMap/motionMap return null here,
 * so snapshot.nativeAnimation stays null and adapter.apply() produces IDENTICAL
 * live2dParams output — no change from pre-C5 behavior.
 */
declare function resolveNativeAnimation(profile: ModelProfile, intent: EmotionIntent): NativeAnimationDirective | null;

type IdleActionLabel = "small-nod" | "head-tilt" | "side-look" | "weight-shift" | "gentle-lean" | "sigh-sink" | "slow-blink";
type IdleActionDirection = -1 | 0 | 1;
interface IdleActionSchedulerOptions {
    seed: number;
    spontaneity?: number;
    gain?: number;
    minIntervalSeconds?: number;
    maxIntervalSeconds?: number;
    recentWindowSize?: number;
}
interface IdleActionUpdateContext {
    enabled: boolean;
    focusLevel: number;
    vad: VADVector | VADRuntimeState;
    personality?: Partial<CharacterPersonality>;
    profile: ModelProfile;
    suppressed?: boolean;
}
interface IdleActionSchedulerState {
    activeAction: IdleActionLabel | null;
    direction: IdleActionDirection;
    startedAt: number | null;
    duration: number;
    nextActionAt: number | null;
    recentActions: IdleActionLabel[];
    recentDirections: Array<-1 | 1>;
    suppressed: boolean;
}
declare class IdleActionScheduler {
    private readonly seed;
    private readonly spontaneity;
    private readonly gain;
    private readonly minIntervalSeconds;
    private readonly maxIntervalSeconds;
    private readonly recentWindowSize;
    private random;
    private active;
    private nextActionAt;
    private recentActions;
    private recentDirections;
    private lastUpdateAt;
    private suppressed;
    constructor(options: IdleActionSchedulerOptions);
    update(timeSeconds: number, context: IdleActionUpdateContext): PartialFACSLikeState;
    interrupt(timeSeconds?: number): void;
    reset(timeSeconds?: number): void;
    getState(): IdleActionSchedulerState;
    private createAction;
    private pickDirection;
    private remember;
    private sampleInterval;
}

declare class MessageReactionClassifier {
    classify(message: string): EmotionIntent;
}

interface VoiceWaitingMotionOptions {
    emotion?: string;
    intensity?: number;
    vad?: Partial<VADVector>;
}
interface VoiceWaitingMotionStartInfo {
    label: string;
    duration: number;
    amplitude: number;
    tempo: number;
    emotion: string;
    vad: VADVector;
}
declare class VoiceWaitingMotionController {
    private motion;
    start(timeSeconds: number, seed?: number, options?: VoiceWaitingMotionOptions): VoiceWaitingMotionStartInfo;
    reset(): void;
    update(timeSeconds: number, bodyMotionGain?: number): PartialFACSLikeState;
}

interface AudioLevelAnalyzer {
    getLevel(): number;
    /** Optional instantaneous peak, normalized to 0..1. */
    getPeak?(): number;
    /** Optional availability signal for sources that can temporarily lose audio. */
    isAvailable?(): boolean;
    /** Alias accepted by lightweight adapters that expose availability directly. */
    available?(): boolean;
    /** Clear source-side smoothing/buffering when speech ends. */
    reset?(): void;
}
declare class NullAudioLevelAnalyzer implements AudioLevelAnalyzer {
    getLevel(): number;
    getPeak(): number;
    isAvailable(): boolean;
    available(): boolean;
    reset(): void;
}

interface MotionStyleOptions {
    /** Reuse a seed to reproduce the same local motion sequence. */
    seed?: number;
    /** Overall chance of low-frequency spontaneous idle actions. */
    spontaneity?: number;
    /** Frequency multiplier for VAD transition gestures. */
    gestureFrequency?: number;
    /** 0 looks around often, 1 keeps the gaze comparatively steady. */
    gazeStability?: number;
    /** Natural blink frequency multiplier. */
    blinkRate?: number;
    /** Breathing tempo multiplier. */
    breathRate?: number;
    /** Amount of non-periodic breathing variation. */
    breathVariance?: number;
    /** Gain applied to continuous small head and face motion. */
    microMotionGain?: number;
    /** Gain applied to discrete spontaneous idle actions. */
    idleActionGain?: number;
    /** Number of recent action labels avoided when choosing the next action. */
    avoidRepeatWindow?: number;
    /** Gain applied to speech-onset and speech-peak accents. */
    speechAccentGain?: number;
}
interface ResolvedMotionStyle {
    seed: number;
    spontaneity: number;
    gestureFrequency: number;
    gazeStability: number;
    blinkRate: number;
    breathRate: number;
    breathVariance: number;
    microMotionGain: number;
    idleActionGain: number;
    avoidRepeatWindow: number;
    speechAccentGain: number;
}
type MotionStylePresetName = "natural" | "lively" | "calm" | "shy";
declare const motionStylePresets: Readonly<Record<MotionStylePresetName, Readonly<MotionStyleOptions>>>;
declare function resolveMotionStyle(options?: MotionStyleOptions, fallbackGazeStability?: number, fallbackSeed?: number): ResolvedMotionStyle;
declare function createMotionSeed(): number;
declare function deriveMotionSeed(seed: number, channel: number): number;

interface SoullinkRuntimeOptions {
    profile: ModelProfile;
    personality?: Partial<CharacterPersonality>;
    emotionPersonality?: EmotionPersonality;
    motionStyle?: MotionStyleOptions;
    audioLevelAnalyzer?: AudioLevelAnalyzer | null;
}
interface TriggerIntentOptions {
    seed?: number;
    vadTarget?: Partial<VADVector>;
    vadDelta?: Partial<VADVector>;
    actionPlan?: SoullinkActionBeat[];
    parameterPlan?: SoullinkParameterBeat[];
    replyDraft?: string;
    provider?: string;
}
interface RuntimeSnapshot {
    state: CharacterState;
    emotionIntent: EmotionIntent | null;
    runtimeExpression: RuntimeExpression | null;
    seed: number | null;
    vad: VADRuntimeState;
    actionUnits: FACSActionUnitState;
    facs: FACSLikeState;
    live2dParams: Live2DParamState;
    nativeAnimation: NativeAnimationDirective | null;
    profile: ModelProfile;
    idleEnabled: boolean;
    lipSyncEnabled: boolean;
    manualFACS: PartialFACSLikeState;
    manualActionUnits: PartialFACSActionUnitState;
    parameterGain: number;
    bodyMotionGain: number;
    proactiveRepeatEnabled: boolean;
    motionStyle: ResolvedMotionStyle;
    plan: SoullinkPlanRuntimeState | null;
    proactive: SoullinkProactiveEvent | null;
    reflection: SoullinkReflectionState | null;
    customChannels: Record<string, number>;
}
declare class SoullinkRuntime {
    private stateMachine;
    private classifier;
    private generator;
    private emotionState;
    private vadMapper;
    private vadGesture;
    private vadMicroMotion;
    private vadPrivateParameters;
    private vadPrivateParameterInfo;
    private actionUnitSolver;
    private idle;
    private idleActions;
    private mixer;
    private paramSmoother;
    private lipSync;
    private voiceWaitingMotion;
    private reaction;
    private actionPlan;
    private speechParameters;
    private recovery;
    private proactive;
    private reflectionPulse;
    private adapter;
    private profile;
    private personality;
    private motionStyle;
    private sessionRandom;
    private audioLevelAnalyzer;
    private currentIntent;
    private currentSeed;
    private currentVAD;
    private currentActionUnits;
    private currentFACS;
    private currentParams;
    private currentNativeAnimation;
    private manualFACS;
    private manualActionUnits;
    private customChannels;
    private vadExpressionResidue;
    private parameterGain;
    private bodyMotionGain;
    private idleEnabled;
    private lipSyncEnabled;
    private voicePlaybackActive;
    private currentPlan;
    private currentProactive;
    private currentReflection;
    private listenDuration;
    private speechDuration;
    constructor(options: SoullinkRuntimeOptions);
    setProfile(profile: ModelProfile): void;
    setIdleEnabled(enabled: boolean): void;
    setLipSyncEnabled(enabled: boolean): void;
    setMotionStyle(options: MotionStyleOptions): void;
    getMotionStyle(): ResolvedMotionStyle;
    setAudioLevelAnalyzer(analyzer: AudioLevelAnalyzer | null): void;
    setVoicePlaybackActive(active: boolean): void;
    startVoiceWaitingMotion(timeSeconds: number, seed?: number, options?: VoiceWaitingMotionOptions): VoiceWaitingMotionStartInfo;
    clearVoiceWaitingMotion(): void;
    setManualFACS(facs: PartialFACSLikeState): void;
    setManualActionUnits(actionUnits: PartialFACSActionUnitState): void;
    setCustomChannel(name: string, value: number): void;
    setCustomChannels(record: Record<string, number>): void;
    clearCustomChannels(): void;
    setParameterGain(gain: number): void;
    setBodyMotionGain(gain: number): void;
    setPrivateVADParameters(parameters: Record<string, VADPrivateParameterInfo>): VADPrivateParameterSummary;
    private refreshPrivateVADParameters;
    setVADDecayRate(rate: number): void;
    setProactiveRepeatEnabled(enabled: boolean): void;
    clearManualFACS(): void;
    sendMessage(message: string, timeSeconds: number): EmotionIntent;
    triggerPlan(plan: SoullinkExternalPlan, timeSeconds: number): EmotionIntent;
    triggerIntent(intent: EmotionIntent, timeSeconds: number, options?: TriggerIntentOptions | number): void;
    startSpeechMotion(parameterPlan: SoullinkParameterBeat[] | undefined, timeSeconds: number, durationSeconds?: number): void;
    clearSpeechMotion(): void;
    applyVADTarget(target: Partial<VADVector>, amount?: number): void;
    applyVADDelta(delta: Partial<VADVector>, amount?: number): void;
    setReflection(reflection: Omit<SoullinkReflectionState, "createdAt">, timeSeconds: number): void;
    consumeProactive(): void;
    reset(timeSeconds: number): void;
    update(timeSeconds: number, deltaSeconds: number): RuntimeSnapshot;
    getSnapshot(): RuntimeSnapshot;
    private getEmotionLayerWeight;
    private createIdleEngine;
    private createIdleActionScheduler;
    private readAudioInput;
    private getPrivateVADParameterWeight;
    private isIdleGestureEnabled;
    private getManualLayer;
    private applyParameterGain;
    private getParameterRanges;
    private advanceState;
    private getReactionLayer;
    private applySpeechParameterOverlay;
    private applyLipSyncMouthGate;
    private getReflectionLayer;
    private getReflectionPulseIntensity;
    private createVADExpressionResidue;
    private getNaturalEmotionName;
}

declare function clamp(value: number, min?: number, max?: number): number;
declare function clamp01(value: number): number;

export { type ParameterBlendMode as $, type ActionUnitDefinition as A, type IdleActionSchedulerOptions as B, type CharacterState as C, type IdleActionSchedulerState as D, type EmotionArchetype as E, type FACSLikeState as F, type IdleActionUpdateContext as G, type MappingSource as H, type IdleActionDirection as I, MessageReactionClassifier as J, type ModelCapabilities as K, type Live2DParamState as L, type ModelProfile as M, type MotionBinding as N, type MotionStyleOptions as O, type PartialFACSLikeState as P, type MotionStylePresetName as Q, type RuntimeExpressionKeyframe as R, type SoullinkProactiveEvent as S, type NativeAnimationCatalog as T, type NativeAnimationDirective as U, type VADRuntimeState as V, type NativeExpressionEntry as W, type NativeMotionEntry as X, type NativeMotionPriority as Y, NullAudioLevelAnalyzer as Z, type NumberRange as _, type PartialFACSActionUnitState as a, validateModelProfile as a$, type ParameterMap as a0, type PrivateEmotionCategory as a1, type PrivateEmotionMap as a2, type PrivateEmotionMapping as a3, type PrivateEmotionVADRange as a4, type ProfileFallback as a5, type ProfileLoadResult as a6, type ProfileValidationResult as a7, type RandomSource as a8, type ResolvedMotionStyle as a9, deriveNeutralParams as aA, deriveParameterRanges as aB, deriveParameterSmoothing as aC, detectCapabilities as aD, ease as aE, effectiveSchemaVersion as aF, emotionVADPresets as aG, facsKeys as aH, facsRangeForKey as aI, getVADPreset as aJ, guessFacsKey as aK, interpolateFACS as aL, isStandardId as aM, loadModelProfile as aN, mergeFACS as aO, migrateProfile as aP, motionStylePresets as aQ, neutralVAD as aR, normalizeFACS as aS, pickOne as aT, randomRange as aU, resolveMotionStyle as aV, resolveNativeAnimation as aW, scaleFACS as aX, scaleFACSFromNeutral as aY, seededRandom as aZ, smoothingForFACS as a_, RuntimeExpressionGenerator as aa, type RuntimeSnapshot as ab, type SoullinkExternalPlan as ac, type SoullinkPlanRuntimeState as ad, type SoullinkReflectionState as ae, SoullinkRuntime as af, type SoullinkRuntimeOptions as ag, type TriggerIntentOptions as ah, type UnmappedCdiParameter as ai, type VADPrivateParameterInfo as aj, VADPrivateParameterOverlay as ak, type VADPrivateParameterSummary as al, type VADPrivateParameterUpdateContext as am, VoiceWaitingMotionController as an, type VoiceWaitingMotionOptions as ao, type VoiceWaitingMotionStartInfo as ap, actionUnitDefinitions as aq, actionUnitKeys as ar, addFACS as as, clamp as at, clamp01 as au, clampFACSState as av, clampFACSValue as aw, computeAdaptationCoverage as ax, createMotionSeed as ay, deriveMotionSeed as az, type FACSActionUnitState as b, type FACSActionUnitKey as c, type VADVector as d, type ParameterMapRule as e, type SoullinkActionBeat as f, type SoullinkParameterBeat as g, type RuntimeExpression as h, type AdaptationCoverage as i, type AudioLevelAnalyzer as j, CURRENT_SCHEMA_VERSION as k, type CdiParamLike as l, type CharacterPersonality as m, type CoverageInput as n, type EasingName as o, type EmotionIntent as p, type EmotionPersonality as q, EmotionStateController as r, type EmotionVariant as s, type ExpressionBinding as t, type ExpressionGenerateInput as u, type FACSKey as v, type FACSKeyCoverage as w, type FACSRangeMap as x, type IdleActionLabel as y, IdleActionScheduler as z };
