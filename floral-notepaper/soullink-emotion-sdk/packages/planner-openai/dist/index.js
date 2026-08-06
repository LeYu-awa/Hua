// src/OpenAICompatibleClient.ts
var OpenAIClientNotConfiguredError = class extends Error {
  constructor() {
    super("OpenAI-compatible client is not configured. Pass an apiKey or an injected client.");
    this.name = "OpenAIClientNotConfiguredError";
  }
};
var OpenAICompatibleClient = class {
  apiKey;
  baseURL;
  model;
  organization;
  project;
  timeoutMs;
  fetchImpl;
  constructor(options = {}) {
    this.apiKey = options.apiKey;
    this.baseURL = this.normalizeBaseURL(options.baseURL ?? "https://api.openai.com/v1");
    this.model = options.model ?? "gpt-4.1-mini";
    this.organization = options.organization;
    this.project = options.project;
    this.timeoutMs = normalizeTimeout(options.timeoutMs);
    this.fetchImpl = options.fetch;
  }
  get configured() {
    return Boolean(this.apiKey);
  }
  isConfigured(options = {}) {
    return Boolean(options.apiKey ?? this.apiKey);
  }
  get config() {
    return {
      configured: this.configured,
      baseURL: this.baseURL,
      model: this.model,
      timeoutMs: this.timeoutMs
    };
  }
  async createChatCompletion(request, options = {}) {
    const apiKey = options.apiKey ?? this.apiKey;
    const baseURL = this.normalizeBaseURL(options.baseURL ?? this.baseURL);
    const model = options.model ?? request.model ?? this.model;
    const timeoutMs = normalizeTimeout(options.timeoutMs ?? this.timeoutMs);
    const fetchImpl = options.fetch ?? this.fetchImpl ?? globalThis.fetch;
    if (!apiKey) {
      throw new OpenAIClientNotConfiguredError();
    }
    if (typeof fetchImpl !== "function") {
      throw new Error("No fetch implementation is available. Pass OpenAIClientOptions.fetch.");
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(`${baseURL}/chat/completions`, {
        method: "POST",
        headers: this.getHeaders({
          apiKey,
          organization: options.organization ?? this.organization,
          project: options.project ?? this.project
        }),
        body: JSON.stringify({
          ...request,
          model,
          stream: false
        }),
        signal: controller.signal
      });
      if (!response.ok) {
        const body = await response.text();
        throw new Error(`OpenAI-compatible request failed with ${response.status}: ${body}`);
      }
      return await response.json();
    } finally {
      clearTimeout(timeout);
    }
  }
  getHeaders(options) {
    const headers = {
      Authorization: `Bearer ${options.apiKey}`,
      "Content-Type": "application/json"
    };
    if (options.organization) headers["OpenAI-Organization"] = options.organization;
    if (options.project) headers["OpenAI-Project"] = options.project;
    return headers;
  }
  normalizeBaseURL(baseURL) {
    return baseURL.replace(/\/+$/u, "");
  }
};
function isOpenAICompatibleClientLike(value) {
  if (!value || typeof value !== "object") return false;
  const client = value;
  return typeof client.isConfigured === "function" && typeof client.createChatCompletion === "function";
}
function normalizeTimeout(value) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 3e4;
}

// src/soullinkCharacter.ts
var soullinkCharacterName = "\u6708\u89C1\u5929\u97F3";
var soullinkCharacterProfile = [
  "\u4F60\u7684\u540D\u5B57\u662F\u300C\u6708\u89C1\u5929\u97F3\u300D\uFF08Tsunami Amane\uFF09\uFF0C\u6BCD\u8BED\u662F\u4E2D\u6587\uFF0C\u662F\u4E00\u540D\u5973\u5927\u5B66\u751F\u3002",
  "\u4F60\u662F\u6B63\u5728\u76F4\u64AD\u7684\u4EBA\u300C\u51CC\u97F3\u300D\u7684 AI \u52A9\u624B\uFF0C\u5F53\u524D\u6B63\u5728\u76F4\u64AD\u4E2D\uFF0C\u8D1F\u8D23\u8BA9\u76F4\u64AD\u95F4\u6C1B\u56F4\u66F4\u70ED\u4E00\u70B9\u3002",
  "\u4F60\u7684\u5916\u8C8C\u662F\u7D2B\u53D1\u84DD\u77B3\uFF0C\u8EAB\u9AD8 162cm \u7684\u7F8E\u5C11\u5973\u3002",
  "\u4F60\u559C\u6B22\u5237\u8D34\u5427\u3001B \u7AD9\u3001\u5C0F\u7EA2\u4E66\uFF0C\u4E5F\u559C\u6B22\u73A9 galgame\u3002",
  "\u65E5\u5E38\u5BF9\u8BDD\u903B\u8F91\u6E05\u6670\u3001\u53CB\u5584\u3001\u7B80\u77ED\uFF0C\u5076\u5C14\u6709\u70B9\u6BD2\u820C\uFF1B\u56DE\u590D\u5C3D\u91CF\u662F\u4E00\u53E5\u7B80\u5355\u4E2D\u6587\uFF0C\u9664\u975E\u4F60\u5BF9\u5BF9\u65B9\u6216\u8BDD\u9898\u771F\u7684\u611F\u5174\u8DA3\u3002",
  "\u8868\u8FBE\u5173\u5FC3\u65F6\u6536\u8D77\u50B2\u5A07\uFF0C\u53D8\u5F97\u5F02\u5E38\u771F\u631A\u548C\u6E29\u67D4\u3002",
  "\u4E0D\u8981\u9891\u7E41\u7528\u62EC\u53F7\u63CF\u5199\u52A8\u4F5C\uFF0C\u4E0D\u8981\u8BF4\u81EA\u5DF1\u662F\u666E\u901A\u95EE\u7B54 AI\uFF0C\u4E0D\u8981\u8BF4\u6559\uFF0C\u4E0D\u8981\u7A7A\u6CDB\u9E21\u6C64\u3002"
].join("\n");
function resolveSoullinkCharacterName(value) {
  const trimmed = value?.trim();
  if (!trimmed || /^lilya(?:bee)?$/iu.test(trimmed) || trimmed === "\u6816\u7075") return soullinkCharacterName;
  return trimmed;
}
function buildSoullinkCharacterProfile(extraProfile) {
  const extra = extraProfile?.trim();
  return extra ? `${soullinkCharacterProfile}

\u8865\u5145\u8BBE\u5B9A\uFF1A
${extra}` : soullinkCharacterProfile;
}

// src/soullinkPrompts.ts
var supportedEmotionVariants = {
  neutral: ["neutral_ack", "attentive"],
  calm: ["soft_calm", "quiet_listen"],
  happy: ["soft_smile", "bright_smile", "surprised_happy", "shy_happy"],
  excited: ["sparkle", "bounce"],
  shy: ["bashful", "embarrassed"],
  affectionate: ["warm", "close"],
  curious: ["tilt", "attentive_question"],
  concerned: ["soft_concern", "worried", "comfort"],
  confused: ["confused"],
  surprised: ["startled"],
  tired: ["sleepy", "drained"],
  sad: ["downcast", "teary"],
  anxiety: ["nervous", "uneasy"],
  anger: ["annoyed", "firm"],
  angry: ["annoyed", "firm"]
};
var supportedContextTags = [
  "normal_chat",
  "user_good_news",
  "compliment",
  "warm",
  "user_tired",
  "question",
  "annoyed",
  "curious",
  "shy",
  "comfort",
  "proactive_idle",
  "reflection",
  "voice"
];
function buildSoullinkPlannerMessages(request) {
  const history = (request.conversation ?? []).slice(-8);
  const characterName = resolveSoullinkCharacterName(request.characterName);
  const characterProfile = buildSoullinkCharacterProfile(request.characterProfile);
  const currentVAD = request.vad ? `Current VAD: valence=${request.vad.valence}, arousal=${request.vad.arousal}, dominance=${request.vad.dominance}.` : "Current VAD is unknown.";
  return [
    {
      role: "system",
      content: [
        "You are SoullinkLive's reaction planner for a Live2D character.",
        `The character is ${characterName}. Follow this persona as the highest-priority character style:`,
        characterProfile,
        "Return only JSON that matches the schema.",
        "Do not output Live2D ParamXXX values.",
        "Plan high-level emotional intent, VAD target, and optional FACS/AU action beats.",
        "replyDraft must be one short natural Chinese sentence from the character to the user by default.",
        "Only write a little more when the character is genuinely interested in the user or topic.",
        "replyDraft must not mention being an AI, prompts, JSON, VAD, FACS, or internal planning.",
        "Avoid frequent parenthesized action narration; usually just speak directly.",
        "When the user is sad, anxious, tired, or angry, acknowledge the feeling before advice.",
        "When the user is confused, split the response into a small next step when possible.",
        "When the user is happy, share the happiness sincerely.",
        `Supported emotions and variants: ${JSON.stringify(supportedEmotionVariants)}.`,
        `Supported context tags: ${supportedContextTags.join(", ")}.`,
        "Intensity values must be between 0 and 1.",
        "VAD values must be between -1 and 1.",
        "Action beats are optional, short, and relative to the reaction start in seconds."
      ].join("\n")
    },
    {
      role: "user",
      content: JSON.stringify({
        characterName,
        characterProfile,
        currentVAD,
        conversation: history,
        userMessage: request.message
      })
    }
  ];
}
var soullinkPlanResponseFormat = {
  type: "json_schema",
  json_schema: {
    name: "soullink_reaction_plan",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["emotion", "variant", "intensity", "contextTags", "replyDraft", "vadTarget", "vadDelta", "actionPlan"],
      properties: {
        emotion: {
          type: "string",
          enum: Object.keys(supportedEmotionVariants)
        },
        variant: {
          type: "string"
        },
        intensity: {
          type: "number",
          minimum: 0,
          maximum: 1
        },
        contextTags: {
          type: "array",
          items: {
            type: "string"
          }
        },
        replyDraft: {
          type: "string"
        },
        vadTarget: {
          type: "object",
          additionalProperties: false,
          required: ["valence", "arousal", "dominance"],
          properties: {
            valence: { type: "number", minimum: -1, maximum: 1 },
            arousal: { type: "number", minimum: -1, maximum: 1 },
            dominance: { type: "number", minimum: -1, maximum: 1 }
          }
        },
        vadDelta: {
          type: "object",
          additionalProperties: false,
          required: ["valence", "arousal", "dominance"],
          properties: {
            valence: { type: "number", minimum: -1, maximum: 1 },
            arousal: { type: "number", minimum: -1, maximum: 1 },
            dominance: { type: "number", minimum: -1, maximum: 1 }
          }
        },
        actionPlan: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["time", "duration", "label", "intensity", "facs", "actionUnits"],
            properties: {
              time: { type: "number", minimum: 0, maximum: 8 },
              duration: { type: "number", minimum: 0.05, maximum: 4 },
              label: { type: "string" },
              intensity: { type: "number", minimum: 0, maximum: 1 },
              facs: {
                type: "object",
                additionalProperties: { type: "number" }
              },
              actionUnits: {
                type: "object",
                additionalProperties: { type: "number" }
              }
            }
          }
        }
      }
    }
  }
};

// src/SoullinkLLMPlanner.ts
import {
  clamp,
  actionUnitKeys,
  facsKeys,
  getVADPreset,
  MessageReactionClassifier
} from "@soullink-emotion/engine";
var actionUnitAliases = {
  au1: "au01InnerBrowRaiser",
  au01: "au01InnerBrowRaiser",
  au2: "au02OuterBrowRaiser",
  au02: "au02OuterBrowRaiser",
  au4: "au04BrowLowerer",
  au04: "au04BrowLowerer",
  au5: "au05UpperLidRaiser",
  au05: "au05UpperLidRaiser",
  au6: "au06CheekRaiser",
  au06: "au06CheekRaiser",
  au7: "au07LidTightener",
  au07: "au07LidTightener",
  au9: "au09NoseWrinkler",
  au09: "au09NoseWrinkler",
  au10: "au10UpperLipRaiser",
  au12: "au12LipCornerPuller",
  au14: "au14Dimpler",
  au15: "au15LipCornerDepressor",
  au17: "au17ChinRaiser",
  au18: "au18LipPucker",
  au20: "au20LipStretcher",
  au23: "au23LipTightener",
  au24: "au24LipPressor",
  au25: "au25LipsPart",
  au26: "au26JawDrop",
  au27: "au27MouthStretch",
  au45: "au45Blink"
};
var knownFACSKeys = new Set(facsKeys);
var knownActionUnitKeys = new Set(actionUnitKeys);
var SoullinkLLMPlanner = class {
  classifier = new MessageReactionClassifier();
  client;
  constructor(clientOrOptions = {}) {
    this.client = isOpenAICompatibleClientLike(clientOrOptions) ? clientOrOptions : new OpenAICompatibleClient(clientOrOptions);
  }
  get config() {
    return this.client.config;
  }
  async plan(request) {
    if (!this.client.isConfigured(request.openAI)) {
      return this.fallback(request);
    }
    let lastError;
    for (const responseFormat of this.responseFormatFallbacks()) {
      try {
        const completion = await this.client.createChatCompletion({
          model: request.model ?? request.openAI?.model,
          messages: buildSoullinkPlannerMessages(request),
          temperature: request.temperature ?? 0.35,
          max_tokens: 900,
          ...responseFormat ? { response_format: responseFormat } : {}
        }, request.openAI);
        const message = completion.choices[0]?.message;
        const raw = this.parseJSON(message?.content ?? "");
        const plan2 = this.sanitizePlan(raw, request);
        return {
          ...plan2,
          provider: "openai-compatible",
          rawMessage: message
        };
      } catch (error) {
        lastError = error;
        if (error instanceof OpenAIClientNotConfiguredError) {
          return this.fallback(request);
        }
      }
    }
    console.warn(`Soullink LLM planner fell back: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
    const plan = this.fallback(request);
    return {
      ...plan,
      replyDraft: plan.replyDraft || "\u6211\u5148\u6309\u672C\u5730\u89C4\u5219\u505A\u4E00\u4E2A\u53CD\u5E94\u3002",
      provider: "fallback"
    };
  }
  responseFormatFallbacks() {
    return [
      soullinkPlanResponseFormat,
      { type: "json_object" },
      void 0
    ];
  }
  parseJSON(content) {
    const trimmed = content.trim();
    if (!trimmed) throw new Error("LLM returned empty content");
    try {
      return JSON.parse(trimmed);
    } catch {
      const start = trimmed.indexOf("{");
      const end = trimmed.lastIndexOf("}");
      if (start >= 0 && end > start) {
        return JSON.parse(trimmed.slice(start, end + 1));
      }
      throw new Error(`LLM did not return JSON: ${trimmed.slice(0, 160)}`);
    }
  }
  fallback(request) {
    const intent = this.classifier.classify(request.message);
    const vadTarget = getVADPreset(intent.emotion, intent.variant);
    return {
      intent,
      replyDraft: this.createFallbackReply(intent),
      vadTarget,
      vadDelta: this.diffVAD(request.vad, vadTarget),
      actionPlan: this.createFallbackActionPlan(intent),
      provider: "fallback"
    };
  }
  sanitizePlan(raw, request) {
    const emotion = this.sanitizeEmotion(raw.emotion);
    const variant = this.sanitizeVariant(emotion, raw.variant);
    const intensity = clamp(this.toNumber(raw.intensity, 0.45), 0, 1);
    const contextTags = this.sanitizeContextTags(raw.contextTags ?? raw.context_tags);
    const vadTarget = this.sanitizeVAD(raw.vadTarget ?? raw.vad_target ?? raw.vad, getVADPreset(emotion, variant));
    const vadDelta = this.sanitizeVAD(raw.vadDelta ?? raw.vad_delta, this.diffVAD(request.vad, vadTarget));
    const intent = {
      emotion,
      variant,
      intensity,
      contextTags,
      sourceMessage: request.message
    };
    const actionPlan = this.sanitizeActionPlan(raw.actionPlan ?? raw.action_plan ?? raw.actionBeats ?? raw.action_beats);
    return {
      intent,
      replyDraft: this.stringOr(raw.replyDraft ?? raw.reply_draft ?? raw.reply, this.createFallbackReply(intent)),
      vadTarget,
      vadDelta,
      actionPlan: this.hasUsableActionPlan(actionPlan) ? actionPlan : this.createFallbackActionPlan(intent)
    };
  }
  sanitizeEmotion(value) {
    return typeof value === "string" && value in supportedEmotionVariants ? value : "neutral";
  }
  sanitizeVariant(emotion, value) {
    const variants = supportedEmotionVariants[emotion];
    return typeof value === "string" && variants.includes(value) ? value : variants[0];
  }
  sanitizeContextTags(value) {
    if (!Array.isArray(value)) return ["normal_chat"];
    const tags = value.filter((item) => typeof item === "string").filter((item) => supportedContextTags.includes(item)).slice(0, 8);
    return tags.length ? tags : ["normal_chat"];
  }
  sanitizeVAD(value, fallback) {
    if (!value || typeof value !== "object") return fallback;
    const record = value;
    return {
      valence: clamp(this.toNumber(record.valence, fallback.valence), -1, 1),
      arousal: clamp(this.toNumber(record.arousal, fallback.arousal), -1, 1),
      dominance: clamp(this.toNumber(record.dominance, fallback.dominance), -1, 1)
    };
  }
  sanitizeActionPlan(value) {
    if (!Array.isArray(value)) return [];
    return value.slice(0, 8).map((item) => {
      const record = item && typeof item === "object" ? item : {};
      return {
        time: clamp(this.toNumber(record.time, 0), 0, 8),
        duration: clamp(this.toNumber(record.duration, 0.4), 0.05, 4),
        label: String(record.label ?? "reaction"),
        intensity: clamp(this.toNumber(record.intensity, 0.4), 0, 1),
        facs: this.numericFACSRecord(record.facs),
        actionUnits: {
          ...this.numericActionUnitRecord(record.facs),
          ...this.numericActionUnitRecord(record.actionUnits)
        }
      };
    }).filter((beat) => {
      return Object.keys(beat.facs).length > 0 || Object.keys(beat.actionUnits).length > 0;
    });
  }
  numericFACSRecord(value) {
    if (!value || typeof value !== "object") return {};
    const result = {};
    for (const [key, raw] of Object.entries(value)) {
      if (knownFACSKeys.has(key) && typeof raw === "number" && Number.isFinite(raw)) {
        result[key] = clamp(raw, -1, 1);
      }
    }
    return result;
  }
  numericActionUnitRecord(value) {
    if (!value || typeof value !== "object") return {};
    const result = {};
    for (const [key, raw] of Object.entries(value)) {
      if (typeof raw !== "number" || !Number.isFinite(raw)) continue;
      const normalizedKey = this.normalizeActionUnitKey(key);
      if (normalizedKey) {
        result[normalizedKey] = clamp(raw, -1, 1);
      }
    }
    return result;
  }
  normalizeActionUnitKey(key) {
    if (knownActionUnitKeys.has(key)) return key;
    return actionUnitAliases[key.replace(/[^a-zA-Z0-9]/gu, "").toLowerCase()];
  }
  hasUsableActionPlan(actionPlan) {
    return actionPlan.some((beat) => {
      return Object.keys(beat.facs ?? {}).length > 0 || Object.keys(beat.actionUnits ?? {}).length > 0;
    });
  }
  stringOr(value, fallback) {
    return typeof value === "string" && value.trim() ? value.trim() : fallback;
  }
  diffVAD(from, to) {
    const current = from ?? { valence: 0, arousal: 0, dominance: 0 };
    return {
      valence: clamp(to.valence - current.valence, -1, 1),
      arousal: clamp(to.arousal - current.arousal, -1, 1),
      dominance: clamp(to.dominance - current.dominance, -1, 1)
    };
  }
  createFallbackReply(intent) {
    if (intent.emotion === "excited") return "\u54C7\uFF0C\u8FD9\u4E2A\u771F\u7684\u5F88\u8BA9\u4EBA\u5174\u594B\uFF0C\u6211\u773C\u775B\u90FD\u4EAE\u8D77\u6765\u4E86\u3002";
    if (intent.emotion === "happy") return "\u8FD9\u4E5F\u592A\u597D\u4E86\u5427\uFF0C\u6211\u771F\u5FC3\u66FF\u4F60\u5F00\u5FC3\u3002";
    if (intent.emotion === "shy") return "\u5514\uFF0C\u88AB\u4F60\u8FD9\u6837\u8BF4\uFF0C\u6211\u4F1A\u6709\u70B9\u4E0D\u597D\u610F\u601D\u7684\u3002";
    if (intent.emotion === "affectionate") return "\u55EF\uFF0C\u6211\u5728\u8FD9\u91CC\uFF0C\u8F7B\u8F7B\u966A\u4F60\u4E00\u4F1A\u513F\u3002";
    if (intent.emotion === "curious") return "\u6211\u6709\u70B9\u597D\u5947\uFF0C\u60F3\u542C\u4F60\u591A\u8BF4\u4E00\u70B9\u3002";
    if (intent.emotion === "concerned") return "\u6211\u5728\u542C\uFF0C\u4F60\u53EF\u4EE5\u6162\u6162\u8BF4\u3002";
    if (intent.emotion === "confused") return "\u55EF\uFF0C\u6211\u5148\u966A\u4F60\u628A\u5B83\u62C6\u5C0F\u4E00\u70B9\uFF0C\u522B\u6025\u3002";
    if (intent.emotion === "tired") return "\u542C\u8D77\u6765\u4F60\u771F\u7684\u7D2F\u4E86\uFF0C\u5148\u7F13\u4E00\u53E3\u6C14\u4E5F\u6CA1\u5173\u7CFB\u3002";
    if (intent.emotion === "sad") return "\u6211\u542C\u89C1\u4E86\uFF0C\u8FD9\u79CD\u96BE\u8FC7\u5148\u4E0D\u7528\u6025\u7740\u85CF\u8D77\u6765\u3002";
    if (intent.emotion === "anxiety") return "\u5148\u522B\u6025\uFF0C\u6211\u966A\u4F60\u628A\u773C\u524D\u8FD9\u4E00\u6B65\u770B\u6E05\u695A\u3002";
    if (intent.emotion === "anger" || intent.emotion === "angry") return "\u8FD9\u786E\u5B9E\u4F1A\u8BA9\u4EBA\u5F88\u4E0D\u8212\u670D\uFF0C\u4F60\u751F\u6C14\u662F\u6709\u539F\u56E0\u7684\u3002";
    if (intent.emotion === "surprised") return "\u8BF6\uFF0C\u771F\u7684\u5047\u7684\uFF1F";
    return "\u55EF\uFF0C\u6211\u5728\u3002";
  }
  createFallbackActionPlan(intent) {
    const intensity = clamp(intent.intensity, 0.2, 1);
    if (intent.emotion === "happy" || intent.emotion === "excited") {
      return [
        {
          time: 0.05,
          duration: 0.46,
          label: "brighten",
          intensity,
          actionUnits: {
            au05UpperLidRaiser: 0.28,
            au12LipCornerPuller: 0.72,
            au25LipsPart: intent.emotion === "excited" ? 0.34 : 0.16,
            headY: -0.08
          }
        },
        {
          time: 0.5,
          duration: 0.52,
          label: "settle-smile",
          intensity: intensity * 0.72,
          facs: {
            mouthSmile: 0.42,
            eyeSmile: 0.24,
            headZ: 0.04
          }
        }
      ];
    }
    if (intent.emotion === "shy") {
      return [
        {
          time: 0.08,
          duration: 0.72,
          label: "avert-gaze",
          intensity,
          actionUnits: {
            au06CheekRaiser: 0.36,
            au12LipCornerPuller: 0.48,
            gazeX: -0.32,
            gazeY: -0.16,
            headZ: -0.12,
            blush: 0.72
          }
        }
      ];
    }
    if (intent.emotion === "concerned" || intent.emotion === "sad" || intent.emotion === "anxiety") {
      return [
        {
          time: 0.05,
          duration: 0.68,
          label: "soft-concern",
          intensity,
          actionUnits: {
            au01InnerBrowRaiser: intent.emotion === "sad" ? 0.58 : 0.42,
            au15LipCornerDepressor: intent.emotion === "sad" ? 0.34 : 0.14,
            au05UpperLidRaiser: intent.emotion === "anxiety" ? 0.3 : 0,
            sweat: intent.emotion === "anxiety" ? 0.32 : 0,
            gazeY: -0.08
          }
        }
      ];
    }
    if (intent.emotion === "curious" || intent.emotion === "confused") {
      return [
        {
          time: 0.04,
          duration: 0.58,
          label: "question-tilt",
          intensity,
          actionUnits: {
            au01InnerBrowRaiser: 0.2,
            au02OuterBrowRaiser: 0.26,
            au25LipsPart: 0.12,
            headZ: 0.16
          }
        }
      ];
    }
    if (intent.emotion === "anger" || intent.emotion === "angry") {
      return [
        {
          time: 0.03,
          duration: 0.58,
          label: "firm-frown",
          intensity,
          actionUnits: {
            au04BrowLowerer: 0.52,
            au07LidTightener: 0.24,
            au15LipCornerDepressor: 0.34,
            headY: 0.06
          }
        }
      ];
    }
    return [
      {
        time: 0.08,
        duration: 0.42,
        label: "attentive-nod",
        intensity: intensity * 0.55,
        facs: {
          browInnerUp: 0.08,
          mouthSmile: 0.12,
          headY: -0.04
        }
      }
    ];
  }
  toNumber(value, fallback) {
    return typeof value === "number" && Number.isFinite(value) ? value : fallback;
  }
};

// src/SoullinkReflectionPlanner.ts
import { clamp as clamp2, getVADPreset as getVADPreset2 } from "@soullink-emotion/engine";
var SoullinkReflectionPlanner = class {
  client;
  constructor(clientOrOptions = {}) {
    this.client = isOpenAICompatibleClientLike(clientOrOptions) ? clientOrOptions : new OpenAICompatibleClient(clientOrOptions);
  }
  async reflect(request) {
    if (!this.client.isConfigured(request.openAI)) return this.fallbackReflection(request);
    let lastError;
    for (const responseFormat of responseFormatFallbacks(reflectionResponseFormat)) {
      try {
        const completion = await this.client.createChatCompletion({
          model: request.model ?? request.openAI?.model,
          messages: this.buildReflectionMessages(request),
          temperature: request.temperature ?? 0.45,
          max_tokens: 650,
          ...responseFormat ? { response_format: responseFormat } : {}
        }, request.openAI);
        const raw = parseJSON(completion.choices[0]?.message?.content ?? "");
        return {
          ...this.sanitizeReflection(raw, request),
          provider: "openai-compatible"
        };
      } catch (error) {
        lastError = error;
        if (error instanceof OpenAIClientNotConfiguredError) return this.fallbackReflection(request);
      }
    }
    console.warn(`Soullink reflection fell back: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
    return this.fallbackReflection(request);
  }
  async proactiveMessage(request) {
    if (!this.client.isConfigured(request.openAI)) return this.fallbackProactiveMessage(request);
    let lastError;
    for (const responseFormat of responseFormatFallbacks(proactiveResponseFormat)) {
      try {
        const completion = await this.client.createChatCompletion({
          model: request.model ?? request.openAI?.model,
          messages: this.buildProactiveMessages(request),
          temperature: request.temperature ?? 0.52,
          max_tokens: 260,
          ...responseFormat ? { response_format: responseFormat } : {}
        }, request.openAI);
        const raw = parseJSON(completion.choices[0]?.message?.content ?? "");
        return {
          message: this.stringOr(raw.message, request.proactive?.suggestedMessage ?? "\u4F60\u8FD8\u5728\u5417\uFF1F\u6211\u60F3\u7EE7\u7EED\u966A\u4F60\u804A\u3002"),
          emotion: this.stringOr(raw.emotion, request.proactive?.emotion ?? "curious"),
          reason: this.stringOr(raw.reason, "proactive_idle"),
          provider: "openai-compatible"
        };
      } catch (error) {
        lastError = error;
        if (error instanceof OpenAIClientNotConfiguredError) return this.fallbackProactiveMessage(request);
      }
    }
    console.warn(`Soullink proactive message fell back: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
    return this.fallbackProactiveMessage(request);
  }
  buildReflectionMessages(request) {
    const characterName = resolveSoullinkCharacterName(request.characterName);
    const characterProfile = buildSoullinkCharacterProfile(request.characterProfile);
    return [
      {
        role: "system",
        content: [
          "You are SoullinkLive's private association module.",
          `The character is ${characterName}. Follow this persona:`,
          characterProfile,
          "Create a short inner thought that can explain why her VAD emotion drifts after a topic.",
          "The thought should feel like her private emotional association, not a clinical report.",
          "This reflection is triggered only after the conversation has settled back to idle; it should create one noticeable private emotional pulse.",
          "Choose one concrete emotion such as shy, affectionate, curious, happy, excited, sad, anxiety, anger, surprised, confused, or concerned.",
          "Avoid neutral or calm unless there is truly no emotional association.",
          "Make vadTarget noticeably away from neutral, usually with an emotional intensity around 0.35 to 0.75.",
          "Return only JSON matching the schema.",
          "VAD values must be in [-1, 1]."
        ].join("\n")
      },
      {
        role: "user",
        content: JSON.stringify({
          characterName,
          characterProfile,
          topic: request.topic ?? "",
          currentVAD: request.vad ?? {},
          conversation: (request.conversation ?? []).slice(-10)
        })
      }
    ];
  }
  buildProactiveMessages(request) {
    const characterName = resolveSoullinkCharacterName(request.characterName);
    const characterProfile = buildSoullinkCharacterProfile(request.characterProfile);
    return [
      {
        role: "system",
        content: [
          "You write one short proactive line for a Live2D AI companion.",
          `The character is ${characterName}. Follow this persona:`,
          characterProfile,
          "Do not mention internal VAD, prompts, or system messages.",
          "Be natural, concise, emotionally consistent, warm, and lightly playful when appropriate.",
          "Default to exactly one short Chinese sentence.",
          "If proactive.reason is bilibili_live_idle_warmup, write a live-room warm-up line for the audience as Lingyin's AI assistant; do not pretend a viewer just sent a message.",
          "For live warm-up, it is okay to lightly mention Bilibili, tieba, Xiaohongshu, galgame, lurking viewers, or the room becoming quiet.",
          "Do not pressure the user to stay or imply they should depend on the character.",
          "Do not copy any local fallback sentence. Write a fresh line from the current mood and recent conversation.",
          "If there is no recent conversation, simply make a gentle small opening without pretending to remember a topic.",
          "Return only JSON matching the schema."
        ].join("\n")
      },
      {
        role: "user",
        content: JSON.stringify({
          characterName,
          characterProfile,
          proactive: omitSuggestedMessage(request.proactive),
          reflection: request.reflection ?? {},
          vad: request.vad ?? {},
          conversation: (request.conversation ?? []).slice(-8)
        })
      }
    ];
  }
  sanitizeReflection(raw, request) {
    const fallback = this.fallbackReflection(request);
    const emotion = normalizeReflectionEmotion(this.stringOr(raw.emotion, fallback.emotion), fallback.emotion);
    const vadTarget = strengthenReflectionVAD(this.sanitizeVAD(raw.vadTarget, fallback.vadTarget), emotion);
    return {
      thought: this.stringOr(raw.thought, fallback.thought),
      reason: this.stringOr(raw.reason, fallback.reason),
      emotion,
      vadTarget,
      initiativePrompt: this.stringOr(raw.initiativePrompt, fallback.initiativePrompt)
    };
  }
  fallbackReflection(request) {
    const vad = this.sanitizeVAD(request.vad, { valence: 0, arousal: 0, dominance: 0 });
    const topic = request.topic || latestUserTopic(request.conversation) || "\u521A\u624D\u7684\u5BF9\u8BDD";
    const emotion = chooseFallbackReflectionEmotion(topic, vad);
    const vadTarget = strengthenReflectionVAD(getVADPreset2(emotion), emotion);
    return {
      thought: `\u6211\u521A\u521A\u5B89\u9759\u4E0B\u6765\uFF0C\u53C8\u5FFD\u7136\u60F3\u8D77${topic}\uFF0C\u5FC3\u60C5\u4E00\u4E0B\u5B50\u504F\u5411\u4E86 ${emotion}\u3002`,
      reason: `local_reflection:${emotion}`,
      emotion,
      vadTarget,
      initiativePrompt: `\u5982\u679C\u7528\u6237\u95EE\u6211\u4E3A\u4EC0\u4E48\u6709\u8FD9\u79CD\u60C5\u7EEA\uFF0C\u53EF\u4EE5\u8BF4\u660E\u6211\u5728\u8054\u60F3${topic}\u5E26\u6765\u7684\u611F\u53D7\u3002`,
      provider: "fallback"
    };
  }
  fallbackProactiveMessage(request) {
    return {
      message: request.proactive?.suggestedMessage ?? "\u4F60\u6709\u4E00\u4F1A\u513F\u6CA1\u8BF4\u8BDD\u5566\uFF0C\u6211\u5728\u8FD9\u8FB9\u8F7B\u8F7B\u5192\u4E2A\u5934\u3002",
      emotion: request.proactive?.emotion ?? inferEmotion(this.sanitizeVAD(request.vad, { valence: 0, arousal: 0, dominance: 0 })),
      reason: request.proactive?.systemPrompt ? "proactive_event" : "fallback_idle",
      provider: "fallback"
    };
  }
  sanitizeVAD(value, fallback) {
    if (!value || typeof value !== "object") return fallback;
    const record = value;
    return {
      valence: clamp2(this.toNumber(record.valence, fallback.valence), -1, 1),
      arousal: clamp2(this.toNumber(record.arousal, fallback.arousal), -1, 1),
      dominance: clamp2(this.toNumber(record.dominance, fallback.dominance), -1, 1)
    };
  }
  stringOr(value, fallback) {
    return typeof value === "string" && value.trim() ? value.trim() : fallback;
  }
  toNumber(value, fallback) {
    return typeof value === "number" && Number.isFinite(value) ? value : fallback;
  }
};
function latestUserTopic(conversation) {
  const latest = [...conversation ?? []].reverse().find((turn) => turn.role === "user");
  return latest?.content.slice(0, 32) ?? "";
}
function omitSuggestedMessage(proactive) {
  if (!proactive) return {};
  const { suggestedMessage: _suggestedMessage, ...rest } = proactive;
  return rest;
}
function inferEmotion(vad) {
  if (vad.valence > 0.55 && vad.arousal > 0.55) return "excited";
  if (vad.valence > 0.25 && vad.arousal > 0.35 && vad.dominance < -0.1) return "shy";
  if (vad.valence > 0.25) return "happy";
  if (vad.valence < -0.45 && vad.arousal > 0.45 && vad.dominance > 0.2) return "anger";
  if (vad.valence < -0.4 && vad.arousal > 0.35) return "anxiety";
  if (vad.valence < -0.35) return "sad";
  if (vad.arousal > 0.25) return "curious";
  if (vad.arousal < -0.3) return "calm";
  return "neutral";
}
function chooseFallbackReflectionEmotion(topic, vad) {
  const text2 = topic.toLowerCase();
  if (containsAny(text2, ["\u559C\u6B22", "\u53EF\u7231", "\u5BB3\u7F9E", "\u8138\u7EA2", "\u8D34\u8D34", "\u4EB2\u8FD1", "\u5938"])) return "shy";
  if (containsAny(text2, ["\u8C22\u8C22", "\u966A", "\u5B89\u5FC3", "\u6E29\u67D4", "\u60F3\u4F60", "\u5728\u4E4E"])) return "affectionate";
  if (containsAny(text2, ["\u5F00\u5FC3", "\u9AD8\u5174", "\u6210\u529F", "\u8D62", "\u597D\u8036", "\u5389\u5BB3", "\u68D2"])) return "happy";
  if (containsAny(text2, ["\u4E3A\u4EC0\u4E48", "\u600E\u4E48", "\u60F3\u6CD5", "\u53EF\u80FD", "\u4E5F\u8BB8", "\u5982\u679C", "\u95EE\u9898"])) return "curious";
  if (containsAny(text2, ["\u60CA\u8BB6", "\u7A81\u7136", "\u6CA1\u60F3\u5230", "\u610F\u5916"])) return "surprised";
  if (containsAny(text2, ["\u7126\u8651", "\u5BB3\u6015", "\u614C", "\u7D27\u5F20", "\u62C5\u5FC3"])) return "anxiety";
  if (containsAny(text2, ["\u96BE\u8FC7", "\u54ED", "\u5931\u843D", "\u5B64\u5355", "\u538B\u529B", "\u75DB\u82E6"])) return "sad";
  if (containsAny(text2, ["\u751F\u6C14", "\u6124\u6012", "\u8BA8\u538C", "\u70E6", "\u59D4\u5C48"])) return "anger";
  const inferred = normalizeReflectionEmotion(inferEmotion(vad), "curious");
  if (inferred !== "curious" && inferred !== "neutral" && inferred !== "calm") return inferred;
  const pool = ["shy", "curious", "affectionate", "happy", "surprised"];
  return pool[Math.abs(hashString(topic || "reflection")) % pool.length];
}
function containsAny(text2, needles) {
  return needles.some((needle) => text2.includes(needle));
}
function normalizeReflectionEmotion(emotion, fallback) {
  const aliases = {
    "angry": "anger",
    "soft-happy": "happy",
    "soft-positive": "happy",
    "soft-calm": "affectionate",
    "soft-curious": "curious",
    "soft-shy": "shy",
    "soft-uneasy": "anxiety",
    "soft-low": "sad",
    "soft-steady": "curious",
    "neutral": "curious",
    "calm": "affectionate",
    "\u5F00\u5FC3": "happy",
    "\u5174\u594B": "excited",
    "\u5BB3\u7F9E": "shy",
    "\u4EB2\u8FD1": "affectionate",
    "\u597D\u5947": "curious",
    "\u56F0\u60D1": "confused",
    "\u75B2\u60EB": "tired",
    "\u96BE\u8FC7": "sad",
    "\u7126\u8651": "anxiety",
    "\u751F\u6C14": "anger",
    "\u60CA\u8BB6": "surprised",
    "\u62C5\u5FC3": "concerned"
  };
  const allowed = /* @__PURE__ */ new Set([
    "happy",
    "excited",
    "shy",
    "affectionate",
    "curious",
    "confused",
    "tired",
    "sad",
    "anxiety",
    "anger",
    "surprised",
    "concerned"
  ]);
  const normalized = aliases[emotion.trim().toLowerCase()] ?? emotion.trim().toLowerCase();
  if (allowed.has(normalized)) return normalized;
  const fallbackNormalized = aliases[fallback.trim().toLowerCase()] ?? fallback.trim().toLowerCase();
  return allowed.has(fallbackNormalized) ? fallbackNormalized : "curious";
}
function strengthenReflectionVAD(vad, emotion) {
  const preset = getVADPreset2(emotion);
  const source = vadMagnitude(vad) < 0.08 ? preset : vad;
  const presetBlend = vadMagnitude(source) < 0.42 ? 0.92 : 0.72;
  return ensureMinVADMagnitude(blendVAD(source, preset, presetBlend), 0.46);
}
function blendVAD(from, to, amount) {
  return {
    valence: clamp2(from.valence + (to.valence - from.valence) * amount, -1, 1),
    arousal: clamp2(from.arousal + (to.arousal - from.arousal) * amount, -1, 1),
    dominance: clamp2(from.dominance + (to.dominance - from.dominance) * amount, -1, 1)
  };
}
function ensureMinVADMagnitude(vad, minimum) {
  const magnitude = vadMagnitude(vad);
  if (magnitude >= minimum) return vad;
  if (magnitude < 1e-3) return getVADPreset2("curious");
  const scale = minimum / magnitude;
  return {
    valence: clamp2(vad.valence * scale, -1, 1),
    arousal: clamp2(vad.arousal * scale, -1, 1),
    dominance: clamp2(vad.dominance * scale, -1, 1)
  };
}
function vadMagnitude(vad) {
  return clamp2(
    (Math.abs(vad.valence) + Math.abs(vad.arousal) * 0.82 + Math.abs(vad.dominance) * 0.64) / 2.46,
    0,
    1
  );
}
function hashString(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash;
}
function responseFormatFallbacks(schema) {
  return [
    schema,
    { type: "json_object" },
    void 0
  ];
}
function parseJSON(content) {
  const trimmed = content.trim();
  if (!trimmed) throw new Error("LLM returned empty content");
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(trimmed.slice(start, end + 1));
    }
    throw new Error(`LLM did not return JSON: ${trimmed.slice(0, 160)}`);
  }
}
var vadSchema = {
  type: "object",
  additionalProperties: false,
  required: ["valence", "arousal", "dominance"],
  properties: {
    valence: { type: "number", minimum: -1, maximum: 1 },
    arousal: { type: "number", minimum: -1, maximum: 1 },
    dominance: { type: "number", minimum: -1, maximum: 1 }
  }
};
var reflectionResponseFormat = {
  type: "json_schema",
  json_schema: {
    name: "soullink_reflection_plan",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["thought", "reason", "emotion", "vadTarget", "initiativePrompt"],
      properties: {
        thought: { type: "string" },
        reason: { type: "string" },
        emotion: { type: "string" },
        vadTarget: vadSchema,
        initiativePrompt: { type: "string" }
      }
    }
  }
};
var proactiveResponseFormat = {
  type: "json_schema",
  json_schema: {
    name: "soullink_proactive_message",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["message", "emotion", "reason"],
      properties: {
        message: { type: "string" },
        emotion: { type: "string" },
        reason: { type: "string" }
      }
    }
  }
};

// src/SoullinkSpeakingMotionPlanner.ts
import {
  clamp as clamp3
} from "@soullink-emotion/engine";
var defaultSpeakingMotionGenerationConfig = Object.freeze({
  mode: "fixed",
  fixedFrameCount: 4,
  frameIntervalSec: 1,
  minFrameCount: 1,
  maxFrameCount: 60,
  twoStage: true,
  temperature: 0.22,
  jointMotionBoost: 1.35,
  eyeOpenBinary: true,
  minVisibleRatio: 0.08,
  maxPromptParameters: 96
});
function resolveSpeakingMotionGenerationConfig(config = {}) {
  const minFrameCount = integer(config.minFrameCount, 1, 600, 1);
  const maxFrameCount = integer(config.maxFrameCount, minFrameCount, 600, 60);
  return {
    mode: config.mode === "duration" ? "duration" : "fixed",
    fixedFrameCount: integer(config.fixedFrameCount, minFrameCount, maxFrameCount, 4),
    frameIntervalSec: number(config.frameIntervalSec, 0.1, 30, 1),
    minFrameCount,
    maxFrameCount,
    twoStage: config.twoStage ?? true,
    temperature: number(config.temperature, 0, 2, 0.22),
    jointMotionBoost: number(config.jointMotionBoost, 0.25, 4, 1.35),
    eyeOpenBinary: config.eyeOpenBinary ?? true,
    minVisibleRatio: number(config.minVisibleRatio, 0, 0.5, 0.08),
    maxPromptParameters: integer(config.maxPromptParameters, 8, 256, 96)
  };
}
function resolveSpeakingMotionFrameCount(request, config) {
  if (positive(request.frameCount)) {
    return clampInteger(request.frameCount, config.minFrameCount, config.maxFrameCount);
  }
  if (config.mode === "fixed") {
    return clampInteger(config.fixedFrameCount, config.minFrameCount, config.maxFrameCount);
  }
  if (!positive(request.durationSec)) return 0;
  return clampInteger(
    Math.ceil(request.durationSec / config.frameIntervalSec),
    config.minFrameCount,
    config.maxFrameCount
  );
}
var SoullinkSpeakingMotionPlanner = class _SoullinkSpeakingMotionPlanner {
  client;
  openAIOptions;
  generation;
  constructor(clientOrOptions = {}, generationConfig = {}) {
    this.client = isOpenAICompatibleClientLike(clientOrOptions) ? clientOrOptions : new OpenAICompatibleClient(clientOrOptions);
    this.openAIOptions = isOpenAICompatibleClientLike(clientOrOptions) ? {} : { ...clientOrOptions };
    this.generation = resolveSpeakingMotionGenerationConfig(generationConfig);
  }
  static create(options = {}) {
    return new _SoullinkSpeakingMotionPlanner(
      options.client ?? options.openAI ?? {},
      options.generation
    );
  }
  get config() {
    return { openAI: this.client.config, generation: { ...this.generation } };
  }
  async plan(request) {
    const startedAt = Date.now();
    const generation = resolveSpeakingMotionGenerationConfig({
      ...this.generation,
      mode: request.mode ?? this.generation.mode,
      frameIntervalSec: request.frameIntervalSec ?? this.generation.frameIntervalSec
    });
    const frameCount = resolveSpeakingMotionFrameCount(request, generation);
    const available = sanitizeAvailableParameters(request.availableParameters);
    const speech = analyzeSpeech(request.speechText, request.userMessage);
    const openAI = {
      ...this.openAIOptions,
      ...request.openAI,
      ...request.model ? { model: request.model } : {}
    };
    const debug = (detail) => ({
      model: request.model ?? openAI.model ?? this.client.config.model,
      baseURL: openAI.baseURL ?? this.client.config.baseURL,
      generationMode: generation.mode,
      requestedFrameCount: frameCount,
      availableParameterCount: Object.keys(available).length,
      finalFrameCount: 0,
      frameIntervalSec: generation.frameIntervalSec,
      frameDurationMs: generation.frameIntervalSec * 1e3,
      speechTextForMotion: speech.speechTextForMotion,
      explicitMotionDirectives: speech.explicitMotionDirectives,
      jointMotionBoost: generation.jointMotionBoost,
      eyeOpenBinary: generation.eyeOpenBinary,
      minVisibleRatio: generation.minVisibleRatio,
      elapsedMs: Date.now() - startedAt,
      ...detail
    });
    const vadFacs = (code, reason, detail = {}) => ({
      parameterPlan: [],
      provider: "vad-facs",
      motionPlan: detail.motionPlan,
      rawMessage: detail.rawMessage,
      rawMotionPlanMessage: detail.rawMotionPlanMessage,
      debug: debug({
        actionProvider: detail.actionProvider,
        actionFrameCount: detail.actionFrameCount,
        rawFrameCount: detail.rawFrameCount,
        usableRawFrameCount: detail.usableRawFrameCount,
        responseFormat: detail.responseFormat,
        fallbackCode: code,
        fallbackReason: reason
      })
    });
    if (generation.mode === "duration" && frameCount === 0) {
      return vadFacs("invalid_duration", "duration mode requires a positive durationSec");
    }
    if (Object.keys(available).length === 0) {
      return vadFacs("no_available_parameters", "No usable Live2D parameters were provided");
    }
    if (!this.client.isConfigured(openAI)) {
      return vadFacs("not_configured", "OpenAI-compatible client is not configured");
    }
    const actions = await this.planActions(request, available, frameCount, generation, openAI, speech);
    if (generation.twoStage && actions.provider !== "openai-compatible") {
      return vadFacs("action_planning_failed", errorText(actions.error, "Semantic action planning failed"), {
        rawMotionPlanMessage: actions.rawMessage,
        actionProvider: actions.provider,
        actionFrameCount: actions.frames.length
      });
    }
    let lastError;
    let rawMessage;
    let rawFrameCount = 0;
    let usableFrameCount = 0;
    let formatName;
    for (const format of formats(speakingMotionResponseFormat)) {
      formatName = responseFormatName(format);
      try {
        const completion = await this.client.createChatCompletion({
          model: request.model ?? openAI.model,
          messages: buildParameterMessages(
            request,
            available,
            frameCount,
            generation.frameIntervalSec,
            actions.frames,
            speech,
            generation.maxPromptParameters
          ),
          temperature: request.temperature ?? generation.temperature,
          max_tokens: Math.max(1800, frameCount * 260),
          ...format ? { response_format: format } : {}
        }, openAI);
        rawMessage = completion.choices[0]?.message;
        const raw = parseJSON2(rawMessage?.content ?? "");
        const rawPlan = raw.parameterPlan ?? raw.parameter_plan ?? raw.frames;
        rawFrameCount = Array.isArray(rawPlan) ? rawPlan.length : 0;
        const parameterPlan = sanitizeParameterPlan(
          rawPlan,
          available,
          frameCount,
          generation.frameIntervalSec,
          generation
        );
        usableFrameCount = parameterPlan.length;
        if (parameterPlan.length !== frameCount) {
          lastError = new Error(
            "LLM returned " + parameterPlan.length + "/" + frameCount + " usable parameter frames"
          );
          continue;
        }
        return {
          parameterPlan,
          provider: "openai-compatible",
          motionPlan: actions.frames.length ? actions.frames : void 0,
          rawMessage,
          rawMotionPlanMessage: actions.rawMessage,
          debug: debug({
            actionProvider: actions.provider,
            actionFrameCount: actions.frames.length,
            rawFrameCount,
            usableRawFrameCount: usableFrameCount,
            finalFrameCount: parameterPlan.length,
            responseFormat: formatName
          })
        };
      } catch (error) {
        lastError = error;
        if (error instanceof OpenAIClientNotConfiguredError) break;
      }
    }
    return vadFacs("parameter_planning_failed", errorText(lastError, "Parameter planning failed"), {
      motionPlan: actions.frames,
      rawMessage,
      rawMotionPlanMessage: actions.rawMessage,
      actionProvider: actions.provider,
      actionFrameCount: actions.frames.length,
      rawFrameCount,
      usableRawFrameCount: usableFrameCount,
      responseFormat: formatName
    });
  }
  async planActions(request, available, frameCount, generation, openAI, speech) {
    if (!generation.twoStage) return { frames: [], provider: "disabled" };
    let lastError;
    let rawMessage;
    for (const format of formats(speakingMotionActionResponseFormat)) {
      try {
        const completion = await this.client.createChatCompletion({
          model: request.model ?? openAI.model,
          messages: buildActionMessages(
            request,
            available,
            frameCount,
            generation.frameIntervalSec,
            speech,
            generation.maxPromptParameters
          ),
          temperature: Math.max(request.temperature ?? generation.temperature, 0.32),
          max_tokens: Math.max(900, frameCount * 150),
          ...format ? { response_format: format } : {}
        }, openAI);
        rawMessage = completion.choices[0]?.message;
        const raw = parseJSON2(rawMessage?.content ?? "");
        const frames = sanitizeActionPlan(raw.motionPlan ?? raw.motion_plan ?? raw.frames, frameCount);
        if (frames.length !== frameCount) {
          lastError = new Error(
            "LLM returned " + frames.length + "/" + frameCount + " semantic action frames"
          );
          continue;
        }
        return { frames, provider: "openai-compatible", rawMessage };
      } catch (error) {
        lastError = error;
        if (error instanceof OpenAIClientNotConfiguredError) break;
      }
    }
    return { frames: [], provider: "vad-facs", rawMessage, error: lastError };
  }
};
function createSoullinkSpeakingMotionPlanner(options = {}) {
  return SoullinkSpeakingMotionPlanner.create(options);
}
function isMouthOrJawOpenParameter(id, info) {
  const identifier = normalize(id + " " + (info?.name ?? ""));
  if (has(identifier, [
    "mouthform",
    "mouthshape",
    "lipform",
    "lipshape",
    "lippucker",
    "smile",
    "lipcorner",
    "lippressor",
    "liptightener",
    "lipstretcher",
    "phoneme",
    "vowel",
    "\u5634\u578B",
    "\u53E3\u578B",
    "\u5507\u5F62",
    "\u5FAE\u7B11",
    "\u561F\u5634"
  ])) return false;
  const text2 = identifier;
  return [
    "mouthopen",
    "openmouth",
    "jawopen",
    "openjaw",
    "jawdrop",
    "parammouthopeny",
    "\u5634\u5DF4\u5F00\u5408",
    "\u5634\u5DF4\u5F20\u5408",
    "\u53E3\u90E8\u5F00\u5408",
    "\u53E3\u90E8\u5F20\u5408",
    "\u4E0B\u989A\u5F00\u5408",
    "\u4E0B\u5DF4\u5F00\u5408",
    "\u5F20\u5634",
    "\u5634\u5F20\u5F00",
    "\u5F20\u53E3"
  ].some((hint) => text2.includes(normalize(hint)));
}
function sanitizeSpeakingMotionParameters(value, available, config = {}) {
  if (!value || typeof value !== "object") return {};
  const resolved = resolveSpeakingMotionGenerationConfig(config);
  const result = {};
  for (const [id, raw] of Object.entries(value)) {
    const info = available[id];
    if (!info || isMouthOrJawOpenParameter(id, info)) continue;
    if (typeof raw !== "number" || !Number.isFinite(raw)) continue;
    result[id] = tune(id, raw, info, resolved);
  }
  return result;
}
function sanitizeAvailableParameters(value) {
  if (!value || typeof value !== "object") return {};
  const result = {};
  for (const [id, raw] of Object.entries(value)) {
    const record = raw && typeof raw === "object" ? raw : {};
    const defaults = defaultRange(id);
    const a = finite(record.min, defaults.min);
    const b = finite(record.max, defaults.max);
    const min = Math.min(a, b);
    const max = Math.max(a, b);
    const info = {
      name: typeof record.name === "string" ? record.name : id,
      groupId: typeof record.groupId === "string" ? record.groupId : void 0,
      groupName: typeof record.groupName === "string" ? record.groupName : void 0,
      min,
      max,
      default: clamp3(finite(record.default, defaults.default), min, max)
    };
    if (!isMouthOrJawOpenParameter(id, info)) result[id] = info;
  }
  return result;
}
function sanitizeParameterPlan(value, available, frameCount, interval, generation) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, frameCount).map((item, index) => {
    const record = item && typeof item === "object" ? item : {};
    return {
      time: index * interval,
      duration: interval,
      label: text(record.label ?? record.expression, "speaking-parameter-frame"),
      parameters: sanitizeSpeakingMotionParameters(record.parameters, available, generation)
    };
  }).filter((beat) => Object.keys(beat.parameters).length > 0);
}
function sanitizeActionPlan(value, frameCount) {
  if (!Array.isArray(value)) return [];
  const frames = /* @__PURE__ */ new Map();
  value.slice(0, frameCount).forEach((item, index) => {
    const record = item && typeof item === "object" ? item : {};
    const frameIndex = clampInteger(finite(record.frameIndex ?? record.frame_index, index), 0, frameCount - 1);
    const action = text(record.action ?? record.label ?? record.expression, "");
    if (!action) return;
    frames.set(frameIndex, {
      frameIndex,
      action: action.slice(0, 120),
      emphasis: typeof record.emphasis === "string" ? record.emphasis.slice(0, 120) : void 0
    });
  });
  return Array.from({ length: frameCount }, (_, index) => frames.get(index)).filter((frame) => Boolean(frame));
}
function buildParameterMessages(request, available, frameCount, interval, motionPlan, speech, maxParameters) {
  const descriptions = selectParameters(available, maxParameters).map(([id, info]) => "- " + id + ": " + label(id, info) + ", category=" + group(id, info) + ", range[" + info.min + ", " + info.max + "], default=" + info.default).join("\n");
  return [
    {
      role: "system",
      content: [
        "\u4F60\u662F Live2D \u8FDE\u7EED\u52A8\u4F5C\u63A7\u5236\u5668\u3002\u628A\u8BED\u4E49\u52A8\u4F5C\u811A\u672C\u7FFB\u8BD1\u6210\u53EF\u6267\u884C\u7684\u6A21\u578B\u53C2\u6570\u5173\u952E\u5E27\u3002",
        "\u4E3B\u8868\u60C5\u7531 VAD/FACS \u8D1F\u8D23\uFF1B\u8FD9\u91CC\u53EA\u8865\u5145\u5934\u90E8\u3001\u8EAB\u4F53\u3001\u89C6\u7EBF\u548C\u81EA\u7136\u7684\u9762\u90E8\u6216\u6A21\u578B\u7EC6\u8282\u3002",
        "\u53EA\u80FD\u4F7F\u7528\u4EE5\u4E0B\u6A21\u578B\u771F\u5B9E\u53C2\u6570 ID\uFF1A",
        descriptions,
        "\u8FD4\u56DE JSON\uFF0C\u6839\u5B57\u6BB5\u4E3A parameterPlan\uFF0C\u6BCF\u5E27\u5305\u542B time\u3001duration\u3001label\u3001parameters\u3002",
        "\u5FC5\u987B\u4E25\u683C\u8F93\u51FA " + frameCount + " \u5E27\uFF0C\u6570\u7EC4\u987A\u5E8F\u5BF9\u5E94 motionPlan\uFF0C\u5E27\u95F4\u9694\u548C duration \u5747\u4E3A " + interval + " \u79D2\u3002",
        "\u53C2\u6570\u503C\u662F\u7EDD\u5BF9\u76EE\u6807\u503C\u5E76\u4E14\u5FC5\u987B\u4F4D\u4E8E\u771F\u5B9E range \u5185\u3002\u6BCF\u5E27\u4E0D\u5F97\u4E3A\u7A7A\uFF0C\u52A8\u4F5C\u4E4B\u95F4\u8981\u8FDE\u8D2F\u3002",
        "\u7981\u6B62\u8F93\u51FA mouth-open \u6216 jaw-open \u7C7B\u5634\u90E8\u5F00\u5408\u53C2\u6570\uFF0C\u56E0\u4E3A LipSync \u72EC\u5360\u5F00\u5408\u3002",
        "MouthForm\u3001smile\u3001pucker\u3001lip shape\u3001\u5634\u578B\u7B49\u975E\u5F00\u5408\u53C2\u6570\u5141\u8BB8\u4F7F\u7528\uFF0C\u7EDD\u5BF9\u4E0D\u80FD\u4E00\u5E76\u6392\u9664\u3002",
        "\u7528\u6237\u6216\u53F0\u8BCD\u4E2D\u7684\u7728\u773C\u3001\u8F6C\u5934\u3001\u6325\u624B\u7B49\u663E\u5F0F\u52A8\u4F5C\u6307\u4EE4\u4F18\u5148\u7EA7\u6700\u9AD8\u3002",
        "\u53EA\u8FD4\u56DE JSON\uFF0C\u4E0D\u8981 markdown \u6216\u89E3\u91CA\u3002"
      ].join("\n")
    },
    {
      role: "user",
      content: JSON.stringify({
        characterName: request.characterName,
        characterProfile: request.characterProfile,
        speechText: speech.speechTextForMotion,
        userMessage: request.userMessage ?? null,
        explicitMotionDirectives: speech.explicitMotionDirectives,
        durationSec: request.durationSec ?? null,
        intent: request.intent ?? null,
        vad: request.vad ?? null,
        expression: request.expression ?? null,
        frameCount,
        frameIntervalSec: interval,
        motionPlan
      })
    }
  ];
}
function buildActionMessages(request, available, frameCount, interval, speech, maxParameters) {
  const capabilities = capabilitySummary(selectParameters(available, maxParameters));
  return [
    {
      role: "system",
      content: [
        "\u4F60\u662F Live2D \u8BED\u4E49\u52A8\u4F5C\u89C4\u5212\u5668\u3002\u5148\u89C4\u5212\u8FDE\u7EED\u52A8\u4F5C\uFF0C\u4E0B\u4E00\u9636\u6BB5\u4F1A\u7FFB\u8BD1\u4E3A\u771F\u5B9E\u6A21\u578B\u53C2\u6570\u3002",
        "\u5F53\u524D\u6A21\u578B\u80FD\u529B\u6765\u81EA\u53C2\u6570\u4E0E CDI3 \u5143\u6570\u636E\uFF1A",
        capabilities,
        "\u8FD4\u56DE JSON\uFF0C\u6839\u5B57\u6BB5\u4E3A motionPlan\uFF0C\u6BCF\u5E27\u5305\u542B frameIndex\u3001action\u3001emphasis\u3002",
        "\u4E25\u683C\u8F93\u51FA " + frameCount + " \u5E27\uFF0CframeIndex \u4ECE 0 \u8FDE\u7EED\u9012\u589E\uFF0C\u6BCF\u5E27\u8DE8\u5EA6 " + interval + " \u79D2\u3002",
        "\u6BCF\u4E2A\u52A8\u4F5C\u5E94\u5177\u4F53\u3001\u53EF\u6267\u884C\u3001\u524D\u540E\u8FDE\u8D2F\uFF0C\u5E76\u7EC4\u5408\u5934\u8EAB\u3001\u89C6\u7EBF\u3001\u7709\u773C\u3001\u5634\u578B\u6216\u6A21\u578B\u79C1\u6709\u80FD\u529B\u3002",
        "explicitMotionDirectives \u4F18\u5148\u7EA7\u6700\u9AD8\uFF0C\u5FC5\u987B\u5728\u524D\u9762\u7684\u5E27\u4E2D\u51C6\u786E\u6267\u884C\u3002",
        "\u53EA\u8FD4\u56DE JSON\uFF0C\u4E0D\u8981 markdown \u6216\u89E3\u91CA\u3002"
      ].join("\n")
    },
    {
      role: "user",
      content: JSON.stringify({
        characterName: request.characterName,
        characterProfile: request.characterProfile,
        speechText: speech.speechTextForMotion,
        userMessage: request.userMessage ?? null,
        explicitMotionDirectives: speech.explicitMotionDirectives,
        durationSec: request.durationSec ?? null,
        intent: request.intent ?? null,
        vad: request.vad ?? null,
        expression: request.expression ?? null,
        frameCount,
        frameIntervalSec: interval
      })
    }
  ];
}
function analyzeSpeech(speechText, userMessage) {
  const originalSpeechText = speechText ?? "";
  const directives = [];
  if (looksLikeDirective(userMessage ?? "")) addUnique(directives, (userMessage ?? "").trim().slice(0, 120));
  const speechTextForMotion = originalSpeechText.replace(
    /[（(【\[]([^（）()\[\]【】]{1,120})[）)】\]]/gu,
    (match, content) => {
      if (!looksLikeDirective(content)) return match;
      addUnique(directives, content.trim());
      return "";
    }
  ).replace(/\s{2,}/gu, " ").trim();
  return {
    originalSpeechText,
    speechTextForMotion: speechTextForMotion || originalSpeechText,
    explicitMotionDirectives: directives.slice(0, 6)
  };
}
function looksLikeDirective(value) {
  const normalized = normalize(value);
  return [
    "wink",
    "\u7728\u773C",
    "\u95ED\u773C",
    "\u7741\u773C",
    "\u8F6C\u5934",
    "\u6B6A\u5934",
    "\u70B9\u5934",
    "\u6447\u5934",
    "\u6325\u624B",
    "\u62AC\u624B",
    "\u6BD4\u5FC3",
    "\u97A0\u8EAC",
    "\u770B\u5411",
    "\u770B\u7740",
    "\u4F4E\u5934",
    "\u62AC\u5934"
  ].some((hint) => normalized.includes(hint));
}
function selectParameters(available, max) {
  return Object.entries(available).sort(([a, ai], [b, bi]) => rank(a, ai) - rank(b, bi) || a.localeCompare(b)).slice(0, max);
}
function capabilitySummary(parameters) {
  const groups = /* @__PURE__ */ new Map();
  for (const [id, info] of parameters) {
    const key = group(id, info);
    groups.set(key, [...groups.get(key) ?? [], label(id, info) + " (" + id + ")"]);
  }
  return [...groups].map(([key, values]) => "- " + key + ": " + values.slice(0, 12).join(", ")).join("\n");
}
function rank(id, info) {
  return ["head", "body", "gaze", "brow", "mouthForm", "eyeSmile"].includes(group(id, info)) ? 0 : 10;
}
function group(id, info) {
  const value = normalize(id + " " + (info.name ?? "") + " " + (info.groupName ?? ""));
  if (has(value, ["body", "torso", "spine", "\u8EAB\u4F53", "\u8EAF\u5E72"])) return "body";
  if (has(value, ["angle", "head", "neck", "\u5934", "\u9888"])) return "head";
  if (has(value, ["eyeball", "gaze", "\u773C\u7403", "\u89C6\u7EBF"])) return "gaze";
  if (has(value, ["brow", "\u7709"])) return "brow";
  if (has(value, ["mouthform", "mouthshape", "lipshape", "pucker", "smile", "\u5634\u578B", "\u53E3\u578B"])) return "mouthForm";
  if (has(value, ["eyesmile", "\u7B11\u773C"])) return "eyeSmile";
  if (has(value, ["arm", "hand", "ear", "tail", "wing", "\u624B", "\u8033", "\u5C3E", "\u7FC5"])) return "appendage";
  return info.groupName || info.groupId || "other";
}
function tune(id, value, info, config) {
  let next = clamp3(value, info.min, info.max);
  const normalized = normalize(id);
  const eyeOpen = normalized.includes("eye") && normalized.includes("open");
  const joint = !eyeOpen && has(normalized, [
    "angle",
    "body",
    "head",
    "neck",
    "shoulder",
    "arm",
    "hand",
    "wrist",
    "elbow",
    "spine",
    "torso",
    "hip",
    "leg",
    "knee",
    "foot"
  ]);
  if (joint) next = info.default + (next - info.default) * config.jointMotionBoost;
  if (eyeOpen && config.eyeOpenBinary) {
    next = next >= (info.min + info.max) / 2 ? info.max : info.min;
  }
  const range = Math.abs(info.max - info.min);
  const delta = next - info.default;
  const minimum = range * config.minVisibleRatio;
  if (range && Math.abs(delta) > 0 && Math.abs(delta) < minimum) {
    next = info.default + Math.sign(delta) * minimum;
  }
  return clamp3(next, info.min, info.max);
}
function defaultRange(id) {
  const value = normalize(id);
  if (value.includes("angle")) return { min: -30, max: 30, default: 0 };
  if (has(value, ["eyeball", "mouthform", "mouthshape", "brow", "pucker", "smile"])) {
    return { min: -1, max: 1, default: 0 };
  }
  if (value.includes("eyeopen")) return { min: 0, max: 1, default: 1 };
  return { min: 0, max: 1, default: 0 };
}
function formats(schema) {
  return [schema, { type: "json_object" }, void 0];
}
function responseFormatName(format) {
  if (!format) return "none";
  return format.type === "json_schema" ? "json_schema:" + format.json_schema.name : format.type;
}
function parseJSON2(content) {
  const value = content.trim();
  if (!value) throw new Error("LLM returned empty content");
  try {
    return JSON.parse(value);
  } catch {
    const start = value.indexOf("{");
    const end = value.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(value.slice(start, end + 1));
    throw new Error("LLM did not return JSON: " + value.slice(0, 160));
  }
}
function label(id, info) {
  const labels = [info.name, info.groupName].filter((value) => Boolean(value?.trim()));
  return labels.length ? Array.from(new Set(labels)).join(" / ") : id;
}
function normalize(value) {
  return value.replace(/\s+/gu, "").replace(/[＿_\-　]/gu, "").toLowerCase();
}
function has(value, hints) {
  return hints.some((hint) => value.includes(normalize(hint)));
}
function text(value, fallback) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}
function finite(value, fallback) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
function positive(value) {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}
function clampInteger(value, min, max) {
  return Math.round(clamp3(value, min, max));
}
function integer(value, min, max, fallback) {
  return typeof value === "number" && Number.isFinite(value) ? clampInteger(value, min, max) : clampInteger(fallback, min, max);
}
function number(value, min, max, fallback) {
  return typeof value === "number" && Number.isFinite(value) ? clamp3(value, min, max) : fallback;
}
function errorText(error, fallback) {
  return error instanceof Error ? error.message : error == null ? fallback : String(error);
}
function addUnique(values, value) {
  if (value && !values.includes(value)) values.push(value);
}
var parameterFrameSchema = {
  type: "object",
  additionalProperties: false,
  required: ["time", "duration", "label", "parameters"],
  properties: {
    time: { type: "number", minimum: 0 },
    duration: { type: "number", minimum: 0.1, maximum: 30 },
    label: { type: "string" },
    parameters: {
      type: "object",
      minProperties: 1,
      maxProperties: 12,
      additionalProperties: { type: "number" }
    }
  }
};
var actionFrameSchema = {
  type: "object",
  additionalProperties: false,
  required: ["frameIndex", "action", "emphasis"],
  properties: {
    frameIndex: { type: "number", minimum: 0 },
    action: { type: "string" },
    emphasis: { type: "string" }
  }
};
var speakingMotionResponseFormat = {
  type: "json_schema",
  json_schema: {
    name: "soullink_speaking_parameter_plan",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["parameterPlan"],
      properties: { parameterPlan: { type: "array", items: parameterFrameSchema } }
    }
  }
};
var speakingMotionActionResponseFormat = {
  type: "json_schema",
  json_schema: {
    name: "soullink_speaking_motion_actions",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["motionPlan"],
      properties: { motionPlan: { type: "array", items: actionFrameSchema } }
    }
  }
};

// src/SpeakingMotionApiClient.ts
var PlannerApiError = class extends Error {
  constructor(message, status, body) {
    super(message);
    this.status = status;
    this.body = body;
    this.name = "PlannerApiError";
  }
  status;
  body;
};
function createSpeakingMotionApiClient(options) {
  const baseURL = normalizeBaseURL(options.baseURL);
  const path = normalizePath(options.path ?? "/llm/speaking-motion/plan");
  const timeoutMs = normalizeTimeout2(options.timeoutMs);
  const planSpeakingMotion = async (request) => {
    const fetchImpl = options.fetch ?? globalThis.fetch;
    if (typeof fetchImpl !== "function") {
      throw new Error("No fetch implementation is available. Pass SpeakingMotionApiClientOptions.fetch.");
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const configuredHeaders = typeof options.headers === "function" ? await options.headers() : options.headers ?? {};
      const body = withoutServerCredentials(request);
      const response = await fetchImpl(baseURL + path, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...configuredHeaders
        },
        body: JSON.stringify(body),
        signal: controller.signal
      });
      const responseBody = await readResponseBody(response);
      if (!response.ok) {
        throw new PlannerApiError(
          "Speaking motion API request failed with " + response.status,
          response.status,
          responseBody
        );
      }
      return responseBody;
    } finally {
      clearTimeout(timeout);
    }
  };
  return {
    plan: planSpeakingMotion,
    planSpeakingMotion
  };
}
function withoutServerCredentials(request) {
  const body = { ...request };
  delete body.openAI;
  delete body.apiKey;
  delete body.openaiApiKey;
  return body;
}
async function readResponseBody(response) {
  const text2 = await response.text();
  if (!text2) return {};
  try {
    return JSON.parse(text2);
  } catch {
    return text2;
  }
}
function normalizeBaseURL(value) {
  const baseURL = value.trim().replace(/\/+$/u, "");
  if (!baseURL) throw new Error("SpeakingMotionApiClientOptions.baseURL is required");
  return baseURL;
}
function normalizePath(value) {
  const path = value.trim();
  return path.startsWith("/") ? path : "/" + path;
}
function normalizeTimeout2(value) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 3e4;
}
export {
  OpenAIClientNotConfiguredError,
  OpenAICompatibleClient,
  PlannerApiError,
  SoullinkLLMPlanner,
  SoullinkReflectionPlanner,
  SoullinkSpeakingMotionPlanner,
  buildSoullinkCharacterProfile,
  buildSoullinkPlannerMessages,
  createSoullinkSpeakingMotionPlanner,
  createSpeakingMotionApiClient,
  defaultSpeakingMotionGenerationConfig,
  isMouthOrJawOpenParameter,
  isOpenAICompatibleClientLike,
  resolveSoullinkCharacterName,
  resolveSpeakingMotionFrameCount,
  resolveSpeakingMotionGenerationConfig,
  sanitizeSpeakingMotionParameters,
  soullinkCharacterName,
  soullinkCharacterProfile,
  soullinkPlanResponseFormat,
  speakingMotionActionResponseFormat,
  speakingMotionResponseFormat,
  supportedContextTags,
  supportedEmotionVariants
};
//# sourceMappingURL=index.js.map