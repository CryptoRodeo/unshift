import { BrowserRouter, Routes, Route, useLocation } from "react-router-dom";
import { Page } from "@patternfly/react-core";
import { AppHeader } from "./components/AppHeader";
import { DashboardPage } from "./components/DashboardPage";
import { RunDetailPage } from "./pages/RunDetailPage";
import { HeaderProvider, useHeaderContext } from "./hooks/useHeaderContext";

function ConnectedAppHeader() {
  const ctx = useHeaderContext();
  return (
    <AppHeader
      connected={ctx?.connected}
      notificationPermission={ctx?.notificationPermission}
      onRequestNotifications={ctx?.onRequestNotifications ?? undefined}
      breadcrumbLabel={ctx?.breadcrumbLabel}
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
      </Routes>
    </div>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <HeaderProvider>
        <Page masthead={<ConnectedAppHeader />}>
          <AnimatedRoutes />
        </Page>
      </HeaderProvider>
    </BrowserRouter>
  );
}
