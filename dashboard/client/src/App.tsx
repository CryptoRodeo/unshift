import { BrowserRouter, Routes, Route, useLocation } from "react-router-dom";
import { Sidebar } from "./components/Sidebar";
import { DashboardPage } from "./components/DashboardPage";
import { RunDetailPage } from "./pages/RunDetailPage";
import { ProjectsPage } from "./pages/ProjectsPage";
import { TicketDetailPage } from "./pages/TicketDetailPage";
import { HeaderProvider, useHeaderContext } from "./hooks/useHeaderContext";
import { WebSocketProvider, useWebSocketContext } from "./hooks/useWebSocket";

function ConnectedSidebar() {
  const ctx = useHeaderContext();
  const { runs } = useWebSocketContext();
  return (
    <Sidebar
      connected={ctx?.connected}
      notificationPermission={ctx?.notificationPermission}
      onRequestNotifications={ctx?.onRequestNotifications ?? undefined}
      runs={runs}
    />
  );
}

function AnimatedRoutes() {
  const location = useLocation();
  // Use a key derived from the top-level path segment to re-trigger animation
  const routeKey = location.pathname === "/" ? "/" : location.pathname.split("/").slice(0, 3).join("/");
  return (
    <div key={routeKey} className="us-page-transition">
      <Routes>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/runs/:runId" element={<RunDetailPage />} />
        <Route path="/projects" element={<ProjectsPage />} />
        <Route path="/projects/:issueKey" element={<TicketDetailPage />} />
      </Routes>
    </div>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <HeaderProvider>
        <WebSocketProvider>
          <div className="us-app-layout">
            <ConnectedSidebar />
            <main className="us-app-layout__main">
              <AnimatedRoutes />
            </main>
          </div>
        </WebSocketProvider>
      </HeaderProvider>
    </BrowserRouter>
  );
}
