/**
 * Live2D Cubism Core 初始化模块。
 *
 * Live2D runtime 在模块顶层检查 window.Live2DCubismCore，
 * 不满足会直接抛错，导致 Tauri 透明窗口里整页空白。
 *
 * 这里加载 Cubism Core v5，兼容水瓶座之恋这类 MOC3 v5 模型。
 */

let initialized = false;
let initializing: Promise<void> | null = null;

// #region debug-point C:cubism-report
const reportCubismDebug = (..._args: unknown[]) => {};
// #endregion

type CubismCoreGlobal = {
  Live2DCubismCore?: {
    Logging?: {
      csmSetLogFunction?: (handler: unknown) => void;
      csmGetLogFunction?: () => unknown;
    };
    Version?: {
      csmGetVersion?: () => number;
    };
  };
};

function getCubismCore() {
  return (window as unknown as CubismCoreGlobal).Live2DCubismCore;
}

function getCubismCoreVersion() {
  try {
    return getCubismCore()?.Version?.csmGetVersion?.() ?? null;
  } catch {
    return null;
  }
}

function getCubismCoreMajorVersion() {
  const version = getCubismCoreVersion();
  return typeof version === "number" ? (version >>> 24) & 0xff : null;
}

function hasCubismCore() {
  return typeof window !== "undefined" && !!getCubismCore();
}

function hasCubism5Core() {
  return typeof window !== "undefined" && getCubismCoreMajorVersion() === 5;
}

function loadCubismCoreScript(): Promise<void> {
  if (hasCubism5Core()) return Promise.resolve();

  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-live2d-cubism-core="true"]');
    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error("Live2DCubismCore script load failed")), { once: true });
      return;
    }

    const script = document.createElement("script");
    script.src = "/vendor/live2dcubismcore-v5.min.js";
    script.async = true;
    script.dataset.live2dCubismCore = "true";
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Live2DCubismCore script load failed"));
    document.head.appendChild(script);
  });
}

function patchCubismLogFunction() {
  const core = getCubismCore();
  if (!core?.Logging?.csmSetLogFunction) return;

  core.Logging.csmSetLogFunction = (handler: unknown) => {
    core.Logging!.csmGetLogFunction = () => (typeof handler === "function" ? handler : undefined);
  };
}

/**
 * 确保 Cubism 5 runtime 已经就绪。
 */
export async function ensureCubismCore(): Promise<void> {
  reportCubismDebug("C", "cubismSetup.ts:ensureCubismCore", "ensureCubismCore enter", {
    initialized,
    hasCore: hasCubismCore(),
    coreVersion: getCubismCoreVersion(),
    coreMajorVersion: getCubismCoreMajorVersion(),
  });
  if (initialized) return;
  if (initializing) return initializing;

  initializing = (async () => {
    reportCubismDebug("C", "cubismSetup.ts:loadCubismCoreScript", "loading Cubism Core v5 script", {
      hasCoreBeforeLoad: hasCubismCore(),
      coreVersionBeforeLoad: getCubismCoreVersion(),
      coreMajorVersionBeforeLoad: getCubismCoreMajorVersion(),
    });
    await loadCubismCoreScript();
    reportCubismDebug("C", "cubismSetup.ts:loadCubismCoreScript", "Cubism Core script loaded", {
      hasCoreAfterLoad: hasCubismCore(),
      coreVersionAfterLoad: getCubismCoreVersion(),
      coreMajorVersionAfterLoad: getCubismCoreMajorVersion(),
    });

    if (!hasCubism5Core()) {
      reportCubismDebug("C", "cubismSetup.ts:ensureCubismCore", "Cubism Core v5 global missing after script load", {
        hasCore: hasCubismCore(),
        coreVersion: getCubismCoreVersion(),
        coreMajorVersion: getCubismCoreMajorVersion(),
      });
      throw new Error(`Live2DCubismCore v5 is not available (current major: ${getCubismCoreMajorVersion() ?? "unknown"})`);
    }

    reportCubismDebug("A", "cubismSetup.ts:ensureCubismCore", "importing cubism5 runtime");
    patchCubismLogFunction();
    const { cubism5Ready } = await import("@naari3/pixi-live2d-display/cubism5");
    await cubism5Ready();
    reportCubismDebug("A", "cubismSetup.ts:ensureCubismCore", "cubism5 runtime ready", {
      coreVersion: getCubismCore()?.Version?.csmGetVersion?.(),
    });
    initialized = true;
  })();

  return initializing;
}
