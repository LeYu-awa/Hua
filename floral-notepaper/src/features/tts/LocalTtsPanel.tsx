import { useCallback, useEffect, useRef, useState } from "react";
import {
  localTtsDeleteVoice,
  localTtsDownload,
  localTtsImportOffline,
  localTtsListCatalog,
  localTtsListInstalled,
  localTtsStatus,
  onLocalTtsDownloadComplete,
  onLocalTtsDownloadProgress,
  type LocalTtsAsset,
  type LocalTtsDownloadProgress,
  type LocalTtsStatus,
  type LocalTtsVoiceRecord,
} from "./localTtsApi";

/** LingChat 开发模式数据目录（离线导入默认源，MIT 同源可复用） */
const LINGCHAT_TTS_DIR = "D:\\花箴\\Aigalgame\\LingChat\\data\\models\\tts-local";

/**
 * 本地 SBV2 TTS 资产面板（LingChat 同源方案）：
 * 按需下载 DeBERTa 语义编码模型 + Ling-v2 音色，进度可视化，
 * 下载后后端自动初始化引擎，即可一键启用（无感切换）。
 */
export function LocalTtsPanel({
  voice,
  onChangeVoice,
}: {
  voice: string;
  onChangeVoice: (v: string) => void;
}) {
  const [catalog, setCatalog] = useState<LocalTtsAsset[]>([]);
  const [installedVoices, setInstalledVoices] = useState<LocalTtsVoiceRecord[]>([]);
  const [status, setStatus] = useState<LocalTtsStatus | null>(null);
  const [progress, setProgress] = useState<Record<string, LocalTtsDownloadProgress>>({});
  const [downloading, setDownloading] = useState<Record<string, boolean>>({});
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const unlistenRef = useRef<(() => void)[]>([]);

  const refresh = useCallback(async () => {
    const [catalog, installed, status] = await Promise.all([
      localTtsListCatalog(),
      localTtsListInstalled(),
      localTtsStatus(),
    ]);
    setCatalog(catalog);
    setInstalledVoices(installed.voices);
    setStatus(status);
  }, []);

  useEffect(() => {
    refresh();
    let cancelled = false;
    (async () => {
      const un1 = await onLocalTtsDownloadProgress((p) => {
        if (cancelled) return;
        setProgress((prev) => ({ ...prev, [p.asset_id]: p }));
      });
      const un2 = await onLocalTtsDownloadComplete(() => {
        if (cancelled) return;
        refresh();
      });
      unlistenRef.current = [un1, un2];
    })();
    return () => {
      cancelled = true;
      unlistenRef.current.forEach((un) => un());
      unlistenRef.current = [];
    };
  }, [refresh]);

  // 已安装音色存在、但当前配置的 voice 不是已安装音色时，自动选中第一个
  // （默认 voice 是 "furina"，对本地引擎无效，避免试听因音色缺失而失败）
  useEffect(() => {
    if (installedVoices.length === 0) return;
    if (!installedVoices.some((v) => v.voice_id === voice)) {
      onChangeVoice(installedVoices[0].voice_id);
    }
  }, [installedVoices, voice, onChangeVoice]);

  const startDownload = async (asset: LocalTtsAsset) => {
    setError(null);
    setDownloading((prev) => ({ ...prev, [asset.id]: true }));
    setProgress((prev) => ({
      ...prev,
      [asset.id]: { asset_id: asset.id, bytes_done: 0, total_bytes: asset.size_bytes, percent: 0 },
    }));
    try {
      await localTtsDownload(asset.id);
      await refresh();
    } catch (e) {
      setError(`下载 ${asset.display_name} 失败：${e}`);
    } finally {
      setDownloading((prev) => ({ ...prev, [asset.id]: false }));
    }
  };

  const handleDelete = async (voiceId: string) => {
    try {
      await localTtsDeleteVoice(voiceId);
      if (voice === voiceId) onChangeVoice("");
      await refresh();
    } catch (e) {
      setError(`删除 ${voiceId} 失败：${e}`);
    }
  };

  /** 离线导入：从本地目录（默认 LingChat 数据目录）复制已下载的日语模型资产 */
  const handleImportOffline = async () => {
    setError(null);
    setImporting(true);
    try {
      let dir = LINGCHAT_TTS_DIR;
      try {
        const { open } = await import("@tauri-apps/plugin-dialog");
        const selected = await open({
          directory: true,
          defaultPath: LINGCHAT_TTS_DIR,
          title: "选择含 assets/ 与 voices/ 的本地 TTS 目录",
        });
        if (typeof selected === "string") dir = selected;
        else return; // 用户取消
      } catch {
        // 非 Tauri / 插件缺失：使用默认路径
      }
      const snapshot = await localTtsImportOffline(dir);
      if (snapshot) {
        await refresh();
        if (snapshot.voices.length > 0 && !voice) {
          onChangeVoice(snapshot.voices[0].voice_id);
        }
      } else {
        setError(`离线导入失败：目录不存在或缺少模型文件（${dir}）`);
      }
    } finally {
      setImporting(false);
    }
  };

  const installedIds = new Set(installedVoices.map((v) => v.voice_id));
  const debertaReady = !!status?.deberta_installed;

  const fmtBytes = (n?: number) => {
    if (!n) return "0 B";
    const units = ["B", "KB", "MB", "GB"];
    let i = 0;
    let v = n;
    while (v >= 1024 && i < units.length - 1) {
      v /= 1024;
      i++;
    }
    return `${v.toFixed(v >= 100 ? 0 : 1)} ${units[i]}`;
  };

  const progressBar = (assetId: string, assetSize: number) => {
    const p = progress[assetId];
    const active = downloading[assetId];
    if (!active && !p) return null;
    const percent = p?.percent ?? 0;
    return (
      <div className="mt-2">
        <div className="h-1.5 rounded-full bg-paper-deep/30 overflow-hidden">
          <div
            className="h-full rounded-full bg-bamboo transition-all"
            style={{ width: `${Math.min(100, percent)}%` }}
          />
        </div>
        <div className="flex justify-between mt-1 text-[10px] text-ink-ghost font-mono tabular-nums">
          <span>{active ? "下载中…" : "已暂停"}</span>
          <span>
            {fmtBytes(p?.bytes_done ?? 0)} / {fmtBytes(assetSize)} ({Math.round(percent)}%)
          </span>
        </div>
      </div>
    );
  };

  return (
    <div className="mb-5 rounded-xl bg-bamboo-mist/20 border border-bamboo/15 p-3.5">
      <div className="flex items-center justify-between mb-2">
        <label className="text-xs font-medium text-ink">本地 SBV2 引擎资产（一次性下载，离线合成）</label>
        <span
          className={`px-2 py-0.5 rounded text-[10px] font-medium ${
            status?.ready
              ? "bg-bamboo/15 text-bamboo"
              : debertaReady
                ? "bg-amber/15 text-amber"
                : "bg-paper-deep/30 text-ink-ghost"
          }`}
        >
          {status?.ready ? "引擎就绪" : debertaReady ? "待选择音色" : "未安装"}
        </span>
      </div>

      <div className="mb-2.5 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={handleImportOffline}
          disabled={importing}
          className="h-7 px-3 rounded-lg text-[11px] font-medium text-bamboo bg-bamboo-mist/30 border border-bamboo/25 hover:bg-bamboo-mist/50 disabled:opacity-50 disabled:cursor-not-allowed transition-all cursor-pointer"
          title="把 LingChat 已下载的日语模型直接复制到花笺（无需联网）"
        >
          {importing ? "导入中…" : "从 LingChat 离线导入模型"}
        </button>
        <span className="text-[10px] text-ink-ghost">
          若网络不可用，可直接复用 LingChat 已下载的模型（MIT/Apache-2.0）
        </span>
      </div>

      <div className="space-y-2.5">
        {catalog.map((asset) => {
          const isVoice = asset.kind === "voice";
          const installed = isVoice ? installedIds.has(asset.id) : debertaReady;
          return (
            <div
              key={asset.id}
              className="flex items-start gap-3 p-2.5 rounded-lg bg-paper-warm/60 border border-paper-deep/25"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-ink truncate">{asset.display_name}</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-paper-deep/30 text-ink-ghost">
                    {isVoice ? "音色" : "语义编码"}
                  </span>
                  {installed && (
                    <span className="text-[10px] font-medium text-bamboo">✓ 已安装</span>
                  )}
                </div>
                <div className="text-[10px] text-ink-ghost mt-0.5 truncate">
                  {asset.language} · {fmtBytes(asset.size_bytes)} · {asset.source}
                </div>
                {isVoice && (
                  <div className="text-[10px] text-ink-ghost mt-0.5">
                    绑定 2 个关联文件（模型 + 情绪风格向量）
                  </div>
                )}
                {progressBar(asset.id, asset.size_bytes)}
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                {isVoice && installed ? (
                  <>
                    <select
                      value={voice}
                      onChange={(e) => onChangeVoice(e.target.value)}
                      className="h-7 px-2 rounded-lg text-xs font-body text-ink bg-paper-warm/80 border border-paper-deep/40 focus:border-bamboo/40 outline-none cursor-pointer"
                      title="选择该音色用于朗读"
                    >
                      <option value="" disabled>
                        选择音色…
                      </option>
                      {installedVoices.map((v) => (
                        <option key={v.voice_id} value={v.voice_id}>
                          {v.display_name ?? v.voice_id}
                        </option>
                      ))}
                    </select>
                    <button
                      onClick={() => handleDelete(asset.id)}
                      className="h-7 px-2.5 rounded-lg text-[10px] font-medium text-ink-ghost hover:text-danger bg-paper-deep/20 hover:bg-paper-deep/40 transition-all cursor-pointer"
                      title="删除音色（释放磁盘空间）"
                    >
                      删除
                    </button>
                  </>
                ) : installed ? (
                  <span className="text-[10px] text-ink-ghost px-1">已安装</span>
                ) : (
                  <button
                    onClick={() => startDownload(asset)}
                    disabled={!!downloading[asset.id]}
                    className="h-7 px-3 rounded-lg text-[11px] font-medium text-white bg-bamboo hover:bg-bamboo-deep disabled:opacity-50 disabled:cursor-not-allowed transition-all cursor-pointer"
                  >
                    {downloading[asset.id] ? "下载中…" : "下载"}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {error && <p className="mt-2 text-[11px] text-danger">{error}</p>}
      <p className="mt-2.5 text-[10px] text-ink-ghost leading-relaxed">
        模型来源：ModelScope lingchat-research-studio（DeBERTa 日语语义编码 +
        Ling-v2 音色，Apache-2.0）。下载完成后自动初始化引擎，朗读请求将直接在本地进程内合成，无需外部服务。
      </p>
    </div>
  );
}
