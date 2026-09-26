import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { AuthProvider, useAuth } from "./auth/AuthContext";
import { ThemeProvider } from "./theme/ThemeContext";
import { AppShell, Layout, useSelection } from "./components/Layout";
import { RealtimeContext } from "./ws/RealtimeContext";
import { useRealtime, WS_URL } from "./ws/useRealtime";
import { getToken } from "./api/client";
import { Loading } from "./components/common";
import { Login } from "./pages/Login";
import { Register } from "./pages/Register";
import { DevicesPage } from "./pages/DevicesPage";
import { OverviewPage } from "./pages/OverviewPage";
import { CreateDevicePage } from "./pages/CreateDevicePage";
import { PairDevicePage } from "./pages/PairDevicePage";
import { DevicePage } from "./pages/DevicePage";
import { AutomationsPage } from "./pages/AutomationsPage";
import { SettingsPage } from "./pages/SettingsPage";
import "./styles.css";

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) {
    return (
      <div className="page">
        <Loading label="Restoring session…" />
      </div>
    );
  }
  if (!user) return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  return <>{children}</>;
}

function PublicRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="page">
        <Loading label="Restoring session…" />
      </div>
    );
  }
  if (user) return <Navigate to="/" replace />;
  return <>{children}</>;
}

/** Connects the realtime socket once a project is selected and bridges it to the layout. */
function DashboardShell() {
  const { projectId } = useSelection();
  const token = getToken();
  const rt = useRealtime(projectId, token);
  return (
    <RealtimeContext.Provider value={rt}>
      <Layout />
    </RealtimeContext.Provider>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <ThemeProvider>
        <AuthProvider>
          <Routes>
            <Route
              path="/login"
              element={
                <PublicRoute>
                  <Login />
                </PublicRoute>
              }
            />
            <Route
              path="/register"
              element={
                <PublicRoute>
                  <Register />
                </PublicRoute>
              }
            />
            <Route
              element={
                <ProtectedRoute>
                  <AppShell>
                    <DashboardShell />
                  </AppShell>
                </ProtectedRoute>
              }
            >
              <Route index element={<OverviewPage />} />
              <Route path="devices" element={<DevicesPage />} />
              <Route path="devices/new" element={<CreateDevicePage />} />
              <Route path="devices/:deviceId" element={<DevicePage />} />
              <Route path="pair" element={<PairDevicePage />} />
              <Route path="automations" element={<AutomationsPage />} />
              <Route path="settings" element={<SettingsPage />} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </AuthProvider>
      </ThemeProvider>
    </BrowserRouter>
  );
}

export { WS_URL };
