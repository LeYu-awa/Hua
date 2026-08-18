import { useCallback, useEffect, useState } from "react";
import { signIn, signUp, resetPassword } from "./api";

interface LoginModalProps {
  open: boolean;
  onClose: () => void;
  /** 触发来源说明（显示在弹窗顶部） */
  reason?: string;
}

type AuthMode = "login" | "register" | "forgot";

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

/**
 * 通用登录弹窗：在未登录用户执行「创建画布 / 编辑内容 / 发布作品」等写操作时弹出，
 * 完成登录后由 onAuthStateChange 驱动全局 userId 更新，页面自动进入已登录态。
 * 支持登录 / 注册 / 忘记密码三种模式，与设置页 AccountPanel 同源（auth/api）。
 */
export function LoginModal({ open, onClose, reason }: LoginModalProps) {
  const [mode, setMode] = useState<AuthMode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // 每次打开重置表单状态
  useEffect(() => {
    if (open) {
      setMode("login");
      setError("");
      setNotice("");
      setSubmitting(false);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  const handleSubmit = useCallback(async () => {
    const trimmedEmail = email.trim();
    setError("");
    setNotice("");
    setSubmitting(true);
    try {
      if (mode !== "forgot" && !isValidEmail(trimmedEmail)) {
        setError("请输入有效邮箱");
        return;
      }
      if (mode === "forgot") {
        await resetPassword(trimmedEmail);
        setNotice("重置邮件已发送，请检查邮箱完成找回。");
        return;
      }
      if (mode === "register") {
        if (password.length < 8) {
          setError("密码需至少 8 位");
          return;
        }
        await signUp(trimmedEmail, password);
        setNotice("注册成功！请检查邮箱确认链接，或直接尝试登录。");
        setMode("login");
        return;
      }
      await signIn(trimmedEmail, password);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作失败");
    } finally {
      setSubmitting(false);
    }
  }, [mode, email, password, onClose]);

  if (!open) return null;

  const title =
    mode === "register" ? "注册账号" : mode === "forgot" ? "找回密码" : "登录以继续";

  return (
    <div
      className="fixed inset-0 z-[999] flex items-center justify-center bg-black/40 backdrop-blur-[2px]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div className="w-[360px] max-w-[92vw] rounded-2xl border border-paper-deep/30 bg-white p-5 shadow-2xl">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <h3 className="text-[15px] font-semibold text-ink">{title}</h3>
            {reason && <p className="mt-0.5 text-[11px] text-ink-faint">{reason}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            className="h-6 w-6 shrink-0 rounded-md text-ink-ghost transition-colors hover:bg-paper-warm hover:text-ink cursor-pointer"
          >
            ✕
          </button>
        </div>

        {error && (
          <div className="mb-3 rounded-lg border border-red-200/60 bg-red-50/60 px-3 py-2 text-[11px] text-red-500">
            {error}
          </div>
        )}
        {notice && (
          <div className="mb-3 rounded-lg border border-bamboo/20 bg-bamboo-mist/40 px-3 py-2 text-[11px] text-bamboo">
            {notice}
          </div>
        )}

        <div className="space-y-3">
          {mode !== "forgot" && (
            <div>
              <label className="mb-1 block text-[10px] font-medium text-ink-faint">邮箱</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="your@email.com"
                className="h-9 w-full rounded-lg border border-paper-deep/40 bg-paper-warm/60 px-3 text-[12px] text-ink outline-none transition-colors focus:border-bamboo/40"
                onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
                autoFocus
              />
            </div>
          )}

          {mode !== "forgot" && (
            <div>
              <label className="mb-1 block text-[10px] font-medium text-ink-faint">
                {mode === "register" ? "密码（至少 8 位）" : "密码"}
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="h-9 w-full rounded-lg border border-paper-deep/40 bg-paper-warm/60 px-3 text-[12px] text-ink outline-none transition-colors focus:border-bamboo/40"
                onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
              />
            </div>
          )}

          {mode === "forgot" && (
            <div>
              <label className="mb-1 block text-[10px] font-medium text-ink-faint">邮箱</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="your@email.com"
                className="h-9 w-full rounded-lg border border-paper-deep/40 bg-paper-warm/60 px-3 text-[12px] text-ink outline-none transition-colors focus:border-bamboo/40"
                onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
                autoFocus
              />
            </div>
          )}

          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting || (!email.trim() && mode !== "forgot") || (mode !== "forgot" && !password)}
            className="h-10 w-full rounded-xl bg-bamboo/90 text-cloud text-[13px] font-medium transition-colors hover:bg-bamboo disabled:cursor-not-allowed disabled:opacity-40 cursor-pointer"
          >
            {submitting
              ? "处理中…"
              : mode === "register"
                ? "注册"
                : mode === "forgot"
                  ? "发送重置邮件"
                  : "登录"}
          </button>
        </div>

        <p className="mt-4 text-center text-[11px] text-ink-ghost">
          {mode === "login" ? (
            <>
              <button
                type="button"
                onClick={() => {
                  setMode("forgot");
                  setError("");
                  setNotice("");
                }}
                className="text-bamboo hover:underline cursor-pointer"
              >
                忘记密码？
              </button>
              <span className="mx-2 text-ink-ghost/50">·</span>
              还没有账号？{" "}
              <button
                type="button"
                onClick={() => {
                  setMode("register");
                  setError("");
                  setNotice("");
                }}
                className="text-bamboo hover:underline cursor-pointer"
              >
                注册
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => {
                setMode("login");
                setError("");
                setNotice("");
              }}
              className="text-bamboo hover:underline cursor-pointer"
            >
              返回登录
            </button>
          )}
        </p>
      </div>
    </div>
  );
}
