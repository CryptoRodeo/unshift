import { BrowserRouter, Routes, Route, useParams } from "react-router-dom";
import { Page } from "@patternfly/react-core";
import { AppHeader } from "./components/AppHeader";
import { DashboardPage } from "./components/DashboardPage";
import { RunDetailPage } from "./pages/RunDetailPage";
import { LiveTerminal } from "./components/LiveTerminal";

function TerminalPage() {
  const { runId } = useParams<{ runId: string }>();
  if (!runId) return null;
  return <LiveTerminal runId={runId} isActive fullScreen />;
}

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/terminal/:runId" element={<TerminalPage />} />
        <Route
          path="*"
          element={
            <Page masthead={<AppHeader />}>
              <Routes>
                <Route path="/" element={<DashboardPage />} />
                <Route path="/runs/:runId" element={<RunDetailPage />} />
              </Routes>
            </Page>
          }
        />
      </Routes>
    </BrowserRouter>
  );
}
