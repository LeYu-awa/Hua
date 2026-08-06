import { Live2DParamState, NativeAnimationDirective } from '@soullink-emotion/engine';
export { Live2DParamState } from '@soullink-emotion/engine';
import { L as Live2DRendererDeps, a as Live2DMotionParameterInfo, C as CubismCoreLoader } from './metadata-B-v0PS5Q.js';
export { b as CDI3Data, c as CDI3ParameterDefinition, d as CDI3ParameterGroupDefinition, e as CDIParameterMeta, f as CubismCoreModelLike, g as Live2DCoreParameterSource, h as Live2DMetadataFetch, i as Live2DMetadataLoadOptions, M as MetadataFetchResponse, j as Model3Data, k as buildMotionParameters, l as deriveCDIUrl, m as loadCDIParameterMeta, p as parseCDIParameterMeta, n as parseModel3DisplayInfo, r as resolveCDIUrl, o as resolveRelativeURL } from './metadata-B-v0PS5Q.js';

/**
 * Renders a Live2D Cubism 4 model into a host element using PIXI v8 and
 * `pixi-live2d-display`. The Cubism Core runtime is supplied by the integrator
 * through `deps.cubismLoader`, keeping this package free of any bundler-specific
 * asset import.
 */
declare class Live2DRenderer {
    private app;
    private container;
    private deps;
    private model;
    private latestParams;
    private lastNativeAnimToken;
    private suppressedParamIds;
    private viewScale;
    private viewOffset;
    private beforeModelUpdate;
    private resizeObserver;
    constructor(container: HTMLElement, deps?: Live2DRendererDeps);
    load(modelUrl: string): Promise<Record<string, Live2DMotionParameterInfo>>;
    setParameters(params: Live2DParamState): void;
    get suppressedParameterIds(): ReadonlySet<string>;
    applyNativeAnimation(directive: NativeAnimationDirective | null): void;
    setViewScale(scale: number): void;
    setViewOffset(offset: {
        x: number;
        y: number;
    }): void;
    destroy(): void;
    private applyExpression;
    private applyMotion;
    private removeModel;
    private disableInternalEyeBlink;
    private fitModel;
    private applyParametersNow;
}

/**
 * Builds a {@link CubismCoreLoader} that injects the Live2D Cubism Core runtime
 * via a `<script>` tag pointing at `coreUrl`. The loader resolves once
 * `window.Live2DCubismCore` is present, and the underlying script is injected
 * at most once regardless of how many times the loader is invoked.
 *
 * The URL is supplied by the integrator (e.g. resolved through a bundler asset
 * import) so this package carries no bundler-specific import of the core asset.
 */
declare function createScriptTagCubismLoader(coreUrl: string): CubismCoreLoader;

export { CubismCoreLoader, Live2DMotionParameterInfo, Live2DRenderer, Live2DRendererDeps, createScriptTagCubismLoader };
