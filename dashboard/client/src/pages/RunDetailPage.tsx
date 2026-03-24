import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  PageSection,
  Title,
  Button,
  Flex,
  FlexItem,
  Grid,
  GridItem,
  Card,
  CardTitle,
  CardBody,
  Alert,
  Tooltip,
  Spinner,
  EmptyState,
} from "@patternfly/react-core";
import { ArrowLeftIcon, RedoIcon, TrashIcon, ExternalLinkAltIcon, TerminalIcon } from "@patternfly/react-icons";
import { useWebSocket } from "../hooks/useWebSocket";
import { isTerminal, isCompleted, isRunError } from "../types";
import type { Run } from "../types";
import { PhaseProgress } from "../components/PhaseProgress";
import { StatusLabel } from "../components/StatusLabel";
import { RunDetailsCard } from "../components/RunDetailsCard";
import { RunLogsCard } from "../components/RunLogsCard";
import { RunContextCard } from "../components/RunContextCard";
import { PrdStatusCard } from "../components/PrdStatusCard";
import { LiveTerminal } from "../components/LiveTerminal";

export function RunDetailPage() {
  const { runId } = useParams<{ runId: string }>();
  const navigate = useNavigate();
  const { runs, loading, stopRun, approveRun, rejectRun, retryRun, deleteRun, openInEditor, fetchRunLogs, fetchProgress, fetchRunHistory, progressMap, startRunForIssue } = useWebSocket();

  const run = runId ? runs.get(runId) : undefined;
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());
  const [approveError, setApproveError] = useState<string | null>(null);
  const [retryError, setRetryError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [editorError, setEditorError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [runHistory, setRunHistory] = useState<Run[]>([]);
  const [showTerminal, setShowTerminal] = useState(false);

  // Fetch persisted logs from DB once the run is loaded into state
  const runLoaded = run !== undefined;
  useEffect(() => {
    if (runId && runLoaded) {
      fetchRunLogs(runId);
    }
  }, [runId, runLoaded, fetchRunLogs]);

  // Fetch progress.txt content on mount
  useEffect(() => {
    if (runId) {
      fetchProgress(runId).then((content) => setProgress(content));
    }
  }, [runId, fetchProgress]);

  // Update progress from WebSocket
  useEffect(() => {
    if (runId) {
      const wsProgress = progressMap.get(runId);
      if (wsProgress) setProgress(wsProgress);
    }
  }, [runId, progressMap]);

  // Fetch run history for the same issue key
  useEffect(() => {
    if (run?.issueKey) {
      fetchRunHistory(run.issueKey).then((history) => setRunHistory(history));
    }
  }, [run?.issueKey, fetchRunHistory]);

  // Auto-expand the current phase section when it changes
  useEffect(() => {
    if (run) {
      setExpandedSections((prev) => {
        const next = new Set(prev);
        next.add(run.status);
        return next;
      });
    }
  }, [run?.status]);

  if (!run && loading) {
    return (
      <PageSection>
        <EmptyState titleText="Loading run…" headingLevel="h3" icon={Spinner} />
      </PageSection>
    );
  }

  if (!run) {
    return (
      <PageSection>
        <Title headingLevel="h2">Run not found</Title>
        <Button variant="link" icon={<ArrowLeftIcon />} onClick={() => navigate("/")}>
          Back to dashboard
        </Button>
      </PageSection>
    );
  }

  const isActive = !isCompleted(run.status);
  const canRetry = isTerminal(run.status);
  const isSuccess = run.status === "success";

  const handleApprove = async () => {
    setApproveError(null);
    const result = await approveRun(run.id);
    if (isRunError(result)) {
      setApproveError(result.error);
    }
  };

  const handleRetry = async () => {
    setRetryError(null);
    try {
      const result = await retryRun(run.id);
      navigate(`/runs/${result.id}`);
    } catch (err) {
      setRetryError(err instanceof Error ? err.message : "Retry failed");
    }
  };

  const handleDelete = async () => {
    if (!confirm("Permanently delete this run and all its data?")) return;
    setDeleteError(null);
    try {
      await deleteRun(run.id);
      navigate("/");
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "Delete failed");
    }
  };

  const handleRerun = async () => {
    if (!confirm("Re-run this previously successful ticket?")) return;
    setRetryError(null);
    try {
      const result = await startRunForIssue(run.issueKey, true);
      if (isRunError(result)) {
        setRetryError(result.error);
      } else if (result.id) {
        navigate(`/runs/${result.id}`);
      }
    } catch (err) {
      setRetryError(err instanceof Error ? err.message : "Re-run failed");
    }
  };

  const handleOpenEditor = async () => {
    setEditorError(null);
    try {
      await openInEditor(run.id);
    } catch (err) {
      setEditorError(err instanceof Error ? err.message : "Failed to open editor");
    }
  };

  return (
    <>
      <PageSection>
        <Flex justifyContent={{ default: "justifyContentSpaceBetween" }}>
          <FlexItem>
            <Flex alignItems={{ default: "alignItemsCenter" }} gap={{ default: "gapMd" }}>
              <Button variant="plain" icon={<ArrowLeftIcon />} onClick={() => navigate("/")} />
              <Title headingLevel="h2">{run.issueKey || run.id.slice(0, 8)}</Title>
              <StatusLabel status={run.status} />
            </Flex>
          </FlexItem>
          <FlexItem>
            <Flex gap={{ default: "gapMd" }}>
              <Tooltip
                content="Terminal session ended with the run"
                trigger={!isActive ? "mouseenter focus" : "manual"}
              >
                <Button
                  variant={showTerminal ? "primary" : "secondary"}
                  icon={<TerminalIcon />}
                  onClick={() => setShowTerminal((v) => !v)}
                  isDisabled={!isActive && !showTerminal}
                >
                  {!isActive ? "Terminal (ended)" : showTerminal ? "Hide Terminal" : "Attach Terminal"}
                </Button>
              </Tooltip>
              {run.repoPath && (
                <Button variant="secondary" icon={<ExternalLinkAltIcon />} onClick={handleOpenEditor}>
                  Open in Editor
                </Button>
              )}
              {isSuccess && (
                <Button variant="secondary" icon={<RedoIcon />} onClick={handleRerun}>
                  Re-run
                </Button>
              )}
              {canRetry && (
                <Button variant="secondary" icon={<RedoIcon />} onClick={handleRetry}>
                  Retry
                </Button>
              )}
              {!isActive && (
                <Button variant="danger" icon={<TrashIcon />} onClick={handleDelete}>
                  Delete
                </Button>
              )}
              {isActive && (
                <Button variant="danger" onClick={() => stopRun(run.id)}>
                  Stop
                </Button>
              )}
            </Flex>
          </FlexItem>
        </Flex>
      </PageSection>

      {retryError && (
        <PageSection>
          <Alert variant="danger" title="Retry failed" isInline>
            {retryError}
          </Alert>
        </PageSection>
      )}

      {editorError && (
        <PageSection>
          <Alert variant="danger" title="Failed to open editor" isInline>
            {editorError}
          </Alert>
        </PageSection>
      )}

      {deleteError && (
        <PageSection>
          <Alert variant="danger" title="Delete failed" isInline>
            {deleteError}
          </Alert>
        </PageSection>
      )}

      <PageSection>
        <PhaseProgress status={run.status} phaseTimestamps={run.phaseTimestamps} completedAt={run.completedAt} />
      </PageSection>

      {run.context && (
        <PageSection>
          <RunContextCard context={run.context} />
        </PageSection>
      )}

      {run.prd.length > 0 && (
        <PageSection>
          <PrdStatusCard entries={run.prd} />
        </PageSection>
      )}

      {run.status === "awaiting_approval" && (
        <PageSection>
          <Card>
            <CardTitle>Approval Required</CardTitle>
            <CardBody>
              <p style={{ marginBottom: "1rem" }}>
                Implementation is complete. Review the changes below before proceeding to create a PR.
              </p>
              {run.logs.length > 0 && (
                <pre style={{ maxHeight: "200px", overflow: "auto", marginBottom: "1rem", padding: "0.5rem", background: "var(--pf-t--global--background--color--secondary--default)", color: "var(--pf-t--global--text--color--regular)", fontSize: "0.85rem" }}>
                  {run.logs
                    .filter((l) => l.phase === "phase2")
                    .slice(-20)
                    .map((l) => l.line)
                    .join("\n")}
                </pre>
              )}
              {approveError && (
                <Alert variant="danger" title="Approval failed" isInline style={{ marginBottom: "1rem" }}>
                  {approveError}
                </Alert>
              )}
              <Flex gap={{ default: "gapMd" }}>
                <Button variant="primary" onClick={handleApprove}>
                  Approve &amp; Create PR
                </Button>
                <Button variant="danger" onClick={() => rejectRun(run.id)}>
                  Reject
                </Button>
              </Flex>
            </CardBody>
          </Card>
        </PageSection>
      )}

      {progress && (
        <PageSection>
          <Card>
            <CardTitle>Progress</CardTitle>
            <CardBody>
              <pre style={{ whiteSpace: "pre-wrap", fontSize: "0.85rem", maxHeight: "400px", overflow: "auto" }}>
                {progress}
              </pre>
            </CardBody>
          </Card>
        </PageSection>
      )}

      <PageSection isFilled>
        <Grid hasGutter>
          <GridItem span={4}>
            <RunDetailsCard run={run} />
            {run.retryCount != null && run.retryCount > 0 && (
              <Card style={{ marginTop: "1rem" }}>
                <CardTitle>Retry Info</CardTitle>
                <CardBody>
                  <p>Retry #{run.retryCount}</p>
                  {run.sourceRunId && (
                    <p>
                      Source run:{" "}
                      {runs.has(run.sourceRunId) ? (
                        <a href={`/runs/${run.sourceRunId}`} onClick={(e) => { e.preventDefault(); navigate(`/runs/${run.sourceRunId}`); }}>
                          {run.sourceRunId.slice(0, 8)}
                        </a>
                      ) : (
                        <span>{run.sourceRunId.slice(0, 8)} (deleted)</span>
                      )}
                    </p>
                  )}
                </CardBody>
              </Card>
            )}
            {runHistory.length > 1 && (
              <Card style={{ marginTop: "1rem" }}>
                <CardTitle>Run History ({run.issueKey})</CardTitle>
                <CardBody>
                  {runHistory.map((h) => (
                    <Flex key={h.id} gap={{ default: "gapSm" }} style={{ marginBottom: "0.5rem" }}>
                      <a
                        href={`/runs/${h.id}`}
                        onClick={(e) => { e.preventDefault(); navigate(`/runs/${h.id}`); }}
                        style={{ fontWeight: h.id === runId ? "bold" : "normal" }}
                      >
                        {h.id.slice(0, 8)}
                      </a>
                      <StatusLabel status={h.status} />
                      <small>{new Date(h.startedAt).toLocaleString()}</small>
                    </Flex>
                  ))}
                </CardBody>
              </Card>
            )}
          </GridItem>

          <GridItem span={8}>
            {showTerminal ? (
              <LiveTerminal runId={run.id} isActive={isActive} />
            ) : (
              <RunLogsCard
                logs={run.logs}
                status={run.status}
                expandedSections={expandedSections}
                onToggleSection={(phase, expanded) => {
                  setExpandedSections((prev) => {
                    const next = new Set(prev);
                    if (expanded) {
                      next.add(phase);
                    } else {
                      next.delete(phase);
                    }
                    return next;
                  });
                }}
              />
            )}
          </GridItem>
        </Grid>
      </PageSection>
    </>
  );
}
