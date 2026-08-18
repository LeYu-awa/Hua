import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { LoginModal } from "./LoginModal";

interface AuthGateContextValue {
  /** 当前登录用户 id（未登录为 null） */
  userId: string | null;
  /** 打开登录弹窗 */
  openLogin: (reason?: string) => void;
  /** 关闭登录弹窗 */
  closeLogin: () => void;
  /**
   * 写操作前置校验：已登录返回 true；未登录弹出登录弹窗并返回 false。
   * 用法：`if (!ensureLogin("发布需要登录")) return;`
   */
  ensureLogin: (reason?: string) => boolean;
}

const AuthGateContext = createContext<AuthGateContextValue | null>(null);

interface AuthGateProviderProps {
  userId: string | null;
  children: ReactNode;
}

/**
 * 登录闸门 Provider：包裹整个应用。提供 ensureLogin 供所有写操作（创建画布、编辑、
 * 发布等）在未登录时统一弹出登录弹窗，而不是阻断页面访问 —— 未登录用户可以正常
 * 浏览所有公开页面与本地功能，仅执行写操作时才触发登录校验。
 */
export function AuthGateProvider({ userId, children }: AuthGateProviderProps) {
  const [loginOpen, setLoginOpen] = useState(false);
  const [reason, setReason] = useState<string | undefined>(undefined);

  const openLogin = useCallback((loginReason?: string) => {
    setReason(loginReason);
    setLoginOpen(true);
  }, []);

  const closeLogin = useCallback(() => setLoginOpen(false), []);

  const ensureLogin = useCallback(
    (loginReason?: string) => {
      if (userId) return true;
      setReason(loginReason);
      setLoginOpen(true);
      return false;
    },
    [userId],
  );

  const value = useMemo<AuthGateContextValue>(
    () => ({ userId, openLogin, closeLogin, ensureLogin }),
    [userId, openLogin, closeLogin, ensureLogin],
  );

  return (
    <AuthGateContext.Provider value={value}>
      {children}
      <LoginModal open={loginOpen} onClose={closeLogin} reason={reason} />
    </AuthGateContext.Provider>
  );
}

export function useAuthGate(): AuthGateContextValue {
  const context = useContext(AuthGateContext);
  if (!context) {
    throw new Error("useAuthGate 必须在 <AuthGateProvider> 内使用");
  }
  return context;
}
