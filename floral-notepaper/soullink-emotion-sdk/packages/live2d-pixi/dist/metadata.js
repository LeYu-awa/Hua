// src/motionParameters.ts
function parseCDIParameterMeta(cdi) {
  const groups = /* @__PURE__ */ new Map();
  for (const group of cdi.ParameterGroups ?? []) {
    if (group.Id) groups.set(group.Id, group.Name ?? "");
  }
  const result = {};
  for (const parameter of cdi.Parameters ?? []) {
    if (!parameter.Id) continue;
    result[parameter.Id] = {
      name: parameter.Name || parameter.Id,
      groupId: parameter.GroupId || void 0,
      groupName: parameter.GroupId ? groups.get(parameter.GroupId) || void 0 : void 0
    };
  }
  return result;
}
function parseModel3DisplayInfo(model3) {
  return model3.FileReferences?.DisplayInfo?.trim() || null;
}
function resolveRelativeURL(modelUrl, relativePath, documentBaseUrl) {
  const pageUrl = documentBaseUrl || globalThis.location?.href;
  const absoluteModelUrl = pageUrl ? new URL(modelUrl, pageUrl) : new URL(modelUrl);
  return new URL(relativePath, absoluteModelUrl).toString();
}
function deriveCDIUrl(modelUrl) {
  const match = modelUrl.match(/^(.*)\.model3\.json(?:[?#].*)?$/u);
  return match ? `${match[1]}.cdi3.json` : null;
}
async function loadCDIParameterMeta(modelUrl, options = {}) {
  const cdiUrl = await resolveCDIUrl(modelUrl, options);
  if (!cdiUrl) return {};
  const fetchMetadata = resolveFetch(options);
  if (!fetchMetadata) {
    warn(options, "[Live2D] fetch is unavailable; cannot load cdi3 parameter metadata");
    return {};
  }
  try {
    const response = await fetchMetadata(cdiUrl);
    if (!response.ok) return {};
    return parseCDIParameterMeta(await response.json());
  } catch (error) {
    warn(options, "[Live2D] failed to load cdi3 parameter metadata", error);
    return {};
  }
}
async function resolveCDIUrl(modelUrl, options = {}) {
  const fetchMetadata = resolveFetch(options);
  if (fetchMetadata) {
    try {
      const response = await fetchMetadata(modelUrl);
      if (response.ok) {
        const displayInfo = parseModel3DisplayInfo(await response.json());
        if (displayInfo) {
          return resolveRelativeURL(modelUrl, displayInfo, options.documentBaseUrl);
        }
      }
    } catch (error) {
      warn(options, "[Live2D] failed to read model3 DisplayInfo", error);
    }
  }
  return deriveCDIUrl(modelUrl);
}
function buildMotionParameters(model, cdiMeta = {}) {
  const coreModel = model.internalModel?.coreModel;
  const result = {};
  if (!coreModel) return result;
  const count = coreModel.getParameterCount?.();
  if (typeof count === "number" && count > 0 && coreModel.getParameterId) {
    for (let index = 0; index < count; index += 1) {
      const id = coreModel.getParameterId(index);
      if (!id) continue;
      const fallback = defaultParameterInfo(id);
      addMotionParameter(result, id, {
        min: coreModel.getParameterMinimumValue?.(index) ?? fallback.min,
        max: coreModel.getParameterMaximumValue?.(index) ?? fallback.max,
        default: coreModel.getParameterDefaultValue?.(index) ?? fallback.default
      }, cdiMeta[id]);
    }
  }
  const rawParameters = coreModel._model?.parameters;
  const ids = rawParameters?.ids ?? [];
  ids.forEach((id, index) => {
    if (!id || result[id]) return;
    const fallback = defaultParameterInfo(id);
    addMotionParameter(result, id, {
      min: rawParameters?.minimumValues?.[index] ?? fallback.min,
      max: rawParameters?.maximumValues?.[index] ?? fallback.max,
      default: rawParameters?.defaultValues?.[index] ?? fallback.default
    }, cdiMeta[id]);
  });
  return result;
}
function resolveFetch(options) {
  if (options.fetch) return options.fetch;
  if (typeof globalThis.fetch !== "function") return void 0;
  return (url) => globalThis.fetch(url);
}
function warn(options, message, cause) {
  if (options.onWarning) {
    options.onWarning(message, cause);
    return;
  }
  console.warn(message, cause ?? "");
}
function addMotionParameter(result, id, range, meta) {
  const min = Number.isFinite(range.min) ? range.min : defaultParameterInfo(id).min;
  const max = Number.isFinite(range.max) ? range.max : defaultParameterInfo(id).max;
  const normalizedMin = Math.min(min, max);
  const normalizedMax = Math.max(min, max);
  result[id] = {
    name: meta?.name || id,
    groupId: meta?.groupId,
    groupName: meta?.groupName,
    min: normalizedMin,
    max: normalizedMax,
    default: clampNumber(range.default, normalizedMin, normalizedMax)
  };
}
function defaultParameterInfo(id) {
  const normalized = id.replace(/\s+/gu, "").replace(/[＿_\-　]/gu, "").toLowerCase();
  if (normalized.includes("angle")) return { min: -30, max: 30, default: 0 };
  if (normalized.includes("eyeball") || normalized.includes("mouthform") || normalized.includes("brow")) {
    return { min: -1, max: 1, default: 0 };
  }
  if (normalized.includes("eyeopen")) return { min: 0, max: 1, default: 1 };
  return { min: 0, max: 1, default: 0 };
}
function clampNumber(value, min, max) {
  return Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));
}
export {
  buildMotionParameters,
  deriveCDIUrl,
  loadCDIParameterMeta,
  parseCDIParameterMeta,
  parseModel3DisplayInfo,
  resolveCDIUrl,
  resolveRelativeURL
};
//# sourceMappingURL=metadata.js.map