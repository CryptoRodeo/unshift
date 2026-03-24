import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  PageSection,
  Title,
  Button,
  Toolbar,
  ToolbarContent,
  ToolbarItem,
  Gallery,
  Label,
  Flex,
  FlexItem,
  Alert,
  AlertActionCloseButton,
  AlertGroup,
  ToggleGroup,
  ToggleGroupItem,
} from "@patternfly/react-core";
import { ThIcon, ThLargeIcon, PlusCircleIcon, SearchIcon } from "@patternfly/react-icons";
import { useWebSocket } from "../hooks/useWebSocket";
import type { StartRunResponse } from "../hooks/useWebSocket";
import { useNotifications } from "../hooks/useNotifications";
import { useHeaderContext } from "../hooks/useHeaderContext";
import { useElapsedTime } from "../hooks/useElapsedTime";
import { useRunFilters } from "../hooks/useRunFilters";
import { FilterBar } from "./FilterBar";
import { DashboardStats } from "./DashboardStats";
import { RunTable } from "./RunTable";
import { StatusLabel } from "./StatusLabel";
import { PhaseProgress } from "./PhaseProgress";
import { STATUS_COLORS } from "../types";
import type { Run } from "../types";

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
  const { runs, loading, connected, startRun, setOnRunEvent } = useWebSocket();
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
  const [startRunSummary, setStartRunSummary] = useState<StartRunSummary | null>(null);
  const [viewMode, setViewMode] = useState<"gallery" | "table">(() => {
    return (localStorage.getItem("unshift:viewMode") as "gallery" | "table") ?? "gallery";
  });

  const handleRunEvent = useCallback(
    (event: { runId: string; issueKey: string; status: string }) => {
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

  const handleStartRun = async () => {
    setIsStarting(true);
    try {
      const data = await startRun();
      setStartRunSummary(buildSummary(data));
    } catch {
      setStartRunSummary({ started: 0, alreadyActive: 0, skipped: [], errors: ["Failed to start runs"] });
    } finally {
      setIsStarting(false);
    }
  };

  const handleViewChange = useCallback((mode: "gallery" | "table") => {
    setViewMode(mode);
    localStorage.setItem("unshift:viewMode", mode);
  }, []);

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
      <PageSection>
        <Toolbar>
          <ToolbarContent>
            <ToolbarItem>
              <Title headingLevel="h2">Runs</Title>
            </ToolbarItem>
            <ToolbarItem align={{ default: "alignEnd" }}>
              <Button
                variant="primary"
                onClick={handleStartRun}
                isLoading={isStarting}
                isDisabled={isStarting}
              >
                Start run
              </Button>
            </ToolbarItem>
          </ToolbarContent>
        </Toolbar>
      </PageSection>

      {startRunSummary && (
        <PageSection>
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
        </PageSection>
      )}

      {runList.length > 0 && (
        <PageSection>
          <DashboardStats runs={runList} onStatusClick={filters.toggleStatus} />
        </PageSection>
      )}

      {runList.length > 0 && (
        <PageSection>
          <Flex justifyContent={{ default: "justifyContentSpaceBetween" }} alignItems={{ default: "alignItemsCenter" }}>
            <FlexItem style={{ flex: 1 }}>
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
            </FlexItem>
            <FlexItem>
              <ToggleGroup aria-label="View toggle">
                <ToggleGroupItem
                  icon={<ThLargeIcon />}
                  aria-label="Gallery view"
                  isSelected={viewMode === "gallery"}
                  onChange={() => handleViewChange("gallery")}
                />
                <ToggleGroupItem
                  icon={<ThIcon />}
                  aria-label="Table view"
                  isSelected={viewMode === "table"}
                  onChange={() => handleViewChange("table")}
                />
              </ToggleGroup>
            </FlexItem>
          </Flex>
        </PageSection>
      )}

      <PageSection isFilled>
        {loading ? (
          <Gallery hasGutter minWidths={{ default: "400px" }}>
            {Array.from({ length: 6 }).map((_, i) => (
              <SkeletonCard key={i} index={i} />
            ))}
          </Gallery>
        ) : runList.length === 0 ? (
          <div className="us-empty-state us-fade-in">
            <div className="us-empty-state__icon">
              <PlusCircleIcon />
            </div>
            <h3 className="us-empty-state__title">No runs yet</h3>
            <p className="us-empty-state__body">
              Click <strong>Start run</strong> to process llm-candidate Jira issues.
            </p>
            <div className="us-empty-state__action">
              <Button variant="primary" onClick={handleStartRun} isLoading={isStarting} isDisabled={isStarting}>
                Start run
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
        ) : viewMode === "table" ? (
          <div className="us-fade-in">
            <RunTable runs={filteredRuns} />
          </div>
        ) : (
          <Gallery hasGutter minWidths={{ default: "400px" }}>
            {filteredRuns.map((run, i) => (
              <div key={run.id} className="us-stagger-enter" style={{ animationDelay: `${i * 30}ms` }}>
                <RunCard
                  run={run}
                  onClick={() => navigate(`/runs/${run.id}`)}
                />
              </div>
            ))}
          </Gallery>
        )}
      </PageSection>
    </>
  );
}

function getRepoShortName(run: Run): string | undefined {
  const repoPath = run.repoPath || run.context?.repoPath;
  if (!repoPath) return undefined;
  return repoPath.split("/").pop() || undefined;
}


function SkeletonCard({ index }: { index: number }) {
  return (
    <div className="us-skeleton-card us-stagger-enter" style={{ animationDelay: `${index * 60}ms` }}>
      <div className="us-skeleton-card__header">
        <div className="us-skeleton us-skeleton-card__title" />
        <div className="us-skeleton us-skeleton-card__badge" />
      </div>
      <div className="us-skeleton-card__progress">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="us-skeleton us-skeleton-card__progress-seg" />
        ))}
      </div>
      <div className="us-skeleton us-skeleton-card__text" />
      <div className="us-skeleton us-skeleton-card__text us-skeleton-card__text--short" />
      <div className="us-skeleton-card__meta">
        <div className="us-skeleton us-skeleton-card__meta-pill" />
        <div className="us-skeleton us-skeleton-card__meta-text" />
      </div>
    </div>
  );
}

function RunCard({ run, onClick }: { run: Run; onClick: () => void }) {
  const elapsed = useElapsedTime(run.startedAt, run.completedAt);
  const statusColor = STATUS_COLORS[run.status] ?? STATUS_COLORS.pending;
  const isActive = !["success", "failed", "stopped", "rejected"].includes(run.status);
  const repoName = getRepoShortName(run);

  return (
    <div
      className={`us-run-card${isActive ? " us-run-card--active" : ""}${run.status === "awaiting_approval" ? " us-run-card--awaiting" : ""}`}
      style={{ "--card-status-color": statusColor } as React.CSSProperties}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); } }}
    >
      <div className="us-run-card__header">
        <span className="us-run-card__issue">{run.issueKey || run.id.slice(0, 8)}</span>
        <div className="us-run-card__badges">
          <StatusLabel status={run.status} />
          {run.retryCount != null && run.retryCount > 0 && (
            <Label color="blue" isCompact>Re-run #{run.retryCount}</Label>
          )}
        </div>
      </div>

      <PhaseProgress status={run.status} compact />

      {run.context?.summary && (
        <div className="us-run-card__summary">{run.context.summary}</div>
      )}

      <div className="us-run-card__meta">
        {repoName && <span className="us-run-card__repo">{repoName}</span>}
        <span className="us-run-card__time">{elapsed}</span>
        <span className="us-run-card__time">{new Date(run.startedAt).toLocaleDateString()}</span>
      </div>
    </div>
  );
}
