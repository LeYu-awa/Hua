/**
 * Metadata describing a single Live2D model parameter, used to drive motion
 * planning and calibration UIs. This is the canonical definition for the
 * SoulLink Live ecosystem; the web app re-exports it for backwards
 * compatibility.
 */
interface Live2DMotionParameterInfo {
    name?: string;
    groupId?: string;
    groupName?: string;
    min: number;
    max: number;
    default: number;
}
/**
 * A loader responsible for making the Live2D Cubism Core runtime available on
 * the global scope (i.e. `window.Live2DCubismCore`). The renderer stays free of
 * any bundler-specific asset import; the integrator supplies this loader.
 */
type CubismCoreLoader = () => Promise<void>;
/**
 * Integration hooks for {@link Live2DRenderer}. All hooks are optional so the
 * renderer can be constructed with no dependencies for testing, but `load()`
 * requires `cubismLoader` to be present.
 */
interface Live2DRendererDeps {
    /**
     * Ensures the Cubism Core runtime is loaded before a model is created.
     * If omitted, {@link Live2DRenderer.load} throws with a clear message.
     */
    cubismLoader?: CubismCoreLoader;
    /** Existing canvas that PIXI should render into instead of appending a new one. */
    canvas?: HTMLCanvasElement;
    /**
     * Invoked with a parameter id when the current model has no matching
     * parameter while applying values. The parameter is skipped regardless.
     */
    onMissingParameter?: (id: string) => void;
}

interface CDI3ParameterDefinition {
    Id?: string;
    Name?: string;
    GroupId?: string;
}
interface CDI3ParameterGroupDefinition {
    Id?: string;
    Name?: string;
}
/** Subset of a Cubism `.cdi3.json` file used by the metadata scanner. */
interface CDI3Data {
    Version?: number;
    Parameters?: CDI3ParameterDefinition[];
    ParameterGroups?: CDI3ParameterGroupDefinition[];
}
/** Subset of a Cubism `.model3.json` file needed to locate DisplayInfo. */
interface Model3Data {
    FileReferences?: {
        DisplayInfo?: string;
    };
}
interface CDIParameterMeta {
    name?: string;
    groupId?: string;
    groupName?: string;
}
interface MetadataFetchResponse {
    ok: boolean;
    json(): Promise<unknown>;
}
/** A deliberately small fetch contract so callers can inject authenticated or test clients. */
type Live2DMetadataFetch = (url: string) => Promise<MetadataFetchResponse>;
interface Live2DMetadataLoadOptions {
    fetch?: Live2DMetadataFetch;
    /** Base used when `modelUrl` itself is relative, useful during SSR and in Node tests. */
    documentBaseUrl?: string;
    onWarning?: (message: string, cause?: unknown) => void;
}
interface CubismCoreModelLike {
    getParameterCount?: () => number;
    getParameterId?: (index: number) => string;
    getParameterMinimumValue?: (index: number) => number;
    getParameterMaximumValue?: (index: number) => number;
    getParameterDefaultValue?: (index: number) => number;
    _model?: {
        parameters?: {
            ids?: string[];
            minimumValues?: number[];
            maximumValues?: number[];
            defaultValues?: number[];
        };
    };
}
/** Structural input accepted by `buildMotionParameters`; no PIXI class is required. */
interface Live2DCoreParameterSource {
    internalModel?: {
        coreModel?: CubismCoreModelLike;
    };
}
/** Convert parsed CDI3 JSON into an id-indexed metadata table. */
declare function parseCDIParameterMeta(cdi: CDI3Data): Record<string, CDIParameterMeta>;
/** Return the DisplayInfo path from parsed model3 JSON, if it is present. */
declare function parseModel3DisplayInfo(model3: Model3Data): string | null;
/**
 * Resolve an asset path relative to a model URL. Relative model URLs use
 * `documentBaseUrl`, or the current page URL when running in a browser.
 */
declare function resolveRelativeURL(modelUrl: string, relativePath: string, documentBaseUrl?: string): string;
/** Derive the conventional sibling CDI3 URL without loading model3 JSON. */
declare function deriveCDIUrl(modelUrl: string): string | null;
declare function loadCDIParameterMeta(modelUrl: string, options?: Live2DMetadataLoadOptions): Promise<Record<string, CDIParameterMeta>>;
declare function resolveCDIUrl(modelUrl: string, options?: Live2DMetadataLoadOptions): Promise<string | null>;
declare function buildMotionParameters(model: Live2DCoreParameterSource, cdiMeta?: Record<string, CDIParameterMeta>): Record<string, Live2DMotionParameterInfo>;

export { type CubismCoreLoader as C, type Live2DRendererDeps as L, type MetadataFetchResponse as M, type Live2DMotionParameterInfo as a, type CDI3Data as b, type CDI3ParameterDefinition as c, type CDI3ParameterGroupDefinition as d, type CDIParameterMeta as e, type CubismCoreModelLike as f, type Live2DCoreParameterSource as g, type Live2DMetadataFetch as h, type Live2DMetadataLoadOptions as i, type Model3Data as j, buildMotionParameters as k, deriveCDIUrl as l, loadCDIParameterMeta as m, parseModel3DisplayInfo as n, resolveRelativeURL as o, parseCDIParameterMeta as p, resolveCDIUrl as r };
