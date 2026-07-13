import { useState, useCallback } from "react";

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

// ---- TTS 配置状态 ----
interface TTSConfig {
  engine: string;
  model: string;
  apiUrl: string;
  gptWeightsPath: string;
  sovitsWeightsPath: string;
  refAudioDir: string;
  defaultSpeed: number;
}

const TTS_ENGINES = ["GPT-SoVITS (本地)", "VITS (本地)", "Edge TTS (云端)", "OpenAI TTS (云端)"];

const DEFAULT_TTS: TTSConfig = {
  engine: "GPT-SoVITS (本地)",
  model: "",
  apiUrl: "http://127.0.0.1:9880",
  gptWeightsPath: "",
  sovitsWeightsPath: "",
  refAudioDir: "",
  defaultSpeed: 1.1,
};

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
function TTSSettings({ config, onChange }: { config: TTSConfig; onChange: (c: TTSConfig) => void }) {
  const update = (patch: Partial<TTSConfig>) => onChange({ ...config, ...patch });

  const handleBrowseFile = async (key: "gptWeightsPath" | "sovitsWeightsPath") => {
    try {
      // 使用 Tauri dialog 选择文件
      const { open } = await import("@tauri-apps/plugin-dialog");
      const extensions = key === "gptWeightsPath"
        ? [{ name: "CKPT", extensions: ["ckpt"] }]
        : [{ name: "PTH", extensions: ["pth"] }];
      const selected = await open({
        title: key === "gptWeightsPath" ? "选择 GPT 模型权重 (.ckpt)" : "选择 SoVITS 模型权重 (.pth)",
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
        <h2 className="text-lg font-display font-bold text-ink mb-6">GPT-SoVITS 配置</h2>

        {/* TTS 引擎 */}
        <div className="mb-5">
          <label className="block text-xs font-medium text-ink-soft mb-1.5">TTS 引擎</label>
          <select
            value={config.engine}
            onChange={(e) => update({ engine: e.target.value })}
            className="w-full h-9 px-3 rounded-lg text-sm font-body text-ink bg-paper-warm/80 border border-paper-deep/40 focus:border-bamboo/40 focus:bg-cloud transition-all outline-none cursor-pointer"
          >
            {TTS_ENGINES.map((e) => (
              <option key={e} value={e}>{e}</option>
            ))}
          </select>
        </div>

        {/* 模型选择 */}
        <div className="mb-5">
          <label className="block text-xs font-medium text-ink-soft mb-1.5">模型</label>
          <select
            value={config.model}
            onChange={(e) => update({ model: e.target.value })}
            className="w-full h-9 px-3 rounded-lg text-sm font-body text-ink bg-paper-warm/80 border border-paper-deep/40 focus:border-bamboo/40 focus:bg-cloud transition-all outline-none cursor-pointer"
          >
            <option value="">-- 请先加载模型权重 --</option>
          </select>
          <p className="text-[10px] text-ink-ghost mt-1">启动 api_v2.py 并加载权重后，模型将在此处显示</p>
        </div>

        {/* API 地址 */}
        <div className="mb-5">
          <label className="block text-xs font-medium text-ink-soft mb-1.5">API 地址</label>
          <input
            type="text"
            value={config.apiUrl}
            onChange={(e) => update({ apiUrl: e.target.value })}
            className="w-full h-9 px-3 rounded-lg text-sm font-mono text-ink bg-paper-warm/80 border border-paper-deep/40 focus:border-bamboo/40 focus:bg-cloud transition-all outline-none"
            placeholder="http://127.0.0.1:9880"
          />
          <p className="text-[10px] text-ink-ghost mt-1">GPT-SoVITS 本地服务的 HTTP API 地址</p>
        </div>

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
            文件名格式示例：<code className="bg-paper-deep/30 px-1 rounded">【开心】今天天气真好.wav</code>
            — 支持情绪标签自动匹配
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
              <span key={emo} className="text-[10px] text-ink-ghost bg-paper-warm/60 px-2 py-0.5 rounded">
                {emo}: {adj}
              </span>
            ))}
          </div>
        </div>

        {/* 提示信息 */}
        <div className="mb-6 p-3 rounded-lg bg-bamboo-mist/40 border border-bamboo/15">
          <p className="text-xs text-ink-soft leading-relaxed">
            <span className="font-semibold text-bamboo">提示：</span>
            请先启动 GPT-SoVITS 的 <code className="bg-paper-deep/30 px-1 rounded">api_v2.py</code> 服务，
            然后通过 HTTP API 加载模型权重。服务启动后，模型列表将自动填充。
          </p>
        </div>

        {/* 操作按钮 */}
        <div className="flex items-center gap-3 pt-2 border-t border-paper-deep/20">
          <button
            onClick={handleReset}
            className="px-5 h-9 rounded-lg text-xs font-medium text-ink-faint bg-paper-warm/80 hover:bg-paper-deep/30 hover:text-ink-soft border border-paper-deep/30 transition-all cursor-pointer"
          >
            恢复默认
          </button>
        </div>
      </div>
    </div>
  );
}

// ---- Elysia 主页面 ----
export function ElysiaPage() {
  const [activeTab, setActiveTab] = useState<ElysiaTab>("tts");
  const [ttsConfig, setTTSConfig] = useState<TTSConfig>(() => {
    // 尝试从 localStorage 恢复配置
    try {
      const saved = localStorage.getItem("elysia_tts_config");
      if (saved) return { ...DEFAULT_TTS, ...JSON.parse(saved) };
    } catch { /* ignore */ }
    return { ...DEFAULT_TTS };
  });

  const handleTTSChange = useCallback((config: TTSConfig) => {
    setTTSConfig(config);
    try {
      localStorage.setItem("elysia_tts_config", JSON.stringify(config));
    } catch { /* ignore */ }
  }, []);

  const renderContent = () => {
    switch (activeTab) {
      case "tts":
        return <TTSSettings config={ttsConfig} onChange={handleTTSChange} />;
      default:
        return <PlaceholderContent tab={activeTab} />;
    }
  };

  return (
    <div
      className="flex-1 flex flex-col min-h-0"
      style={{ backgroundColor: "var(--color-paper)" }}
    >
      {/* 顶部标题栏 */}
      <header className="shrink-0 flex items-center justify-between h-11 px-4 border-b border-paper-deep/20 bg-paper/80 backdrop-blur-sm">
        <h1 className="text-sm font-display font-bold text-ink tracking-wide select-none">
          Elysia
        </h1>
        <button
          className="w-7 h-7 flex items-center justify-center rounded-lg text-ink-ghost hover:text-ink-faint hover:bg-paper-warm transition-all cursor-pointer"
          title="设置"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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
        <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
          {renderContent()}
        </main>
      </div>
    </div>
  );
}
