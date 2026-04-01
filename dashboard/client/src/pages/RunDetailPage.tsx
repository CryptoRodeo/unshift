import React, { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  Alert,
  Tooltip,
  Tabs,
  Tab,
  TabTitleText,
} from "@patternfly/react-core";
import {
  ArrowLeftIcon,
  RedoIcon,
  TrashIcon,
  ExternalLinkAltIcon,
  HistoryIcon,
  TimesIcon,
  ExclamationTriangleIcon,
  CodeIcon,
} from "@patternfly/react-icons";
import { useWebSocketContext } from "../hooks/useWebSocket";
import { useHeaderContext } from "../hooks/useHeaderContext";
import { isTerminal, isCompleted, isRunError, formatDuration, PHASE_LABELS, relativeTime } from "../types";
import type { Run, RunPhase, WorktreeInfo } from "../types";
import { getRepoName } from "../hooks/useRunFilters";
import { PhaseProgress } from "../components/PhaseProgress";
import { StatusLabel } from "../components/StatusLabel";
import { ActivityFeed } from "../components/ActivityFeed";
import { DiffViewer } from "../components/DiffViewer";

function ConfirmModal({ title, message, confirmLabel, confirmVariant, onConfirm, onCancel }: {
  title: string;
  message: string;
  confirmLabel: string;
  confirmVariant: "primary" | "danger";
  onConfirm: () => void;
  onCancel: () => void;
}) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
      if (e.key === "Enter") onConfirm();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onConfirm, onCancel]);

  return (
    <div className="us-modal-overlay" onClick={onCancel}>
      <div className="us-modal" onClick={(e) => e.stopPropagation()}>
        <h3 className="us-modal__title">{title}</h3>
        <p className="us-modal__message">{message}</p>
        <div className="us-modal__actions">
          <button className="us-btn us-btn--ghost" onClick={onCancel}>Cancel</button>
          <button className={`us-btn us-btn--${confirmVariant}`} onClick={onConfirm} autoFocus>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}

function inferProvider(
  model: string | undefined,
  providers: { provider: string; models: string[] }[]
): string | undefined {
  if (!model) return undefined;
  for (const p of providers) {
    if (p.models.includes(model)) return p.provider;
  }
  return undefined;
}

function PhaseTimingBreakdown({ phaseTimestamps }: { phaseTimestamps: Record<string, string> }) {
  const entries = Object.entries(phaseTimestamps).sort(
    (a, b) => new Date(a[1]).getTime() - new Date(b[1]).getTime()
  );
  if (entries.length < 2) return null;

  const durations: { label: string; ms: number }[] = [];
  for (let i = 0; i < entries.length - 1; i++) {
    const [phase] = entries[i];
    const start = new Date(entries[i][1]).getTime();
    const end = new Date(entries[i + 1][1]).getTime();
    const ms = end - start;
    if (ms > 0) {
      durations.push({ label: PHASE_LABELS[phase] || phase, ms });
    }
  }

  return (
    <>
      {durations.map((d) => (
        <div key={d.label} className="us-detail-sidebar__section">
          <span className="us-detail-sidebar__label">{d.label}</span>
          <span className="us-detail-sidebar__value us-detail-sidebar__mono">{formatDuration(d.ms)}</span>
        </div>
      ))}
    </>
  );
}

export function RunDetailPage() {
  const { runId } = useParams<{ runId: string }>();
  const navigate = useNavigate();
  const { runs, loading, connected, stopRun, approveRun, rejectRun, retryRun, deleteRun, fetchRepoUrl, fetchRunLogs, fetchRunHistory, startRunForIssue, commentsMap, fetchComments, addComment, progressMap } = useWebSocketContext();
  const headerCtx = useHeaderContext();

  useEffect(() => {
    if (headerCtx) headerCtx.setConnected(connected);
  }, [connected, headerCtx]);

  const run = runId ? runs.get(runId) : undefined;

  const issueKey = run?.issueKey;
  useEffect(() => {
    if (headerCtx) headerCtx.setBreadcrumbLabel(issueKey || null);
    return () => { if (headerCtx) headerCtx.setBreadcrumbLabel(null); };
  }, [issueKey, headerCtx]);

  const [activeTab, setActiveTab] = useState<string | number>(0);
  const [approveError, setApproveError] = useState<string | null>(null);
  const [retryError, setRetryError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [repoUrl, setRepoUrl] = useState<string | null>(null);
  const [runHistory, setRunHistory] = useState<Run[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [confirmAction, setConfirmAction] = useState<"approve" | "reject" | null>(null);
  const [rerunModal, setRerunModal] = useState<"retry" | "rerun" | null>(null);
  const [providers, setProviders] = useState<{ provider: string; defaultModel: string; models: string[] }[]>([]);
  const [modalProvider, setModalProvider] = useState("");
  const [modalModel, setModalModel] = useState("");
  const [jiraBaseUrl, setJiraBaseUrl] = useState<string | null>(null);
  const [liveJiraStatus, setLiveJiraStatus] = useState<string | null>(null);
  const [editorLoading, setEditorLoading] = useState(false);
  const [editorError, setEditorError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      fetch("/api/providers").then((r) => r.json() as Promise<{ providers: { provider: string; defaultModel: string; models: string[] }[] }>),
      fetch("/api/config").then((r) => r.json() as Promise<{ jiraBaseUrl?: string | null }>),
    ]).then(([providersData, configData]) => {
      setProviders(providersData.providers);
      if (configData.jiraBaseUrl) setJiraBaseUrl(configData.jiraBaseUrl);
    }).catch(() => {});
  }, []);

  // Fetch live Jira ticket status
  useEffect(() => {
    if (!run?.issueKey) return;
    let cancelled = false;
    const fetchStatus = () => {
      fetch(`/api/jira/issue/${encodeURIComponent(run.issueKey)}/status`)
        .then((r) => r.ok ? r.json() as Promise<{ status: string }> : null)
        .then((data) => { if (!cancelled && data) setLiveJiraStatus(data.status); })
        .catch(() => {});
    };
    fetchStatus();
    const interval = setInterval(fetchStatus, 60_000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [run?.issueKey]);

  const doApprove = useCallback(async () => {
    if (!run) return;
    setConfirmAction(null);
    setApproveError(null);
    const result = await approveRun(run.id);
    if (isRunError(result)) {
      setApproveError(result.error);
    }
  }, [approveRun, run]);

  const doReject = useCallback(async () => {
    if (!run) return;
    setConfirmAction(null);
    await rejectRun(run.id);
  }, [rejectRun, run]);

  const runLoaded = run !== undefined;
  useEffect(() => {
    if (runId && runLoaded) {
      fetchRunLogs(runId);
      fetchComments(runId);
    }
  }, [runId, runLoaded, fetchRunLogs, fetchComments]);

  useEffect(() => {
    if (run?.issueKey) {
      fetchRunHistory(run.issueKey).then((history) => setRunHistory(history));
    }
  }, [run?.issueKey, fetchRunHistory]);

  // Keyboard shortcuts for approval flow: A = approve, R = reject
  useEffect(() => {
    if (!run || run.status !== "awaiting_approval" || confirmAction) return;
    const handler = (e: KeyboardEvent) => {
      // Ignore when typing in an input/textarea
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

      if (e.key === "a" || e.key === "A") {
        e.preventDefault();
        setConfirmAction("approve");
      } else if (e.key === "r" || e.key === "R") {
        e.preventDefault();
        setConfirmAction("reject");
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [run?.status, confirmAction]);

  useEffect(() => {
    if (!run?.repoPath) return;
    fetchRepoUrl(run.id).then((data) => setRepoUrl(data.repoUrl)).catch(() => {});
  }, [run?.id, run?.repoPath, fetchRepoUrl]);

  if (!run && loading) {
    return (
      <div className="us-skeleton-detail us-fade-in">
        <div className="us-skeleton-detail__subheader">
          <div className="us-skeleton us-skeleton-detail__back" />
          <div className="us-skeleton us-skeleton-detail__title" />
          <div className="us-skeleton us-skeleton-detail__status" />
        </div>
        <div className="us-skeleton-detail__content">
          <div className="us-skeleton-detail__progress">
            {Array.from({ length: 5 }).map((_, i) => (
              <React.Fragment key={i}>
                <div className="us-skeleton us-skeleton-detail__progress-circle" />
                {i < 4 && <div className="us-skeleton us-skeleton-detail__progress-line" />}
              </React.Fragment>
            ))}
          </div>
          <div className="us-skeleton-detail__card">
            <div className="us-skeleton us-skeleton-detail__card-title" />
            <div className="us-skeleton us-skeleton-detail__card-line" />
            <div className="us-skeleton us-skeleton-detail__card-line us-skeleton-detail__card-line--short" />
          </div>
          <div className="us-skeleton-detail__logs">
            <div className="us-skeleton-detail__logs-header">
              <div className="us-skeleton us-skeleton-detail__logs-tab" />
              <div className="us-skeleton us-skeleton-detail__logs-tab" />
            </div>
            <div className="us-skeleton-detail__logs-body">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="us-skeleton us-skeleton-detail__logs-line" style={{ width: `${50 + Math.random() * 45}%` }} />
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!run) {
    return (
      <div className="us-not-found us-fade-in">
        <div className="us-not-found__code">404</div>
        <h2 className="us-not-found__title">Run not found</h2>
        <p className="us-not-found__body">This run may have been deleted or the URL is incorrect.</p>
        <button className="us-btn us-btn--primary" onClick={() => navigate("/")}>
          <ArrowLeftIcon /> Back to Dashboard
        </button>
      </div>
    );
  }

  const isActive = !isCompleted(run.status);
  const canRetry = isTerminal(run.status);
  const isSuccess = run.status === "success";

  const openRerunModal = (mode: "retry" | "rerun") => {
    const runModel = run.tokens?.model;
    const detectedProvider = inferProvider(runModel, providers);
    if (detectedProvider) {
      setModalProvider(detectedProvider);
      setModalModel(runModel ?? "");
    } else if (providers.length > 0) {
      setModalProvider(providers[0].provider);
      setModalModel(providers[0].defaultModel);
    }
    setRerunModal(mode);
  };

  const handleRetryConfirm = async () => {
    setRerunModal(null);
    setRetryError(null);
    try {
      const result = await retryRun(run.id, { provider: modalProvider, model: modalModel });
      navigate(`/runs/${result.id}`);
    } catch (err) {
      setRetryError(err instanceof Error ? err.message : "Retry failed");
    }
  };

  const handleRerunConfirm = async () => {
    setRerunModal(null);
    setRetryError(null);
    try {
      const result = await startRunForIssue(run.issueKey, true, { provider: modalProvider, model: modalModel });
      if (isRunError(result)) {
        setRetryError(result.error);
      } else if (result.id) {
        navigate(`/runs/${result.id}`);
      }
    } catch (err) {
      setRetryError(err instanceof Error ? err.message : "Re-run failed");
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

  const handleModalProviderChange = (provider: string) => {
    setModalProvider(provider);
    const match = providers.find((p) => p.provider === provider);
    if (match) setModalModel(match.defaultModel);
  };

  const handleOpenInEditor = async () => {
    setEditorLoading(true);
    setEditorError(null);
    try {
      const res = await fetch(`/api/runs/${run.id}/worktree`);
      if (!res.ok) {
        setEditorError("Failed to fetch worktree info");
        return;
      }
      const info: WorktreeInfo = await res.json();
      if (!info.available) {
        setEditorError(info.error || "Worktree is not available");
        return;
      }
      // Use a hidden <a> element to open custom protocol URIs (window.open is blocked by browsers)
      const a = document.createElement("a");
      if (info.hasDevContainer) {
        a.href = info.devContainerUri;
      } else {
        a.href = info.vsCodeUri;
      }
      a.click();
    } catch {
      setEditorError("Failed to open editor");
    } finally {
      setEditorLoading(false);
    }
  };

  const jiraIssueUrl = (jiraBaseUrl && run.issueKey ? `${jiraBaseUrl.replace(/\/+$/, "")}/browse/${run.issueKey}` : null)
    ?? run.context?.jiraUrl;

  return (
    <div className="us-detail us-fade-in">
      {/* Sticky sub-header */}
      <div className="us-detail-subheader">
        <div className="us-detail-subheader__left">
          <button className="us-detail-subheader__back" onClick={() => navigate("/")} aria-label="Back to dashboard">
            <ArrowLeftIcon />
          </button>
          <h1 className="us-detail-subheader__title">
            {run.issueKey ? (
              <>
                <a
                  href={`/projects/${encodeURIComponent(run.issueKey)}`}
                  className="us-detail-subheader__title-link"
                  onClick={(e) => { e.preventDefault(); navigate(`/projects/${encodeURIComponent(run.issueKey)}`); }}
                >
                  {run.issueKey}
                </a>
                <span className="us-detail-subheader__breadcrumb-sep">&gt;</span>
                <span className="us-detail-subheader__breadcrumb-run">Run #{run.id.slice(0, 8)}</span>
              </>
            ) : (
              run.id.slice(0, 8)
            )}
          </h1>
          <StatusLabel status={run.status} />
        </div>
        <div className="us-detail-subheader__actions">
          {/* Primary action */}
          {run.status === "awaiting_approval" && (
            <>
              <button className="us-btn us-btn--primary" onClick={() => setConfirmAction("approve")}>Approve &amp; Create PR</button>
              <button className="us-btn us-btn--danger" onClick={() => setConfirmAction("reject")}>Reject</button>
            </>
          )}
          {isActive && run.status !== "awaiting_approval" && (
            <button className="us-btn us-btn--danger" onClick={() => stopRun(run.id)}>Stop</button>
          )}

          {/* Secondary icon buttons */}
          <div className="us-detail-subheader__secondary">
            {(run.status === "awaiting_approval" || run.status === "success") && (
              <Tooltip content={editorLoading ? "Loading…" : "Open worktree in VSCode"}>
                <button
                  className={`us-detail-subheader__icon-btn us-btn--editor${editorLoading ? " us-btn--editor-loading" : ""}`}
                  onClick={handleOpenInEditor}
                  disabled={editorLoading}
                  aria-label="Open in Editor"
                >
                  <CodeIcon />
                </button>
              </Tooltip>
            )}

            {run.repoPath && (
              <Tooltip content={repoUrl ? "Open Repository" : "Repository URL not available"}>
                <a
                  className={`us-detail-subheader__icon-btn${repoUrl ? "" : " us-detail-subheader__icon-btn--disabled"}`}
                  href={repoUrl ?? undefined}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="Open Repository"
                  aria-disabled={!repoUrl}
                  onClick={repoUrl ? undefined : (e) => e.preventDefault()}
                >
                  <ExternalLinkAltIcon />
                </a>
              </Tooltip>
            )}

            {isSuccess && (
              <Tooltip content="Re-run">
                <button className="us-detail-subheader__icon-btn" onClick={() => openRerunModal("rerun")} aria-label="Re-run">
                  <RedoIcon />
                </button>
              </Tooltip>
            )}

            {canRetry && (
              <Tooltip content="Retry">
                <button className="us-detail-subheader__icon-btn" onClick={() => openRerunModal("retry")} aria-label="Retry">
                  <RedoIcon />
                </button>
              </Tooltip>
            )}

            {runHistory.length > 1 && (
              <Tooltip content="Run history">
                <button
                  className={`us-detail-subheader__icon-btn ${showHistory ? "us-detail-subheader__icon-btn--active" : ""}`}
                  onClick={() => setShowHistory((v) => !v)}
                  aria-label="Run history"
                >
                  <HistoryIcon />
                </button>
              </Tooltip>
            )}
          </div>

          {/* Danger action — separated */}
          {!isActive && (
            <>
              <span className="us-detail-subheader__divider" />
              <Tooltip content="Delete run">
                <button className="us-detail-subheader__icon-btn us-detail-subheader__icon-btn--danger" onClick={handleDelete} aria-label="Delete">
                  <TrashIcon />
                </button>
              </Tooltip>
            </>
          )}
        </div>

      </div>

      {/* Error alerts */}
      {(retryError || deleteError || approveError || editorError) && (
        <div className="us-detail-alerts">
          {approveError && <Alert variant="danger" title="Approval failed" isInline>{approveError}</Alert>}
          {retryError && <Alert variant="danger" title="Retry failed" isInline>{retryError}</Alert>}
          {deleteError && <Alert variant="danger" title="Delete failed" isInline>{deleteError}</Alert>}
          {editorError && <Alert variant="warning" title="Open in Editor" isInline>{editorError}</Alert>}
        </div>
      )}

      {/* Two-panel layout */}
      <div className="us-detail-panels">
        {/* Center content area */}
        <div className="us-detail-main">
          {/* Issue summary & description */}
          {run.context && (
            <section className="us-detail-section us-detail-description">
              <div className="us-detail-description__header">
                <h2 className="us-detail-description__summary">
                  {jiraIssueUrl ? (
                    <a href={jiraIssueUrl} target="_blank" rel="noreferrer" className="us-detail-subheader__title-link">
                      {run.context.summary}
                    </a>
                  ) : (
                    run.context.summary
                  )}
                </h2>
                <span className="us-detail-description__started">Started {relativeTime(run.startedAt)}</span>
              </div>
              {run.context.description && (
                <p className="us-detail-description__body">{run.context.description}</p>
              )}
            </section>
          )}

          {/* Phase Progress */}
          <section className="us-detail-section">
            <PhaseProgress status={run.status} phaseTimestamps={run.phaseTimestamps} completedAt={run.completedAt} />
          </section>

          {/* Approval banner */}
          {run.status === "awaiting_approval" && (
            <section className="us-detail-section us-approval-banner us-approval-banner--pulse">
              <div className="us-approval-banner__content">
                <div className="us-approval-banner__header">
                  <ExclamationTriangleIcon className="us-approval-banner__icon" />
                  <div className="us-approval-banner__text">
                    <strong>Approval Required</strong>
                    <p>Implementation is complete. Review the changes before proceeding to create a PR.</p>
                  </div>
                </div>
                <div className="us-approval-banner__actions">
                  <button className="us-btn us-btn--primary" onClick={() => setConfirmAction("approve")}>
                    Approve &amp; Create PR
                  </button>
                  <button className="us-btn us-btn--danger" onClick={() => setConfirmAction("reject")}>
                    Reject
                  </button>
                  <span className="us-approval-banner__shortcuts">
                    Press <kbd>A</kbd> to approve · <kbd>R</kbd> to reject
                  </span>
                </div>
              </div>
            </section>
          )}

          {/* Tabbed content: Activity / Changes */}
          <section className="us-detail-section us-detail-section--fill">
            <Tabs activeKey={activeTab} onSelect={(_e, key) => setActiveTab(key)} className="us-detail-content-tabs">
              <Tab eventKey={0} title={<TabTitleText>Activity</TabTitleText>}>
                <ActivityFeed
                  run={run}
                  modelName={run.tokens?.model}
                  comments={commentsMap.get(run.id)}
                  onAddComment={(content) => addComment(run.id, content)}
                  progressText={progressMap.get(run.id)}
                />
              </Tab>
              {run.repoPath ? (
                <Tab eventKey={1} title={<TabTitleText>Changes</TabTitleText>}>
                  <DiffViewer runId={run.id} />
                </Tab>
              ) : null}
            </Tabs>
          </section>
        </div>

        {/* Right metadata sidebar */}
        <aside className="us-detail-sidebar">
          {/* RUN INFO */}
          {(run.tokens?.model || (run.retryCount != null && run.retryCount > 0)) && (
            <div className="us-detail-sidebar__group">
              <h3 className="us-detail-sidebar__group-header">Run Info</h3>
              {run.tokens?.model && (
                <div className="us-detail-sidebar__section us-detail-sidebar__section--vertical">
                  <span className="us-detail-sidebar__label">Model</span>
                  <code className="us-detail-sidebar__value us-detail-sidebar__code">{run.tokens.model}</code>
                </div>
              )}
              {run.retryCount != null && run.retryCount > 0 && (
                <div className="us-detail-sidebar__section">
                  <span className="us-detail-sidebar__label">Retry</span>
                  <span className="us-detail-sidebar__value">
                    #{run.retryCount}
                    {run.sourceRunId && (
                      <>
                        {" from "}
                        {runs.has(run.sourceRunId) ? (
                          <a href={`/runs/${run.sourceRunId}`} className="us-detail-sidebar__link" onClick={(e) => { e.preventDefault(); navigate(`/runs/${run.sourceRunId}`); }}>
                            {run.sourceRunId.slice(0, 8)}
                          </a>
                        ) : (
                          <span>{run.sourceRunId.slice(0, 8)} (deleted)</span>
                        )}
                      </>
                    )}
                  </span>
                </div>
              )}
            </div>
          )}

          {/* TICKET */}
          {run.context && (
            <div className="us-detail-sidebar__group">
              <h3 className="us-detail-sidebar__group-header">Ticket</h3>
              {run.context.issueType && (
                <div className="us-detail-sidebar__section">
                  <span className="us-detail-sidebar__label">Type</span>
                  <span className="us-detail-sidebar__value us-detail-sidebar__issue-type">{run.context.issueType}</span>
                </div>
              )}
              {(liveJiraStatus || run.context.jiraStatus) && (
                <div className="us-detail-sidebar__section">
                  <span className="us-detail-sidebar__label">Status</span>
                  <span className="us-detail-sidebar__value">{liveJiraStatus || run.context.jiraStatus}</span>
                </div>
              )}
              {run.context.priority && (
                <div className="us-detail-sidebar__section">
                  <span className="us-detail-sidebar__label">Priority</span>
                  <span className={`us-detail-sidebar__value us-detail-sidebar__priority us-detail-sidebar__priority--${run.context.priority.toLowerCase()}`}>{run.context.priority}</span>
                </div>
              )}
              {run.context.assignee && (
                <div className="us-detail-sidebar__section">
                  <span className="us-detail-sidebar__label">Assignee</span>
                  <span className="us-detail-sidebar__value">{run.context.assignee}</span>
                </div>
              )}
              {run.context.labels && run.context.labels.length > 0 && (
                <div className="us-detail-sidebar__section us-detail-sidebar__section--vertical">
                  <span className="us-detail-sidebar__label">Labels</span>
                  <span className="us-detail-sidebar__value us-detail-sidebar__labels">
                    {run.context.labels.map((label) => (
                      <span key={label} className="us-detail-sidebar__label-tag">{label}</span>
                    ))}
                  </span>
                </div>
              )}
            </div>
          )}

          {/* GIT */}
          {(run.repoPath || run.branchName || run.prUrl) && (
            <div className="us-detail-sidebar__group">
              <h3 className="us-detail-sidebar__group-header">Git</h3>
              {run.repoPath && (
                <>
                  <div className="us-detail-sidebar__section us-detail-sidebar__section--vertical">
                    <span className="us-detail-sidebar__label">Repository</span>
                    <code className="us-detail-sidebar__value us-detail-sidebar__code">{getRepoName(run) ?? run.repoPath}</code>
                  </div>
                  {run.repoPath.includes(".worktrees") && (
                    <div className="us-detail-sidebar__section us-detail-sidebar__section--vertical">
                      <span className="us-detail-sidebar__label">Work Tree</span>
                      <code className="us-detail-sidebar__value us-detail-sidebar__code">{run.repoPath}</code>
                    </div>
                  )}
                </>
              )}
              {run.branchName && (
                <div className="us-detail-sidebar__section us-detail-sidebar__section--vertical">
                  <span className="us-detail-sidebar__label">Branch</span>
                  <code className="us-detail-sidebar__value us-detail-sidebar__code">{run.branchName}</code>
                </div>
              )}
              {run.prUrl && (
                <div className="us-detail-sidebar__section us-detail-sidebar__section--vertical">
                  <span className="us-detail-sidebar__label">Pull Request</span>
                  <a href={run.prUrl} target="_blank" rel="noreferrer" className="us-detail-sidebar__value us-detail-sidebar__link">
                    {run.prUrl.replace(/^https?:\/\/[^/]+\//, "")}
                  </a>
                </div>
              )}
            </div>
          )}

          {/* USAGE */}
          {run.tokens && (
            <div className="us-detail-sidebar__group">
              <h3 className="us-detail-sidebar__group-header">Usage</h3>
              <div className="us-detail-sidebar__section">
                <span className="us-detail-sidebar__label">Input Tokens</span>
                <span className="us-detail-sidebar__value us-detail-sidebar__mono">{run.tokens.inputTokens.toLocaleString()}</span>
              </div>
              <div className="us-detail-sidebar__section">
                <span className="us-detail-sidebar__label">Output Tokens</span>
                <span className="us-detail-sidebar__value us-detail-sidebar__mono">{run.tokens.outputTokens.toLocaleString()}</span>
              </div>
              {run.tokens.cacheReadTokens > 0 && (
                <div className="us-detail-sidebar__section">
                  <span className="us-detail-sidebar__label">Cache Read</span>
                  <span className="us-detail-sidebar__value us-detail-sidebar__mono">{run.tokens.cacheReadTokens.toLocaleString()}</span>
                </div>
              )}
              {run.tokens.cacheCreationTokens > 0 && (
                <div className="us-detail-sidebar__section">
                  <span className="us-detail-sidebar__label">Cache Creation</span>
                  <span className="us-detail-sidebar__value us-detail-sidebar__mono">{run.tokens.cacheCreationTokens.toLocaleString()}</span>
                </div>
              )}
              <div className="us-detail-sidebar__section us-detail-sidebar__total">
                <span className="us-detail-sidebar__label">Total</span>
                <span className="us-detail-sidebar__value us-detail-sidebar__mono">
                  {(run.tokens.inputTokens + run.tokens.outputTokens + run.tokens.cacheReadTokens + run.tokens.cacheCreationTokens).toLocaleString()}
                </span>
              </div>
            </div>
          )}

          {/* TIMING */}
          <div className="us-detail-sidebar__group">
            <h3 className="us-detail-sidebar__group-header">Timing</h3>
            <div className="us-detail-sidebar__section">
              <span className="us-detail-sidebar__label">Started</span>
              <span className="us-detail-sidebar__value">{new Date(run.startedAt).toLocaleString()}</span>
            </div>
            <div className="us-detail-sidebar__section">
              <span className="us-detail-sidebar__label">Duration</span>
              <span className="us-detail-sidebar__value us-detail-sidebar__mono">
                {formatDuration(
                  (run.completedAt ? new Date(run.completedAt).getTime() : Date.now()) -
                  new Date(run.startedAt).getTime()
                )}
              </span>
            </div>
            {run.phaseTimestamps && <PhaseTimingBreakdown phaseTimestamps={run.phaseTimestamps} />}
          </div>
        </aside>
      </div>

      {/* History Drawer — slides in from right */}
      {/* Confirmation modals */}
      {confirmAction === "approve" && (
        <ConfirmModal
          title="Approve & Create PR"
          message={`This will create a pull request for ${run.issueKey}${run.repoPath ? ` in ${getRepoName(run) ?? run.repoPath}` : ""}.`}
          confirmLabel="Approve"
          confirmVariant="primary"
          onConfirm={doApprove}
          onCancel={() => setConfirmAction(null)}
        />
      )}
      {confirmAction === "reject" && (
        <ConfirmModal
          title="Reject Changes"
          message={`This will reject the implementation for ${run.issueKey}. The changes will be discarded.`}
          confirmLabel="Reject"
          confirmVariant="danger"
          onConfirm={doReject}
          onCancel={() => setConfirmAction(null)}
        />
      )}

      {rerunModal && (
        <div className="us-modal-overlay" onClick={() => setRerunModal(null)}>
          <div className="us-modal" onClick={(e) => e.stopPropagation()}>
            <h3 className="us-modal__title">{rerunModal === "retry" ? "Retry Run" : "Re-run Ticket"}</h3>
            <p className="us-modal__message">
              {rerunModal === "retry"
                ? `Retry ${run.issueKey} from the implementation phase with a different model.`
                : `Re-run ${run.issueKey} from scratch with a different model.`}
            </p>
            {providers.length > 0 && (
              <div className="us-modal__fields">
                <label className="us-modal__label">Provider</label>
                <select
                  className="us-select us-select--full"
                  value={modalProvider}
                  onChange={(e) => handleModalProviderChange(e.target.value)}
                  aria-label="Provider"
                >
                  {providers.map((p) => (
                    <option key={p.provider} value={p.provider}>{p.provider}</option>
                  ))}
                </select>
                <label className="us-modal__label">Model</label>
                <select
                  className="us-select us-select--full"
                  value={modalModel}
                  onChange={(e) => setModalModel(e.target.value)}
                  aria-label="Model"
                >
                  {(providers.find((p) => p.provider === modalProvider)?.models ?? []).map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              </div>
            )}
            <div className="us-modal__actions">
              <button className="us-btn us-btn--ghost" onClick={() => setRerunModal(null)}>Cancel</button>
              <button
                className="us-btn us-btn--primary"
                onClick={rerunModal === "retry" ? handleRetryConfirm : handleRerunConfirm}
                autoFocus
              >
                {rerunModal === "retry" ? "Retry" : "Re-run"}
              </button>
            </div>
          </div>
        </div>
      )}


      {showHistory && runHistory.length > 1 && (
        <div className="us-drawer-overlay" onClick={() => setShowHistory(false)}>
          <div className="us-drawer" onClick={(e) => e.stopPropagation()}>
            <div className="us-drawer__header">
              <h3>Run History ({run.issueKey})</h3>
              <button className="us-drawer__close" onClick={() => setShowHistory(false)} aria-label="Close history">
                <TimesIcon />
              </button>
            </div>
            <div className="us-drawer__body">
              {runHistory.map((h) => (
                <div
                  key={h.id}
                  className={`us-drawer__item ${h.id === runId ? "us-drawer__item--current" : ""}`}
                  onClick={() => { navigate(`/runs/${h.id}`); setShowHistory(false); }}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { navigate(`/runs/${h.id}`); setShowHistory(false); } }}
                >
                  <code className="us-drawer__item-id">{h.id.slice(0, 8)}</code>
                  <StatusLabel status={h.status} />
                  <small className="us-drawer__item-date">{new Date(h.startedAt).toLocaleString()}</small>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
