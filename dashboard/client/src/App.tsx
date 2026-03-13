import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Page } from "@patternfly/react-core";
import { AppHeader } from "./components/AppHeader";
import { DashboardPage } from "./components/DashboardPage";
import { RunDetailPage } from "./components/RunDetailPage";

export function App() {
  return (
    <BrowserRouter>
      <Page masthead={<AppHeader />}>
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/runs/:runId" element={<RunDetailPage />} />
        </Routes>
      </Page>
    </BrowserRouter>
  );
}
