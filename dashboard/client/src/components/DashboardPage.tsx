import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  Button,
  Alert,
  AlertActionCloseButton,
  AlertGroup,
  Tooltip,
} from "@patternfly/react-core";
import { PlusCircleIcon, SearchIcon } from "@patternfly/react-icons";
import { useWebSocketContext } from "../hooks/useWebSocket";
import type { StartRunResponse, RunEventCallback } from "../hooks/useWebSocket";
import { isRunError } from "../types";
import { useNotifications } from "../hooks/useNotifications";
import { useHeaderContext } from "../hooks/useHeaderContext";
import { useRunFilters } from "../hooks/useRunFilters";
import { FilterBar } from "./FilterBar";
import { DashboardStats } from "./DashboardStats";
import { RunTable } from "./RunTable";

interface StartRunSummary {
  started: number;
  alreadyActive: number;
  skipped: { issueKey: string; reason: string }[];
  errors: string[];
}

function buildSummary(data: StartRunResponse): StartRunSummary {
  const alreadyActiveErrors: string[] = [];
  const otherErrors: string[] = [];
  for (const err of data.errors) {
    if (err.includes("already has an active run")) {
      alreadyActiveErrors.push(err);
    } else {
      otherErrors.push(err);
    }
  }
  return {
    started: data.runs.length,
    alreadyActive: alreadyActiveErrors.length,
    skipped: data.skipped,
    errors: otherErrors,
  };
}

function summaryVariant(summary: StartRunSummary): "success" | "info" | "warning" {
  if (summary.errors.length > 0) return "warning";
  if (summary.started > 0) return "success";
  return "info";
}

function summaryTitle(summary: StartRunSummary): string {
  if (summary.started > 0) {
    return `Started ${summary.started} new run${summary.started > 1 ? "s" : ""}`;
  }
  return "No new tickets to process";
}

const STATUS_LABELS: Record<string, string> = {
  awaiting_approval: "Awaiting Approval",
  success: "Success",
  failed: "Failed",
  stopped: "Stopped",
  rejected: "Rejected",
};

export function DashboardPage() {
  const { runs, loading, connected, startRun, startRunForIssue, setOnRunEvent } = useWebSocketContext();
  const navigate = useNavigate();
  const { permission, requestPermission, notify, toasts, dismissToast } = useNotifications();
  const headerCtx = useHeaderContext();
  const filters = useRunFilters();

  // Sync connection & notification state to the header
  useEffect(() => {
    if (!headerCtx) return;
    headerCtx.setConnected(connected);
  }, [connected, headerCtx]);

  useEffect(() => {
    if (!headerCtx) return;
    headerCtx.setNotificationPermission(permission);
    headerCtx.setOnRequestNotifications(requestPermission);
  }, [permission, requestPermission, headerCtx]);
  const [isStarting, setIsStarting] = useState(false);
  const [isStartingSingle, setIsStartingSingle] = useState(false);
  const [ticketId, setTicketId] = useState("");
  const [startRunSummary, setStartRunSummary] = useState<StartRunSummary | null>(null);
  const [singleRunError, setSingleRunError] = useState<string | null>(null);
  // Provider/model selection
  const [providers, setProviders] = useState<{ provider: string; defaultModel: string; models: string[] }[]>([]);
  const [selectedProvider, setSelectedProvider] = useState<string>("");
  const [selectedModel, setSelectedModel] = useState<string>("");

  useEffect(() => {
    Promise.all([
      fetch("/api/providers").then((r) => r.json() as Promise<{ providers: { provider: string; defaultModel: string; models: string[] }[] }>),
      fetch("/api/config").then((r) => r.json() as Promise<{ provider: string; model: string }>),
    ]).then(([providersData, configData]) => {
      setProviders(providersData.providers);
      setSelectedProvider(configData.provider);
      setSelectedModel(configData.model);
    }).catch(() => {});
  }, []);

  const handleRunEvent = useCallback<RunEventCallback>(
    (event) => {
      const label = STATUS_LABELS[event.status] ?? event.status;
      const isApproval = event.status === "awaiting_approval";
      notify(`${event.issueKey}: ${label}`, {
        body: `Run ${event.issueKey} is now ${label}`,
        onClick: () => navigate(`/runs/${event.runId}`),
        force: isApproval,
      });
    },
    [notify, navigate]
  );

  useEffect(() => {
    setOnRunEvent(handleRunEvent);
    return () => setOnRunEvent(null);
  }, [setOnRunEvent, handleRunEvent]);

  useEffect(() => {
    if (!startRunSummary) return;
    const timer = setTimeout(() => setStartRunSummary(null), 8000);
    return () => clearTimeout(timer);
  }, [startRunSummary]);

  const handleProviderChange = (provider: string) => {
    setSelectedProvider(provider);
    const match = providers.find((p) => p.provider === provider);
    if (match) setSelectedModel(match.defaultModel);
  };

  const handleStartSingleRun = async () => {
    const key = ticketId.trim();
    if (!key) return;
    setIsStartingSingle(true);
    setSingleRunError(null);
    try {
      const result = await startRunForIssue(key, true, {
        provider: selectedProvider || undefined,
        model: selectedModel || undefined,
      });
      if (isRunError(result)) {
        setSingleRunError(`${key}: ${result.error}`);
      } else {
        setTicketId("");
        navigate(`/runs/${result.id}`);
      }
    } catch {
      setSingleRunError(`Failed to start run for ${key}`);
    } finally {
      setIsStartingSingle(false);
    }
  };

  useEffect(() => {
    if (!singleRunError) return;
    const timer = setTimeout(() => setSingleRunError(null), 8000);
    return () => clearTimeout(timer);
  }, [singleRunError]);

  const handleStartRun = async () => {
    setIsStarting(true);
    try {
      const data = await startRun({ provider: selectedProvider || undefined, model: selectedModel || undefined });
      setStartRunSummary(buildSummary(data));
    } catch {
      setStartRunSummary({ started: 0, alreadyActive: 0, skipped: [], errors: ["Failed to start runs"] });
    } finally {
      setIsStarting(false);
    }
  };

  const runList = Array.from(runs.values()).sort(
    (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
  );
  const filteredRuns = filters.filterRuns(runList);

  return (
    <>
      {toasts.length > 0 && (
        <AlertGroup isToast isLiveRegion>
          {toasts.map((t) => (
            <Alert
              key={t.id}
              variant={t.variant}
              title={t.title}
              actionClose={<AlertActionCloseButton onClose={() => dismissToast(t.id)} />}
              onClick={t.onClick}
              style={t.onClick ? { cursor: "pointer" } : undefined}
            >
              {t.body}
            </Alert>
          ))}
        </AlertGroup>
      )}

      <div className="us-dashboard">
        {/* Top toolbar: title, provider/model, start run */}
        <div className="us-dashboard__toolbar">
          <h2 className="us-dashboard__title">Runs</h2>
          <div className="us-dashboard__toolbar-right">
            {providers.length > 0 && (
              <>
                <Tooltip content="AI provider">
                  <select
                    className="us-select"
                    value={selectedProvider}
                    onChange={(e) => handleProviderChange(e.target.value)}
                    aria-label="Provider"
                  >
                    {providers.map((p) => (
                      <option key={p.provider} value={p.provider}>{p.provider}</option>
                    ))}
                  </select>
                </Tooltip>
                <Tooltip content="Model ID">
                  <select
                    className="us-select"
                    value={selectedModel}
                    onChange={(e) => setSelectedModel(e.target.value)}
                    aria-label="Model"
                  >
                    {(providers.find((p) => p.provider === selectedProvider)?.models ?? []).map((m) => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>
                </Tooltip>
              </>
            )}
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <input
                className="us-input"
                type="text"
                placeholder="PROJ-123"
                value={ticketId}
                onChange={(e) => setTicketId(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleStartSingleRun(); }}
                aria-label="Jira ticket ID"
                style={{ width: 120 }}
              />
              <Button
                variant="secondary"
                onClick={handleStartSingleRun}
                isLoading={isStartingSingle}
                isDisabled={isStartingSingle || !ticketId.trim()}
              >
                Run Ticket
              </Button>
            </div>
            <Button
              variant="primary"
              onClick={handleStartRun}
              isLoading={isStarting}
              isDisabled={isStarting}
            >
              Run batch
            </Button>
          </div>
        </div>

        {startRunSummary && (
          <div className="us-dashboard__section">
            <Alert
              variant={summaryVariant(startRunSummary)}
              title={summaryTitle(startRunSummary)}
              isInline
              actionClose={<AlertActionCloseButton onClose={() => setStartRunSummary(null)} />}
            >
              {(startRunSummary.alreadyActive > 0 || startRunSummary.skipped.length > 0 || startRunSummary.errors.length > 0) && (
                <ul>
                  {startRunSummary.alreadyActive > 0 && (
                    <li>{startRunSummary.alreadyActive} already active</li>
                  )}
                  {startRunSummary.skipped.map((s) => (
                    <li key={s.issueKey}>
                      <strong>{s.issueKey}</strong>: {s.reason}
                    </li>
                  ))}
                  {startRunSummary.errors.map((err, i) => (
                    <li key={i}>{err}</li>
                  ))}
                </ul>
              )}
            </Alert>
          </div>
        )}

        {singleRunError && (
          <div className="us-dashboard__section">
            <Alert
              variant="danger"
              title={singleRunError}
              isInline
              actionClose={<AlertActionCloseButton onClose={() => setSingleRunError(null)} />}
            />
          </div>
        )}

        {/* Compact inline stats bar */}
        {runList.length > 0 && (
          <div className="us-dashboard__section">
            <DashboardStats runs={runList} onStatusClick={filters.toggleStatus} />
          </div>
        )}

        {/* Filter bar */}
        {runList.length > 0 && (
          <div className="us-dashboard__section">
            <FilterBar
              query={filters.query}
              statuses={filters.statuses}
              repo={filters.repo}
              hasFilters={filters.hasFilters}
              setQuery={filters.setQuery}
              toggleStatus={filters.toggleStatus}
              setRepo={filters.setRepo}
              clearAll={filters.clearAll}
              runs={runList}
              totalCount={runList.length}
              filteredCount={filteredRuns.length}
            />
          </div>
        )}

        {/* Run list */}
        <div className="us-dashboard__content">
          {loading ? (
            <div className="us-table-wrapper">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="us-skeleton-row us-stagger-enter" style={{ animationDelay: `${i * 40}ms` }}>
                  <div className="us-skeleton" style={{ width: 10, height: 10, borderRadius: "50%" }} />
                  <div className="us-skeleton" style={{ width: 80, height: 14 }} />
                  <div className="us-skeleton" style={{ flex: 1, height: 14, maxWidth: 300 }} />
                  <div className="us-skeleton" style={{ width: 60, height: 14 }} />
                  <div className="us-skeleton" style={{ width: 50, height: 14 }} />
                  <div className="us-skeleton" style={{ width: 80, height: 4, borderRadius: 2 }} />
                </div>
              ))}
            </div>
          ) : runList.length === 0 ? (
            <div className="us-empty-state us-fade-in">
              <div className="us-empty-state__icon">
                <PlusCircleIcon />
              </div>
              <h3 className="us-empty-state__title">No runs yet</h3>
              <p className="us-empty-state__body">
                Click <strong>Run batch</strong> to process llm-candidate Jira issues.
              </p>
              <div className="us-empty-state__action">
                <Button variant="primary" onClick={handleStartRun} isLoading={isStarting} isDisabled={isStarting}>
                  Run batch
                </Button>
              </div>
            </div>
          ) : filteredRuns.length === 0 ? (
            <div className="us-empty-state us-fade-in">
              <div className="us-empty-state__icon us-empty-state__icon--warning">
                <SearchIcon />
              </div>
              <h3 className="us-empty-state__title">No matching runs</h3>
              <p className="us-empty-state__body">
                No runs match the current filters. Try adjusting your search or status filters.
              </p>
              <div className="us-empty-state__action">
                <Button variant="link" onClick={filters.clearAll}>
                  Clear all filters
                </Button>
              </div>
            </div>
          ) : (
            <div className="us-fade-in">
              <RunTable runs={filteredRuns} />
            </div>
          )}
        </div>
      </div>
    </>
  );
}

