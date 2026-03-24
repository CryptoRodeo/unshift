import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  PageSection,
  Title,
  Button,
  Toolbar,
  ToolbarContent,
  ToolbarItem,
  Card,
  CardBody,
  Gallery,
  Label,
  Flex,
  FlexItem,
  EmptyState,
  EmptyStateBody,
  Spinner,
  Alert,
  AlertActionCloseButton,
  AlertGroup,
  Tooltip,
  ToggleGroup,
  ToggleGroupItem,
} from "@patternfly/react-core";
import { BellIcon, BellSlashIcon, ThIcon, ThLargeIcon } from "@patternfly/react-icons";
import { useWebSocket } from "../hooks/useWebSocket";
import type { StartRunResponse } from "../hooks/useWebSocket";
import { useNotifications } from "../hooks/useNotifications";
import { useElapsedTime } from "../hooks/useElapsedTime";
import { useRunFilters } from "../hooks/useRunFilters";
import { PhaseProgress } from "./PhaseProgress";
import { FilterBar } from "./FilterBar";
import { DashboardStats } from "./DashboardStats";
import { RunTable } from "./RunTable";
import { StatusLabel } from "./StatusLabel";
import type { Run } from "../types";
import { PHASE_LABELS } from "../types";

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
  const filters = useRunFilters();
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
              <Label color={connected ? "green" : "red"}>
                {connected ? "Connected" : "Disconnected"}
              </Label>
            </ToolbarItem>
            <ToolbarItem>
              {permission === "denied" ? (
                <Tooltip content="Notifications blocked. Re-enable in browser settings.">
                  <Button variant="plain" isDisabled>
                    <BellSlashIcon />
                  </Button>
                </Tooltip>
              ) : permission === "granted" ? (
                <Tooltip content="Notifications enabled">
                  <Button variant="plain" onClick={requestPermission}>
                    <BellIcon color="var(--pf-t--global--color--status--info--default)" />
                  </Button>
                </Tooltip>
              ) : (
                <Tooltip content="Enable browser notifications">
                  <Button variant="plain" onClick={requestPermission}>
                    <BellIcon />
                  </Button>
                </Tooltip>
              )}
            </ToolbarItem>
            <ToolbarItem>
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
          <EmptyState titleText="Loading runs…" headingLevel="h3" icon={Spinner} />
        ) : runList.length === 0 ? (
          <EmptyState titleText="No runs yet" headingLevel="h3">
            <EmptyStateBody>
              Click <strong>Start run</strong> to process llm-candidate Jira
              issues.
            </EmptyStateBody>
          </EmptyState>
        ) : filteredRuns.length === 0 ? (
          <EmptyState titleText="No matching runs" headingLevel="h3">
            <EmptyStateBody>
              No runs match the current filters.{" "}
              <Button variant="link" isInline onClick={filters.clearAll}>
                Clear filters
              </Button>
            </EmptyStateBody>
          </EmptyState>
        ) : viewMode === "table" ? (
          <RunTable runs={filteredRuns} />
        ) : (
          <Gallery hasGutter minWidths={{ default: "400px" }}>
            {filteredRuns.map((run) => (
              <RunCard
                key={run.id}
                run={run}
                onClick={() => navigate(`/runs/${run.id}`)}
              />
            ))}
          </Gallery>
        )}
      </PageSection>
    </>
  );
}

function RunCard({ run, onClick }: { run: Run; onClick: () => void }) {
  const elapsed = useElapsedTime(run.startedAt, run.completedAt);

  return (
    <Card isClickable isCompact onClick={onClick}>
      <CardBody>
        <Flex direction={{ default: "column" }} gap={{ default: "gapSm" }}>
          <Flex justifyContent={{ default: "justifyContentSpaceBetween" }}>
            <FlexItem>
              <Title headingLevel="h3" size="lg">
                {run.issueKey || run.id.slice(0, 8)}
              </Title>
            </FlexItem>
            <FlexItem>
              <Flex gap={{ default: "gapSm" }}>
                <StatusLabel status={run.status} />
                {run.retryCount != null && run.retryCount > 0 && (
                  <Label color="blue">Re-run #{run.retryCount}</Label>
                )}
              </Flex>
            </FlexItem>
          </Flex>

          <FlexItem>
            <PhaseProgress status={run.status} phaseTimestamps={run.phaseTimestamps} completedAt={run.completedAt} />
          </FlexItem>

          {run.context && (
            <FlexItem>
              <small>{run.context.summary}</small>
            </FlexItem>
          )}

          <FlexItem>
            <small>
              Started {new Date(run.startedAt).toLocaleString()} &middot; {elapsed}
              {PHASE_LABELS[run.status] && ` \u00b7 ${PHASE_LABELS[run.status]}`}
            </small>
          </FlexItem>
        </Flex>
      </CardBody>
    </Card>
  );
}
