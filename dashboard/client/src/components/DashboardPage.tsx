import { useState, useEffect } from "react";
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
  Alert,
  AlertActionCloseButton,
} from "@patternfly/react-core";
import { useWebSocket } from "../hooks/useWebSocket";
import type { StartRunResponse } from "../hooks/useWebSocket";
import { PhaseProgress } from "./PhaseProgress";
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

export function DashboardPage() {
  const { runs, connected, startRun } = useWebSocket();
  const navigate = useNavigate();
  const [isStarting, setIsStarting] = useState(false);
  const [startRunSummary, setStartRunSummary] = useState<StartRunSummary | null>(null);

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

  const runList = Array.from(runs.values()).sort(
    (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
  );

  return (
    <>
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

      <PageSection isFilled>
        {runList.length === 0 ? (
          <EmptyState titleText="No runs yet" headingLevel="h3">
            <EmptyStateBody>
              Click <strong>Start run</strong> to process llm-candidate Jira
              issues.
            </EmptyStateBody>
          </EmptyState>
        ) : (
          <Gallery hasGutter minWidths={{ default: "400px" }}>
            {runList.map((run) => (
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
            <PhaseProgress status={run.status} />
          </FlexItem>

          {run.context && (
            <FlexItem>
              <small>{run.context.summary}</small>
            </FlexItem>
          )}

          <FlexItem>
            <small>
              Started {new Date(run.startedAt).toLocaleString()}
              {PHASE_LABELS[run.status] && ` \u00b7 ${PHASE_LABELS[run.status]}`}
            </small>
          </FlexItem>
        </Flex>
      </CardBody>
    </Card>
  );
}
