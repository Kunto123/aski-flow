import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  AuthUser,
  Permission,
  getPermissionsApi,
  loginApi,
  getMeApi,
} from "../api/auth";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface AuthContextValue {
  /** null = belum login */
  user: AuthUser | null;
  permissions: Permission[];
  isAdmin: boolean;
  isOperator: boolean;
  /** Cek apakah operator memiliki izin untuk key tertentu.
   *  Admin selalu mengembalikan true. */
  hasPermission: (key: string) => boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
  /** Reload daftar permission dari server (dipanggil setelah admin mengubah permission) */
  refreshPermissions: () => Promise<void>;
  authLoading: boolean;
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------
export const AuthContext = createContext<AuthContextValue>({
  user: null,
  permissions: [],
  isAdmin: false,
  isOperator: false,
  hasPermission: () => false,
  login: async () => {},
  logout: () => {},
  refreshPermissions: async () => {},
  authLoading: true,
});

const TOKEN_KEY = "aski_auth_token";

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------
export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [authLoading, setAuthLoading] = useState(true);

  // Coba restore sesi dari localStorage saat pertama mount
  useEffect(() => {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) {
      setAuthLoading(false);
      return;
    }
    // Validasi token dengan /auth/me
    getMeApi()
      .then(async (me) => {
        setUser(me);
        const perms = await getPermissionsApi();
        setPermissions(perms);
      })
      .catch(() => {
        // Token tidak valid / kedaluwarsa
        localStorage.removeItem(TOKEN_KEY);
      })
      .finally(() => setAuthLoading(false));
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const res = await loginApi(username, password);
    localStorage.setItem(TOKEN_KEY, res.token);
    setUser(res.user);
    const perms = await getPermissionsApi();
    setPermissions(perms);
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    setUser(null);
    setPermissions([]);
  }, []);

  const refreshPermissions = useCallback(async () => {
    const perms = await getPermissionsApi();
    setPermissions(perms);
  }, []);

  const hasPermission = useCallback(
    (key: string): boolean => {
      if (!user) return false;
      if (user.role === "admin") return true;
      return permissions.some((p) => p.permission_key === key && p.is_allowed);
    },
    [user, permissions],
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      permissions,
      isAdmin: user?.role === "admin",
      isOperator: user?.role === "operator",
      hasPermission,
      login,
      logout,
      refreshPermissions,
      authLoading,
    }),
    [user, permissions, hasPermission, login, logout, refreshPermissions, authLoading],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------
export function useAuth(): AuthContextValue {
  return useContext(AuthContext);
}
