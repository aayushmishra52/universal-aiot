import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  getToken,
  login as apiLogin,
  me as apiMe,
  register as apiRegister,
  setToken,
  type Org,
  type User,
} from "../api/client";

interface AuthState {
  user: User | null;
  orgs: Org[];
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, name: string) => Promise<void>;
  logout: () => void;
  refresh: () => Promise<void>;
  /** Role of the user in the currently selected org. */
  roleFor: (orgId: string | null) => string | null;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!getToken()) {
      setUser(null);
      setOrgs([]);
      setLoading(false);
      return;
    }
    try {
      const data = await apiMe();
      setUser(data.user);
      setOrgs(data.orgs ?? []);
    } catch {
      setToken(null);
      setUser(null);
      setOrgs([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const login = useCallback(async (email: string, password: string) => {
    const data = await apiLogin({ email, password });
    setToken(data.token);
    setUser(data.user);
    setOrgs(data.orgs ?? []);
  }, []);

  const register = useCallback(
    async (email: string, password: string, name: string) => {
      const data = await apiRegister({ email, password, name });
      setToken(data.token);
      setUser(data.user);
      setOrgs(data.org ? [data.org] : []);
    },
    [],
  );

  const logout = useCallback(() => {
    setToken(null);
    setUser(null);
    setOrgs([]);
  }, []);

  const roleFor = useCallback(
    (orgId: string | null): string | null => {
      if (!orgId) return null;
      return orgs.find((o) => o.id === orgId)?.role ?? null;
    },
    [orgs],
  );

  const value = useMemo<AuthState>(
    () => ({ user, orgs, loading, login, register, logout, refresh, roleFor }),
    [user, orgs, loading, login, register, logout, refresh, roleFor],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
