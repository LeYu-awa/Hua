import { openUrl } from "@tauri-apps/plugin-opener";
import { useState } from "react";

export function RHTVPage() {
  const [starting, setStarting] = useState(false);

  const handleStart = async () => {
    setStarting(true);
    // 如果 ComfyUI 已经在运行，直接打开浏览器
    await openUrl("http://127.0.0.1:8188");
    setTimeout(() => setStarting(false), 2000);
  };

  return (
    <div className="h-full w-full flex flex-col items-center justify-center gap-5 text-ink-soft p-8">
      <svg
        width={48}
        height={48}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="opacity-40"
      >
        <polyline points="4 17 10 11 4 5" />
        <line x1="12" y1="19" x2="20" y2="19" />
      </svg>

      <h2 className="text-base font-medium text-ink">ComfyUI 已在本地下载</h2>

      <div className="max-w-md text-sm leading-relaxed space-y-2">
        <p>
          ComfyUI 已安装到 <code className="bg-paper-warm px-1 rounded">d:\花箴\comfyui</code>
        </p>
        <p>
          首次启动前需要下载模型文件（如 SDXL、Flux 等），
          请先运行启动脚本：
        </p>
        <div className="bg-paper-warm rounded-lg p-3 font-mono text-xs select-all">
          d:\花箴\comfyui\start.bat
        </div>
      </div>

      <button
        onClick={handleStart}
        disabled={starting}
        className="px-4 py-2 rounded-lg bg-bamboo text-cloud text-sm hover:opacity-80 transition-opacity cursor-pointer disabled:opacity-50"
      >
        {starting ? "打开中..." : "打开 ComfyUI"}
      </button>

      <p className="text-xs text-ink-ghost max-w-sm text-center leading-relaxed">
        提示：首次使用需要先运行 start.bat 启动服务，
        然后在浏览器中通过 ComfyUI Manager 下载所需的模型。
        之后每次使用前启动 start.bat 即可。
      </p>
    </div>
  );
}
