import { PartialFACSLikeState, PartialFACSActionUnitState, EmotionIntent, VADVector, SoullinkParameterBeat, Live2DParamState } from '@soullink-emotion/engine';

type OpenAIChatRole = "system" | "developer" | "user" | "assistant" | "tool";
interface OpenAIChatMessage {
    role: OpenAIChatRole;
    content: string;
    name?: string;
    tool_call_id?: string;
}
interface OpenAIJsonSchemaResponseFormat {
    type: "json_schema";
    json_schema: {
        name: string;
        strict?: boolean;
        schema: Record<string, unknown>;
    };
}
interface OpenAIJsonObjectResponseFormat {
    type: "json_object";
}
interface OpenAITextResponseFormat {
    type: "text";
}
type OpenAIResponseFormat = OpenAIJsonSchemaResponseFormat | OpenAIJsonObjectResponseFormat | OpenAITextResponseFormat;
interface OpenAIChatCompletionRequest {
    model?: string;
    messages: OpenAIChatMessage[];
    temperature?: number;
    top_p?: number;
    max_tokens?: number;
    response_format?: OpenAIResponseFormat;
    stream?: false;
}
interface OpenAIChatCompletionChoice {
    index: number;
    message: OpenAIChatMessage;
    finish_reason?: string;
}
interface OpenAIChatCompletionResponse {
    id: string;
    object: "chat.completion";
    created: number;
    model: string;
    choices: OpenAIChatCompletionChoice[];
    usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
        total_tokens?: number;
    };
}
interface OpenAIClientOptions {
    apiKey?: string;
    baseURL?: string;
    model?: string;
    organization?: string;
    project?: string;
    timeoutMs?: number;
    fetch?: typeof globalThis.fetch;
}
interface OpenAIClientConfig {
    configured: boolean;
    baseURL: string;
    model: string;
    timeoutMs: number;
}
interface OpenAICompatibleClientLike {
    readonly config: OpenAIClientConfig;
    isConfigured(options?: OpenAIClientOptions): boolean;
    createChatCompletion(request: OpenAIChatCompletionRequest, options?: OpenAIClientOptions): Promise<OpenAIChatCompletionResponse>;
}

declare class OpenAIClientNotConfiguredError extends Error {
    constructor();
}
declare class OpenAICompatibleClient implements OpenAICompatibleClientLike {
    private apiKey?;
    private baseURL;
    private model;
    private organization?;
    private project?;
    private timeoutMs;
    private fetchImpl?;
    constructor(options?: OpenAIClientOptions);
    get configured(): boolean;
    isConfigured(options?: OpenAIClientOptions): boolean;
    get config(): {
        configured: boolean;
        baseURL: string;
        model: string;
        timeoutMs: number;
    };
    createChatCompletion(request: OpenAIChatCompletionRequest, options?: OpenAIClientOptions): Promise<OpenAIChatCompletionResponse>;
    private getHeaders;
    private normalizeBaseURL;
}
declare function isOpenAICompatibleClientLike(value: unknown): value is OpenAICompatibleClientLike;

declare const soullinkCharacterName = "\u6708\u89C1\u5929\u97F3";
declare const soullinkCharacterProfile: string;
declare function resolveSoullinkCharacterName(value?: string): string;
declare function buildSoullinkCharacterProfile(extraProfile?: string): string;

interface SoullinkConversationTurn {
    role: "user" | "assistant";
    content: string;
}
interface SoullinkLLMPlanRequest {
    message: string;
    conversation?: SoullinkConversationTurn[];
    characterName?: string;
    characterProfile?: string;
    vad?: VADVector;
    model?: string;
    temperature?: number;
    openAI?: OpenAIClientOptions;
}
interface SoullinkActionBeat {
    time: number;
    duration: number;
    label: string;
    intensity: number;
    facs?: PartialFACSLikeState;
    actionUnits?: PartialFACSActionUnitState;
}
interface SoullinkLLMPlan {
    intent: EmotionIntent;
    replyDraft: string;
    vadTarget: VADVector;
    vadDelta: VADVector;
    actionPlan: SoullinkActionBeat[];
    provider: "openai-compatible" | "fallback";
    rawMessage?: OpenAIChatMessage;
}

declare const supportedEmotionVariants: {
    readonly neutral: readonly ["neutral_ack", "attentive"];
    readonly calm: readonly ["soft_calm", "quiet_listen"];
    readonly happy: readonly ["soft_smile", "bright_smile", "surprised_happy", "shy_happy"];
    readonly excited: readonly ["sparkle", "bounce"];
    readonly shy: readonly ["bashful", "embarrassed"];
    readonly affectionate: readonly ["warm", "close"];
    readonly curious: readonly ["tilt", "attentive_question"];
    readonly concerned: readonly ["soft_concern", "worried", "comfort"];
    readonly confused: readonly ["confused"];
    readonly surprised: readonly ["startled"];
    readonly tired: readonly ["sleepy", "drained"];
    readonly sad: readonly ["downcast", "teary"];
    readonly anxiety: readonly ["nervous", "uneasy"];
    readonly anger: readonly ["annoyed", "firm"];
    readonly angry: readonly ["annoyed", "firm"];
};
declare const supportedContextTags: string[];
declare function buildSoullinkPlannerMessages(request: SoullinkLLMPlanRequest): OpenAIChatMessage[];
declare const soullinkPlanResponseFormat: OpenAIJsonSchemaResponseFormat;

declare class SoullinkLLMPlanner {
    private classifier;
    private client;
    constructor(clientOrOptions?: OpenAICompatibleClientLike | OpenAIClientOptions);
    get config(): OpenAIClientConfig;
    plan(request: SoullinkLLMPlanRequest): Promise<SoullinkLLMPlan>;
    private responseFormatFallbacks;
    private parseJSON;
    private fallback;
    private sanitizePlan;
    private sanitizeEmotion;
    private sanitizeVariant;
    private sanitizeContextTags;
    private sanitizeVAD;
    private sanitizeActionPlan;
    private numericFACSRecord;
    private numericActionUnitRecord;
    private normalizeActionUnitKey;
    private hasUsableActionPlan;
    private stringOr;
    private diffVAD;
    private createFallbackReply;
    private createFallbackActionPlan;
    private toNumber;
}

interface SoullinkReflectionRequest {
    conversation?: SoullinkConversationTurn[];
    vad?: Partial<VADVector>;
    topic?: string;
    characterName?: string;
    characterProfile?: string;
    model?: string;
    temperature?: number;
    openAI?: OpenAIClientOptions;
}
interface SoullinkReflectionPlan {
    thought: string;
    reason: string;
    emotion: string;
    vadTarget: VADVector;
    initiativePrompt: string;
    provider: "openai-compatible" | "fallback";
}
interface SoullinkProactiveMessageRequest {
    characterName?: string;
    characterProfile?: string;
    proactive?: {
        emotion?: string;
        intensity?: number;
        silenceSeconds?: number;
        systemPrompt?: string;
        suggestedMessage?: string;
    };
    conversation?: SoullinkConversationTurn[];
    reflection?: Partial<SoullinkReflectionPlan>;
    vad?: Partial<VADVector>;
    model?: string;
    temperature?: number;
    openAI?: OpenAIClientOptions;
}
interface SoullinkProactiveMessagePlan {
    message: string;
    emotion: string;
    reason: string;
    provider: "openai-compatible" | "fallback";
}
declare class SoullinkReflectionPlanner {
    private client;
    constructor(clientOrOptions?: OpenAICompatibleClientLike | OpenAIClientOptions);
    reflect(request: SoullinkReflectionRequest): Promise<SoullinkReflectionPlan>;
    proactiveMessage(request: SoullinkProactiveMessageRequest): Promise<SoullinkProactiveMessagePlan>;
    private buildReflectionMessages;
    private buildProactiveMessages;
    private sanitizeReflection;
    private fallbackReflection;
    private fallbackProactiveMessage;
    private sanitizeVAD;
    private stringOr;
    private toNumber;
}

interface Live2DParameterInfo {
    name?: string;
    groupId?: string;
    groupName?: string;
    min: number;
    max: number;
    default: number;
}
type SpeakingMotionGenerationMode = "duration" | "fixed" | "fixed-parallel";
type ResolvedSpeakingMotionGenerationMode = "duration" | "fixed";
interface SpeakingMotionGenerationConfig {
    mode?: SpeakingMotionGenerationMode;
    fixedFrameCount?: number;
    frameIntervalSec?: number;
    minFrameCount?: number;
    maxFrameCount?: number;
    twoStage?: boolean;
    temperature?: number;
    jointMotionBoost?: number;
    eyeOpenBinary?: boolean;
    minVisibleRatio?: number;
    maxPromptParameters?: number;
}
interface SoullinkSpeakingMotionPlannerOptions {
    client?: OpenAICompatibleClientLike;
    openAI?: OpenAIClientOptions;
    generation?: SpeakingMotionGenerationConfig;
}
interface ResolvedSpeakingMotionGenerationConfig {
    mode: ResolvedSpeakingMotionGenerationMode;
    fixedFrameCount: number;
    frameIntervalSec: number;
    minFrameCount: number;
    maxFrameCount: number;
    twoStage: boolean;
    temperature: number;
    jointMotionBoost: number;
    eyeOpenBinary: boolean;
    minVisibleRatio: number;
    maxPromptParameters: number;
}
interface SpeakingMotionPlanRequest {
    speechText: string;
    durationSec?: number;
    availableParameters?: Record<string, Live2DParameterInfo>;
    intent?: Partial<EmotionIntent>;
    vad?: Partial<VADVector>;
    expression?: {
        emotion?: string;
        variant?: string;
        intensity?: number;
        peakFACS?: PartialFACSLikeState;
    } | null;
    characterName?: string;
    characterProfile?: string;
    userMessage?: string;
    model?: string;
    temperature?: number;
    openAI?: OpenAIClientOptions;
    mode?: SpeakingMotionGenerationMode;
    frameCount?: number;
    frameIntervalSec?: number;
}
interface SpeakingMotionActionFrame {
    frameIndex: number;
    action: string;
    emphasis?: string;
}
type SpeakingMotionFallbackCode = "not_configured" | "no_available_parameters" | "invalid_duration" | "action_planning_failed" | "parameter_planning_failed";
interface SpeakingMotionPlanDebug {
    model: string;
    baseURL: string;
    generationMode: ResolvedSpeakingMotionGenerationMode;
    requestedFrameCount: number;
    availableParameterCount: number;
    actionProvider?: "openai-compatible" | "vad-facs" | "disabled";
    actionFrameCount?: number;
    rawFrameCount?: number;
    usableRawFrameCount?: number;
    finalFrameCount: number;
    responseFormat?: string;
    fallbackCode?: SpeakingMotionFallbackCode;
    fallbackReason?: string;
    frameIntervalSec: number;
    frameDurationMs: number;
    speechTextForMotion: string;
    explicitMotionDirectives: string[];
    jointMotionBoost: number;
    eyeOpenBinary: boolean;
    minVisibleRatio: number;
    elapsedMs: number;
}
interface SpeakingMotionPlan {
    parameterPlan: SoullinkParameterBeat[];
    provider: "openai-compatible" | "vad-facs";
    motionPlan?: SpeakingMotionActionFrame[];
    rawMessage?: OpenAIChatMessage;
    rawMotionPlanMessage?: OpenAIChatMessage;
    debug?: SpeakingMotionPlanDebug;
}
declare const defaultSpeakingMotionGenerationConfig: Readonly<ResolvedSpeakingMotionGenerationConfig>;
declare function resolveSpeakingMotionGenerationConfig(config?: SpeakingMotionGenerationConfig): ResolvedSpeakingMotionGenerationConfig;
declare function resolveSpeakingMotionFrameCount(request: Pick<SpeakingMotionPlanRequest, "durationSec" | "frameCount">, config: ResolvedSpeakingMotionGenerationConfig): number;
declare class SoullinkSpeakingMotionPlanner {
    private client;
    private openAIOptions;
    private generation;
    constructor(clientOrOptions?: OpenAICompatibleClientLike | OpenAIClientOptions, generationConfig?: SpeakingMotionGenerationConfig);
    static create(options?: SoullinkSpeakingMotionPlannerOptions): SoullinkSpeakingMotionPlanner;
    get config(): {
        openAI: OpenAIClientConfig;
        generation: {
            mode: ResolvedSpeakingMotionGenerationMode;
            fixedFrameCount: number;
            frameIntervalSec: number;
            minFrameCount: number;
            maxFrameCount: number;
            twoStage: boolean;
            temperature: number;
            jointMotionBoost: number;
            eyeOpenBinary: boolean;
            minVisibleRatio: number;
            maxPromptParameters: number;
        };
    };
    plan(request: SpeakingMotionPlanRequest): Promise<SpeakingMotionPlan>;
    private planActions;
}
declare function createSoullinkSpeakingMotionPlanner(options?: SoullinkSpeakingMotionPlannerOptions): SoullinkSpeakingMotionPlanner;
declare function isMouthOrJawOpenParameter(id: string, info?: Partial<Live2DParameterInfo>): boolean;
declare function sanitizeSpeakingMotionParameters(value: unknown, available: Record<string, Live2DParameterInfo>, config?: SpeakingMotionGenerationConfig): Live2DParamState;
declare const speakingMotionResponseFormat: OpenAIJsonSchemaResponseFormat;
declare const speakingMotionActionResponseFormat: OpenAIJsonSchemaResponseFormat;

interface SpeakingMotionApiClientOptions {
    baseURL: string;
    fetch?: typeof globalThis.fetch;
    headers?: Record<string, string> | (() => Record<string, string> | Promise<Record<string, string>>);
    timeoutMs?: number;
    path?: string;
}
interface SpeakingMotionApiClient {
    plan(request: SpeakingMotionPlanRequest): Promise<SpeakingMotionPlan>;
    planSpeakingMotion(request: SpeakingMotionPlanRequest): Promise<SpeakingMotionPlan>;
}
declare class PlannerApiError extends Error {
    readonly status: number;
    readonly body?: unknown | undefined;
    constructor(message: string, status: number, body?: unknown | undefined);
}
declare function createSpeakingMotionApiClient(options: SpeakingMotionApiClientOptions): SpeakingMotionApiClient;

export { type Live2DParameterInfo, type OpenAIChatCompletionChoice, type OpenAIChatCompletionRequest, type OpenAIChatCompletionResponse, type OpenAIChatMessage, type OpenAIChatRole, type OpenAIClientConfig, OpenAIClientNotConfiguredError, type OpenAIClientOptions, OpenAICompatibleClient, type OpenAICompatibleClientLike, type OpenAIJsonObjectResponseFormat, type OpenAIJsonSchemaResponseFormat, type OpenAIResponseFormat, type OpenAITextResponseFormat, PlannerApiError, type ResolvedSpeakingMotionGenerationConfig, type ResolvedSpeakingMotionGenerationMode, type SoullinkActionBeat, type SoullinkConversationTurn, type SoullinkLLMPlan, type SoullinkLLMPlanRequest, SoullinkLLMPlanner, type SoullinkProactiveMessagePlan, type SoullinkProactiveMessageRequest, type SoullinkReflectionPlan, SoullinkReflectionPlanner, type SoullinkReflectionRequest, SoullinkSpeakingMotionPlanner, type SoullinkSpeakingMotionPlannerOptions, type SpeakingMotionActionFrame, type SpeakingMotionApiClient, type SpeakingMotionApiClientOptions, type SpeakingMotionFallbackCode, type SpeakingMotionGenerationConfig, type SpeakingMotionGenerationMode, type SpeakingMotionPlan, type SpeakingMotionPlanDebug, type SpeakingMotionPlanRequest, buildSoullinkCharacterProfile, buildSoullinkPlannerMessages, createSoullinkSpeakingMotionPlanner, createSpeakingMotionApiClient, defaultSpeakingMotionGenerationConfig, isMouthOrJawOpenParameter, isOpenAICompatibleClientLike, resolveSoullinkCharacterName, resolveSpeakingMotionFrameCount, resolveSpeakingMotionGenerationConfig, sanitizeSpeakingMotionParameters, soullinkCharacterName, soullinkCharacterProfile, soullinkPlanResponseFormat, speakingMotionActionResponseFormat, speakingMotionResponseFormat, supportedContextTags, supportedEmotionVariants };
