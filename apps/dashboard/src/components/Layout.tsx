import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  createOrg,
  createProject,
  listOrgs,
  listProjects,
  type Org,
  type Project,
} from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { useTheme } from "../theme/ThemeContext";
import { useRealtimeState } from "../ws/RealtimeContext";

/* ---------- org / project selection state ---------- */
interface SelectionState {
  orgs: Org[];
  orgId: string | null;
  setOrgId: (id: string) => void;
  projects: Project[];
  projectId: string | null;
  setProjectId: (id: string) => void;
  addOrg: (name: string) => Promise<Org>;
  addProject: (name: string) => Promise<Project>;
  loading: boolean;
  error: string | null;
}

const SelectionContext = createContext<SelectionState | null>(null);

const ORG_KEY = "aiot.sel.org";
const PROJ_KEY = "aiot.sel.project";

export function useSelection(): SelectionState {
  const ctx = useContext(SelectionContext);
  if (!ctx) throw new Error("useSelection must be used inside <Layout>");
  return ctx;
}

function SelectionProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [orgId, setOrgIdState] = useState<string | null>(
    () => localStorage.getItem(ORG_KEY),
  );
  const [projectId, setProjectIdState] = useState<string | null>(
    () => localStorage.getItem(PROJ_KEY),
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Load orgs
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const list = await listOrgs();
        if (cancelled) return;
        setOrgs(list);
        if (list.length > 0 && !list.some((o) => o.id === orgId)) {
          const first = list[0].id;
          setOrgIdState(first);
          localStorage.setItem(ORG_KEY, first);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load organizations");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load projects when org changes
  useEffect(() => {
    if (!orgId) {
      setProjects([]);
      setProjectIdState(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const list = await listProjects(orgId);
        if (cancelled) return;
        setProjects(list);
        const saved = localStorage.getItem(PROJ_KEY);
        if (list.some((p) => p.id === saved)) {
          setProjectIdState(saved);
        } else if (list.length > 0) {
          setProjectIdState(list[0].id);
          localStorage.setItem(PROJ_KEY, list[0].id);
        } else {
          setProjectIdState(null);
          localStorage.removeItem(PROJ_KEY);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load projects");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [orgId]);

  const setOrgId = useCallback((id: string) => {
    setOrgIdState(id);
    localStorage.setItem(ORG_KEY, id);
    setProjectIdState(null);
    localStorage.removeItem(PROJ_KEY);
  }, []);

  const setProjectId = useCallback((id: string) => {
    setProjectIdState(id);
    localStorage.setItem(PROJ_KEY, id);
  }, []);

  const addOrg = useCallback(async (name: string) => {
    const org = await createOrg(name);
    setOrgs((prev) => [...prev, org]);
    setOrgId(org.id);
    return org;
  }, [setOrgId]);

  const addProject = useCallback(
    async (name: string) => {
      if (!orgId) throw new Error("Select an organization first");
      const proj = await createProject(orgId, name);
      setProjects((prev) => [...prev, proj]);
      setProjectId(proj.id);
      return proj;
    },
    [orgId, setProjectId],
  );

  const value = useMemo<SelectionState>(
    () => ({
      orgs, orgId, setOrgId, projects, projectId, setProjectId,
      addOrg, addProject, loading, error,
    }),
    [orgs, orgId, setOrgId, projects, projectId, setProjectId, addOrg, addProject, loading, error],
  );
  return <SelectionContext.Provider value={value}>{children}</SelectionContext.Provider>;
}

/* ---------- chrome ---------- */
const NAV = [
  { to: "/", label: "Overview", icon: "◉", end: true },
  { to: "/devices", label: "Devices", icon: "◈", end: true },
  { to: "/pair", label: "Pair device", icon: "⎋" },
  { to: "/automations", label: "Automations", icon: "⚡" },
  { to: "/settings", label: "Settings", icon: "⚙" },
];

export function Layout() {
  const { user, logout, roleFor } = useAuth();
  const { mode, toggleMode } = useTheme();
  const { connected: wsConnected } = useRealtimeState();
  const { orgs, orgId, setOrgId, projects, projectId, setProjectId } = useSelection();
  const [navOpen, setNavOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => setNavOpen(false), [location.pathname]);

  const role = roleFor(orgId);

  return (
    <div className="app-shell">
      {navOpen && <div className="scrim" onClick={() => setNavOpen(false)} />}
      <aside className={`sidebar${navOpen ? " open" : ""}`}>
        <Link to="/" className="brand" style={{ textDecoration: "none", color: "inherit" }}>
          <span className="brand-mark">◈</span>
          <span>
            <div className="brand-name">AIoT Console</div>
            <div className="brand-sub">Universal AIoT</div>
          </span>
        </Link>
        <nav className="nav">
          <div className="nav-label">Fleet</div>
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.end}
              className={({ isActive }) => `nav-link${isActive ? " active" : ""}`}
            >
              <span className="nav-icon">{n.icon}</span>
              {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-foot">
          <div className="user-chip">
            <span className="avatar">{(user?.name ?? "?").slice(0, 1).toUpperCase()}</span>
            <span>
              <div className="u-name">{user?.name}</div>
              <div className="u-role">{role ?? "—"}</div>
            </span>
            <button
              className="logout-btn"
              title="Log out"
              onClick={() => {
                logout();
                navigate("/login");
              }}
            >
              ⏻
            </button>
          </div>
        </div>
      </aside>

      <div className="main-col">
        <header className="topbar">
          <button className="hamburger" onClick={() => setNavOpen((v) => !v)} aria-label="Menu">
            ☰
          </button>
          <select
            className="input select-inline"
            aria-label="Organization"
            value={orgId ?? ""}
            onChange={(e) => setOrgId(e.target.value)}
          >
            {orgs.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
          <select
            className="input select-inline"
            aria-label="Project"
            value={projectId ?? ""}
            onChange={(e) => setProjectId(e.target.value)}
            disabled={projects.length === 0}
          >
            {projects.length === 0 && <option value="">No projects</option>}
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <span style={{ marginLeft: "auto", display: "flex", gap: 14, alignItems: "center" }}>
            <span className={`conn-dot ${wsConnected ? "live" : "down"}`} title={wsConnected ? "Realtime connected" : "Realtime disconnected"}>
              <span className="dot" />
              {wsConnected ? "LIVE" : "OFFLINE"}
            </span>
            <button className="btn btn-ghost btn-sm" onClick={toggleMode} title="Toggle theme">
              {mode === "dark" ? "☀" : "☾"}
            </button>
          </span>
        </header>
        <Outlet />
      </div>
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  return <SelectionProvider>{children}</SelectionProvider>;
}
