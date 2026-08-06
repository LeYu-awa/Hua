import { ModelProfile, AdaptationCoverage, FACSKey, ParameterBlendMode } from '@soullink-emotion/engine';
export { MappingSource } from '@soullink-emotion/engine';
import { OpenAIClientOptions, OpenAICompatibleClientLike } from '@soullink-emotion/planner-openai';

declare const profileGeneratorVersion = "soullink-profile-autogen-v3";
interface EnsureLive2DProfileRequest {
    modelDir?: string;
    displayName?: string;
    force?: boolean;
    openAI?: OpenAIClientOptions;
}
interface Live2DProfileAutoGeneratorOptions {
    /** Absolute or process-relative directory containing one subdirectory per model. */
    modelsRoot: string;
    /** Public URL prefix corresponding to modelsRoot. Defaults to `/models`. */
    modelsBaseUrl?: string;
    /** Inject a configured OpenAI-compatible client. */
    client?: OpenAICompatibleClientLike;
    /** Allow the configured client to run without a request-level API key. */
    useConfiguredOpenAI?: boolean;
    /** Model directory used when ensure() omits modelDir. Defaults to `lilyabee`. */
    defaultModelDir?: string;
}
interface SaveCalibratedProfileRequest {
    modelDir: string;
    parameterMap?: unknown;
    customParams?: unknown;
    privateEmotionMap?: unknown;
    neutralParams?: unknown;
    idleConfig?: unknown;
    displayName?: string;
}
interface EnsureLive2DProfileResult {
    generated: boolean;
    reason: "current" | "missing" | "stale" | "forced";
    provider: "openai-compatible" | "heuristic" | "existing" | "manual";
    profileUrl: string;
    modelUrl: string;
    sourceSignature: Live2DSourceSignature;
    profile: ModelProfile;
    notes: string[];
    /** Response-only adaptation-coverage diagnostic. Never written to disk. */
    coverage?: AdaptationCoverage;
}
interface Live2DSourceSignature {
    modelDir: string;
    model3File: string;
    cdi3File?: string;
    hash: string;
    generatedAt: string;
}
interface Live2DParameterInfo {
    id: string;
    name: string;
    groupId: string;
    groupName: string;
}
declare class Live2DProfileAutoGenerator {
    private readonly client;
    private readonly modelsRoot;
    private readonly modelsBaseUrl;
    private readonly useConfiguredOpenAI;
    private readonly defaultModelDir;
    constructor(options: Live2DProfileAutoGeneratorOptions);
    ensure(request: EnsureLive2DProfileRequest): Promise<EnsureLive2DProfileResult>;
    /**
     * Persist a manually calibrated profile. Overlays only the sanitized incoming
     * rules onto the existing profile, preserves the existing source signature
     * (never rehashes), recomputes neutralParams/parameterSmoothing/capabilities,
     * and marks the profile as provider="manual".
     */
    saveCalibratedProfile(request: SaveCalibratedProfileRequest): Promise<EnsureLive2DProfileResult>;
    private loadContext;
    private createSignature;
    private createHeuristicProfile;
    private generateWithLLM;
    private sanitizeProfile;
    /**
     * C5-T4/C5-T6: Scan expression (.exp3.json) and motion (.motion3.json) files
     * from the model directory and build the NativeAnimationCatalog. All file paths
     * are validated with isInside before access. Files > 256 KB, paths outside the
     * model directory, or unexpected extensions are skipped with a note in the
     * provided notes array.
     */
    private buildNativeAnimationCatalog;
    /**
     * C5-T4: Heuristic name->emotion mapping. Returns a Record keyed by emotion
     * name whose values are the best-matching expression name from the catalog.
     * Returns undefined when no expression maps to any known emotion.
     */
    private buildExpressionMap;
    private createIdleConfig;
    private sanitizeIdleConfig;
    private readExistingProfile;
    private writeProfile;
}

/**
 * Canonical Cubism 4 mapping for one FACS key. The numeric fields
 * (mode/scale/min/max) mirror the constants used by
 * Live2DProfileAutoGenerator.createHeuristicProfile exactly, so this table is a
 * faithful record of the shipped heuristic — it is data, not a second source of
 * truth for the emitted rule shapes.
 */
interface StandardParamSpec {
    ids?: string[];
    pair?: {
        left: string[];
        right: string[];
    };
    group?: "EyeBlink" | "LipSync" | "MouthOpen";
    mode: ParameterBlendMode;
    scale: number;
    min: number;
    max: number;
}
/**
 * Standard-ID-first mapping table. Keys that are name-only or subtract-derived
 * (tear, sweat, mouthFrown, mouthPucker, eyeBlinkL, eyeBlinkR, eyeSquint) are
 * intentionally absent — they are never resolved from the canonical id table.
 */
declare const STANDARD_PARAM_TABLE: Partial<Record<FACSKey, StandardParamSpec>>;
type GroupLike = {
    Target?: string;
    Name?: string;
    Ids?: string[];
};
/**
 * Resolve a FACS key to concrete parameter ids using the standard-ID-first
 * strategy, WITHOUT the CDI name-needle fallback (callers own that step):
 *
 *   1. model's own standard-named Group (Target "Parameter") -> "standard-group"
 *   2. canonical standard id(s) from the table -> "standard-id"
 *   3. otherwise undefined (caller falls back to name matching, then unmapped)
 *
 * Never name-based, so it can never displace a name-resolved shipped mapping.
 */
declare function resolveStandard(key: FACSKey, params: ReadonlyArray<{
    id: string;
}>, groups: ReadonlyArray<GroupLike>): {
    ids: string[];
    source: "standard-group" | "standard-id";
} | undefined;

export { type EnsureLive2DProfileRequest, type EnsureLive2DProfileResult, type Live2DParameterInfo, Live2DProfileAutoGenerator, type Live2DProfileAutoGeneratorOptions, type Live2DSourceSignature, STANDARD_PARAM_TABLE, type SaveCalibratedProfileRequest, type StandardParamSpec, profileGeneratorVersion, resolveStandard };
