import React, { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  Alert,
  Tooltip,
} from "@patternfly/react-core";
import {
  ArrowLeftIcon,
  RedoIcon,
  TrashIcon,
  ExternalLinkAltIcon,
  InfoCircleIcon,
  HistoryIcon,
  TimesIcon,
  ExclamationTriangleIcon,
  CopyIcon,
  CheckIcon,
} from "@patternfly/react-icons";
import { useWebSocket } from "../hooks/useWebSocket";
import { useHeaderContext } from "../hooks/useHeaderContext";
import { isTerminal, isCompleted, isRunError } from "../types";
import type { Run } from "../types";
import { PhaseProgress } from "../components/PhaseProgress";
import { StatusLabel } from "../components/StatusLabel";
import { RunContextCard } from "../components/RunContextCard";
import { PrdStatusCard } from "../components/PrdStatusCard";
import { RunLogsCard } from "../components/RunLogsCard";

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

export function RunDetailPage() {
  const { runId } = useParams<{ runId: string }>();
  const navigate = useNavigate();
  const { runs, loading, connected, stopRun, approveRun, rejectRun, retryRun, deleteRun, fetchEditorInfo, fetchRunLogs, fetchProgress, fetchRunHistory, progressMap, startRunForIssue } = useWebSocket();
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

  const [approveError, setApproveError] = useState<string | null>(null);
  const [retryError, setRetryError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [editorError, setEditorError] = useState<string | null>(null);
  const [editorInfo, setEditorInfo] = useState<{ localDir: string; branchName: string | null; gitCommand: string | null } | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [runHistory, setRunHistory] = useState<Run[]>([]);
  const [showMetadata, setShowMetadata] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [confirmAction, setConfirmAction] = useState<"approve" | "reject" | null>(null);

  const doApprove = useCallback(async () => {
    setConfirmAction(null);
    setApproveError(null);
    const result = await approveRun(run?.id ?? "");
    if (isRunError(result)) {
      setApproveError(result.error);
    }
  }, [approveRun, run?.id]);

  const doReject = useCallback(async () => {
    setConfirmAction(null);
    await rejectRun(run?.id ?? "");
  }, [rejectRun, run?.id]);

  const runLoaded = run !== undefined;
  useEffect(() => {
    if (runId && runLoaded) {
      fetchRunLogs(runId);
    }
  }, [runId, runLoaded, fetchRunLogs]);

  useEffect(() => {
    if (runId) {
      fetchProgress(runId).then((content) => setProgress(content));
    }
  }, [runId, fetchProgress]);

  useEffect(() => {
    if (runId) {
      const wsProgress = progressMap.get(runId);
      if (wsProgress) setProgress(wsProgress);
    }
  }, [runId, progressMap]);

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
      const info = await fetchEditorInfo(run.id);
      setEditorInfo(info);
    } catch (err) {
      setEditorError(err instanceof Error ? err.message : "Failed to get editor info");
    }
  };

  const handleCopy = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(null), 2000);
  };

  return (
    <div className="us-detail us-fade-in">
      {/* Sticky sub-header */}
      <div className="us-detail-subheader">
        <div className="us-detail-subheader__left">
          <button className="us-detail-subheader__back" onClick={() => navigate("/")} aria-label="Back to dashboard">
            <ArrowLeftIcon />
          </button>
          <h1 className="us-detail-subheader__title">{run.issueKey || run.id.slice(0, 8)}</h1>
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
            {run.repoPath && (
              <Tooltip content="Open Locally">
                <button className="us-detail-subheader__icon-btn" onClick={handleOpenEditor} aria-label="Open Locally">
                  <ExternalLinkAltIcon />
                </button>
              </Tooltip>
            )}

            {isSuccess && (
              <Tooltip content="Re-run">
                <button className="us-detail-subheader__icon-btn" onClick={handleRerun} aria-label="Re-run">
                  <RedoIcon />
                </button>
              </Tooltip>
            )}

            {canRetry && (
              <Tooltip content="Retry">
                <button className="us-detail-subheader__icon-btn" onClick={handleRetry} aria-label="Retry">
                  <RedoIcon />
                </button>
              </Tooltip>
            )}

            <Tooltip content={showMetadata ? "Hide details" : "Show details"}>
              <button
                className={`us-detail-subheader__icon-btn ${showMetadata ? "us-detail-subheader__icon-btn--active" : ""}`}
                onClick={() => setShowMetadata((v) => !v)}
                aria-label="Toggle details"
              >
                <InfoCircleIcon />
              </button>
            </Tooltip>

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

        {/* Collapsible metadata row */}
        {showMetadata && (
          <div className="us-detail-metadata">
            <div className="us-detail-metadata__item">
              <span className="us-detail-metadata__label">Run ID</span>
              <code className="us-detail-metadata__value">{run.issueKey || run.id}</code>
            </div>
            <div className="us-detail-metadata__item">
              <span className="us-detail-metadata__label">Started</span>
              <span className="us-detail-metadata__value">{new Date(run.startedAt).toLocaleString()}</span>
            </div>
            {run.repoPath && (
              <div className="us-detail-metadata__item">
                <span className="us-detail-metadata__label">Repository</span>
                <code className="us-detail-metadata__value">{run.repoPath}</code>
              </div>
            )}
            {run.branchName && (
              <div className="us-detail-metadata__item">
                <span className="us-detail-metadata__label">Branch</span>
                <code className="us-detail-metadata__value">{run.branchName}</code>
              </div>
            )}
            {run.prUrl && (
              <div className="us-detail-metadata__item">
                <span className="us-detail-metadata__label">Pull Request</span>
                <a href={run.prUrl} target="_blank" rel="noreferrer" className="us-detail-metadata__value us-detail-metadata__link">{run.prUrl}</a>
              </div>
            )}
            {run.tokens?.model && (
              <div className="us-detail-metadata__item">
                <span className="us-detail-metadata__label">Model</span>
                <code className="us-detail-metadata__value">{run.tokens.model}</code>
              </div>
            )}
            {run.retryCount != null && run.retryCount > 0 && (
              <div className="us-detail-metadata__item">
                <span className="us-detail-metadata__label">Retry</span>
                <span className="us-detail-metadata__value">
                  #{run.retryCount}
                  {run.sourceRunId && (
                    <>
                      {" from "}
                      {runs.has(run.sourceRunId) ? (
                        <a href={`/runs/${run.sourceRunId}`} onClick={(e) => { e.preventDefault(); navigate(`/runs/${run.sourceRunId}`); }}>
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
      </div>

      {/* Error alerts */}
      {(retryError || editorError || deleteError || approveError) && (
        <div className="us-detail-alerts">
          {approveError && <Alert variant="danger" title="Approval failed" isInline>{approveError}</Alert>}
          {retryError && <Alert variant="danger" title="Retry failed" isInline>{retryError}</Alert>}
          {editorError && <Alert variant="danger" title="Failed to get editor info" isInline>{editorError}</Alert>}
          {deleteError && <Alert variant="danger" title="Delete failed" isInline>{deleteError}</Alert>}
        </div>
      )}

      {/* Single-column stacked layout */}
      <div className="us-detail-content">
        {/* Phase Progress — full width */}
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
              {run.logs.length > 0 && (
                <details className="us-approval-banner__details">
                  <summary>View recent output</summary>
                  <pre className="us-approval-banner__logs">
                    {run.logs
                      .filter((l) => l.phase === "phase2")
                      .slice(-20)
                      .map((l) => l.line)
                      .join("\n")}
                  </pre>
                </details>
              )}
            </div>
          </section>
        )}

        {/* Context Card — full width */}
        {run.context && (
          <section className="us-detail-section">
            <RunContextCard context={run.context} />
          </section>
        )}

        {/* PRD Card — full width, collapsible */}
        {run.prd.length > 0 && (
          <section className="us-detail-section">
            <PrdStatusCard entries={run.prd} />
          </section>
        )}

        {/* Progress */}
        {progress && (
          <section className="us-detail-section">
            <div className="us-detail-card">
              <h3 className="us-detail-card__title">Progress</h3>
              <pre className="us-detail-card__pre">{progress}</pre>
            </div>
          </section>
        )}

        {/* Logs */}
        <section className="us-detail-section us-detail-section--fill">
          <RunLogsCard
            logs={run.logs}
            status={run.status}
          />
        </section>
      </div>

      {/* History Drawer — slides in from right */}
      {/* Confirmation modals */}
      {confirmAction === "approve" && (
        <ConfirmModal
          title="Approve & Create PR"
          message={`This will create a pull request for ${run.issueKey}${run.repoPath ? ` in ${run.repoPath.split("/").pop()}` : ""}.`}
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

      {editorInfo && (
        <div className="us-modal-overlay" onClick={() => setEditorInfo(null)}>
          <div className="us-modal" onClick={(e) => e.stopPropagation()}>
            <div className="us-modal__header">
              <h3 className="us-modal__title">Open Locally</h3>
              <button className="us-modal__close" onClick={() => setEditorInfo(null)} aria-label="Close">
                <TimesIcon />
              </button>
            </div>
            <div className="us-modal__body">
              <label className="us-modal__label">Local path</label>
              <div className="us-modal__copyable">
                <code className="us-modal__code">{editorInfo.localDir}</code>
                <button
                  className="us-modal__copy-btn"
                  onClick={() => handleCopy(editorInfo.localDir, "path")}
                  aria-label="Copy path"
                >
                  {copied === "path" ? <CheckIcon /> : <CopyIcon />}
                </button>
              </div>
              {editorInfo.gitCommand && (
                <>
                  <label className="us-modal__label">Checkout branch</label>
                  <div className="us-modal__copyable">
                    <code className="us-modal__code">{editorInfo.gitCommand}</code>
                    <button
                      className="us-modal__copy-btn"
                      onClick={() => handleCopy(editorInfo.gitCommand!, "git")}
                      aria-label="Copy git command"
                    >
                      {copied === "git" ? <CheckIcon /> : <CopyIcon />}
                    </button>
                  </div>
                </>
              )}
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
