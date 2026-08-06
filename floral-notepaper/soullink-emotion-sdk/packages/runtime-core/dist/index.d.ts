import { EmotionIntent, VADVector, SoullinkExternalPlan, SoullinkProactiveEvent, SoullinkReflectionState, PartialFACSLikeState, SoullinkParameterBeat, RuntimeSnapshot, ModelProfile, SoullinkRuntime, PartialFACSActionUnitState, MotionStyleOptions, AudioLevelAnalyzer } from '@soullink-emotion/engine';
export { RuntimeSnapshot } from '@soullink-emotion/engine';

type VoiceStatus = "idle" | "loading" | "playing" | "error";
interface ConversationTurn {
    role: "user" | "assistant";
    content: string;
}
/**
 * Character configuration. Kept as plain data so it can be serialized and swapped
 * without touching the orchestration.
 */
interface PersonaConfig {
    name: string;
    profile: string;
    /** Maps an emotion name to the expression variant used when the character speaks. */
    variantByEmotion: Record<string, string>;
    /** Emotion -> canned reply used when the reaction planner fails. */
    fallbacks?: Record<string, string>;
    /** Emotion -> canned line used when a proactive draft fails to generate. */
    proactiveFallbacks?: Record<string, string>;
}
/** Structural mirror of the renderer's Live2DMotionParameterInfo (no renderer import). */
interface MotionParameterInfo {
    name?: string;
    groupId?: string;
    groupName?: string;
    min: number;
    max: number;
    default: number;
}
interface ProactiveDraft {
    eventId: string;
    status: "loading" | "ready" | "error";
    message: string;
    emotion: string;
    reason: string;
    provider: string;
}
interface ReactionPlanInput {
    message: string;
    conversation: ConversationTurn[];
    characterName: string;
    characterProfile: string;
    vad?: Partial<VADVector>;
}
interface ProactivePlanInput {
    characterName: string;
    characterProfile: string;
    proactive: SoullinkProactiveEvent;
    conversation: ConversationTurn[];
    reflection: SoullinkReflectionState | null;
    vad?: Partial<VADVector>;
}
interface ProactivePlanResult {
    message: string;
    emotion: string;
    reason: string;
    provider: string;
}
interface ReflectionPlanInput {
    conversation: ConversationTurn[];
    vad?: Partial<VADVector>;
    topic?: string;
    characterName: string;
    characterProfile: string;
}
interface ReflectionPlanResult {
    thought: string;
    reason: string;
    emotion?: string;
    vadTarget?: Partial<VADVector>;
}
/**
 * `fixed-parallel` plans a known number of frames while TTS is still running.
 * `duration` waits for TTS so the planner can size the plan from the real clip.
 */
type SpeakingMotionSchedulingMode = "duration" | "fixed-parallel";
interface SpeakingMotionSchedulingConfig {
    /** Defaults to `fixed-parallel` for the lowest time-to-first-audio. */
    mode?: SpeakingMotionSchedulingMode;
    /** Number of keyframes requested in `fixed-parallel` mode. Defaults to 4. */
    fixedFrameCount?: number;
    /** Distance between generated keyframes. Defaults to 1 second. */
    frameIntervalSec?: number;
}
interface SpeakingMotionInput {
    speechText: string;
    durationSec: number;
    /** Scheduling metadata for planners that support both duration-derived and fixed plans. */
    mode?: SpeakingMotionSchedulingMode;
    /** Present in `fixed-parallel` mode; omitted so duration-aware planners can derive it. */
    frameCount?: number;
    frameIntervalSec?: number;
    availableParameters?: Record<string, MotionParameterInfo>;
    intent?: Partial<EmotionIntent>;
    vad?: Partial<VADVector>;
    expression?: {
        emotion?: string;
        variant?: string;
        intensity?: number;
        peakFACS?: PartialFACSLikeState;
    } | null;
    characterName: string;
    characterProfile: string;
    userMessage?: string;
}
interface SpeakingMotionResult {
    /** Empty or omitted when VAD/FACS should drive expression without parameter keyframes. */
    parameterPlan?: SoullinkParameterBeat[];
    /** `vad-facs` explicitly selects the no-parameter-plan path. */
    provider?: string;
    fallbackReason?: string;
}
interface PlannerClient {
    planReaction(input: ReactionPlanInput): Promise<SoullinkExternalPlan>;
    planProactive?(input: ProactivePlanInput): Promise<ProactivePlanResult>;
    planReflection?(input: ReflectionPlanInput): Promise<ReflectionPlanResult>;
    planSpeakingMotion?(input: SpeakingMotionInput): Promise<SpeakingMotionResult>;
}
interface TtsContext {
    emotion?: string;
    vad?: Partial<VADVector>;
    intent?: EmotionIntent | null;
}
interface TtsResult {
    url?: string;
    bytes?: ArrayBuffer;
    durationSec?: number;
}
interface TtsClient {
    synthesize(text: string, ctx: TtsContext): Promise<TtsResult>;
}
type ClockTickCallback = (now: number, dt: number) => void;
interface Clock {
    start(cb: ClockTickCallback): void;
    stop(): void;
    /** Best-effort current time in seconds; used for intent timing between ticks. */
    now?(): number;
}
interface ManualClock extends Clock {
    now(): number;
    tick(now: number, dt: number): void;
}
interface AudioSource {
    url?: string;
    bytes?: ArrayBuffer;
}
/**
 * Result of starting playback. `play` resolves once playback has *started*.
 * `finished` (when provided) resolves when the clip ends, errors, or is stopped,
 * which is what the serial callers await to preserve one-at-a-time speech.
 */
interface AudioPlayback {
    durationSec: number;
    finished?: Promise<void>;
}
interface AudioSink {
    play(src: AudioSource): Promise<AudioPlayback>;
    stop(): void;
}
interface ClassifyResult {
    intent: EmotionIntent;
}
interface MessageClassifier {
    classify(message: string): Promise<ClassifyResult>;
}
/** Subset of the engine runtime's trigger options the session forwards. */
interface TriggerIntentOptions {
    seed?: number;
    vadTarget?: Partial<VADVector>;
    vadDelta?: Partial<VADVector>;
    parameterPlan?: SoullinkParameterBeat[];
    replyDraft?: string;
    provider?: string;
}
/** Full session state, emitted on every meaningful change via `onSnapshot`. */
interface SessionSnapshot {
    runtime: RuntimeSnapshot | null;
    planning: boolean;
    apiError: string | null;
    lastReply: string;
    voiceStatus: VoiceStatus;
    autoVoiceEnabled: boolean;
    proactiveDraft: ProactiveDraft | null;
    conversation: ConversationTurn[];
}
interface SoullinkSessionOptions {
    profile: ModelProfile;
    persona: PersonaConfig;
    planner?: PlannerClient;
    tts?: TtsClient;
    classifier?: MessageClassifier;
    clock?: Clock;
    audio?: AudioSink;
    onSnapshot?: (snapshot: SessionSnapshot) => void;
    reflectionIdleDelaySeconds?: number;
    speakingMotionScheduling?: SpeakingMotionSchedulingConfig;
    /** Optional local motion variation tuning passed to the engine runtime. */
    motionStyle?: MotionStyleOptions;
    /** Optional measured audio source for RMS lip sync and speech accents. */
    audioLevelAnalyzer?: AudioLevelAnalyzer | null;
}
interface SpeakRequest {
    text: string;
    emotion?: string;
    vad?: Partial<VADVector>;
    intent?: EmotionIntent | null;
    planSpeakingMotion?: boolean;
    force?: boolean;
    userMessage?: string;
}
interface DeliverProactiveOptions {
    /** Transform the planned message before it is spoken (e.g. length clamp). */
    transformMessage?: (message: string) => string;
    /** Emotion to fall back to when the planner does not return one. */
    fallbackEmotion?: string;
    /** Prefix for the apiError string set when planning fails. */
    errorLabel?: string;
}
interface SoullinkSession {
    start(): void;
    stop(): void;
    sendMessage(message: string, options?: {
        awaitReply?: boolean;
    }): Promise<EmotionIntent | null>;
    triggerIntent(intent: EmotionIntent, options?: TriggerIntentOptions): void;
    acceptProactive(): Promise<void>;
    deliverProactive(event: SoullinkProactiveEvent, options?: DeliverProactiveOptions): Promise<boolean>;
    planProactive(event: SoullinkProactiveEvent): Promise<ProactivePlanResult>;
    pushAssistantTurn(content: string): void;
    requestReflection(topic?: string): Promise<void>;
    synthesizeLastReply(): Promise<void>;
    speak(request: SpeakRequest): Promise<void>;
    stopVoice(): void;
    reset(): void;
    setProfile(profile: ModelProfile): void;
    getSnapshot(): SessionSnapshot;
    getRuntimeSnapshot(): RuntimeSnapshot | null;
    getRuntime(): SoullinkRuntime | null;
    getProfile(): ModelProfile | null;
    setSpeakingMotionParameters(parameters: Record<string, MotionParameterInfo>): void;
    setAutoVoiceEnabled(enabled: boolean): void;
    setIdleEnabled(enabled: boolean): void;
    setLipSyncEnabled(enabled: boolean): void;
    setManualFACS(facs: PartialFACSLikeState): void;
    setManualActionUnits(actionUnits: PartialFACSActionUnitState): void;
    setManualParameters(parameters: Record<string, number>): void;
    setParameterGain(gain: number): void;
    setBodyMotionGain(gain: number): void;
    setVADDecayRate(rate: number): void;
    setProactiveRepeatEnabled(enabled: boolean): void;
}

/**
 * Headless, framework-agnostic orchestrator. Owns the engine SoullinkRuntime and
 * drives the reaction / proactive / reflection / voice-playback loops through
 * injected ports (clock, audio, planner, tts, classifier). No requestAnimationFrame,
 * Audio, localStorage, or DOM access lives here.
 */
declare function createSoullinkSession(options: SoullinkSessionOptions): SoullinkSession;

/**
 * requestAnimationFrame-backed clock. Falls back to an interval when rAF is not
 * available (e.g. Node), so importing this module never throws off the browser.
 */
declare function createRafClock(): Clock;
/** setInterval-backed clock at a fixed frame rate. Works in any environment. */
declare function createIntervalClock(fps?: number): Clock;
/**
 * Deterministic clock driven by explicit `tick(now, dt)` calls. Ideal for tests.
 * `now()` reflects the last ticked time.
 */
declare function createManualClock(initial?: number): ManualClock;

/**
 * AudioSink backed by HTMLAudioElement. In a non-browser environment `play`
 * resolves immediately so the session degrades gracefully (no audio, but the
 * playback lifecycle still settles).
 *
 * Ownership: the sink revokes any `blob:` object URL it plays (whether created
 * here from `bytes` or handed in via `src.url`) when the clip ends, errors, is
 * stopped, or is replaced by a newer clip.
 */
declare function createBrowserAudioSink(): AudioSink;

declare const amanePersona: PersonaConfig;

export { type AudioPlayback, type AudioSink, type AudioSource, type ClassifyResult, type Clock, type ClockTickCallback, type ConversationTurn, type DeliverProactiveOptions, type ManualClock, type MessageClassifier, type MotionParameterInfo, type PersonaConfig, type PlannerClient, type ProactiveDraft, type ProactivePlanInput, type ProactivePlanResult, type ReactionPlanInput, type ReflectionPlanInput, type ReflectionPlanResult, type SessionSnapshot, type SoullinkSession, type SoullinkSessionOptions, type SpeakRequest, type SpeakingMotionInput, type SpeakingMotionResult, type SpeakingMotionSchedulingConfig, type SpeakingMotionSchedulingMode, type TriggerIntentOptions, type TtsClient, type TtsContext, type TtsResult, type VoiceStatus, amanePersona, createBrowserAudioSink, createIntervalClock, createManualClock, createRafClock, createSoullinkSession };
