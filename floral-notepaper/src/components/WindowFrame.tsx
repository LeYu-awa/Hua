import { useCallback, useState } from "react";
import {
  closeCurrentWindow,
  minimizeCurrentWindow,
  toggleMaximizeCurrentWindow,
  startCurrentWindowDrag,
} from "../features/windows/controls";
import { usesNativeTitleBar } from "../features/windows/platform";
import floralIcon from "../assets/images/floral-icon.png";

interface WindowFrameProps {
  /** Children rendered below the title bar */
  children: React.ReactNode;
}

export function WindowFrame({ children }: WindowFrameProps) {
  const [isMaximized, setIsMaximized] = useState(false);
  // macOS (non-tile windows) uses the native title bar; others keep custom chrome.
  const nativeChrome = usesNativeTitleBar();

  const handleDrag = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest("button")) return;
    void startCurrentWindowDrag().catch(() => undefined);
  }, []);

  const handleMinimize = useCallback(() => {
    void minimizeCurrentWindow().catch(() => undefined);
  }, []);

  const handleMaximize = useCallback(() => {
    setIsMaximized((v) => !v);
    void toggleMaximizeCurrentWindow().catch(() => undefined);
  }, []);

  const handleClose = useCallback(() => {
    void closeCurrentWindow().catch(() => undefined);
  }, []);

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      {/* ── unified title bar ── */}
      <div
        className={`flex items-center justify-between h-10 shrink-0 select-none bg-paper ${
          nativeChrome ? "pl-[82px] pr-3" : "px-3"
        }`}
        onMouseDown={handleDrag}
      >
        {/* left: app name (the icon is dropped under the native title bar on macOS;
            custom-chrome platforms keep the icon for branding) */}
        <div className="flex items-center gap-2 pl-1">
          {!nativeChrome && (
            <img src={floralIcon} alt="花笺" className="w-[17px] h-[17px] object-contain" />
          )}
          <span className="text-[12px] font-display font-medium text-ink-soft tracking-wide">
            花笺
          </span>
        </div>

        {/* right: window controls — hidden when the native title bar is used */}
        {!nativeChrome && (
          <div className="flex items-center gap-1">
            <button
              onClick={handleMinimize}
              className="w-7 h-7 flex items-center justify-center rounded-md text-ink-ghost hover:text-ink-soft hover:bg-paper-warm transition-colors cursor-pointer"
              title="最小化"
            >
              <svg
                width="10"
                height="10"
                viewBox="0 0 12 12"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              >
                <path d="M2 6h8" />
              </svg>
            </button>

            <button
              onClick={handleMaximize}
              className="w-7 h-7 flex items-center justify-center rounded-md text-ink-ghost hover:text-ink-soft hover:bg-paper-warm transition-colors cursor-pointer"
              title={isMaximized ? "还原" : "最大化"}
            >
              {isMaximized ? (
                <svg
                  width="10"
                  height="10"
                  viewBox="0 0 12 12"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                >
                  <rect x="1.5" y="5" width="5.5" height="5.5" rx="0.5" />
                  <path d="M5 1.5V3.3a1.8 1.8 0 0 0 1.8 1.8h1.7" />
                  <rect x="5" y="5" width="5.5" height="5.5" rx="0.5" fill="none" />
                </svg>
              ) : (
                <svg
                  width="10"
                  height="10"
                  viewBox="0 0 12 12"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                >
                  <rect x="2" y="2" width="8" height="8" rx="0.8" />
                </svg>
              )}
            </button>

            <button
              onClick={handleClose}
              className="w-7 h-7 flex items-center justify-center rounded-md text-ink-ghost hover:text-white hover:bg-red-500 transition-colors cursor-pointer"
              title="关闭"
            >
              <svg
                width="10"
                height="10"
                viewBox="0 0 12 12"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              >
                <path d="M2 2l8 8M10 2l-8 8" />
              </svg>
            </button>
          </div>
        )}
      </div>

      {/* ── content ── */}
      <div className="flex-1 min-h-0">{children}</div>
    </div>
  );
}
