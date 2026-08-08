export { loadTTSConfig, saveTTSConfig, subscribeTTSConfig, TTS_CONFIG_STORAGE_KEY } from "./config";
export {
  TTS_ENGINE_OPTIONS,
  OPENAI_TTS_VOICES,
  DEFAULT_TTS,
  EMOTION_SPEED_ADJUST,
  type TTSConfig,
  type TTSEngineKey,
} from "./types";
export { synthesizeWithConfig, type TtsContext, type TtsResult } from "./ttsClient";
export {
  speakText,
  stopSpeech,
  shouldAutoSpeak,
  isSpeechPlaying,
  subscribeSpeechState,
  subscribeMouthValue,
  unlockSpeechPlayback,
} from "./ttsService";
