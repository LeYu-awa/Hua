// src/Live2DProfileAutoGenerator.ts
import { createHash, randomBytes } from "crypto";
import { promises as fs } from "fs";
import path from "path";
import {
  detectCapabilities,
  facsKeys,
  CURRENT_SCHEMA_VERSION,
  deriveNeutralParams,
  deriveParameterSmoothing,
  computeAdaptationCoverage,
  isStandardId
} from "@soullink-emotion/engine";
import {
  OpenAIClientNotConfiguredError,
  OpenAICompatibleClient
} from "@soullink-emotion/planner-openai";

// src/standardParamTable.ts
var STANDARD_PARAM_TABLE = {
  eyeOpen: {
    group: "EyeBlink",
    pair: { left: ["ParamEyeLOpen"], right: ["ParamEyeROpen"] },
    mode: "set",
    scale: 1,
    min: 0,
    max: 1.2
  },
  eyeSmile: {
    pair: { left: ["ParamEyeLSmile"], right: ["ParamEyeRSmile"] },
    mode: "set",
    scale: 1,
    min: 0,
    max: 1
  },
  gazeX: { ids: ["ParamEyeBallX"], mode: "set", scale: 1, min: -1, max: 1 },
  gazeY: { ids: ["ParamEyeBallY"], mode: "set", scale: 1, min: -1, max: 1 },
  headX: { ids: ["ParamAngleX"], mode: "set", scale: 30, min: -30, max: 30 },
  headY: { ids: ["ParamAngleY"], mode: "set", scale: 30, min: -30, max: 30 },
  headZ: { ids: ["ParamAngleZ"], mode: "set", scale: 30, min: -30, max: 30 },
  bodyX: { ids: ["ParamBodyAngleX"], mode: "set", scale: 12, min: -12, max: 12 },
  bodyY: { ids: ["ParamBodyAngleY"], mode: "set", scale: 12, min: -12, max: 12 },
  bodyZ: { ids: ["ParamBodyAngleZ"], mode: "set", scale: 12, min: -12, max: 12 },
  mouthSmile: { ids: ["ParamMouthForm"], mode: "set", scale: 1, min: -1, max: 1 },
  mouthOpen: {
    group: "LipSync",
    ids: ["ParamMouthOpenY"],
    mode: "set",
    scale: 1,
    min: 0,
    max: 1
  },
  browInnerUp: {
    pair: { left: ["ParamBrowLY"], right: ["ParamBrowRY"] },
    mode: "set",
    scale: 1,
    min: -1,
    max: 1
  },
  browOuterUp: {
    pair: { left: ["ParamBrowLAngle"], right: ["ParamBrowRAngle"] },
    mode: "set",
    scale: 0.9,
    min: -1,
    max: 1
  },
  browDown: {
    pair: { left: ["ParamBrowLForm"], right: ["ParamBrowRForm"] },
    mode: "set",
    scale: -0.85,
    min: -1,
    max: 1
  },
  blush: { ids: ["ParamCheek"], mode: "set", scale: 1, min: 0, max: 1 },
  breath: { ids: ["ParamBreath"], mode: "set", scale: 1, min: 0, max: 1 }
};
function resolveStandard(key, params, groups) {
  const spec = STANDARD_PARAM_TABLE[key];
  if (!spec) return void 0;
  const paramIds = new Set(params.map((param) => param.id));
  if (spec.group) {
    const group = groups.find(
      (candidate) => candidate.Target === "Parameter" && candidate.Name === spec.group
    );
    const groupIds = (group?.Ids ?? []).filter((id) => paramIds.has(id));
    if (groupIds.length > 0) {
      return { ids: groupIds, source: "standard-group" };
    }
  }
  const candidateIds = spec.pair ? [...spec.pair.left, ...spec.pair.right] : spec.ids ?? [];
  if (candidateIds.length > 0 && candidateIds.every((id) => paramIds.has(id))) {
    return { ids: [...candidateIds], source: "standard-id" };
  }
  return void 0;
}

// src/Live2DProfileAutoGenerator.ts
var profileGeneratorVersion = "soullink-profile-autogen-v3";
var Live2DProfileAutoGenerator = class {
  client;
  modelsRoot;
  modelsBaseUrl;
  useConfiguredOpenAI;
  defaultModelDir;
  constructor(options) {
    if (!options?.modelsRoot?.trim()) {
      throw new Error("Live2DProfileAutoGenerator requires a modelsRoot directory");
    }
    this.client = options.client ?? new OpenAICompatibleClient();
    this.modelsRoot = path.resolve(options.modelsRoot);
    this.modelsBaseUrl = normalizeModelsBaseUrl(options.modelsBaseUrl ?? "/models");
    this.useConfiguredOpenAI = options.useConfiguredOpenAI ?? false;
    this.defaultModelDir = sanitizeModelDir(options.defaultModelDir ?? "lilyabee");
  }
  async ensure(request) {
    const context = await this.loadContext(request.modelDir ?? this.defaultModelDir);
    const existing = await this.readExistingProfile(context.profilePath);
    const existingHash = existing?.sourceSignature?.hash;
    const generatorRevisionCurrent = !existing?.autoProfile || existing.autoProfile.provider === "manual" || existing.autoProfile.promptVersion === profileGeneratorVersion;
    const reason = request.force ? "forced" : existing ? existingHash === context.signature.hash && existing.modelPath === context.webModelPath && generatorRevisionCurrent ? "current" : "stale" : "missing";
    if (reason === "current" && existing) {
      return {
        generated: false,
        reason,
        provider: "existing",
        profileUrl: context.webProfilePath,
        modelUrl: context.webModelPath,
        sourceSignature: context.signature,
        profile: existing,
        notes: ["source signature is current"],
        // Provenance is unknown for a pre-existing profile; coverage infers
        // per-key confidence from whether targets are standard Cubism ids.
        coverage: computeAdaptationCoverage(existing, context.parameters, {
          modelDir: context.modelDir,
          provider: "existing",
          provenance: void 0
        })
      };
    }
    const provenance = {};
    const heuristic = await this.createHeuristicProfile(context, request.displayName ?? existing?.displayName, provenance);
    const notes = [`generation reason: ${reason}`];
    let provider = "heuristic";
    let profile = heuristic;
    if (shouldUseLLM(request.openAI, this.useConfiguredOpenAI) && this.client.isConfigured(request.openAI)) {
      try {
        const llmProfile = await this.generateWithLLM(context, heuristic, existing, request.openAI);
        profile = await this.sanitizeProfile(llmProfile, heuristic, context, "openai-compatible");
        provider = "openai-compatible";
        notes.push("LLM profile accepted after parameter validation");
      } catch (error) {
        notes.push(`LLM profile generation fell back to heuristic: ${error instanceof Error ? error.message : String(error)}`);
      }
    } else {
      notes.push("Explicit OpenAI-compatible settings were not provided; used heuristic scanner");
    }
    if (provider === "heuristic") {
      profile = await this.sanitizeProfile(profile, heuristic, context, "heuristic");
    }
    await this.writeProfile(context.profilePath, profile);
    return {
      generated: true,
      reason,
      provider,
      profileUrl: context.webProfilePath,
      modelUrl: context.webModelPath,
      sourceSignature: context.signature,
      profile,
      notes,
      coverage: computeAdaptationCoverage(profile, context.parameters, {
        modelDir: context.modelDir,
        provider,
        provenance
      })
    };
  }
  /**
   * Persist a manually calibrated profile. Overlays only the sanitized incoming
   * rules onto the existing profile, preserves the existing source signature
   * (never rehashes), recomputes neutralParams/parameterSmoothing/capabilities,
   * and marks the profile as provider="manual".
   */
  async saveCalibratedProfile(request) {
    const context = await this.loadContext(request.modelDir);
    const parameterIds = new Set(context.parameters.map((parameter) => parameter.id));
    const mouthOpenParameterIds = new Set(
      context.parameters.filter(isMouthOpenLive2DParameter).map((parameter) => parameter.id)
    );
    const existing = await this.readExistingProfile(context.profilePath);
    const base = existing ?? await this.createHeuristicProfile(context, request.displayName);
    const parameterMap = { ...base.parameterMap };
    const rawIncomingMap = request.parameterMap && typeof request.parameterMap === "object" && !Array.isArray(request.parameterMap) ? request.parameterMap : {};
    for (const key of facsKeys) {
      const rule = sanitizeRule(rawIncomingMap[key], parameterIds);
      if (rule) parameterMap[key] = rule;
    }
    const customParams = { ...base.customParams ?? {} };
    const rawIncomingCustom = request.customParams && typeof request.customParams === "object" && !Array.isArray(request.customParams) ? request.customParams : {};
    for (const [key, value] of Object.entries(rawIncomingCustom)) {
      const rule = sanitizeRule(value, parameterIds);
      if (rule) customParams[key] = rule;
    }
    const hasCustomParams = Object.keys(customParams).length > 0;
    const privateEmotionMap = sanitizePrivateEmotionMap(
      request.privateEmotionMap,
      parameterIds,
      base.privateEmotionMap ?? {},
      "manual",
      mouthOpenParameterIds
    );
    const hasPrivateEmotionMap = Object.keys(privateEmotionMap).length > 0;
    const derivedBase = { parameterMap, ...hasCustomParams ? { customParams } : {} };
    const preservedSignature = base.sourceSignature ?? context.signature;
    const resultSignature = {
      modelDir: preservedSignature.modelDir ?? context.signature.modelDir,
      model3File: preservedSignature.model3File ?? context.signature.model3File,
      cdi3File: preservedSignature.cdi3File ?? context.signature.cdi3File,
      hash: preservedSignature.hash,
      generatedAt: preservedSignature.generatedAt ?? context.signature.generatedAt
    };
    const profile = {
      modelId: base.modelId,
      displayName: request.displayName?.trim() || base.displayName,
      version: base.version,
      modelPath: context.webModelPath,
      sourceSignature: preservedSignature,
      autoProfile: {
        provider: "manual",
        promptVersion: base.autoProfile?.promptVersion ?? profileGeneratorVersion,
        generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
        notes: ["Manually calibrated profile saved via /profile/save."]
      },
      schemaVersion: CURRENT_SCHEMA_VERSION,
      capabilities: emptyCapabilities(),
      parameterMap,
      ...hasCustomParams ? { customParams } : {},
      ...hasPrivateEmotionMap ? { privateEmotionMap } : {},
      idleConfig: this.sanitizeIdleConfig(request.idleConfig, base.idleConfig, parameterMap),
      reactionBias: base.reactionBias,
      neutralParams: {
        ...deriveNeutralParams(derivedBase),
        ...sanitizeNumericRecord(request.neutralParams, parameterIds)
      },
      parameterSmoothing: deriveParameterSmoothing(derivedBase)
    };
    profile.capabilities = detectCapabilities(profile);
    await this.writeProfile(context.profilePath, profile);
    return {
      generated: true,
      reason: "forced",
      provider: "manual",
      profileUrl: context.webProfilePath,
      modelUrl: context.webModelPath,
      sourceSignature: resultSignature,
      profile,
      notes: [
        "Manual calibration saved.",
        "Existing source signature preserved (not rehashed)."
      ],
      // Provenance is unknown for a manual save; coverage infers per-key
      // confidence from whether targets are standard Cubism ids.
      coverage: computeAdaptationCoverage(profile, context.parameters, {
        modelDir: context.modelDir,
        provider: "manual",
        provenance: void 0
      })
    };
  }
  async loadContext(modelDirInput) {
    const modelDir = sanitizeModelDir(modelDirInput);
    const directoryPath = path.resolve(this.modelsRoot, modelDir);
    if (!isInside(this.modelsRoot, directoryPath)) {
      throw new Error("modelDir must stay inside the configured models root");
    }
    const entries = await fs.readdir(directoryPath);
    const model3File = entries.find((entry) => entry.toLowerCase().endsWith(".model3.json"));
    if (!model3File) throw new Error(`No .model3.json file found in ${modelDir}`);
    const model3Path = path.join(directoryPath, model3File);
    const model3 = await readJson(model3Path);
    const displayInfo = model3.FileReferences?.DisplayInfo;
    const cdi3File = typeof displayInfo === "string" && displayInfo.trim() ? normalizeRelativeFile(displayInfo) : entries.find((entry) => entry.toLowerCase().endsWith(".cdi3.json"));
    const cdi3Path = cdi3File ? resolveModelFile(directoryPath, cdi3File) : void 0;
    const cdi3 = cdi3Path ? await readOptionalJson(cdi3Path) : void 0;
    const profilePath = path.join(directoryPath, "soullink.profile.json");
    const groups = Array.isArray(model3.Groups) ? model3.Groups : [];
    const expressions = model3.FileReferences?.Expressions?.map((expression) => ({
      name: String(expression.Name ?? ""),
      file: String(expression.File ?? "")
    })).filter((expression) => expression.name || expression.file) ?? [];
    const motionGroups = Object.entries(model3.FileReferences?.Motions ?? {}).map(([group, motions]) => ({
      group,
      files: Array.isArray(motions) ? motions.map((motion) => String(motion.File ?? "")) : []
    })).filter((motionGroup) => motionGroup.group || motionGroup.files.some(Boolean));
    const parameters = buildParameterInfo(cdi3);
    const signature = await this.createSignature({
      modelDir,
      directoryPath,
      model3File,
      model3Path,
      cdi3File,
      cdi3Path,
      model3
    });
    return {
      modelDir,
      directoryPath,
      model3File,
      model3Path,
      cdi3File,
      cdi3Path,
      profilePath,
      webModelPath: joinModelsUrl(this.modelsBaseUrl, modelDir, toWebPath(model3File)),
      webProfilePath: joinModelsUrl(this.modelsBaseUrl, modelDir, "soullink.profile.json"),
      model3,
      cdi3,
      parameters,
      groups,
      expressions,
      expressionFiles: expressions,
      motionGroups,
      signature
    };
  }
  async createSignature(input) {
    const hash = createHash("sha256");
    hash.update(`modelDir:${input.modelDir}
`);
    hash.update(`model3File:${input.model3File}
`);
    hash.update(await fs.readFile(input.model3Path));
    if (input.cdi3Path) {
      hash.update(`
cdi3File:${input.cdi3File ?? ""}
`);
      hash.update(await fs.readFile(input.cdi3Path));
    }
    const moc = input.model3.FileReferences?.Moc;
    if (moc) {
      const mocPath = resolveModelFile(input.directoryPath, moc);
      const stat = await statOptional(mocPath);
      if (stat) hash.update(`
moc:${moc}:${stat.size}:${Math.round(stat.mtimeMs)}`);
    }
    for (const expression of input.model3.FileReferences?.Expressions ?? []) {
      if (!expression.File || !expression.File.toLowerCase().endsWith(".exp3.json")) continue;
      try {
        const expressionPath = resolveModelFile(input.directoryPath, expression.File);
        const content = await readOptionalFile(expressionPath);
        if (content) hash.update(`
expression:${expression.Name ?? ""}:${expression.File}
`).update(content);
      } catch {
      }
    }
    for (const [group, entries] of Object.entries(input.model3.FileReferences?.Motions ?? {})) {
      for (let i = 0; i < entries.length; i++) {
        const file = entries[i]?.File;
        if (!file || !file.toLowerCase().endsWith(".motion3.json")) continue;
        try {
          const motionPath = resolveModelFile(input.directoryPath, file);
          const stat = await statOptional(motionPath);
          if (stat) hash.update(`
motion:${group}:${i}:${file}:${stat.size}:${Math.round(stat.mtimeMs)}`);
        } catch {
        }
      }
    }
    return {
      modelDir: input.modelDir,
      model3File: input.model3File,
      cdi3File: input.cdi3File,
      hash: hash.digest("hex"),
      generatedAt: (/* @__PURE__ */ new Date()).toISOString()
    };
  }
  async createHeuristicProfile(context, displayName, provenance = {}) {
    const selector = new ParameterSelector(context.parameters);
    const params = context.parameters;
    const groups = context.groups;
    const paramIdSet = new Set(params.map((param) => param.id));
    const map = {};
    const addRule = (key, rule) => {
      if (rule) map[key] = rule;
    };
    const resolveSingle = (key, nameMatch) => {
      const std = resolveStandard(key, params, groups);
      if (std && std.ids.length) {
        provenance[key] = std.source;
        return std.ids[0];
      }
      if (nameMatch) {
        provenance[key] = "name-match";
        return nameMatch;
      }
      return void 0;
    };
    const resolveMulti = (key, nameMatch) => {
      const std = resolveStandard(key, params, groups);
      if (std && std.ids.length) {
        provenance[key] = std.source;
        return std.ids;
      }
      if (nameMatch.length) {
        provenance[key] = "name-match";
        return nameMatch;
      }
      return [];
    };
    const eyeOpen = selector.eyeOpenPair(context.groups);
    const eyeBlinkGroupName = STANDARD_PARAM_TABLE.eyeOpen?.group;
    const blinkGroupIds = (groups.find((group) => group.Target === "Parameter" && group.Name === eyeBlinkGroupName)?.Ids ?? []).filter((id) => paramIdSet.has(id));
    const eyeSmile = resolveMulti("eyeSmile", selector.pair(["eyesmile", "eye smile", "\u5FAE\u7B11"], ["ParamEyeLSmile"], ["ParamEyeRSmile"]));
    const gazeX = resolveSingle("gazeX", selector.one(["eyeballx", "eye x", "\u773C\u73E0x", "\u773C\u7403x"], ["ParamEyeBallX"]));
    const gazeY = resolveSingle("gazeY", selector.one(["eyebally", "eye y", "\u773C\u73E0y", "\u773C\u7403y"], ["ParamEyeBallY"]));
    const headX = resolveSingle("headX", selector.one(["anglex", "\u89D2\u5EA6x"], ["ParamAngleX"]));
    const headY = resolveSingle("headY", selector.one(["angley", "\u89D2\u5EA6y"], ["ParamAngleY"]));
    const headZ = resolveSingle("headZ", selector.one(["anglez", "\u89D2\u5EA6z"], ["ParamAngleZ"]));
    const bodyX = resolveSingle("bodyX", selector.one(["bodyanglex", "\u8EAB\u4F53\u65CB\u8F6Cx", "\u8EAB\u4F53x"], ["ParamBodyAngleX"]));
    const bodyY = resolveSingle("bodyY", selector.one(["bodyangley", "\u8EAB\u4F53\u65CB\u8F6Cy", "\u8EAB\u4F53y"], ["ParamBodyAngleY"]));
    const bodyZ = resolveSingle("bodyZ", selector.one(["bodyanglez", "\u8EAB\u4F53\u65CB\u8F6Cz", "\u8EAB\u4F53z"], ["ParamBodyAngleZ"]));
    const mouthForm = resolveSingle("mouthSmile", selector.one(["mouthform", "\u5634\u53D8\u5F62", "\u5634\u3000\u53D8\u5F62"], ["ParamMouthForm"]));
    const mouthOpen = resolveSingle("mouthOpen", selector.one(["mouthopeny", "\u5634\u5F20\u5F00", "\u5F20\u5F00\u548C\u95ED\u5408"], ["ParamMouthOpenY"]));
    const mouthPucker = selector.one(["mouthpucker", "\u9F13\u5634", "\u561F\u5634"], []);
    const browY = resolveMulti("browInnerUp", selector.pair(["brow", "\u7709", "\u4E0A\u4E0B"], ["ParamBrowLY"], ["ParamBrowRY"]));
    const browAngle = resolveMulti("browOuterUp", selector.pair(["brow", "\u7709", "angle", "\u89D2\u5EA6"], ["ParamBrowLAngle"], ["ParamBrowRAngle"]));
    const browForm = resolveMulti("browDown", selector.pair(["brow", "\u7709", "form", "\u5909\u5F62", "\u53D8\u5F62"], ["ParamBrowLForm"], ["ParamBrowRForm"]));
    const blushName = selector.many(["blush", "\u8138\u7EA2", "\u8138\u988A\u6CDB\u7EA2", "\u816E\u7EA2"], ["\u8138\u9ED1"]);
    const stdBlush = resolveStandard("blush", params, groups);
    let blush;
    if (stdBlush && stdBlush.ids.length) {
      blush = unique([...blushName, ...stdBlush.ids]);
      provenance.blush = stdBlush.source;
    } else if (blushName.length) {
      blush = blushName;
      provenance.blush = "name-match";
    } else {
      blush = [];
    }
    const tear = selector.many(["tear", "\u6CEA", "\u773C\u6CEA"], []);
    if (tear.length) provenance.tear = "name-match";
    const sweat = selector.many(["sweat", "\u6C57"], []);
    if (sweat.length) provenance.sweat = "name-match";
    const breath = resolveSingle("breath", selector.one(["breath", "\u547C\u5438"], ["ParamBreath"]));
    if (mouthPucker) provenance.mouthPucker = "name-match";
    if (eyeOpen.length) {
      provenance.eyeOpen = blinkGroupIds.length >= 2 ? "standard-group" : eyeOpen.every((id) => isStandardId(id)) ? "standard-id" : "name-match";
      addRule("eyeOpen", { targets: eyeOpen, mode: "set", scale: 1, min: 0, max: 1.2 });
      if (eyeOpen[0]) {
        addRule("eyeBlinkL", { target: eyeOpen[0], mode: "subtract", scale: 1, min: 0, max: 1.2 });
        provenance.eyeBlinkL = "derived";
      }
      if (eyeOpen[1]) {
        addRule("eyeBlinkR", { target: eyeOpen[1], mode: "subtract", scale: 1, min: 0, max: 1.2 });
        provenance.eyeBlinkR = "derived";
      }
      addRule("eyeSquint", { targets: eyeOpen, mode: "subtract", scale: 0.22, min: 0, max: 1.2 });
      provenance.eyeSquint = "derived";
    }
    addRule("eyeSmile", ruleForTargets(eyeSmile, "set", 1, 0, 1));
    addRule("gazeX", ruleForTarget(gazeX, "set", 1, -1, 1));
    addRule("gazeY", ruleForTarget(gazeY, "set", 1, -1, 1));
    addRule("headX", ruleForTarget(headX, "set", 30, -30, 30));
    addRule("headY", ruleForTarget(headY, "set", 30, -30, 30));
    addRule("headZ", ruleForTarget(headZ, "set", 30, -30, 30));
    addRule("bodyX", ruleForTarget(bodyX, "set", 12, -12, 12));
    addRule("bodyY", ruleForTarget(bodyY, "set", 12, -12, 12));
    addRule("bodyZ", ruleForTarget(bodyZ, "set", 12, -12, 12));
    addRule("mouthSmile", ruleForTarget(mouthForm, "set", 1, -1, 1));
    addRule("mouthFrown", ruleForTarget(mouthForm, "subtract", 1, -1, 1));
    if (mouthForm) provenance.mouthFrown = "derived";
    addRule("mouthOpen", ruleForTarget(mouthOpen, "set", 1, 0, 1));
    addRule("mouthPucker", ruleForTarget(mouthPucker, "set", 1, 0, 1));
    addRule("browInnerUp", ruleForTargets(browY, "set", 1, -1, 1));
    addRule("browOuterUp", ruleForTargets(browAngle, "set", 0.9, -1, 1));
    addRule("browDown", ruleForTargets(browForm, "set", -0.85, -1, 1));
    addRule("blush", ruleForTargets(blush, "set", 1, 0, 1));
    addRule("tear", ruleForTargets(tear, "set", 1, 0, 1));
    addRule("sweat", ruleForTargets(sweat, "set", 1, 0, 1));
    addRule("breath", ruleForTarget(breath, "set", 1, 0, 1));
    const privateEmotionMap = buildHeuristicPrivateEmotionMap(params, mappedTargetIds(map));
    const catalogNotes = [];
    const nativeCatalog = await this.buildNativeAnimationCatalog(context, catalogNotes);
    const expressionMap = this.buildExpressionMap(context, nativeCatalog);
    const nativeAnimationEntries = (nativeCatalog.expressions?.length ?? 0) + (nativeCatalog.motions?.length ?? 0);
    const profile = {
      modelId: `${sanitizeId(context.modelDir)}_${context.signature.hash.slice(0, 8)}`,
      displayName: displayName?.trim() || context.modelDir,
      version: "1.0.0",
      modelPath: context.webModelPath,
      sourceSignature: context.signature,
      autoProfile: {
        provider: "heuristic",
        promptVersion: profileGeneratorVersion,
        generatedAt: context.signature.generatedAt,
        notes: [
          "Generated from model3/cdi3 parameter names.",
          "LLM may refine this profile when OpenAI-compatible settings are enabled.",
          ...catalogNotes
        ]
      },
      schemaVersion: CURRENT_SCHEMA_VERSION,
      capabilities: emptyCapabilities(),
      parameterMap: map,
      ...Object.keys(privateEmotionMap).length ? { privateEmotionMap } : {},
      idleConfig: this.createIdleConfig(map),
      reactionBias: {
        shy: {
          blushMultiplier: 1.1,
          gazeAwayMultiplier: 1.05
        },
        happy: {
          mouthSmileMultiplier: 1,
          eyeSmileMultiplier: 1
        }
      },
      neutralParams: deriveNeutralParams({ parameterMap: map }),
      parameterSmoothing: deriveParameterSmoothing({ parameterMap: map }),
      ...nativeAnimationEntries > 0 ? { nativeAnimations: nativeCatalog } : {},
      ...expressionMap ? { expressionMap } : {}
    };
    profile.capabilities = detectCapabilities(profile);
    return profile;
  }
  async generateWithLLM(context, heuristic, existing, openAI) {
    let lastError;
    for (const responseFormat of responseFormatFallbacks(profileResponseFormat)) {
      try {
        const completion = await this.client.createChatCompletion({
          model: openAI?.model,
          messages: [
            {
              role: "system",
              content: buildProfileSystemPrompt()
            },
            {
              role: "user",
              content: JSON.stringify({
                task: "Generate soullink.profile.json for this Live2D model.",
                sourceSignature: context.signature,
                modelPathMustEqual: context.webModelPath,
                cdiParameters: context.parameters,
                model3Groups: context.groups,
                expressions: context.expressions,
                heuristicDraft: heuristic,
                existingProfileReference: existing ?? null,
                canonicalReference: canonicalProfileReference()
              })
            }
          ],
          temperature: 0.18,
          max_tokens: 4500,
          ...responseFormat ? { response_format: responseFormat } : {}
        }, openAI);
        return parseJSON(completion.choices[0]?.message?.content ?? "");
      } catch (error) {
        lastError = error;
        if (error instanceof OpenAIClientNotConfiguredError) throw error;
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }
  async sanitizeProfile(raw, heuristic, context, provider) {
    const parameterIds = new Set(context.parameters.map((parameter) => parameter.id));
    const profile = raw;
    const rawMap = profile.parameterMap && typeof profile.parameterMap === "object" ? profile.parameterMap : {};
    const parameterMap = { ...heuristic.parameterMap };
    for (const key of facsKeys) {
      if (provider === "openai-compatible" && Object.prototype.hasOwnProperty.call(rawMap, key) && rawMap[key] === null) {
        delete parameterMap[key];
        continue;
      }
      const rule = sanitizeRule(rawMap[key], parameterIds);
      if (rule) parameterMap[key] = rule;
    }
    const rawCustomParams = profile.customParams && typeof profile.customParams === "object" && !Array.isArray(profile.customParams) ? profile.customParams : {};
    const customParams = {};
    for (const [key, value] of Object.entries(rawCustomParams)) {
      const rule = sanitizeRule(value, parameterIds);
      if (rule) customParams[key] = rule;
    }
    const hasCustomParams = Object.keys(customParams).length > 0;
    const privateEmotionMap = sanitizePrivateEmotionMap(
      profile.privateEmotionMap,
      parameterIds,
      heuristic.privateEmotionMap ?? {},
      provider === "openai-compatible" ? "llm" : "heuristic",
      new Set(context.parameters.filter(isMouthOpenLive2DParameter).map((parameter) => parameter.id))
    );
    const hasPrivateEmotionMap = Object.keys(privateEmotionMap).length > 0;
    const derivedBase = { parameterMap, ...hasCustomParams ? { customParams } : {} };
    const catalogNotes = [];
    const nativeCatalog = await this.buildNativeAnimationCatalog(context, catalogNotes);
    const nativeAnimationEntries = (nativeCatalog.expressions?.length ?? 0) + (nativeCatalog.motions?.length ?? 0);
    const catalogExpressionNames = new Set((nativeCatalog.expressions ?? []).map((e) => e.name));
    const rawExpressionMap = profile.expressionMap && typeof profile.expressionMap === "object" && !Array.isArray(profile.expressionMap) ? profile.expressionMap : {};
    const expressionMap = {};
    for (const [key, value] of Object.entries(rawExpressionMap)) {
      if (typeof key !== "string") continue;
      if (typeof value === "string") {
        if (catalogExpressionNames.has(value)) {
          expressionMap[key] = value;
        }
      } else if (value && typeof value === "object" && !Array.isArray(value)) {
        const record = value;
        const exprName = typeof record.expression === "string" ? record.expression : void 0;
        if (exprName && catalogExpressionNames.has(exprName)) {
          const minIntensity = typeof record.minIntensity === "number" && Number.isFinite(record.minIntensity) && record.minIntensity >= 0 && record.minIntensity <= 1 ? record.minIntensity : void 0;
          expressionMap[key] = {
            expression: exprName,
            ...minIntensity !== void 0 ? { minIntensity } : {}
          };
        }
      }
    }
    const hasExpressionMap = Object.keys(expressionMap).length > 0;
    const rawMotionMap = profile.motionMap && typeof profile.motionMap === "object" && !Array.isArray(profile.motionMap) ? profile.motionMap : {};
    const motionMap = {};
    const catalogMotions = nativeCatalog.motions ?? [];
    for (const [key, value] of Object.entries(rawMotionMap)) {
      if (!value || typeof value !== "object" || Array.isArray(value)) continue;
      const record = value;
      const group = typeof record.group === "string" && record.group.trim() ? record.group.trim() : void 0;
      const index = typeof record.index === "number" && Number.isInteger(record.index) && record.index >= 0 ? record.index : void 0;
      if (!group) continue;
      const exists = catalogMotions.some((motion) => motion.group === group && (index === void 0 || motion.index === index));
      if (!exists) continue;
      const priority = isMotionPriority(record.priority) ? record.priority : void 0;
      motionMap[key] = {
        group,
        ...index !== void 0 ? { index } : {},
        ...priority ? { priority } : {}
      };
    }
    const hasMotionMap = Object.keys(motionMap).length > 0;
    const result = {
      modelId: stringOr(profile.modelId, heuristic.modelId),
      displayName: stringOr(profile.displayName, heuristic.displayName),
      version: stringOr(profile.version, heuristic.version),
      modelPath: context.webModelPath,
      sourceSignature: context.signature,
      autoProfile: {
        provider,
        promptVersion: profileGeneratorVersion,
        generatedAt: context.signature.generatedAt,
        notes: [
          ...provider === "openai-compatible" ? ["Generated with LLM and validated against actual CDI parameters."] : heuristic.autoProfile?.notes ?? [],
          ...catalogNotes
        ]
      },
      schemaVersion: CURRENT_SCHEMA_VERSION,
      capabilities: emptyCapabilities(),
      parameterMap,
      ...hasCustomParams ? { customParams } : {},
      ...hasPrivateEmotionMap ? { privateEmotionMap } : {},
      idleConfig: this.sanitizeIdleConfig(profile.idleConfig, heuristic.idleConfig, parameterMap),
      reactionBias: profile.reactionBias && typeof profile.reactionBias === "object" ? profile.reactionBias : heuristic.reactionBias,
      neutralParams: {
        ...deriveNeutralParams(derivedBase),
        ...sanitizeNumericRecord(profile.neutralParams, parameterIds)
      },
      parameterSmoothing: {
        ...deriveParameterSmoothing(derivedBase),
        ...sanitizeNumericRecord(profile.parameterSmoothing, parameterIds)
      },
      ...nativeAnimationEntries > 0 ? { nativeAnimations: nativeCatalog } : {},
      ...hasExpressionMap ? { expressionMap } : {},
      ...hasMotionMap ? { motionMap } : {}
    };
    result.capabilities = detectCapabilities(result);
    return result;
  }
  /**
   * C5-T4/C5-T6: Scan expression (.exp3.json) and motion (.motion3.json) files
   * from the model directory and build the NativeAnimationCatalog. All file paths
   * are validated with isInside before access. Files > 256 KB, paths outside the
   * model directory, or unexpected extensions are skipped with a note in the
   * provided notes array.
   */
  async buildNativeAnimationCatalog(context, notes = []) {
    const MAX_EXPRESSIONS = 64;
    const MAX_MOTIONS = 256;
    const MAX_EXP_BYTES = 256 * 1024;
    const expressions = [];
    for (const { name, file } of context.expressionFiles) {
      if (expressions.length >= MAX_EXPRESSIONS) {
        notes.push(`Expression limit (${MAX_EXPRESSIONS}) reached; skipping remaining expression files.`);
        break;
      }
      if (!file || !file.toLowerCase().endsWith(".exp3.json")) continue;
      try {
        const resolved = path.resolve(context.directoryPath, normalizeRelativeFile(file));
        if (!isInside(context.directoryPath, resolved)) {
          notes.push(`Expression file "${file}" escapes model directory; skipped.`);
          continue;
        }
        const stat = await statOptional(resolved);
        if (!stat) continue;
        if (stat.size > MAX_EXP_BYTES) {
          notes.push(`Expression file "${file}" skipped (${stat.size} bytes exceeds 256 KB limit).`);
          continue;
        }
        const raw = await readOptionalFile(resolved);
        if (!raw) continue;
        const exp3 = JSON.parse(raw.toString("utf8"));
        const params = [];
        for (const param of exp3.Parameters ?? []) {
          if (typeof param.Id === "string" && param.Id && typeof param.Value === "number" && param.Value !== 0) {
            params.push(param.Id);
          }
        }
        expressions.push({ name, file, ...params.length ? { params } : {} });
      } catch {
        notes.push(`Failed to process expression file "${file}"; skipped.`);
      }
    }
    const motions = [];
    const motionsRecord = context.model3.FileReferences?.Motions ?? {};
    outer: for (const [group, entries] of Object.entries(motionsRecord)) {
      if (!Array.isArray(entries)) continue;
      for (let index = 0; index < entries.length; index++) {
        if (motions.length >= MAX_MOTIONS) {
          notes.push(`Motion limit (${MAX_MOTIONS}) reached; skipping remaining motion entries.`);
          break outer;
        }
        const file = entries[index]?.File;
        if (!file || typeof file !== "string") continue;
        if (!file.toLowerCase().endsWith(".motion3.json")) continue;
        try {
          const resolved = resolveModelFile(context.directoryPath, file);
          if (!isInside(context.directoryPath, resolved)) {
            notes.push(`Motion file "${file}" (group "${group}", index ${index}) escapes model directory; skipped.`);
            continue;
          }
          motions.push({ group, index, file });
        } catch {
          notes.push(`Motion file "${file}" (group "${group}", index ${index}) failed path check; skipped.`);
        }
      }
    }
    return {
      ...expressions.length ? { expressions } : {},
      ...motions.length ? { motions } : {}
    };
  }
  /**
   * C5-T4: Heuristic name->emotion mapping. Returns a Record keyed by emotion
   * name whose values are the best-matching expression name from the catalog.
   * Returns undefined when no expression maps to any known emotion.
   */
  buildExpressionMap(_context, catalog) {
    const expressionList = catalog.expressions ?? [];
    if (!expressionList.length) return void 0;
    const emotionHeuristics = [
      [["blush", "\u8138\u7EA2", "embarrassed"], "shy"],
      [["angry", "\u6012", "anger"], "angry"],
      [["tears", "\u6CEA", "tear", "cry", "sad", "\u60B2"], "sad"],
      [["loveeyes", "love", "\u7231", "heart"], "affectionate"],
      [["stars", "excited", "star", "\u5174\u594B"], "excited"],
      [["confused", "\u5E7D\u7075", "ghost"], "confused"],
      [["smile", "happy", "\u5F00\u5FC3"], "happy"],
      [["surprised", "\u60CA", "wow"], "surprised"]
    ];
    const sorted = [...expressionList].sort((a, b) => a.file.localeCompare(b.file));
    const result = {};
    const emotionClaimed = /* @__PURE__ */ new Set();
    for (const { name } of sorted) {
      const normalized = normalizeText(name);
      for (const [needles, emotion] of emotionHeuristics) {
        if (emotionClaimed.has(emotion)) continue;
        if (needles.some((needle) => normalized.includes(normalizeText(needle)))) {
          result[emotion] = name;
          emotionClaimed.add(emotion);
          break;
        }
      }
    }
    return Object.keys(result).length ? result : void 0;
  }
  createIdleConfig(map) {
    const idleConfig = {};
    if (map.gazeX) idleConfig.gazeX = [-0.12, 0.12];
    if (map.gazeY) idleConfig.gazeY = [-0.06, 0.08];
    if (map.headX) idleConfig.headX = [-0.08, 0.08];
    if (map.headY) idleConfig.headY = [-0.04, 0.04];
    if (map.headZ) idleConfig.headZ = [-0.05, 0.05];
    if (map.bodyX) idleConfig.bodyX = [-0.045, 0.045];
    if (map.bodyY) idleConfig.bodyY = [-0.014, 0.014];
    if (map.bodyZ) idleConfig.bodyZ = [-0.055, 0.055];
    if (map.mouthSmile) idleConfig.mouthSmile = [0.02, 0.1];
    if (map.browInnerUp) idleConfig.browInnerUp = [0, 0.06];
    if (map.eyeOpen) idleConfig.eyeOpen = [0.9, 1];
    return idleConfig;
  }
  sanitizeIdleConfig(raw, fallback, map) {
    if (!raw || typeof raw !== "object") return fallback;
    const record = raw;
    const result = { ...fallback };
    for (const key of facsKeys) {
      if (!map[key]) continue;
      const value = record[key];
      if (!Array.isArray(value) || value.length !== 2) continue;
      const min = typeof value[0] === "number" && Number.isFinite(value[0]) ? value[0] : void 0;
      const max = typeof value[1] === "number" && Number.isFinite(value[1]) ? value[1] : void 0;
      if (min === void 0 || max === void 0 || min > max) continue;
      result[key] = [min, max];
    }
    return result;
  }
  async readExistingProfile(profilePath) {
    return await readOptionalJson(profilePath);
  }
  async writeProfile(profilePath, profile) {
    const temporaryPath = `${profilePath}.${process.pid}-${randomBytes(6).toString("hex")}.tmp`;
    try {
      await fs.writeFile(temporaryPath, `${JSON.stringify(profile, null, 2)}
`, "utf8");
      await fs.rename(temporaryPath, profilePath);
    } finally {
      await fs.rm(temporaryPath, { force: true });
    }
  }
};
var ParameterSelector = class {
  constructor(parameters) {
    this.parameters = parameters;
    for (const parameter of parameters) {
      this.byId.set(parameter.id, parameter);
    }
  }
  parameters;
  byId = /* @__PURE__ */ new Map();
  eyeOpenPair(groups) {
    const blinkGroup = groups.find((group) => group.Target === "Parameter" && group.Name === "EyeBlink");
    const ids = blinkGroup?.Ids?.filter((id) => this.byId.has(id)) ?? [];
    if (ids.length >= 2) return ids.slice(0, 2);
    return this.pair(["eyeopen", "\u5F00\u95ED"], ["ParamEyeLOpen"], ["ParamEyeROpen"]);
  }
  pair(sharedNeedles, leftIds, rightIds) {
    const left = this.preferred(leftIds) ?? this.bestMatch([sharedNeedles, ["left", "\u5DE6", " l"]]);
    const right = this.preferred(rightIds) ?? this.bestMatch([sharedNeedles, ["right", "\u53F3", " r"]]);
    return [left, right].filter((id) => Boolean(id));
  }
  one(needles, preferredIds) {
    return this.preferred(preferredIds) ?? this.bestMatch([needles]);
  }
  many(needles, exclusions) {
    const normalizedExclusions = exclusions.map(normalizeText).filter(Boolean);
    const result = [];
    for (const parameter of this.parameters) {
      const haystack = normalizeText(`${parameter.id} ${parameter.name} ${parameter.groupName}`);
      if (normalizedExclusions.some((needle) => haystack.includes(needle))) continue;
      if (needles.some((needle) => matchesSemanticNeedle(parameter, needle))) result.push(parameter.id);
    }
    return unique(result).slice(0, 4);
  }
  preferred(ids) {
    return ids.find((id) => this.byId.has(id));
  }
  bestMatch(needleGroups) {
    let best;
    for (const parameter of this.parameters) {
      const groupScores = needleGroups.map((needles) => needles.filter((needle) => matchesSelectorNeedle(parameter, needle)).length);
      if (groupScores.some((score2) => score2 === 0)) continue;
      const score = groupScores.reduce((sum, value) => sum + value, 0);
      if (!best || score > best.score) best = { id: parameter.id, score };
    }
    return best?.id;
  }
};
function mappedTargetIds(map) {
  const result = /* @__PURE__ */ new Set();
  for (const rule of Object.values(map)) {
    if (rule?.target) result.add(rule.target);
    for (const target of rule?.targets ?? []) result.add(target);
  }
  return result;
}
function buildHeuristicPrivateEmotionMap(parameters, excludedIds) {
  const definitions = [
    {
      key: "positiveEye",
      category: "positiveEye",
      needles: ["\u7231\u5FC3\u773C", "\u661F\u661F\u773C", "heart eye", "love eye", "star eye", "sparkle eye"],
      priority: 90,
      confidence: 0.94,
      exclusiveGroup: "face-effect"
    },
    {
      key: "confusionEffect",
      category: "privateEffect",
      needles: ["\u56F0\u60D1", "\u7591\u95EE", "confused", "confusion", "question mark"],
      emotions: ["confused"],
      priority: 95,
      confidence: 0.96,
      exclusiveGroup: "face-effect"
    },
    {
      key: "angerEffect",
      category: "anger",
      needles: ["\u751F\u6C14", "\u6124\u6012", "\u6012", "angry", "anger", "mad"],
      priority: 90,
      confidence: 0.95,
      exclusiveGroup: "face-effect"
    },
    {
      key: "shadowEffect",
      category: "shadow",
      needles: ["\u8138\u9ED1", "\u9ED1\u8138", "\u9634\u5F71", "shadow", "dark face"],
      priority: 80,
      confidence: 0.94,
      exclusiveGroup: "face-effect"
    },
    {
      key: "surpriseEffect",
      category: "surprise",
      needles: ["\u60CA\u8BB6", "\u9707\u60CA", "surprise", "shock"],
      priority: 80,
      confidence: 0.92,
      exclusiveGroup: "face-effect"
    },
    {
      key: "starEffect",
      category: "privateEffect",
      needles: ["\u661F\u661F", "star", "sparkle"],
      emotions: ["excited", "happy", "surprised"],
      priority: 70,
      confidence: 0.82,
      exclusiveGroup: "face-effect"
    }
  ];
  const result = {};
  const claimed = /* @__PURE__ */ new Set();
  for (const definition of definitions) {
    const targets = parameters.filter((parameter) => !excludedIds.has(parameter.id) && !claimed.has(parameter.id)).filter((parameter) => definition.needles.some((needle) => matchesSemanticNeedle(parameter, needle))).map((parameter) => parameter.id).slice(0, 4);
    if (!targets.length) continue;
    targets.forEach((target) => claimed.add(target));
    result[definition.key] = {
      targets,
      category: definition.category,
      ...definition.emotions ? { emotions: definition.emotions } : {},
      ...definition.exclusiveGroup ? { exclusiveGroup: definition.exclusiveGroup } : {},
      priority: definition.priority,
      source: "heuristic",
      confidence: definition.confidence
    };
  }
  return result;
}
function buildProfileSystemPrompt() {
  return [
    "You are a Live2D Cubism parameter adapter engineer for SoullinkLive.",
    "Your job is to generate a maintainable soullink.profile.json that maps high-level FACS-like emotion keys to actual Live2D parameter IDs.",
    "",
    "Critical rules:",
    "1. Return JSON only. No markdown, no comments.",
    "2. Do not invent parameter IDs. Every target/targets entry must be selected from cdiParameters.id.",
    "3. Keep modelPath exactly equal to modelPathMustEqual.",
    "4. Prefer the heuristicDraft unless CDI parameter names clearly prove a better mapping.",
    "5. If a heuristic FACS mapping is clearly wrong, set that parameterMap key to null to delete it. Otherwise omit uncertain additions.",
    "6. Do not map cosmetic toggles, props, clothing, or hand poses to facial FACS unless their name clearly means the facial effect.",
    "7. Use stable Live2D conventions: eyeOpen is set to eye open params, eyeBlinkL/R subtract from each eye open param, mouthOpen uses mouth-open-y, mouthSmile/mouthFrown use mouth form when available.",
    "8. Directional keys gazeX/gazeY/headX/headY/headZ/bodyX/bodyY/bodyZ use signed ranges. Visual effect keys use 0..1 ranges.",
    "9. neutralParams should include every mapped target. Use eye open = 1, breath = 0.5, most others = 0 unless the reference says otherwise.",
    "10. parameterSmoothing should be modest: mouth/eyes fast, head/body medium, blush/tear/sweat slow.",
    "11. When adding model-specific controls outside the supported FACS keys, put them in customParams with validated target/targets entries.",
    "12. Use privateEmotionMap for semantic effect parameters that should react automatically to VAD/emotion, such as confused, anger symbols, stars, shadows, or surprise effects.",
    "13. privateEmotionMap must never target mouth-open/jaw-open parameters. Use emotions and/or vadRange for model-specific triggers, and an exclusiveGroup for mutually exclusive face effects.",
    "",
    `Supported FACS keys: ${facsKeys.join(", ")}.`,
    "ParameterMapRule format: { target?: string, targets?: string[], mode?: 'set'|'add'|'subtract'|'inverse', scale?: number, offset?: number, min?: number, max?: number, curve?: 'linear'|'easeIn'|'easeOut'|'easeInOut'|'smoothstep', gamma?: number, deadzone?: number, inputRange?: [number, number], outputRange?: [number, number], invertAround?: number }.",
    "PrivateEmotionMapping format: { target?: string, targets?: string[], category?: 'positiveEye'|'blush'|'tear'|'shadow'|'anger'|'sweat'|'surprise'|'privateEffect', emotions?: string[], vadRange?: { valence?: [number,number], arousal?: [number,number], dominance?: [number,number] }, triggerMode?: 'any'|'all', activeValue?: number, neutralValue?: number, intensity?: number, priority?: number, exclusiveGroup?: string, confidence?: number }.",
    "Output a complete ModelProfile object with schemaVersion, modelId, displayName, version, modelPath, capabilities, parameterMap, optional customParams/privateEmotionMap, idleConfig, neutralParams, parameterSmoothing, and optional reactionBias."
  ].join("\n");
}
function canonicalProfileReference() {
  return {
    purpose: "Reference style based on the known LilyaBee adapter. Use as guidance, not as fixed parameter IDs for other models.",
    commonMappings: {
      eyeOpen: { targets: ["ParamEyeLOpen", "ParamEyeROpen"], mode: "set", scale: 1, min: 0, max: 1.2 },
      eyeBlinkL: { target: "ParamEyeLOpen", mode: "subtract", scale: 1, min: 0, max: 1.2 },
      eyeBlinkR: { target: "ParamEyeROpen", mode: "subtract", scale: 1, min: 0, max: 1.2 },
      gazeX: { target: "ParamEyeBallX", mode: "set", scale: 1, min: -1, max: 1 },
      gazeY: { target: "ParamEyeBallY", mode: "set", scale: 1, min: -1, max: 1 },
      headX: { target: "ParamAngleX", mode: "set", scale: 30, min: -30, max: 30 },
      headY: { target: "ParamAngleY", mode: "set", scale: 30, min: -30, max: 30 },
      headZ: { target: "ParamAngleZ", mode: "set", scale: 30, min: -30, max: 30 },
      bodyX: { target: "ParamBodyAngleX", mode: "set", scale: 12, min: -12, max: 12 },
      bodyY: { target: "ParamBodyAngleY", mode: "set", scale: 12, min: -12, max: 12 },
      bodyZ: { target: "ParamBodyAngleZ", mode: "set", scale: 12, min: -12, max: 12 },
      mouthSmile: { target: "ParamMouthForm", mode: "set", scale: 1, min: -1, max: 1 },
      mouthFrown: { target: "ParamMouthForm", mode: "subtract", scale: 1, min: -1, max: 1 },
      mouthOpen: { target: "ParamMouthOpenY", mode: "set", scale: 1, min: 0, max: 1 },
      blush: "Map only to params named blush/cheek/\u8138\u7EA2/\u8138\u988A\u6CDB\u7EA2.",
      tear: "Map only to params named tear/\u773C\u6CEA/\u6CEA.",
      sweat: "Map only to params named sweat/\u6C57."
    },
    privateEmotionExamples: {
      confusionEffect: {
        targets: ["ParamWithConfusedDisplayName"],
        category: "privateEffect",
        emotions: ["confused"],
        exclusiveGroup: "face-effect"
      }
    }
  };
}
function responseFormatFallbacks(schema) {
  return [
    schema,
    { type: "json_object" },
    void 0
  ];
}
function shouldUseLLM(openAI, useConfiguredOpenAI) {
  if (openAI?.apiKey?.trim()) return true;
  return useConfiguredOpenAI;
}
var mapRuleSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    target: { type: "string" },
    targets: {
      type: "array",
      items: { type: "string" }
    },
    mode: {
      type: "string",
      enum: ["set", "add", "subtract", "inverse"]
    },
    scale: { type: "number" },
    offset: { type: "number" },
    min: { type: "number" },
    max: { type: "number" },
    curve: {
      type: "string",
      enum: ["linear", "easeIn", "easeOut", "easeInOut", "smoothstep"]
    },
    gamma: { type: "number" },
    deadzone: { type: "number" },
    inputRange: {
      type: "array",
      minItems: 2,
      maxItems: 2,
      items: { type: "number" }
    },
    outputRange: {
      type: "array",
      minItems: 2,
      maxItems: 2,
      items: { type: "number" }
    },
    invertAround: { type: "number" }
  }
};
var parameterMapSchema = {
  type: "object",
  additionalProperties: false,
  properties: Object.fromEntries(facsKeys.map((key) => [key, {
    oneOf: [mapRuleSchema, { type: "null" }]
  }]))
};
var privateEmotionMappingSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    target: { type: "string" },
    targets: { type: "array", items: { type: "string" } },
    category: {
      type: "string",
      enum: ["positiveEye", "blush", "tear", "shadow", "anger", "sweat", "surprise", "privateEffect"]
    },
    emotions: { type: "array", items: { type: "string" } },
    vadRange: {
      type: "object",
      additionalProperties: false,
      properties: {
        valence: { type: "array", minItems: 2, maxItems: 2, items: { type: "number" } },
        arousal: { type: "array", minItems: 2, maxItems: 2, items: { type: "number" } },
        dominance: { type: "array", minItems: 2, maxItems: 2, items: { type: "number" } }
      }
    },
    triggerMode: { type: "string", enum: ["any", "all"] },
    activeValue: { type: "number" },
    neutralValue: { type: "number" },
    intensity: { type: "number", minimum: 0, maximum: 1 },
    priority: { type: "number" },
    exclusiveGroup: { type: "string" },
    source: { type: "string", enum: ["heuristic", "llm", "manual"] },
    confidence: { type: "number", minimum: 0, maximum: 1 }
  }
};
var profileResponseFormat = {
  type: "json_schema",
  json_schema: {
    name: "soullink_live2d_profile",
    strict: false,
    schema: {
      type: "object",
      additionalProperties: true,
      required: ["modelId", "displayName", "version", "modelPath", "capabilities", "parameterMap", "idleConfig", "neutralParams", "parameterSmoothing"],
      properties: {
        modelId: { type: "string" },
        displayName: { type: "string" },
        version: { type: "string" },
        modelPath: { type: "string" },
        capabilities: {
          type: "object",
          additionalProperties: { type: "boolean" }
        },
        schemaVersion: { type: "number" },
        parameterMap: parameterMapSchema,
        customParams: {
          type: "object",
          additionalProperties: mapRuleSchema
        },
        privateEmotionMap: {
          type: "object",
          additionalProperties: {
            oneOf: [privateEmotionMappingSchema, { type: "null" }]
          }
        },
        idleConfig: {
          type: "object",
          additionalProperties: {
            type: "array",
            minItems: 2,
            maxItems: 2,
            items: { type: "number" }
          }
        },
        neutralParams: {
          type: "object",
          additionalProperties: { type: "number" }
        },
        parameterSmoothing: {
          type: "object",
          additionalProperties: { type: "number" }
        },
        reactionBias: {
          type: "object",
          additionalProperties: {
            type: "object",
            additionalProperties: { type: "number" }
          }
        },
        expressionMap: {
          type: "object",
          additionalProperties: {
            oneOf: [
              { type: "string" },
              {
                type: "object",
                properties: {
                  expression: { type: "string" },
                  minIntensity: { type: "number" }
                },
                required: ["expression"]
              }
            ]
          }
        },
        nativeAnimations: {
          type: "object",
          properties: {
            expressions: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  name: { type: "string" },
                  file: { type: "string" },
                  params: { type: "array", items: { type: "string" } }
                },
                required: ["name", "file"]
              }
            },
            motions: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  group: { type: "string" },
                  index: { type: "number" },
                  file: { type: "string" }
                },
                required: ["group", "index", "file"]
              }
            }
          }
        },
        motionMap: {
          type: "object",
          additionalProperties: {
            type: "object",
            properties: {
              group: { type: "string" },
              index: { type: "number" },
              priority: { type: "string", enum: ["idle", "normal", "force"] }
            },
            required: ["group"]
          }
        }
      }
    }
  }
};
async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}
async function readOptionalJson(filePath) {
  try {
    return await readJson(filePath);
  } catch {
    return void 0;
  }
}
async function readOptionalFile(filePath) {
  try {
    return await fs.readFile(filePath);
  } catch {
    return void 0;
  }
}
async function statOptional(filePath) {
  try {
    return await fs.stat(filePath);
  } catch {
    return void 0;
  }
}
function parseJSON(content) {
  const trimmed = content.trim();
  if (!trimmed) throw new Error("LLM returned empty content");
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(trimmed.slice(start, end + 1));
    throw new Error(`LLM did not return JSON: ${trimmed.slice(0, 160)}`);
  }
}
function buildParameterInfo(cdi3) {
  const groups = /* @__PURE__ */ new Map();
  for (const group of cdi3?.ParameterGroups ?? []) {
    if (group.Id) groups.set(group.Id, group.Name ?? "");
  }
  return (cdi3?.Parameters ?? []).filter((parameter) => Boolean(parameter.Id)).map((parameter) => ({
    id: parameter.Id,
    name: parameter.Name ?? "",
    groupId: parameter.GroupId ?? "",
    groupName: parameter.GroupId ? groups.get(parameter.GroupId) ?? "" : ""
  }));
}
function ruleForTarget(target, mode, scale, min, max) {
  return target ? { target, mode, scale, min, max } : void 0;
}
function ruleForTargets(targets, mode, scale, min, max) {
  const uniqueTargets = unique(targets);
  return uniqueTargets.length ? { targets: uniqueTargets, mode, scale, min, max } : void 0;
}
function sanitizePrivateEmotionMap(value, allowedTargets, fallback, source, blockedTargets = /* @__PURE__ */ new Set()) {
  const result = { ...fallback };
  if (!value || typeof value !== "object" || Array.isArray(value)) return result;
  for (const [rawKey, rawMapping] of Object.entries(value)) {
    const key = rawKey.trim().slice(0, 80);
    if (!key) continue;
    if (rawMapping === null) {
      delete result[key];
      continue;
    }
    const mapping = sanitizePrivateEmotionMapping(rawMapping, allowedTargets, source, blockedTargets);
    if (mapping) result[key] = mapping;
  }
  return result;
}
function sanitizePrivateEmotionMapping(value, allowedTargets, source, blockedTargets) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return void 0;
  const record = value;
  const target = typeof record.target === "string" && allowedTargets.has(record.target) && !blockedTargets.has(record.target) ? record.target : void 0;
  const targets = Array.isArray(record.targets) ? unique(record.targets.filter((entry) => typeof entry === "string" && allowedTargets.has(entry) && !blockedTargets.has(entry))) : [];
  if (!target && targets.length === 0) return void 0;
  const category = isPrivateEmotionCategory(record.category) ? record.category : void 0;
  const emotions = Array.isArray(record.emotions) ? unique(record.emotions.filter((emotion) => typeof emotion === "string" && Boolean(emotion.trim())).map((emotion) => emotion.trim().slice(0, 48))).slice(0, 16) : [];
  const vadRange = sanitizePrivateEmotionVADRange(record.vadRange);
  const triggerMode = record.triggerMode === "all" ? "all" : record.triggerMode === "any" ? "any" : void 0;
  const activeValue = finiteOptionalNumber(record.activeValue);
  const neutralValue = finiteOptionalNumber(record.neutralValue);
  const intensity = boundedOptionalNumber(record.intensity, 0, 1);
  const priority = boundedOptionalNumber(record.priority, -1e3, 1e3);
  const exclusiveGroup = typeof record.exclusiveGroup === "string" && record.exclusiveGroup.trim() ? record.exclusiveGroup.trim().slice(0, 80) : void 0;
  const confidence = boundedOptionalNumber(record.confidence, 0, 1) ?? (source === "llm" ? 0.65 : source === "manual" ? 1 : 0.8);
  return {
    ...target ? { target } : {},
    ...targets.length ? { targets } : {},
    category: category ?? "privateEffect",
    ...emotions.length ? { emotions } : {},
    ...vadRange ? { vadRange } : {},
    ...triggerMode ? { triggerMode } : {},
    ...activeValue !== void 0 ? { activeValue } : {},
    ...neutralValue !== void 0 ? { neutralValue } : {},
    ...intensity !== void 0 ? { intensity } : {},
    ...priority !== void 0 ? { priority } : {},
    ...exclusiveGroup ? { exclusiveGroup } : {},
    source,
    confidence
  };
}
function sanitizePrivateEmotionVADRange(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return void 0;
  const record = value;
  const result = {};
  for (const axis of ["valence", "arousal", "dominance"]) {
    const pair = finiteNumberPair(record[axis]);
    if (!pair) continue;
    const first = Math.max(-1, Math.min(1, pair[0]));
    const second = Math.max(-1, Math.min(1, pair[1]));
    result[axis] = [Math.min(first, second), Math.max(first, second)];
  }
  return Object.keys(result).length ? result : void 0;
}
function isPrivateEmotionCategory(value) {
  return [
    "positiveEye",
    "blush",
    "tear",
    "shadow",
    "anger",
    "sweat",
    "surprise",
    "privateEffect"
  ].includes(String(value));
}
function boundedOptionalNumber(value, min, max) {
  const number = finiteOptionalNumber(value);
  return number === void 0 ? void 0 : Math.max(min, Math.min(max, number));
}
function sanitizeRule(value, allowedTargets) {
  if (!value || typeof value !== "object") return void 0;
  const record = value;
  const target = typeof record.target === "string" && allowedTargets.has(record.target) ? record.target : void 0;
  const targets = Array.isArray(record.targets) ? unique(record.targets.filter((item) => typeof item === "string" && allowedTargets.has(item))) : [];
  if (!target && targets.length === 0) return void 0;
  const mode = isBlendMode(record.mode) ? record.mode : "set";
  const scale = finiteNumber(record.scale, 1);
  const offset = finiteOptionalNumber(record.offset);
  const min = finiteOptionalNumber(record.min);
  const max = finiteOptionalNumber(record.max);
  const curve = isCurve(record.curve) ? record.curve : void 0;
  const gamma = typeof record.gamma === "number" && Number.isFinite(record.gamma) && record.gamma > 0 ? record.gamma : void 0;
  const deadzone = typeof record.deadzone === "number" && Number.isFinite(record.deadzone) && record.deadzone >= 0 ? record.deadzone : void 0;
  const inputRange = finiteNumberPair(record.inputRange);
  const outputRange = finiteNumberPair(record.outputRange);
  const invertAround = finiteOptionalNumber(record.invertAround);
  return {
    ...target ? { target } : {},
    ...targets.length ? { targets } : {},
    mode,
    scale,
    ...offset !== void 0 ? { offset } : {},
    ...min !== void 0 ? { min } : {},
    ...max !== void 0 ? { max } : {},
    ...curve !== void 0 ? { curve } : {},
    ...gamma !== void 0 ? { gamma } : {},
    ...deadzone !== void 0 ? { deadzone } : {},
    ...inputRange !== void 0 ? { inputRange } : {},
    ...outputRange !== void 0 ? { outputRange } : {},
    ...invertAround !== void 0 ? { invertAround } : {}
  };
}
function sanitizeNumericRecord(value, allowedKeys) {
  if (!value || typeof value !== "object") return {};
  const result = {};
  for (const [key, raw] of Object.entries(value)) {
    if (allowedKeys.has(key) && typeof raw === "number" && Number.isFinite(raw)) {
      result[key] = raw;
    }
  }
  return result;
}
function isBlendMode(value) {
  return value === "set" || value === "add" || value === "subtract" || value === "inverse";
}
function isCurve(value) {
  return value === "linear" || value === "easeIn" || value === "easeOut" || value === "easeInOut" || value === "smoothstep";
}
function isMotionPriority(value) {
  return value === "idle" || value === "normal" || value === "force";
}
function finiteOptionalNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : void 0;
}
function finiteNumberPair(value) {
  if (!Array.isArray(value) || value.length !== 2) return void 0;
  const first = finiteOptionalNumber(value[0]);
  const second = finiteOptionalNumber(value[1]);
  return first !== void 0 && second !== void 0 ? [first, second] : void 0;
}
function emptyCapabilities() {
  return {
    headControl: false,
    bodyControl: false,
    eyeBlink: false,
    eyeSmile: false,
    gazeControl: false,
    mouthOpen: false,
    mouthSmile: false,
    browControl: false,
    blush: false,
    tear: false,
    sweat: false,
    breath: false
  };
}
function sanitizeModelDir(input) {
  const normalized = input.trim() || "lilyabee";
  if (!/^[a-zA-Z0-9_-]+$/u.test(normalized)) {
    throw new Error("modelDir may only contain letters, numbers, underscore, and dash");
  }
  return normalized;
}
function sanitizeId(input) {
  return input.replace(/[^a-zA-Z0-9_-]/gu, "_").toLowerCase();
}
function normalizeRelativeFile(input) {
  return input.replace(/\\/gu, "/").replace(/^\/+/u, "");
}
function resolveModelFile(directoryPath, relativeFile) {
  const resolved = path.resolve(directoryPath, normalizeRelativeFile(relativeFile));
  if (!isInside(directoryPath, resolved)) {
    throw new Error(`Model file reference escapes its model directory: ${relativeFile}`);
  }
  return resolved;
}
function normalizeText(input) {
  return input.replace(/\s+/gu, "").replace(/[＿_\-　]/gu, "").toLowerCase();
}
function isMouthOpenLive2DParameter(parameter) {
  const idAndName = normalizeText(`${parameter.id} ${parameter.name}`);
  if ([
    "mouthform",
    "mouthshape",
    "lipshape",
    "lipform",
    "liptype",
    "\u5634\u578B",
    "\u53E3\u578B",
    "\u5507\u5F62",
    "\u5507\u578B"
  ].some((hint) => idAndName.includes(normalizeText(hint)))) return false;
  return [
    "mouthopen",
    "openmouth",
    "jawopen",
    "openjaw",
    "\u5634\u5F20\u5F00",
    "\u5F20\u5634",
    "\u5634\u5DF4\u5F00\u5408",
    "\u5634\u5F00\u5408",
    "\u53E3\u90E8\u5F00\u5408",
    "\u4E0B\u988C\u5F00\u5408"
  ].some((hint) => idAndName.includes(normalizeText(hint)));
}
function matchesSemanticNeedle(parameter, rawNeedle) {
  const needle = normalizeText(rawNeedle);
  if (!needle) return false;
  const fields = [parameter.id, parameter.name, parameter.groupName].filter(Boolean);
  if (/[^\u0000-\u007f]/u.test(needle)) {
    return fields.some((field) => normalizeText(field).includes(needle));
  }
  const needleTokens = semanticTokens(rawNeedle);
  return fields.some((field) => {
    const tokens = semanticTokens(field);
    return needleTokens.every((needleToken) => tokens.some((token) => token.startsWith(needleToken)));
  });
}
function matchesSelectorNeedle(parameter, rawNeedle) {
  const needle = normalizeText(rawNeedle);
  if (!needle) return false;
  const fields = [parameter.id, parameter.name, parameter.groupName].filter(Boolean);
  if (/^[a-z]$/u.test(needle)) {
    return fields.some((field) => semanticTokens(field).includes(needle));
  }
  return fields.some((field) => normalizeText(field).includes(needle));
}
function semanticTokens(input) {
  return input.replace(/([a-z0-9])([A-Z])/gu, "$1 $2").replace(/([A-Z]+)([A-Z][a-z])/gu, "$1 $2").toLowerCase().split(/[^a-z0-9]+/gu).filter(Boolean);
}
function toWebPath(input) {
  return input.replace(/\\/gu, "/");
}
function normalizeModelsBaseUrl(input) {
  const trimmed = input.trim();
  if (!trimmed || trimmed === "/") return "";
  return trimmed.replace(/\/+$/u, "");
}
function joinModelsUrl(baseUrl, ...segments) {
  const suffix = segments.map((segment) => segment.replace(/^\/+|\/+$/gu, "")).join("/");
  return `${baseUrl}/${suffix}`;
}
function isInside(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative);
}
function unique(values) {
  return [...new Set(values)];
}
function finiteNumber(value, fallback) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
function stringOr(value, fallback) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}
export {
  Live2DProfileAutoGenerator,
  STANDARD_PARAM_TABLE,
  profileGeneratorVersion,
  resolveStandard
};
//# sourceMappingURL=index.js.map