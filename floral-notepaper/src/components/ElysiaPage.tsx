import { useState, useCallback, useEffect } from "react";
import { Live2DCompanionSettings } from "../features/companion/components/Live2DCompanionSettings";
import {
  DEFAULT_TTS,
  OPENAI_TTS_VOICES,
  TTS_ENGINE_OPTIONS,
  loadTTSConfig,
  saveTTSConfig,
  speakText,
  stopSpeech,
  type TTSConfig,
} from "../features/tts";
import { LocalTtsPanel } from "../features/tts/LocalTtsPanel";

// ---- Elysia 导航选项卡 ----
type ElysiaTab = "general" | "live2d" | "tts" | "memory" | "rag" | "mcp" | "appearance";

interface TabDef {
  key: ElysiaTab;
  label: string;
  icon: string;
}

const TABS: TabDef[] = [
  { key: "general", label: "通用", icon: "⚙" },
  { key: "live2d", label: "Live2D", icon: "▣" },
  { key: "tts", label: "TTS", icon: "♪" },
  { key: "memory", label: "记忆", icon: "◈" },
  { key: "rag", label: "RAG", icon: "◫" },
  { key: "mcp", label: "MCP", icon: "⎔" },
  { key: "appearance", label: "外观", icon: "◒" },
];

// ---- 占位页面 ----
function PlaceholderContent({ tab }: { tab: ElysiaTab }) {
  const labels: Record<ElysiaTab, string> = {
    general: "通用设置",
    live2d: "Live2D 角色配置",
    tts: "TTS 语音合成",
    memory: "记忆管理",
    rag: "RAG 检索增强",
    mcp: "MCP 协议配置",
    appearance: "外观设置",
  };
  return (
    <div className="flex-1 flex items-center justify-center text-ink-ghost text-sm">
      {labels[tab]} — 即将推出
    </div>
  );
}

// ---- TTS 配置面板 ----
function TTSSettings({
  config,
  onChange,
}: {
  config: TTSConfig;
  onChange: (c: TTSConfig) => void;
}) {
  const update = (patch: Partial<TTSConfig>) => onChange({ ...config, ...patch });
  const [testError, setTestError] = useState<string | null>(null);
  const [testOk, setTestOk] = useState(false);

  // 订阅语音合成失败详情（speakText 会把错误广播出来，这里就地展示）
  useEffect(() => {
    const handler = (event: Event) => {
      setTestOk(false);
      setTestError((event as CustomEvent<string>).detail ?? "未知错误");
    };
    window.addEventListener("tts-speech-error", handler);
    return () => window.removeEventListener("tts-speech-error", handler);
  }, []);

  const handleTest = async () => {
    setTestError(null);
    setTestOk(false);
    const ok = await speakText(
      config.engine === "local"
        ? "こんにちは、私は花箋の音声アシスタントです。今日も一緒に頑張りましょう。"
        : "你好，我是花笺的语音助手，很高兴见到你。",
      { emotion: "happy" },
    );
    if (ok) setTestOk(true);
  };

  const handleBrowseFile = async (key: "gptWeightsPath" | "sovitsWeightsPath") => {
    try {
      // 使用 Tauri dialog 选择文件
      const { open } = await import("@tauri-apps/plugin-dialog");
      const extensions =
        key === "gptWeightsPath"
          ? [{ name: "CKPT", extensions: ["ckpt"] }]
          : [{ name: "PTH", extensions: ["pth"] }];
      const selected = await open({
        title:
          key === "gptWeightsPath" ? "选择 GPT 模型权重 (.ckpt)" : "选择 SoVITS 模型权重 (.pth)",
        filters: extensions,
        multiple: false,
      });
      if (selected && typeof selected === "string") {
        update({ [key]: selected });
      }
    } catch {
      // 非 Tauri 环境，静默失败
    }
  };

  const handleBrowseDir = async () => {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({
        title: "选择参考音频目录",
        directory: true,
        multiple: false,
      });
      if (selected && typeof selected === "string") {
        update({ refAudioDir: selected });
      }
    } catch {
      // 非 Tauri 环境，静默失败
    }
  };

  const handleReset = () => {
    onChange({ ...DEFAULT_TTS });
  };

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-2xl">
        <h2 className="text-lg font-display font-bold text-ink mb-6">TTS 语音合成配置</h2>

        {/* 触发条件 */}
        <div className="mb-5 p-3.5 rounded-xl bg-bamboo-mist/30 border border-bamboo/15">
          <label className="flex items-center gap-2.5 text-xs font-medium text-ink-soft cursor-pointer">
            <input
              type="checkbox"
              checked={config.enabled}
              onChange={(e) => update({ enabled: e.target.checked })}
              className="accent-bamboo"
            />
            启用语音合成（关闭后所有朗读请求将被静默跳过）
          </label>
          <label className="flex items-center gap-2.5 text-xs font-medium text-ink-soft mt-2.5 cursor-pointer">
            <input
              type="checkbox"
              checked={config.autoSpeak}
              onChange={(e) => update({ autoSpeak: e.target.checked })}
              className="accent-bamboo"
            />
            AI 助手回复后自动朗读（左侧 AI 对话窗口）
          </label>
        </div>

        {/* TTS 引擎 */}
        <div className="mb-5">
          <label className="block text-xs font-medium text-ink-soft mb-1.5">TTS 引擎</label>
          <select
            value={config.engine}
            onChange={(e) => update({ engine: e.target.value as TTSConfig["engine"] })}
            className="w-full h-9 px-3 rounded-lg text-sm font-body text-ink bg-paper-warm/80 border border-paper-deep/40 focus:border-bamboo/40 focus:bg-cloud transition-all outline-none cursor-pointer"
          >
            {TTS_ENGINE_OPTIONS.map((opt) => (
              <option key={opt.key} value={opt.key}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        {/* 本地 SBV2 引擎：资产下载面板 */}
        {config.engine === "local" && (
          <LocalTtsPanel
            voice={config.voice}
            onChangeVoice={(v) => update({ voice: v })}
          />
        )}

        {/* 模型（GPT-SoVITS / OpenAI 为文本输入，其余沿用占位） */}
        <div className="mb-5">
          <label className="block text-xs font-medium text-ink-soft mb-1.5">模型</label>
          {config.engine === "openai" ? (
            <input
              type="text"
              value={config.model}
              onChange={(e) => update({ model: e.target.value })}
              className="w-full h-9 px-3 rounded-lg text-sm font-mono text-ink bg-paper-warm/80 border border-paper-deep/40 focus:border-bamboo/40 focus:bg-cloud transition-all outline-none"
              placeholder="tts-1"
            />
          ) : (
            <input
              type="text"
              value={config.model}
              onChange={(e) => update({ model: e.target.value })}
              className="w-full h-9 px-3 rounded-lg text-sm font-mono text-ink bg-paper-warm/80 border border-paper-deep/40 focus:border-bamboo/40 focus:bg-cloud transition-all outline-none"
              placeholder={
                config.engine === "dashscope"
                  ? "cosyvoice-v2"
                  : "加载权重后填写模型名（不影响合成请求，仅作标识）"
              }
            />
          )}
        </div>

        {/* 音色（voice） */}
        <div className="mb-5">
          <label className="block text-xs font-medium text-ink-soft mb-1.5">
            音色
            <span className="text-ink-ghost font-normal ml-1">
              {config.engine === "gpt-sovits" && "— 参考音频文件名（位于参考音频目录下）"}
              {config.engine === "vits" && "— 说话人 id（MoeTTS speaker）"}
              {config.engine === "edge" && "— 浏览器语音名，留空自动选中文女声"}
              {config.engine === "openai" && "— 标准音色名"}
              {config.engine === "dashscope" &&
                "— 复刻音色 ID（先上传 10-20 秒音频创建音色）或系统音色名"}
            </span>
          </label>
          {config.engine === "openai" ? (
            <select
              value={config.voice}
              onChange={(e) => update({ voice: e.target.value })}
              className="w-full h-9 px-3 rounded-lg text-sm font-body text-ink bg-paper-warm/80 border border-paper-deep/40 focus:border-bamboo/40 focus:bg-cloud transition-all outline-none cursor-pointer"
            >
              {OPENAI_TTS_VOICES.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          ) : (
            <input
              type="text"
              value={config.voice}
              onChange={(e) => update({ voice: e.target.value })}
              className="w-full h-9 px-3 rounded-lg text-sm font-mono text-ink bg-paper-warm/80 border border-paper-deep/40 focus:border-bamboo/40 focus:bg-cloud transition-all outline-none"
              placeholder={config.engine === "gpt-sovits" ? "参考音频名.wav" : "0"}
            />
          )}
        </div>

        {/* API 地址 */}
        <div className="mb-5">
          <label className="block text-xs font-medium text-ink-soft mb-1.5">API 地址</label>
          <input
            type="text"
            value={config.apiUrl}
            onChange={(e) => update({ apiUrl: e.target.value })}
            className="w-full h-9 px-3 rounded-lg text-sm font-mono text-ink bg-paper-warm/80 border border-paper-deep/40 focus:border-bamboo/40 focus:bg-cloud transition-all outline-none"
            placeholder={config.engine === "openai" ? DEFAULT_TTS.apiUrl : "http://127.0.0.1:9880"}
          />
          <p className="text-[10px] text-ink-ghost mt-1">
            {config.engine === "gpt-sovits" &&
              "GPT-SoVITS 本地服务的 HTTP API 地址（api_v2.py，POST /tts）"}
            {config.engine === "vits" && "MoeTTS / VITS 服务地址（GET /tts?text=...&id=<说话人>）"}
            {config.engine === "edge" && "无需填写，使用系统内置 Edge / 中文语音"}
            {config.engine === "openai" &&
              "OpenAI 兼容 / VibeVoice 服务地址（本地默认 POST /audio/speech）"}
            {config.engine === "dashscope" &&
              "阿里云百炼 base（国内 https://dashscope.aliyuncs.com/api/v1，国际 dashscope-intl）"}
          </p>
        </div>

        {/* OpenAI / 阿里云 TTS 专用 API Key */}
        {(config.engine === "openai" || config.engine === "dashscope") && (
          <div className="mb-5">
            <label className="block text-xs font-medium text-ink-soft mb-1.5">API Key</label>
            <input
              type="password"
              value={config.apiKey}
              onChange={(e) => update({ apiKey: e.target.value })}
              className="w-full h-9 px-3 rounded-lg text-sm font-mono text-ink bg-paper-warm/80 border border-paper-deep/40 focus:border-bamboo/40 focus:bg-cloud transition-all outline-none"
              placeholder="sk-..."
            />
            <p className="text-[10px] text-ink-ghost mt-1">
              仅保存在本机 localStorage，用于云端 TTS 请求
            </p>
          </div>
        )}

        {/* GPT 模型权重 (CKPT) */}
        <div className="mb-5">
          <label className="block text-xs font-medium text-ink-soft mb-1.5">
            GPT 模型权重 (CKPT)
            <span className="text-ink-ghost font-normal ml-1">— 文本 → 语音特征</span>
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              value={config.gptWeightsPath}
              onChange={(e) => update({ gptWeightsPath: e.target.value })}
              className="flex-1 h-9 px-3 rounded-lg text-xs font-mono text-ink bg-paper-warm/80 border border-paper-deep/40 focus:border-bamboo/40 focus:bg-cloud transition-all outline-none"
              placeholder="F:\ai\Elysia\resources\G\xxx.ckpt"
            />
            <button
              onClick={() => handleBrowseFile("gptWeightsPath")}
              className="shrink-0 px-4 h-9 rounded-lg text-xs font-medium text-bamboo bg-bamboo-mist/60 hover:bg-bamboo-mist/90 border border-bamboo/20 transition-all cursor-pointer"
            >
              浏览...
            </button>
          </div>
        </div>

        {/* SoVITS 模型权重 (PTH) */}
        <div className="mb-5">
          <label className="block text-xs font-medium text-ink-soft mb-1.5">
            SoVITS 模型权重 (PTH)
            <span className="text-ink-ghost font-normal ml-1">— 语音特征 → 音频</span>
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              value={config.sovitsWeightsPath}
              onChange={(e) => update({ sovitsWeightsPath: e.target.value })}
              className="flex-1 h-9 px-3 rounded-lg text-xs font-mono text-ink bg-paper-warm/80 border border-paper-deep/40 focus:border-bamboo/40 focus:bg-cloud transition-all outline-none"
              placeholder="F:\ai\Elysia\resources\G\xxx.pth"
            />
            <button
              onClick={() => handleBrowseFile("sovitsWeightsPath")}
              className="shrink-0 px-4 h-9 rounded-lg text-xs font-medium text-bamboo bg-bamboo-mist/60 hover:bg-bamboo-mist/90 border border-bamboo/20 transition-all cursor-pointer"
            >
              浏览...
            </button>
          </div>
        </div>

        {/* 参考音频目录 */}
        <div className="mb-5">
          <label className="block text-xs font-medium text-ink-soft mb-1.5">
            参考音频目录
            <span className="text-ink-ghost font-normal ml-1">— 存放带情绪标签的 .wav 文件</span>
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              value={config.refAudioDir}
              onChange={(e) => update({ refAudioDir: e.target.value })}
              className="flex-1 h-9 px-3 rounded-lg text-xs font-mono text-ink bg-paper-warm/80 border border-paper-deep/40 focus:border-bamboo/40 focus:bg-cloud transition-all outline-none"
              placeholder="F:\ai\Elysia\resources\G"
            />
            <button
              onClick={handleBrowseDir}
              className="shrink-0 px-4 h-9 rounded-lg text-xs font-medium text-bamboo bg-bamboo-mist/60 hover:bg-bamboo-mist/90 border border-bamboo/20 transition-all cursor-pointer"
            >
              浏览...
            </button>
          </div>
          <p className="text-[10px] text-ink-ghost mt-1">
            文件名格式示例：
            <code className="bg-paper-deep/30 px-1 rounded">【开心】今天天气真好.wav</code>—
            支持情绪标签自动匹配
          </p>
        </div>

        {/* 默认语速 */}
        <div className="mb-5">
          <label className="block text-xs font-medium text-ink-soft mb-1.5">
            默认语速
            <span className="text-ink-ghost font-normal ml-1">— 会根据文本情绪自动微调</span>
          </label>
          <div className="flex items-center gap-3">
            <input
              type="range"
              min="0.5"
              max="2.0"
              step="0.05"
              value={config.defaultSpeed}
              onChange={(e) => update({ defaultSpeed: parseFloat(e.target.value) })}
              className="flex-1 h-1.5 rounded-full bg-paper-deep/30 appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-bamboo [&::-webkit-slider-thumb]:cursor-pointer"
            />
            <span className="w-12 text-center text-sm font-mono text-ink-soft tabular-nums">
              {config.defaultSpeed.toFixed(2)}
            </span>
          </div>
          <div className="flex gap-3 mt-2">
            {[
              { emo: "开心", adj: "+15%" },
              { emo: "难过", adj: "-15%" },
              { emo: "生气", adj: "+10%" },
              { emo: "平静", adj: "不变" },
            ].map(({ emo, adj }) => (
              <span
                key={emo}
                className="text-[10px] text-ink-ghost bg-paper-warm/60 px-2 py-0.5 rounded"
              >
                {emo}: {adj}
              </span>
            ))}
          </div>
        </div>

        {/* 音量 */}
        <div className="mb-5">
          <label className="block text-xs font-medium text-ink-soft mb-1.5">音量</label>
          <div className="flex items-center gap-3">
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={config.volume}
              onChange={(e) => update({ volume: parseFloat(e.target.value) })}
              className="flex-1 h-1.5 rounded-full bg-paper-deep/30 appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-bamboo [&::-webkit-slider-thumb]:cursor-pointer"
            />
            <span className="w-12 text-center text-sm font-mono text-ink-soft tabular-nums">
              {Math.round(config.volume * 100)}%
            </span>
          </div>
        </div>

        {/* 提示信息 */}
        <div className="mb-6 p-3 rounded-lg bg-bamboo-mist/40 border border-bamboo/15">
          <p className="text-xs text-ink-soft leading-relaxed">
            <span className="font-semibold text-bamboo">提示：</span>
            {config.engine === "gpt-sovits" && (
              <>
                请先启动 GPT-SoVITS 的{" "}
                <code className="bg-paper-deep/30 px-1 rounded">api_v2.py</code> 服务
                并加载权重，再填写参考音频（音色），即可在左侧 AI 对话窗口听到角色朗读。
              </>
            )}
            {config.engine === "vits" && (
              <>
                启动 MoeTTS 服务后，音色填说话人 id（默认 0），请求路径为{" "}
                <code className="bg-paper-deep/30 px-1 rounded">
                  GET /tts?text=...&id=&lt;说话人&gt;
                </code>
                。
              </>
            )}
            {config.engine === "edge" && (
              <>使用系统内置 Edge / 中文语音，无需服务端；音色留空自动选择中文女声。</>
            )}
            {config.engine === "openai" && (
              <>
                默认接本地 VibeVoice：
                <code className="bg-paper-deep/30 px-1 rounded">http://127.0.0.1:8001/v1</code>
                ，请求路径为{" "}
                <code className="bg-paper-deep/30 px-1 rounded">POST /audio/speech</code>
                。本地服务不需要 API Key。
              </>
            )}
          </p>
        </div>

        {/* 操作按钮 */}
        <div className="flex items-center gap-3 pt-2 border-t border-paper-deep/20">
          <button
            onClick={handleTest}
            className="px-5 h-9 rounded-lg text-xs font-medium text-cloud bg-bamboo hover:bg-bamboo-light transition-all cursor-pointer"
          >
            试听
          </button>
          <button
            onClick={stopSpeech}
            className="px-5 h-9 rounded-lg text-xs font-medium text-ink-faint bg-paper-warm/80 hover:bg-paper-deep/30 hover:text-ink-soft border border-paper-deep/30 transition-all cursor-pointer"
          >
            停止
          </button>
          <button
            onClick={handleReset}
            className="px-5 h-9 rounded-lg text-xs font-medium text-ink-faint bg-paper-warm/80 hover:bg-paper-deep/30 hover:text-ink-soft border border-paper-deep/30 transition-all cursor-pointer"
          >
            恢复默认
          </button>
          {testOk && (
            <span className="text-[11px] font-medium text-bamboo">
              ✓ 已开始播放（请留意音量/静音）
            </span>
          )}
          {testError && (
            <span className="text-[11px] font-medium text-danger break-all">
              播放失败：{testError}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

// ---- Elysia 主页面 ----
export function ElysiaPage() {
  const [activeTab, setActiveTab] = useState<ElysiaTab>("live2d");
  const [ttsConfig, setTTSConfig] = useState<TTSConfig>(() => loadTTSConfig());

  const handleTTSChange = useCallback((config: TTSConfig) => {
    setTTSConfig(config);
    saveTTSConfig(config);
  }, []);

  const renderContent = () => {
    switch (activeTab) {
      case "live2d":
        return <Live2DCompanionSettings />;
      case "tts":
        return <TTSSettings config={ttsConfig} onChange={handleTTSChange} />;
      default:
        return <PlaceholderContent tab={activeTab} />;
    }
  };

  return (
    <div className="flex-1 flex flex-col min-h-0" style={{ backgroundColor: "var(--color-paper)" }}>
      {/* 顶部标题栏 */}
      <header className="shrink-0 flex items-center justify-between h-11 px-4 border-b border-paper-deep/20 bg-paper/80 backdrop-blur-sm">
        <h1 className="text-sm font-display font-bold text-ink tracking-wide select-none">
          Elysia
        </h1>
        <button
          className="w-7 h-7 flex items-center justify-center rounded-lg text-ink-ghost hover:text-ink-faint hover:bg-paper-warm transition-all cursor-pointer"
          title="设置"
        >
          <svg
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </button>
      </header>

      {/* 主体：左导航 + 右内容 */}
      <div className="flex-1 flex min-h-0">
        {/* 左侧导航 */}
        <nav className="shrink-0 w-[140px] border-r border-paper-deep/20 bg-paper/50 py-3 flex flex-col gap-0.5">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-2.5 mx-2 px-3 py-2 rounded-lg text-xs font-medium transition-all duration-200 cursor-pointer text-left ${
                activeTab === tab.key
                  ? "bg-bamboo-mist/70 text-bamboo"
                  : "text-ink-soft hover:bg-paper-warm/80 hover:text-ink"
              }`}
            >
              <span className="text-sm w-5 text-center shrink-0">{tab.icon}</span>
              <span>{tab.label}</span>
            </button>
          ))}
        </nav>

        {/* 右侧内容区 */}
        <main className="flex-1 flex flex-col min-w-0 overflow-hidden">{renderContent()}</main>
      </div>
    </div>
  );
}
