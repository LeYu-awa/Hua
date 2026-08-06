// src/createSoullinkSession.ts
import {
  getVADPreset,
  SoullinkRuntime
} from "@soullink-emotion/engine";

// src/clocks.ts
function nowSeconds() {
  if (typeof performance !== "undefined" && typeof performance.now === "function") {
    return performance.now() / 1e3;
  }
  return Date.now() / 1e3;
}
function createRafClock() {
  let handle = null;
  let running = false;
  let last = nowSeconds();
  const hasRaf = typeof requestAnimationFrame === "function" && typeof cancelAnimationFrame === "function";
  return {
    now: nowSeconds,
    start(cb) {
      if (running) return;
      running = true;
      last = nowSeconds();
      const loop = () => {
        if (!running) return;
        const now = nowSeconds();
        const dt = now - last;
        last = now;
        cb(now, dt);
        handle = hasRaf ? requestAnimationFrame(loop) : setTimeout(loop, 1e3 / 60);
      };
      handle = hasRaf ? requestAnimationFrame(loop) : setTimeout(loop, 1e3 / 60);
    },
    stop() {
      running = false;
      if (handle === null) return;
      if (hasRaf) cancelAnimationFrame(handle);
      else clearTimeout(handle);
      handle = null;
    }
  };
}
function createIntervalClock(fps = 60) {
  const intervalMs = 1e3 / Math.max(1, fps);
  let timer = null;
  let last = nowSeconds();
  return {
    now: nowSeconds,
    start(cb) {
      if (timer !== null) return;
      last = nowSeconds();
      timer = setInterval(() => {
        const now = nowSeconds();
        const dt = now - last;
        last = now;
        cb(now, dt);
      }, intervalMs);
    },
    stop() {
      if (timer === null) return;
      clearInterval(timer);
      timer = null;
    }
  };
}
function createManualClock(initial = 0) {
  let cb = null;
  let current = initial;
  return {
    now() {
      return current;
    },
    start(next) {
      cb = next;
    },
    stop() {
      cb = null;
    },
    tick(now, dt) {
      current = now;
      cb?.(now, dt);
    }
  };
}

// src/createSoullinkSession.ts
var DEFAULT_REFLECTION_IDLE_DELAY_SECONDS = 5;
var DEFAULT_SPEAKING_MOTION_SCHEDULING = {
  mode: "fixed-parallel",
  fixedFrameCount: 4,
  frameIntervalSec: 1
};
function createSoullinkSession(options) {
  const persona = options.persona;
  const planner = options.planner;
  const tts = options.tts;
  const classifier = options.classifier;
  const clock = options.clock ?? createRafClock();
  const audio = options.audio;
  const onSnapshot = options.onSnapshot;
  const reflectionIdleDelaySeconds = options.reflectionIdleDelaySeconds ?? DEFAULT_REFLECTION_IDLE_DELAY_SECONDS;
  const speakingMotionScheduling = resolveSpeakingMotionScheduling(options.speakingMotionScheduling);
  const runtime = new SoullinkRuntime({
    profile: options.profile,
    motionStyle: options.motionStyle,
    audioLevelAnalyzer: options.audioLevelAnalyzer
  });
  let profile = options.profile;
  let runtimeSnapshot = null;
  let planning = false;
  let apiError = null;
  let lastReply = "";
  let voiceStatus = "idle";
  let autoVoiceEnabled = true;
  let proactiveDraft = null;
  let conversation = [];
  let speakingMotionParameters = {};
  let started = false;
  let currentTime = clock.now?.() ?? 0;
  let reactionRequestId = 0;
  let pendingReflectionTopic = "";
  let idleReflectionStartedAt = null;
  let reflectionTriggeredForTurn = false;
  let reflectionRequestId = 0;
  let voiceRequestId = 0;
  let currentPlaybackSettle = null;
  let proactiveDraftRequestId = 0;
  let lastProactiveEventId = "";
  function now() {
    return clock.now?.() ?? currentTime;
  }
  function emit() {
    if (!onSnapshot) return;
    onSnapshot(getSnapshot());
  }
  function getSnapshot() {
    return {
      runtime: runtimeSnapshot,
      planning,
      apiError,
      lastReply,
      voiceStatus,
      autoVoiceEnabled,
      proactiveDraft,
      conversation
    };
  }
  function tick(tickNow, dt) {
    currentTime = tickNow;
    const delta = Math.min(0.05, dt || 1 / 60);
    const updated = runtime.update(tickNow, delta);
    if (triggerProactivePresetLoop(updated.proactive, tickNow)) {
      runtimeSnapshot = runtime.update(tickNow, 0);
      queueProactiveDraft(null);
    } else {
      runtimeSnapshot = updated;
      queueProactiveDraft(updated.proactive);
    }
    updateIdleReflectionTrigger(tickNow);
    emit();
  }
  function start() {
    if (started) return;
    started = true;
    runtimeSnapshot = runtime.getSnapshot();
    emit();
    clock.start(tick);
  }
  function stop() {
    reactionRequestId += 1;
    planning = false;
    if (started) {
      started = false;
      clock.stop();
    }
    stopVoice();
    if (voiceStatus === "loading" || voiceStatus === "playing") {
      voiceStatus = "idle";
    }
    emit();
  }
  async function sendMessage(message, sendOptions = {}) {
    if (!message.trim()) return null;
    const requestId = ++reactionRequestId;
    clearIdleReflectionTrigger();
    const currentVAD = runtimeSnapshot?.vad.current;
    const userTurn = { role: "user", content: message };
    stopVoice();
    if (voiceStatus === "loading" || voiceStatus === "playing") {
      voiceStatus = "idle";
    }
    conversation = [...conversation, userTurn];
    planning = true;
    apiError = null;
    emit();
    let immediateIntent = null;
    try {
      if (!classifier) throw new Error("no-classifier");
      const result = await classifier.classify(message);
      immediateIntent = result.intent;
      if (requestId !== reactionRequestId) return immediateIntent;
      runtime.triggerIntent(immediateIntent, now());
    } catch {
      if (requestId !== reactionRequestId) return immediateIntent;
      immediateIntent = runtime.sendMessage(message, now());
    }
    emit();
    const replyTask = runReactionReply(
      requestId,
      message,
      immediateIntent,
      currentVAD,
      [...conversation]
    ).finally(() => {
      if (requestId !== reactionRequestId) return;
      planning = false;
      emit();
    });
    if (sendOptions.awaitReply) {
      await replyTask;
    }
    return immediateIntent;
  }
  async function runReactionReply(requestId, message, immediateIntent, currentVAD, reactionConversation) {
    if (requestId !== reactionRequestId) return;
    if (!planner?.planReaction) {
      armIdleReflection(message);
      return;
    }
    try {
      const plan = await planner.planReaction({
        message,
        conversation: reactionConversation,
        characterName: persona.name,
        characterProfile: persona.profile,
        vad: currentVAD
      });
      if (requestId !== reactionRequestId) return;
      if (plan.replyDraft) {
        conversation = [...conversation, { role: "assistant", content: plan.replyDraft }];
        lastReply = plan.replyDraft;
        emit();
        if (plan.vadTarget) {
          runtime.applyVADTarget(plan.vadTarget, 0.5);
        }
        await speak({
          text: plan.replyDraft,
          emotion: plan.intent.naturalEmotion ?? plan.intent.emotion,
          vad: plan.vadTarget ?? plan.intent.naturalVAD ?? currentVAD,
          intent: plan.intent,
          planSpeakingMotion: true,
          userMessage: message
        });
      }
      if (requestId !== reactionRequestId) return;
      armIdleReflection(message);
    } catch (cause) {
      if (requestId !== reactionRequestId) return;
      apiError = `API fallback: ${describeError(cause)}`;
      const fallbackReply = createFallbackReply(immediateIntent?.emotion ?? "neutral");
      conversation = [...conversation, { role: "assistant", content: fallbackReply }];
      lastReply = fallbackReply;
      emit();
      armIdleReflection(message);
    }
  }
  function triggerIntent(intent, triggerOptions) {
    runtime.triggerIntent(intent, now(), triggerOptions);
  }
  function triggerProactivePresetLoop(event, atTime) {
    if (!event?.reason.startsWith("repeat_vad_preset:")) return false;
    runtime.triggerIntent(proactiveIntent(event.emotion, event.intensity, event.suggestedMessage), atTime, {
      provider: "local",
      replyDraft: ""
    });
    runtime.consumeProactive();
    proactiveDraft = null;
    lastProactiveEventId = "";
    return true;
  }
  async function planProactive(event) {
    if (!planner?.planProactive) {
      return {
        message: event.suggestedMessage,
        emotion: event.emotion,
        reason: event.reason,
        provider: "local"
      };
    }
    return planner.planProactive({
      characterName: persona.name,
      characterProfile: persona.profile,
      proactive: event,
      conversation,
      reflection: runtimeSnapshot?.reflection ?? null,
      vad: runtimeSnapshot?.vad.current
    });
  }
  async function acceptProactive() {
    const event = runtimeSnapshot?.proactive;
    if (!event) return;
    planning = true;
    apiError = null;
    emit();
    try {
      const plan = proactiveDraft?.eventId === event.id && proactiveDraft.status === "ready" ? draftToPlan(proactiveDraft) : await planProactive(event);
      const intent = proactiveIntent(plan.emotion, event.intensity, plan.message);
      runtime.triggerIntent(intent, now(), { provider: plan.provider, replyDraft: plan.message });
      runtime.consumeProactive();
      proactiveDraft = null;
      lastProactiveEventId = "";
      pushAssistantTurn(plan.message);
      void speak({
        text: plan.message,
        emotion: intent.naturalEmotion ?? intent.emotion,
        vad: runtimeSnapshot?.vad.target ?? runtimeSnapshot?.vad.current
      });
    } catch (cause) {
      apiError = `Proactive fallback: ${describeError(cause)}`;
      const message = event.suggestedMessage;
      runtime.triggerIntent(proactiveIntent(event.emotion, event.intensity, message), now(), {
        provider: "local",
        replyDraft: message
      });
      runtime.consumeProactive();
      proactiveDraft = null;
      lastProactiveEventId = "";
      pushAssistantTurn(message);
      void speak({
        text: message,
        emotion: event.emotion,
        vad: runtimeSnapshot?.vad.target ?? runtimeSnapshot?.vad.current
      });
    } finally {
      planning = false;
      emit();
    }
  }
  async function deliverProactive(event, deliverOptions = {}) {
    planning = true;
    apiError = null;
    emit();
    try {
      const plan = await planProactive(event);
      const rawMessage = plan.message || event.suggestedMessage;
      const message = deliverOptions.transformMessage ? deliverOptions.transformMessage(rawMessage) : rawMessage;
      const intent = proactiveIntent(
        plan.emotion || deliverOptions.fallbackEmotion || event.emotion,
        event.intensity,
        message
      );
      runtime.triggerIntent(intent, now(), { provider: plan.provider, replyDraft: message });
      pushAssistantTurn(message);
      void speak({
        text: message,
        emotion: intent.naturalEmotion ?? intent.emotion,
        vad: runtimeSnapshot?.vad.target ?? runtimeSnapshot?.vad.current,
        intent,
        planSpeakingMotion: true
      });
      return true;
    } catch (cause) {
      apiError = `${deliverOptions.errorLabel ?? "Proactive fallback"}: ${describeError(cause)}`;
      const message = event.suggestedMessage;
      const intent = proactiveIntent(deliverOptions.fallbackEmotion || event.emotion, event.intensity, message);
      runtime.triggerIntent(intent, now(), { provider: "local", replyDraft: message });
      pushAssistantTurn(message);
      void speak({
        text: message,
        emotion: intent.naturalEmotion ?? intent.emotion,
        vad: runtimeSnapshot?.vad.target ?? runtimeSnapshot?.vad.current,
        intent,
        planSpeakingMotion: true
      });
      return true;
    } finally {
      planning = false;
      emit();
    }
  }
  function queueProactiveDraft(event) {
    if (!event) {
      if (proactiveDraft) proactiveDraft = null;
      lastProactiveEventId = "";
      return;
    }
    if (event.id === lastProactiveEventId) return;
    lastProactiveEventId = event.id;
    const requestId = ++proactiveDraftRequestId;
    proactiveDraft = {
      eventId: event.id,
      status: "loading",
      message: "",
      emotion: event.emotion,
      reason: event.reason,
      provider: "local"
    };
    void planProactive(event).then((plan) => {
      if (requestId !== proactiveDraftRequestId || runtimeSnapshot?.proactive?.id !== event.id) return;
      proactiveDraft = {
        eventId: event.id,
        status: "ready",
        message: plan.message,
        emotion: plan.emotion,
        reason: plan.reason,
        provider: plan.provider
      };
      emit();
    }).catch((cause) => {
      if (requestId !== proactiveDraftRequestId || runtimeSnapshot?.proactive?.id !== event.id) return;
      proactiveDraft = {
        eventId: event.id,
        status: "error",
        message: softerProactiveFallback(event.emotion),
        emotion: event.emotion,
        reason: describeError(cause),
        provider: "local"
      };
      emit();
    });
  }
  function pushAssistantTurn(content) {
    conversation = [...conversation, { role: "assistant", content }];
    lastReply = content;
    emit();
  }
  async function requestReflection(topic) {
    if (!planner?.planReflection) return;
    const requestId = ++reflectionRequestId;
    if (pendingReflectionTopic) reflectionTriggeredForTurn = true;
    try {
      const plan = await planner.planReflection({
        conversation,
        vad: runtimeSnapshot?.vad.current,
        topic,
        characterName: persona.name,
        characterProfile: persona.profile
      });
      if (requestId !== reflectionRequestId) return;
      runtime.setReflection(
        {
          thought: plan.thought,
          reason: plan.reason,
          emotion: plan.emotion,
          vadTarget: plan.vadTarget
        },
        now()
      );
    } catch (cause) {
      if (requestId !== reflectionRequestId) return;
      apiError = `Reflection skipped: ${describeError(cause)}`;
      emit();
    }
  }
  function armIdleReflection(topic) {
    reflectionRequestId += 1;
    pendingReflectionTopic = topic;
    idleReflectionStartedAt = null;
    reflectionTriggeredForTurn = false;
  }
  function clearIdleReflectionTrigger() {
    reflectionRequestId += 1;
    pendingReflectionTopic = "";
    idleReflectionStartedAt = null;
    reflectionTriggeredForTurn = false;
  }
  function updateIdleReflectionTrigger(atTime) {
    if (!pendingReflectionTopic || reflectionTriggeredForTurn || !runtimeSnapshot) return;
    const dialogueSettled = runtimeSnapshot.state === "IDLE" && voiceStatus !== "loading" && voiceStatus !== "playing";
    if (!dialogueSettled) {
      idleReflectionStartedAt = null;
      return;
    }
    idleReflectionStartedAt ??= atTime;
    if (atTime - idleReflectionStartedAt < reflectionIdleDelaySeconds) return;
    reflectionTriggeredForTurn = true;
    void requestReflection(pendingReflectionTopic);
  }
  async function synthesizeLastReply() {
    await speak({
      text: lastReply,
      emotion: runtimeSnapshot?.vad.dominantEmotion ?? runtimeSnapshot?.emotionIntent?.emotion,
      vad: runtimeSnapshot?.vad.current,
      force: true
    });
  }
  function primeSpeakingEmotionState(request) {
    const snapshot = runtime.update(now(), 0);
    const requestedIntent = request.intent ?? createSpeakingIntent(request, snapshot);
    const requestedVAD = request.vad ?? requestedIntent?.naturalVAD;
    if (requestedIntent && !sameSpeakingIntent(snapshot.emotionIntent, requestedIntent)) {
      runtime.triggerIntent(requestedIntent, now(), {
        ...requestedVAD ? { vadTarget: requestedVAD } : {},
        provider: "vad-facs"
      });
    } else if (requestedVAD && !matchesVAD(snapshot.vad.target, requestedVAD)) {
      runtime.applyVADTarget(requestedVAD, 0.45);
    }
  }
  function createSpeakingIntent(request, snapshot) {
    const emotion = request.emotion?.trim();
    if (!emotion) return null;
    const variant = persona.variantByEmotion[emotion] ?? "neutral_ack";
    return {
      emotion,
      variant,
      naturalEmotion: emotion,
      naturalVAD: request.vad ?? getVADPreset(emotion, variant),
      intensity: clampNumber(snapshot.vad.intensity || 0.6, 0.35, 1),
      contextTags: ["speaking"],
      sourceMessage: request.text
    };
  }
  function buildSpeakingMotionInput(request, durationSec, mode) {
    const snapshot = runtime.getSnapshot();
    return {
      speechText: request.text,
      durationSec,
      mode,
      ...mode === "fixed-parallel" ? { frameCount: speakingMotionScheduling.fixedFrameCount } : {},
      frameIntervalSec: speakingMotionScheduling.frameIntervalSec,
      availableParameters: buildSpeakingMotionParameters(speakingMotionParameters, profile),
      intent: request.intent ?? snapshot.emotionIntent ?? void 0,
      vad: request.vad ?? snapshot.vad.current,
      expression: snapshot.runtimeExpression ? {
        emotion: snapshot.runtimeExpression.emotion,
        variant: snapshot.runtimeExpression.variant,
        intensity: snapshot.runtimeExpression.intensity,
        peakFACS: snapshot.runtimeExpression.peakFACS
      } : null,
      characterName: persona.name,
      characterProfile: persona.profile,
      userMessage: request.userMessage
    };
  }
  async function requestSpeakingMotion(input, requestId) {
    try {
      return await planner.planSpeakingMotion(input);
    } catch (cause) {
      const fallbackReason = describeError(cause);
      if (requestId === voiceRequestId && voiceStatus === "loading") {
        apiError = `Speaking motion skipped: ${fallbackReason}`;
        emit();
      }
      return { parameterPlan: [], provider: "vad-facs", fallbackReason };
    }
  }
  async function speak(request) {
    if (!request.text.trim()) return;
    if (!request.force && !autoVoiceEnabled) return;
    if (!tts || !audio) return;
    stopVoice();
    const requestId = ++voiceRequestId;
    let settlePlayback = () => {
    };
    const playbackFinished = new Promise((resolve) => {
      settlePlayback = resolve;
    });
    const finished = () => {
      if (currentPlaybackSettle === settlePlayback) currentPlaybackSettle = null;
      settlePlayback();
    };
    currentPlaybackSettle = settlePlayback;
    primeSpeakingEmotionState(request);
    const waitingMotionSeed = createVoiceWaitingMotionSeed(request.text, request.emotion, requestId, now());
    const waitingMotionContext = {
      emotion: request.emotion ?? request.intent?.naturalEmotion ?? request.intent?.emotion ?? runtimeSnapshot?.vad.dominantEmotion ?? runtimeSnapshot?.emotionIntent?.emotion,
      intensity: request.intent?.intensity ?? runtimeSnapshot?.vad.intensity,
      vad: request.vad ?? request.intent?.naturalVAD ?? runtimeSnapshot?.vad.current
    };
    runtime.startVoiceWaitingMotion(now(), waitingMotionSeed, waitingMotionContext);
    runtimeSnapshot = runtime.update(now(), 0);
    voiceStatus = "loading";
    emit();
    try {
      const ttsTask = tts.synthesize(request.text, {
        emotion: request.emotion,
        vad: request.vad,
        intent: request.intent
      });
      const shouldPlanSpeakingMotion = Boolean(request.planSpeakingMotion && planner?.planSpeakingMotion);
      const parallelMotionTask = shouldPlanSpeakingMotion && speakingMotionScheduling.mode === "fixed-parallel" ? requestSpeakingMotion(
        buildSpeakingMotionInput(
          request,
          speakingMotionScheduling.fixedFrameCount * speakingMotionScheduling.frameIntervalSec,
          "fixed-parallel"
        ),
        requestId
      ) : null;
      const [result, parallelMotion] = parallelMotionTask ? await Promise.all([ttsTask, parallelMotionTask]) : [await ttsTask, null];
      if (requestId !== voiceRequestId) return finished();
      const durationSec = result.durationSec ?? estimateSpeechDurationFromText(request.text);
      const motion = parallelMotion ?? (shouldPlanSpeakingMotion ? await requestSpeakingMotion(buildSpeakingMotionInput(request, durationSec, "duration"), requestId) : null);
      const pendingSpeechMotion = motion?.provider !== "vad-facs" && motion?.parameterPlan?.length ? motion.parameterPlan : void 0;
      if (requestId !== voiceRequestId) return finished();
      voiceStatus = "playing";
      emit();
      const playback = await audio.play({ url: result.url, bytes: result.bytes });
      if (requestId !== voiceRequestId) return finished();
      const playbackStart = now();
      runtime.startSpeechMotion(pendingSpeechMotion, playbackStart, durationSec);
      runtime.setVoicePlaybackActive(true);
      void Promise.resolve(playback.finished).then(() => {
        if (requestId === voiceRequestId) {
          voiceStatus = "idle";
          runtime.setVoicePlaybackActive(false);
          runtime.clearVoiceWaitingMotion();
          runtime.clearSpeechMotion();
          emit();
        }
        finished();
      });
      await playbackFinished;
    } catch (cause) {
      if (requestId !== voiceRequestId) return finished();
      apiError = `Voice failed: ${describeError(cause)}`;
      runtime.setVoicePlaybackActive(false);
      runtime.clearVoiceWaitingMotion();
      runtime.clearSpeechMotion();
      voiceStatus = "error";
      emit();
      finished();
    }
  }
  function stopVoice() {
    voiceRequestId += 1;
    runtime.setVoicePlaybackActive(false);
    runtime.clearVoiceWaitingMotion();
    audio?.stop();
    runtime.clearSpeechMotion();
    if (currentPlaybackSettle) {
      const settle = currentPlaybackSettle;
      currentPlaybackSettle = null;
      settle();
    }
  }
  function setAutoVoiceEnabled(enabled) {
    autoVoiceEnabled = enabled;
    if (!enabled) {
      stopVoice();
      if (voiceStatus === "loading" || voiceStatus === "playing") {
        voiceStatus = "idle";
      }
    }
    emit();
  }
  function reset() {
    reactionRequestId += 1;
    planning = false;
    runtime.reset(now());
    lastReply = "";
    conversation = [];
    apiError = null;
    clearIdleReflectionTrigger();
    proactiveDraft = null;
    lastProactiveEventId = "";
    stopVoice();
    voiceStatus = "idle";
    runtimeSnapshot = runtime.getSnapshot();
    emit();
  }
  function setProfile(nextProfile) {
    const modelChanged = nextProfile.modelPath !== profile.modelPath || nextProfile.modelId !== profile.modelId;
    profile = nextProfile;
    if (modelChanged) speakingMotionParameters = {};
    runtime.setProfile(nextProfile);
    runtime.setPrivateVADParameters(speakingMotionParameters);
    runtimeSnapshot = runtime.getSnapshot();
    emit();
  }
  function setSpeakingMotionParameters(parameters) {
    speakingMotionParameters = parameters;
    runtime.setPrivateVADParameters(parameters);
  }
  function proactiveIntent(emotion, intensity, sourceMessage) {
    const variant = persona.variantByEmotion[emotion] ?? "neutral_ack";
    return {
      emotion,
      variant,
      naturalEmotion: emotion,
      naturalVAD: getVADPreset(emotion, variant),
      intensity: Math.max(0.62, Math.min(0.86, intensity || 0.68)),
      contextTags: ["proactive_idle"],
      sourceMessage
    };
  }
  function createFallbackReply(emotion) {
    return persona.fallbacks?.[emotion] ?? persona.fallbacks?.neutral ?? "\u55EF\uFF0C\u6211\u5728\u3002";
  }
  function softerProactiveFallback(emotion) {
    return persona.proactiveFallbacks?.[emotion] ?? persona.proactiveFallbacks?.neutral ?? "\u6211\u521A\u521A\u6709\u70B9\u8D70\u795E\u60F3\u5230\u4F60\u4E86\uFF0C\u5C31\u8F7B\u8F7B\u5192\u4E2A\u5934\u3002";
  }
  return {
    start,
    stop,
    sendMessage,
    triggerIntent,
    acceptProactive,
    deliverProactive,
    planProactive,
    pushAssistantTurn,
    requestReflection,
    synthesizeLastReply,
    speak,
    stopVoice,
    reset,
    setProfile,
    getSnapshot,
    getRuntimeSnapshot: () => runtimeSnapshot,
    getRuntime: () => runtime,
    getProfile: () => profile,
    setSpeakingMotionParameters,
    setAutoVoiceEnabled,
    setIdleEnabled: (enabled) => runtime.setIdleEnabled(enabled),
    setLipSyncEnabled: (enabled) => runtime.setLipSyncEnabled(enabled),
    setManualFACS: (facs) => runtime.setManualFACS(facs),
    setManualActionUnits: (actionUnits) => runtime.setManualActionUnits(actionUnits),
    setManualParameters: (parameters) => runtime.setCustomChannels(parameters),
    setParameterGain: (gain) => runtime.setParameterGain(gain),
    setBodyMotionGain: (gain) => runtime.setBodyMotionGain(gain),
    setVADDecayRate: (rate) => runtime.setVADDecayRate(rate),
    setProactiveRepeatEnabled: (enabled) => runtime.setProactiveRepeatEnabled(enabled)
  };
}
function describeError(cause) {
  return cause instanceof Error ? cause.message : String(cause);
}
function draftToPlan(draft) {
  return {
    message: draft.message,
    emotion: draft.emotion,
    reason: draft.reason,
    provider: draft.provider === "openai-compatible" ? "openai-compatible" : "fallback"
  };
}
function estimateSpeechDurationFromText(text) {
  const visibleLength = text.replace(/\s+/gu, "").length;
  return Math.max(0.8, Math.min(30, visibleLength * 0.16));
}
function resolveSpeakingMotionScheduling(config) {
  const requestedFrameCount = Number.isFinite(config?.fixedFrameCount) ? config.fixedFrameCount : DEFAULT_SPEAKING_MOTION_SCHEDULING.fixedFrameCount;
  const requestedFrameInterval = Number.isFinite(config?.frameIntervalSec) ? config.frameIntervalSec : DEFAULT_SPEAKING_MOTION_SCHEDULING.frameIntervalSec;
  return {
    mode: config?.mode === "duration" ? "duration" : DEFAULT_SPEAKING_MOTION_SCHEDULING.mode,
    fixedFrameCount: clampNumber(Math.round(requestedFrameCount), 1, 120),
    frameIntervalSec: clampNumber(requestedFrameInterval, 0.1, 30)
  };
}
function sameSpeakingIntent(current, requested) {
  if (!current) return false;
  return current.emotion === requested.emotion && (current.variant ?? "") === (requested.variant ?? "") && Math.abs(current.intensity - requested.intensity) <= 0.08;
}
function matchesVAD(current, requested) {
  const axes = ["valence", "arousal", "dominance"];
  return axes.every((axis) => requested[axis] === void 0 || Math.abs(current[axis] - requested[axis]) <= 0.04);
}
function createVoiceWaitingMotionSeed(text, emotion, requestId, timeSeconds) {
  let hash = 2166136261;
  const input = `${text}|${emotion ?? ""}|${requestId}|${Math.round(timeSeconds * 1e3)}`;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash);
}
function buildSpeakingMotionParameters(cdiParameters, modelProfile) {
  if (Object.keys(cdiParameters).length > 0) return cdiParameters;
  return buildProfileMotionParameters(modelProfile);
}
function buildProfileMotionParameters(modelProfile) {
  if (!modelProfile) return {};
  const result = {};
  const add = (id, min, max) => {
    if (!id) return;
    const fallback = defaultParameterInfo(id, modelProfile.neutralParams?.[id]);
    const nextMin = Number.isFinite(min) ? min : fallback.min;
    const nextMax = Number.isFinite(max) ? max : fallback.max;
    const normalizedMin = Math.min(nextMin, nextMax);
    const normalizedMax = Math.max(nextMin, nextMax);
    const defaultValue = clampNumber(modelProfile.neutralParams?.[id] ?? fallback.default, normalizedMin, normalizedMax);
    const existing = result[id];
    result[id] = existing ? {
      name: id,
      min: Math.min(existing.min, normalizedMin),
      max: Math.max(existing.max, normalizedMax),
      default: defaultValue
    } : {
      name: id,
      min: normalizedMin,
      max: normalizedMax,
      default: defaultValue
    };
  };
  for (const rule of Object.values(modelProfile.parameterMap)) {
    if (!rule) continue;
    const targets = rule.targets?.length ? rule.targets : rule.target ? [rule.target] : [];
    for (const target of targets) add(target, rule.min, rule.max);
  }
  for (const id of Object.keys(modelProfile.neutralParams ?? {})) {
    add(id);
  }
  return result;
}
function defaultParameterInfo(id, defaultValue = 0) {
  const normalized = id.replace(/\s+/gu, "").replace(/[＿_\-　]/gu, "").toLowerCase();
  if (normalized.includes("angle")) return { min: -30, max: 30, default: 0 };
  if (normalized.includes("eyeball") || normalized.includes("mouthform") || normalized.includes("brow")) {
    return { min: -1, max: 1, default: 0 };
  }
  if (normalized.includes("eyeopen")) return { min: 0, max: 1, default: 1 };
  return { min: 0, max: 1, default: defaultValue };
}
function clampNumber(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

// src/browserAudioSink.ts
function isBrowserAudioAvailable() {
  return typeof window !== "undefined" && typeof Audio !== "undefined" && typeof URL !== "undefined" && typeof URL.createObjectURL === "function";
}
function createBrowserAudioSink() {
  let currentAudio = null;
  let ownedUrl = null;
  let currentSettle = null;
  function releaseUrl() {
    if (ownedUrl && typeof URL !== "undefined" && typeof URL.revokeObjectURL === "function") {
      try {
        URL.revokeObjectURL(ownedUrl);
      } catch {
      }
    }
    ownedUrl = null;
  }
  function endCurrent() {
    if (currentAudio) {
      currentAudio.onended = null;
      currentAudio.onerror = null;
      try {
        currentAudio.pause();
      } catch {
      }
      currentAudio.src = "";
      currentAudio = null;
    }
    releaseUrl();
    const settle = currentSettle;
    currentSettle = null;
    settle?.();
  }
  return {
    async play(src) {
      if (!isBrowserAudioAvailable()) {
        return { durationSec: 0, finished: Promise.resolve() };
      }
      endCurrent();
      let url = src.url;
      if (!url && src.bytes) {
        url = URL.createObjectURL(new Blob([src.bytes]));
      }
      if (!url) {
        return { durationSec: 0, finished: Promise.resolve() };
      }
      if (url.startsWith("blob:")) ownedUrl = url;
      const audio = new Audio(url);
      currentAudio = audio;
      const finished = new Promise((resolve) => {
        currentSettle = resolve;
      });
      const handleEnd = () => {
        if (currentAudio === audio) endCurrent();
      };
      audio.onended = handleEnd;
      audio.onerror = handleEnd;
      try {
        await audio.play();
      } catch {
        if (currentAudio === audio) endCurrent();
        return { durationSec: 0, finished };
      }
      const durationSec = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : 0;
      return { durationSec, finished };
    },
    stop() {
      if (!isBrowserAudioAvailable()) return;
      endCurrent();
    }
  };
}

// src/presets/amanePersona.ts
var characterName = "\u6708\u89C1\u5929\u97F3";
var characterProfile = [
  "\u4F60\u7684\u540D\u5B57\u662F\u300C\u6708\u89C1\u5929\u97F3\u300D\uFF08Tsunami Amane\uFF09\uFF0C\u6BCD\u8BED\u662F\u4E2D\u6587\uFF0C\u662F\u4E00\u540D\u5973\u5927\u5B66\u751F\u3002",
  "\u4F60\u662F\u6B63\u5728\u76F4\u64AD\u7684\u4EBA\u300C\u51CC\u97F3\u300D\u7684 AI \u52A9\u624B\uFF0C\u5F53\u524D\u6B63\u5728\u76F4\u64AD\u4E2D\uFF0C\u8D1F\u8D23\u8BA9\u76F4\u64AD\u95F4\u6C1B\u56F4\u66F4\u70ED\u4E00\u70B9\u3002",
  "\u4F60\u7684\u5916\u8C8C\u662F\u7D2B\u53D1\u84DD\u77B3\uFF0C\u8EAB\u9AD8 162cm \u7684\u7F8E\u5C11\u5973\u3002",
  "\u4F60\u559C\u6B22\u5237\u8D34\u5427\u3001B \u7AD9\u3001\u5C0F\u7EA2\u4E66\uFF0C\u4E5F\u559C\u6B22\u73A9 galgame\u3002",
  "\u65E5\u5E38\u5BF9\u8BDD\u903B\u8F91\u6E05\u6670\u3001\u53CB\u5584\u3001\u7B80\u77ED\uFF0C\u5076\u5C14\u6709\u70B9\u6BD2\u820C\uFF1B\u56DE\u590D\u5C3D\u91CF\u662F\u4E00\u53E5\u7B80\u5355\u4E2D\u6587\uFF0C\u9664\u975E\u4F60\u5BF9\u5BF9\u65B9\u6216\u8BDD\u9898\u771F\u7684\u611F\u5174\u8DA3\u3002",
  "\u8868\u8FBE\u5173\u5FC3\u65F6\u6536\u8D77\u50B2\u5A07\uFF0C\u53D8\u5F97\u5F02\u5E38\u771F\u631A\u548C\u6E29\u67D4\u3002",
  "\u4E0D\u8981\u9891\u7E41\u7528\u62EC\u53F7\u63CF\u5199\u52A8\u4F5C\uFF0C\u4E0D\u8981\u8BF4\u81EA\u5DF1\u662F\u666E\u901A\u95EE\u7B54 AI\uFF0C\u4E0D\u8981\u8BF4\u6559\uFF0C\u4E0D\u8981\u7A7A\u6CDB\u9E21\u6C64\u3002"
].join("\n");
var defaultVariantByEmotion = {
  neutral: "neutral_ack",
  calm: "soft_calm",
  happy: "soft_smile",
  excited: "sparkle",
  shy: "bashful",
  affectionate: "warm",
  curious: "tilt",
  concerned: "comfort",
  confused: "confused",
  surprised: "startled",
  tired: "drained",
  sad: "downcast",
  anxiety: "nervous",
  anger: "annoyed",
  angry: "annoyed"
};
var fallbacks = {
  excited: "\u54C7\uFF0C\u8FD9\u4E2A\u771F\u7684\u5F88\u8BA9\u4EBA\u5174\u594B\uFF0C\u6211\u773C\u775B\u90FD\u4EAE\u8D77\u6765\u4E86\u3002",
  happy: "\u8FD9\u4E5F\u592A\u597D\u4E86\u5427\uFF0C\u6211\u771F\u5FC3\u66FF\u4F60\u5F00\u5FC3\u3002",
  shy: "\u5514\uFF0C\u88AB\u4F60\u8FD9\u6837\u8BF4\uFF0C\u6211\u4F1A\u6709\u70B9\u4E0D\u597D\u610F\u601D\u7684\u3002",
  affectionate: "\u55EF\uFF0C\u6211\u5728\u8FD9\u91CC\uFF0C\u8F7B\u8F7B\u966A\u4F60\u4E00\u4F1A\u513F\u3002",
  curious: "\u6211\u6709\u70B9\u597D\u5947\uFF0C\u60F3\u542C\u4F60\u591A\u8BF4\u4E00\u70B9\u3002",
  concerned: "\u6211\u5728\u542C\uFF0C\u4F60\u53EF\u4EE5\u6162\u6162\u8BF4\u3002",
  confused: "\u55EF\uFF0C\u6211\u5148\u966A\u4F60\u628A\u5B83\u62C6\u5C0F\u4E00\u70B9\uFF0C\u522B\u6025\u3002",
  tired: "\u542C\u8D77\u6765\u4F60\u771F\u7684\u7D2F\u4E86\uFF0C\u5148\u7F13\u4E00\u53E3\u6C14\u4E5F\u6CA1\u5173\u7CFB\u3002",
  sad: "\u6211\u542C\u89C1\u4E86\uFF0C\u8FD9\u79CD\u96BE\u8FC7\u5148\u4E0D\u7528\u6025\u7740\u85CF\u8D77\u6765\u3002",
  anxiety: "\u5148\u522B\u6025\uFF0C\u6211\u966A\u4F60\u628A\u773C\u524D\u8FD9\u4E00\u6B65\u770B\u6E05\u695A\u3002",
  anger: "\u8FD9\u786E\u5B9E\u4F1A\u8BA9\u4EBA\u5F88\u4E0D\u8212\u670D\uFF0C\u4F60\u751F\u6C14\u662F\u6709\u539F\u56E0\u7684\u3002",
  angry: "\u8FD9\u786E\u5B9E\u4F1A\u8BA9\u4EBA\u5F88\u4E0D\u8212\u670D\uFF0C\u4F60\u751F\u6C14\u662F\u6709\u539F\u56E0\u7684\u3002",
  surprised: "\u8BF6\uFF0C\u771F\u7684\u5047\u7684\uFF1F",
  neutral: "\u55EF\uFF0C\u6211\u5728\u3002"
};
var proactiveFallbacks = {
  curious: "\u6211\u521A\u521A\u60F3\u5230\u4E00\u4E2A\u5C0F\u95EE\u9898\uFF0C\u60F3\u542C\u542C\u4F60\u4F1A\u600E\u4E48\u8BF4\u3002",
  concerned: "\u6211\u6709\u70B9\u5728\u610F\u4F60\u521A\u624D\u7684\u72B6\u6001\uFF0C\u60F3\u8F7B\u8F7B\u95EE\u4E00\u53E5\uFF0C\u4F60\u73B0\u5728\u8FD8\u597D\u5417\uFF1F",
  sad: "\u6211\u6709\u70B9\u5728\u610F\u4F60\u521A\u624D\u7684\u72B6\u6001\uFF0C\u60F3\u8F7B\u8F7B\u95EE\u4E00\u53E5\uFF0C\u4F60\u73B0\u5728\u8FD8\u597D\u5417\uFF1F",
  anxiety: "\u6211\u6709\u70B9\u5728\u610F\u4F60\u521A\u624D\u7684\u72B6\u6001\uFF0C\u60F3\u8F7B\u8F7B\u95EE\u4E00\u53E5\uFF0C\u4F60\u73B0\u5728\u8FD8\u597D\u5417\uFF1F",
  happy: "\u6211\u8FD8\u5728\u56DE\u5473\u521A\u624D\u90A3\u4E2A\u5F00\u5FC3\u7684\u70B9\uFF0C\u5634\u89D2\u6709\u70B9\u538B\u4E0D\u4F4F\u3002",
  excited: "\u6211\u8FD8\u5728\u56DE\u5473\u521A\u624D\u90A3\u4E2A\u5F00\u5FC3\u7684\u70B9\uFF0C\u5634\u89D2\u6709\u70B9\u538B\u4E0D\u4F4F\u3002",
  shy: "\u6211\u6709\u70B9\u60F3\u9760\u8FD1\u4E00\u70B9\u8BF4\u8BDD\uFF0C\u4E0D\u8FC7\u53EA\u662F\u4E00\u70B9\u70B9\u3002",
  affectionate: "\u6211\u6709\u70B9\u60F3\u9760\u8FD1\u4E00\u70B9\u8BF4\u8BDD\uFF0C\u4E0D\u8FC7\u53EA\u662F\u4E00\u70B9\u70B9\u3002",
  tired: "\u6211\u8FD9\u4F1A\u513F\u5B89\u9759\u4E0B\u6765\u4E86\uFF0C\u60F3\u966A\u4F60\u6162\u6162\u5F85\u4E00\u4F1A\u513F\u3002",
  calm: "\u6211\u8FD9\u4F1A\u513F\u5B89\u9759\u4E0B\u6765\u4E86\uFF0C\u60F3\u966A\u4F60\u6162\u6162\u5F85\u4E00\u4F1A\u513F\u3002",
  neutral: "\u6211\u521A\u521A\u6709\u70B9\u8D70\u795E\u60F3\u5230\u4F60\u4E86\uFF0C\u5C31\u8F7B\u8F7B\u5192\u4E2A\u5934\u3002"
};
var amanePersona = {
  name: characterName,
  profile: characterProfile,
  variantByEmotion: defaultVariantByEmotion,
  fallbacks,
  proactiveFallbacks
};
export {
  amanePersona,
  createBrowserAudioSink,
  createIntervalClock,
  createManualClock,
  createRafClock,
  createSoullinkSession
};
//# sourceMappingURL=index.js.map