import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type ThemeMode = "dark" | "light";

interface ThemeState {
  mode: ThemeMode;
  accent: string;
  setMode: (m: ThemeMode) => void;
  toggleMode: () => void;
  setAccent: (hex: string) => void;
  /** Card visibility preferences keyed by a stable card id. */
  hiddenCards: Record<string, boolean>;
  setCardHidden: (id: string, hidden: boolean) => void;
}

const ThemeContext = createContext<ThemeState | null>(null);

const MODE_KEY = "aiot.theme.mode";
const ACCENT_KEY = "aiot.theme.accent";
const CARDS_KEY = "aiot.theme.hiddenCards";

const DEFAULT_ACCENT = "#6e56cf";

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}
function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable — theme just won't persist */
  }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>(() =>
    read<ThemeMode>(MODE_KEY, "dark"),
  );
  const [accent, setAccentState] = useState<string>(() =>
    read<string>(ACCENT_KEY, DEFAULT_ACCENT),
  );
  const [hiddenCards, setHiddenCards] = useState<Record<string, boolean>>(() =>
    read<Record<string, boolean>>(CARDS_KEY, {}),
  );

  useEffect(() => {
    document.documentElement.dataset.theme = mode;
    write(MODE_KEY, mode);
  }, [mode]);

  useEffect(() => {
    document.documentElement.style.setProperty("--accent", accent);
    write(ACCENT_KEY, accent);
  }, [accent]);

  useEffect(() => {
    write(CARDS_KEY, hiddenCards);
  }, [hiddenCards]);

  const setMode = useCallback((m: ThemeMode) => setModeState(m), []);
  const toggleMode = useCallback(
    () => setModeState((m) => (m === "dark" ? "light" : "dark")),
    [],
  );
  const setAccent = useCallback((hex: string) => setAccentState(hex), []);
  const setCardHidden = useCallback((id: string, hidden: boolean) => {
    setHiddenCards((prev) => ({ ...prev, [id]: hidden }));
  }, []);

  const value = useMemo<ThemeState>(
    () => ({
      mode,
      accent,
      setMode,
      toggleMode,
      setAccent,
      hiddenCards,
      setCardHidden,
    }),
    [mode, accent, setMode, toggleMode, setAccent, hiddenCards, setCardHidden],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeState {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used inside <ThemeProvider>");
  return ctx;
}
