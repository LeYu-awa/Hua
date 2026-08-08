import { useEffect, useState, useCallback } from "react";
import { supabase } from "../features/auth/supabase";
import {
  signUp,
  signIn,
  signOut,
  resetPassword,
  updatePassword,
  getProfile,
  updateProfile,
  uploadAvatar,
  onAuthStateChange,
} from "../features/auth/api";
import { uploadConfig, downloadConfig } from "../features/sync/api";
import type { UserProfile } from "../features/auth/types";
import type { AppConfig } from "../features/settings/types";
import { AccountPanelSkeleton } from "./AccountPanelSkeleton";

interface AccountPanelProps {
  config: AppConfig;
  onConfigChange: (config: AppConfig) => void;
}

type AuthMode = "login" | "register" | "forgotPassword" | "resetPassword";

const PASSWORD_REQUIREMENT_MESSAGE = "密码需至少 8 位，并包含字母、数字和特殊字符";

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function getPasswordResetRedirectTo(): string | undefined {
  if (typeof window === "undefined") return undefined;
  return `${window.location.origin}${window.location.pathname}`;
}

function isRecoveryUrl(): boolean {
  if (typeof window === "undefined") return false;
  const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const searchParams = new URLSearchParams(window.location.search);
  return hashParams.get("type") === "recovery" || searchParams.get("type") === "recovery";
}

function validatePassword(password: string): string | null {
  if (password.length < 8) return PASSWORD_REQUIREMENT_MESSAGE;
  if (!/[A-Za-z]/.test(password)) return PASSWORD_REQUIREMENT_MESSAGE;
  if (!/\d/.test(password)) return PASSWORD_REQUIREMENT_MESSAGE;
  if (!/[^A-Za-z0-9]/.test(password)) return PASSWORD_REQUIREMENT_MESSAGE;
  return null;
}

function getAuthTitle(mode: AuthMode): string {
  if (mode === "register") return "注册";
  if (mode === "forgotPassword") return "找回密码";
  if (mode === "resetPassword") return "设置新密码";
  return "登录";
}

export function AccountPanel({ config, onConfigChange }: AccountPanelProps) {
  const [session, setSession] = useState<boolean>(false);
  const [user, setUser] = useState<{ id: string; email: string | null } | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  // auth form state
  const [mode, setMode] = useState<AuthMode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // edit state
  const [editingName, setEditingName] = useState(false);
  const [editNameValue, setEditNameValue] = useState("");
  const [syncStatus, setSyncStatus] = useState<"idle" | "syncing" | "done" | "error">("idle");

  // init session
  useEffect(() => {
    if (isRecoveryUrl()) {
      setMode("resetPassword");
      setNotice("请设置新密码完成账号恢复。");
    }

    supabase.auth.getSession().then(({ data }) => {
      const s = data.session;
      if (s?.user) {
        setSession(true);
        setUser({ id: s.user.id, email: s.user.email ?? null });
        getProfile(s.user.id).then(setProfile);
      }
      setLoading(false);
    });

    const sub = onAuthStateChange((event, sess) => {
      const s = sess as { user?: { id: string; email?: string } } | null;
      if (event === "PASSWORD_RECOVERY") {
        setMode("resetPassword");
        setNotice("请设置新密码完成账号恢复。");
      }
      if ((event === "SIGNED_IN" || event === "PASSWORD_RECOVERY") && s?.user) {
        setSession(true);
        setUser({ id: s.user.id, email: s.user.email ?? null });
        getProfile(s.user.id).then(setProfile);
      } else if (event === "SIGNED_OUT") {
        setSession(false);
        setUser(null);
        setProfile(null);
        setMode("login");
      }
    });

    return () => sub.unsubscribe();
  }, []);

  // ─── handlers ───

  const handleSubmit = useCallback(async () => {
    const trimmedEmail = email.trim();
    setError("");
    setNotice("");
    setSubmitting(true);
    try {
      if ((mode === "login" || mode === "register" || mode === "forgotPassword") && !isValidEmail(trimmedEmail)) {
        setError("请输入有效邮箱");
        return;
      }

      if (mode === "forgotPassword") {
        await resetPassword(trimmedEmail, getPasswordResetRedirectTo());
        setNotice("重置邮件已发送，请检查邮箱。");
        return;
      }

      if (mode === "resetPassword") {
        const passwordError = validatePassword(password);
        if (passwordError) {
          setError(passwordError);
          return;
        }
        if (password !== confirmPassword) {
          setError("两次输入的密码不一致");
          return;
        }
        await updatePassword(password);
        setPassword("");
        setConfirmPassword("");
        setMode("login");
        setNotice("密码修改成功，请使用新密码登录。");
        await signOut();
        return;
      }

      if (mode === "register") {
        const passwordError = validatePassword(password);
        if (passwordError) {
          setError(passwordError);
          return;
        }
        await signUp(trimmedEmail, password);
        setNotice("注册成功！请检查邮箱确认链接，或直接尝试登录。");
        setMode("login");
      } else {
        await signIn(trimmedEmail, password);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作失败");
    } finally {
      setSubmitting(false);
    }
  }, [mode, email, password, confirmPassword]);

  const handleLogout = useCallback(async () => {
    await signOut();
  }, []);

  const handleSaveName = useCallback(async () => {
    if (!user || !editNameValue.trim()) return;
    try {
      const updated = await updateProfile(user.id, { display_name: editNameValue.trim() });
      if (updated) setProfile(updated);
      setEditingName(false);
    } catch {
      setError("保存失败");
    }
  }, [user, editNameValue]);

  const handleAvatarUpload = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      if (!user) return;
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        const url = await uploadAvatar(user.id, file);
        if (url) {
          const updated = await updateProfile(user.id, { avatar_url: url });
          if (updated) setProfile(updated);
        }
      } catch {
        setError("上传失败");
      }
    },
    [user],
  );

  const handleSyncConfig = useCallback(async () => {
    if (!user) return;
    setSyncStatus("syncing");
    try {
      await uploadConfig(user.id, config);
      setSyncStatus("done");
      setTimeout(() => setSyncStatus("idle"), 2000);
    } catch {
      setSyncStatus("error");
    }
  }, [user, config]);

  const handleLoadConfig = useCallback(async () => {
    if (!user) return;
    setSyncStatus("syncing");
    try {
      const remote = await downloadConfig(user.id);
      if (remote) {
        onConfigChange(remote);
      }
      setSyncStatus("done");
      setTimeout(() => setSyncStatus("idle"), 2000);
    } catch {
      setSyncStatus("error");
    }
  }, [user, onConfigChange]);

  // ─── loading ───
  // 注意：session=true 但 profile 尚未加载完成时也要显示加载状态，
  // 避免中间态渲染登录表单导致闪烁
  if (loading || (session && mode !== "resetPassword" && !profile)) {
    return <AccountPanelSkeleton />;
  }

  // ─── logged in ───
  if (session && user && profile && mode !== "resetPassword") {
    return (
      <ScrollFrame>
        {/* 个人信息卡片 */}
        <Card title="个人信息">
          <div className="flex items-center gap-4">
            {/* 头像 */}
            <label className="relative cursor-pointer group shrink-0">
              <div className="w-16 h-16 rounded-2xl overflow-hidden border-2 border-paper-deep/40 bg-paper-warm/80 flex items-center justify-center">
                {profile.avatar_url ? (
                  <img
                    src={profile.avatar_url}
                    alt="avatar"
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <span className="text-2xl font-display font-bold text-bamboo/60">
                    {(profile.display_name || user.email || "?").charAt(0).toUpperCase()}
                  </span>
                )}
              </div>
              <div className="absolute inset-0 rounded-2xl bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
                <span className="text-[9px] text-white opacity-0 group-hover:opacity-100 transition-opacity">
                  更换
                </span>
              </div>
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleAvatarUpload}
              />
            </label>

            <div className="min-w-0 flex-1">
              {editingName ? (
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={editNameValue}
                    onChange={(e) => setEditNameValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleSaveName();
                      if (e.key === "Escape") setEditingName(false);
                    }}
                    className="h-8 px-2.5 rounded-lg bg-paper-warm/70 border border-paper-deep/40 text-[13px] font-medium text-ink outline-none"
                    autoFocus
                  />
                  <button
                    onClick={handleSaveName}
                    className="h-8 px-3 rounded-lg bg-bamboo/90 text-cloud text-[11px] hover:bg-bamboo cursor-pointer"
                  >
                    保存
                  </button>
                  <button
                    onClick={() => setEditingName(false)}
                    className="h-8 px-2 rounded-lg border border-paper-deep/40 text-[11px] text-ink-faint hover:text-ink cursor-pointer"
                  >
                    取消
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <h3 className="text-[15px] font-display font-semibold text-ink truncate">
                    {profile.display_name || user.email?.split("@")[0] || "用户"}
                  </h3>
                  <button
                    onClick={() => {
                      setEditNameValue(profile.display_name || "");
                      setEditingName(true);
                    }}
                    className="w-5 h-5 flex items-center justify-center rounded-md text-ink-ghost hover:text-ink-soft cursor-pointer"
                  >
                    <svg
                      width="11"
                      height="11"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                    >
                      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                    </svg>
                  </button>
                </div>
              )}
              <p className="text-[11px] text-ink-ghost font-mono mt-0.5 truncate">{user.email}</p>
            </div>
          </div>
        </Card>

        {/* 同步 */}
        <Card title="云同步">
          <p className="text-[11px] text-ink-ghost mb-3">
            将应用配置同步到云端，在其他设备上登录后可恢复。
          </p>
          <div className="flex gap-2">
            <button
              onClick={handleSyncConfig}
              disabled={syncStatus === "syncing"}
              className="h-8 px-4 rounded-lg border border-paper-deep/45 text-[11px] text-ink-faint hover:text-bamboo hover:bg-bamboo-mist/50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer"
            >
              {syncStatus === "syncing" ? "同步中..." : "上传配置"}
            </button>
            <button
              onClick={handleLoadConfig}
              disabled={syncStatus === "syncing"}
              className="h-8 px-4 rounded-lg border border-paper-deep/45 text-[11px] text-ink-faint hover:text-bamboo hover:bg-bamboo-mist/50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer"
            >
              {syncStatus === "syncing" ? "同步中..." : "下载配置"}
            </button>
          </div>
          {syncStatus === "done" && <p className="text-[11px] text-bamboo mt-2">同步完成</p>}
          {syncStatus === "error" && <p className="text-[11px] text-red-400 mt-2">同步失败</p>}
        </Card>

        {/* 登出 */}
        <Card>
          <button
            onClick={handleLogout}
            className="h-9 px-4 rounded-lg border border-red-400/40 text-[12px] text-red-400 hover:bg-red-400/10 transition-colors cursor-pointer"
          >
            退出登录
          </button>
        </Card>
      </ScrollFrame>
    );
  }

  const requiresEmail = mode === "login" || mode === "register" || mode === "forgotPassword";
  const requiresPassword = mode === "login" || mode === "register" || mode === "resetPassword";
  const submitDisabled =
    submitting ||
    (requiresEmail && !email.trim()) ||
    (requiresPassword && !password) ||
    (mode === "resetPassword" && !confirmPassword);
  const submitLabel = submitting
    ? "处理中..."
    : mode === "register"
      ? "注册"
      : mode === "forgotPassword"
        ? "发送重置邮件"
        : mode === "resetPassword"
          ? "更新密码"
          : "登录";

  // ─── login / register form ───
  return (
    <ScrollFrame center>
      <div className="max-w-[360px] w-full pt-4">
        <Card>
          <h3 className="text-[15px] font-display font-semibold text-ink mb-4">
            {getAuthTitle(mode)}
          </h3>

          {error && (
            <div className="mb-3 px-3 py-2 rounded-lg bg-red-50/50 border border-red-200/50 text-[11px] text-red-500">
              {error}
            </div>
          )}

          {notice && (
            <div className="mb-3 px-3 py-2 rounded-lg bg-bamboo-mist/40 border border-bamboo/20 text-[11px] text-bamboo">
              {notice}
            </div>
          )}

          <div className="space-y-3">
            {mode !== "resetPassword" && (
              <div>
                <label className="block text-[10px] font-mono text-ink-faint mb-1">邮箱</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="your@email.com"
                  className="w-full h-9 px-3 rounded-lg bg-paper-warm/70 border border-paper-deep/40 text-[12px] text-ink placeholder:text-ink-ghost/50 outline-none focus:border-bamboo/30"
                  onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
                />
              </div>
            )}

            {mode !== "forgotPassword" && (
              <div>
                <label className="block text-[10px] font-mono text-ink-faint mb-1">
                  {mode === "resetPassword" ? "新密码" : "密码"}
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="至少 8 位，含字母、数字、特殊字符"
                  className="w-full h-9 px-3 rounded-lg bg-paper-warm/70 border border-paper-deep/40 text-[12px] text-ink placeholder:text-ink-ghost/50 outline-none focus:border-bamboo/30"
                  onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
                />
              </div>
            )}

            {mode === "resetPassword" && (
              <div>
                <label className="block text-[10px] font-mono text-ink-faint mb-1">确认新密码</label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="再次输入新密码"
                  className="w-full h-9 px-3 rounded-lg bg-paper-warm/70 border border-paper-deep/40 text-[12px] text-ink placeholder:text-ink-ghost/50 outline-none focus:border-bamboo/30"
                  onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
                />
              </div>
            )}

            {mode === "register" && (
              <div>
                <label className="block text-[10px] font-mono text-ink-faint mb-1">显示名称</label>
                <input
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="可选"
                  className="w-full h-9 px-3 rounded-lg bg-paper-warm/70 border border-paper-deep/40 text-[12px] text-ink placeholder:text-ink-ghost/50 outline-none focus:border-bamboo/30"
                  onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
                />
              </div>
            )}

            <button
              onClick={handleSubmit}
              disabled={submitDisabled}
              className="w-full h-10 rounded-xl bg-bamboo/90 text-cloud text-[13px] font-medium hover:bg-bamboo disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer mt-1"
            >
              {submitLabel}
            </button>
          </div>

          <p className="text-[11px] text-ink-ghost text-center mt-4">
            {mode === "login" ? (
              <>
                <button
                  onClick={() => {
                    setMode("forgotPassword");
                    setError("");
                    setNotice("");
                    setPassword("");
                  }}
                  className="text-bamboo hover:underline cursor-pointer"
                >
                  忘记密码？
                </button>
                <span className="mx-2 text-ink-ghost/50">·</span>
                还没有账号？{" "}
                <button
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
              <>
                {mode === "forgotPassword" ? "想起密码了？" : "已有账号？"}{" "}
                <button
                  onClick={() => {
                    setMode("login");
                    setError("");
                    setNotice("");
                    setPassword("");
                    setConfirmPassword("");
                  }}
                  className="text-bamboo hover:underline cursor-pointer"
                >
                  登录
                </button>
              </>
            )}
          </p>
        </Card>
      </div>
    </ScrollFrame>
  );
}

/* ─── 复用 SettingsPage 的组件 ─── */

function ScrollFrame({ children, center }: { children: React.ReactNode; center?: boolean }) {
  return (
    <div className="flex-1 overflow-y-auto min-h-0">
      <div className={`px-6 py-5 ${center ? "flex flex-col items-center" : ""}`}>
        {children}
        <div className="h-8" />
      </div>
    </div>
  );
}

function Card({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <div className="mb-4 px-4 py-3.5 rounded-xl bg-paper/30 border border-paper-deep/25 max-w-[600px]">
      {title && (
        <label className="block text-[11px] font-mono text-ink-faint mb-2.5">{title}</label>
      )}
      {children}
    </div>
  );
}
