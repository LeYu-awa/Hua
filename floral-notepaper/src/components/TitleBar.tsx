import { useCallback, useState } from "react";
import {
  closeCurrentWindow,
  minimizeCurrentWindow,
  toggleMaximizeCurrentWindow,
  startCurrentWindowDrag,
} from "../features/windows/controls";

interface TitleBarProps {
  /** Page/panel title shown in the bar */
  title: string;
  /** If provided, shows a close button instead of native close */
  onClose?: () => void;
  /** Extra buttons to render on the right (before window controls) */
  extra?: React.ReactNode;
}

export function TitleBar({ title, onClose, extra }: TitleBarProps) {
  const [isMaximized, setIsMaximized] = useState(false);

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
    if (onClose) {
      onClose();
    } else {
      void closeCurrentWindow().catch(() => undefined);
    }
  }, [onClose]);

  return (
    <div
      className="flex items-center justify-between h-11 px-4 border-b border-paper-deep/25 shrink-0 select-none bg-paper/40"
      onMouseDown={handleDrag}
    >
      <h2 className="text-[13px] font-display font-medium text-ink-soft">{title}</h2>

      <div className="flex items-center gap-2">
        {extra}

        {/* minimize */}
        <button
          onClick={handleMinimize}
          className="w-7 h-7 flex items-center justify-center rounded-lg text-ink-ghost hover:text-ink-soft hover:bg-paper-warm transition-colors cursor-pointer"
          title="最小化"
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 12 12"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          >
            <path d="M2 6h8" />
          </svg>
        </button>

        {/* maximize / restore */}
        <button
          onClick={handleMaximize}
          className="w-7 h-7 flex items-center justify-center rounded-lg text-ink-ghost hover:text-ink-soft hover:bg-paper-warm transition-colors cursor-pointer"
          title={isMaximized ? "还原" : "最大化"}
        >
          {isMaximized ? (
            <svg
              width="12"
              height="12"
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
              width="12"
              height="12"
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

        {/* close */}
        <button
          onClick={handleClose}
          className="w-7 h-7 flex items-center justify-center rounded-lg text-ink-ghost hover:text-red-500 hover:bg-red-50 transition-colors cursor-pointer"
          title="关闭"
        >
          <svg
            width="12"
            height="12"
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
    </div>
  );
}
