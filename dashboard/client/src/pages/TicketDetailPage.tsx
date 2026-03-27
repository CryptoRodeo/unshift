import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  ArrowLeftIcon,
  ExternalLinkAltIcon,
  PlusIcon,
} from "@patternfly/react-icons";
import type { JiraIssueDetail, JiraComment, Run } from "../../../shared/types";
import { useWebSocket } from "../hooks/useWebSocket";
import { StatusLabel } from "../components/StatusLabel";
import { STATUS_COLORS, formatDuration, isRunError, relativeTime } from "../types";

export function TicketDetailPage() {
  const { issueKey } = useParams<{ issueKey: string }>();
  const navigate = useNavigate();
  const { startRunForIssue } = useWebSocket();
  const [startingRun, setStartingRun] = useState(false);

  const handleStartRun = async () => {
    if (!issueKey || startingRun) return;
    setStartingRun(true);
    try {
      const result = await startRunForIssue(issueKey, true);
      if (isRunError(result)) {
        setStartingRun(false);
      } else if (result.id) {
        navigate(`/runs/${result.id}`);
      }
    } catch {
      setStartingRun(false);
    }
  };

  const [issue, setIssue] = useState<JiraIssueDetail | null>(null);
  const [issueLoading, setIssueLoading] = useState(true);
  const [issueError, setIssueError] = useState<string | null>(null);

  const [comments, setComments] = useState<JiraComment[]>([]);
  const [commentsLoading, setCommentsLoading] = useState(true);

  const [runs, setRuns] = useState<Run[]>([]);
  const [runsLoading, setRunsLoading] = useState(true);

  // Fetch Jira issue details
  useEffect(() => {
    if (!issueKey) return;
    setIssueLoading(true);
    setIssueError(null);
    fetch(`/api/jira/issue/${encodeURIComponent(issueKey)}`)
      .then((r) => {
        if (!r.ok) throw new Error("Failed to fetch issue");
        return r.json() as Promise<JiraIssueDetail>;
      })
      .then((data) => {
        setIssue(data);
        setIssueLoading(false);
      })
      .catch((err) => {
        setIssueError(err.message);
        setIssueLoading(false);
      });
  }, [issueKey]);

  // Fetch Jira comments
  useEffect(() => {
    if (!issueKey) return;
    setCommentsLoading(true);
    fetch(`/api/jira/issue/${encodeURIComponent(issueKey)}/comments`)
      .then((r) => (r.ok ? (r.json() as Promise<{ comments: JiraComment[] }>) : { comments: [] }))
      .then((data) => {
        setComments(data.comments);
        setCommentsLoading(false);
      })
      .catch(() => setCommentsLoading(false));
  }, [issueKey]);

  // Fetch run history for this ticket
  useEffect(() => {
    if (!issueKey) return;
    setRunsLoading(true);
    fetch(`/api/history/${encodeURIComponent(issueKey)}`)
      .then((r) => (r.ok ? (r.json() as Promise<Run[]>) : []))
      .then((data) => {
        setRuns(data);
        setRunsLoading(false);
      })
      .catch(() => setRunsLoading(false));
  }, [issueKey]);

  if (issueLoading) {
    return (
      <div className="us-skeleton-detail us-fade-in">
        <div className="us-skeleton-detail__subheader">
          <div className="us-skeleton us-skeleton-detail__back" />
          <div className="us-skeleton us-skeleton-detail__title" />
          <div className="us-skeleton us-skeleton-detail__status" />
        </div>
        <div className="us-skeleton-detail__content">
          <div className="us-skeleton-detail__card">
            <div className="us-skeleton us-skeleton-detail__card-title" />
            <div className="us-skeleton us-skeleton-detail__card-line" />
            <div className="us-skeleton us-skeleton-detail__card-line us-skeleton-detail__card-line--short" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="us-detail us-fade-in">
      {/* Sticky sub-header */}
      <div className="us-detail-subheader">
        <div className="us-detail-subheader__left">
          <button className="us-detail-subheader__back" onClick={() => navigate("/projects")} aria-label="Back to projects">
            <ArrowLeftIcon />
          </button>
          <h1 className="us-detail-subheader__title">
            {issue?.jiraUrl ? (
              <a href={issue.jiraUrl} target="_blank" rel="noreferrer" className="us-detail-subheader__title-link">
                {issueKey}
              </a>
            ) : (
              issueKey
            )}
          </h1>
          {issue && (
            <span className="us-ticket-jira-status">{issue.status}</span>
          )}
        </div>
        <div className="us-detail-subheader__actions">
          <button
            className="us-btn us-btn--primary"
            onClick={handleStartRun}
            disabled={startingRun}
          >
            <PlusIcon /> {startingRun ? "Starting..." : "Start New Run"}
          </button>
          {issue?.jiraUrl && (
            <a href={issue.jiraUrl} target="_blank" rel="noreferrer" className="us-btn us-btn--ghost">
              <ExternalLinkAltIcon /> Open in Jira
            </a>
          )}
        </div>
      </div>

      {issueError && !issue && (
        <div className="us-ticket-error">
          Could not load Jira issue details. Showing run data only.
        </div>
      )}

      {/* Two-panel layout */}
      <div className="us-detail-panels">
        {/* Center content area */}
        <div className="us-detail-main">
          {/* Issue summary & description */}
          {issue && (
            <section className="us-detail-section us-detail-description">
              <h2 className="us-detail-description__summary">{issue.summary}</h2>
              {issue.description && (
                <p className="us-detail-description__body">{issue.description}</p>
              )}
            </section>
          )}

          {/* Jira Comments */}
          <section className="us-detail-section">
            <h3 className="us-ticket-section-title">Comments</h3>
            {commentsLoading ? (
              <div className="us-ticket-comments-loading">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="us-skeleton-row us-stagger-enter" style={{ animationDelay: `${i * 40}ms` }}>
                    <div className="us-skeleton" style={{ width: 28, height: 28, borderRadius: "50%" }} />
                    <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
                      <div className="us-skeleton" style={{ width: 120, height: 12 }} />
                      <div className="us-skeleton" style={{ width: "80%", height: 14 }} />
                    </div>
                  </div>
                ))}
              </div>
            ) : comments.length === 0 ? (
              <p className="us-ticket-empty-text">No comments on this ticket.</p>
            ) : (
              <div className="us-ticket-comments">
                {comments.map((comment) => (
                  <div key={comment.id} className="us-ticket-comment">
                    <div className="us-ticket-comment__avatar">
                      {comment.avatarUrl ? (
                        <img src={comment.avatarUrl} alt="" className="us-ticket-comment__avatar-img" />
                      ) : (
                        <div className="us-ticket-comment__avatar-placeholder">
                          {comment.author.charAt(0).toUpperCase()}
                        </div>
                      )}
                    </div>
                    <div className="us-ticket-comment__content">
                      <div className="us-ticket-comment__header">
                        <span className="us-ticket-comment__author">{comment.author}</span>
                        <span className="us-ticket-comment__time">{relativeTime(comment.created)}</span>
                      </div>
                      <div className="us-ticket-comment__body">{comment.body}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Runs for this ticket */}
          <section className="us-detail-section">
            <h3 className="us-ticket-section-title">Runs</h3>
            {runsLoading ? (
              <div className="us-ticket-runs-loading">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="us-skeleton-row us-stagger-enter" style={{ animationDelay: `${i * 40}ms` }}>
                    <div className="us-skeleton" style={{ width: 10, height: 10, borderRadius: "50%" }} />
                    <div className="us-skeleton" style={{ width: 70, height: 14 }} />
                    <div className="us-skeleton" style={{ width: 80, height: 14 }} />
                    <div className="us-skeleton" style={{ width: 60, height: 14 }} />
                  </div>
                ))}
              </div>
            ) : runs.length === 0 ? (
              <p className="us-ticket-empty-text">No runs for this ticket yet.</p>
            ) : (
              <div className="us-ticket-runs">
                {runs.map((run) => {
                  const statusColor = STATUS_COLORS[run.status] ?? STATUS_COLORS.pending;
                  const duration = run.completedAt
                    ? formatDuration(new Date(run.completedAt).getTime() - new Date(run.startedAt).getTime())
                    : formatDuration(Date.now() - new Date(run.startedAt).getTime());
                  return (
                    <div
                      key={run.id}
                      className="us-ticket-run-row"
                      onClick={() => navigate(`/runs/${run.id}`)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          navigate(`/runs/${run.id}`);
                        }
                      }}
                    >
                      <span className="us-ticket-run-row__dot" style={{ backgroundColor: statusColor }} />
                      <code className="us-ticket-run-row__id">{run.id.slice(0, 8)}</code>
                      <StatusLabel status={run.status} />
                      <span className="us-ticket-run-row__time">{new Date(run.startedAt).toLocaleString()}</span>
                      <span className="us-ticket-run-row__duration">{duration}</span>
                      {run.prUrl && (
                        <a
                          href={run.prUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="us-ticket-run-row__pr"
                          onClick={(e) => e.stopPropagation()}
                        >
                          PR
                        </a>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>

        {/* Right metadata sidebar */}
        <aside className="us-detail-sidebar">
          {/* DETAILS */}
          {issue && (
            <div className="us-detail-sidebar__group">
              <h3 className="us-detail-sidebar__group-header">Details</h3>
              <div className="us-detail-sidebar__section">
                <span className="us-detail-sidebar__label">Status</span>
                <span className="us-detail-sidebar__value">{issue.status}</span>
              </div>
              {issue.issueType && (
                <div className="us-detail-sidebar__section">
                  <span className="us-detail-sidebar__label">Type</span>
                  <span className="us-detail-sidebar__value us-detail-sidebar__issue-type">{issue.issueType}</span>
                </div>
              )}
              {issue.priority && (
                <div className="us-detail-sidebar__section">
                  <span className="us-detail-sidebar__label">Priority</span>
                  <span className={`us-detail-sidebar__value us-detail-sidebar__priority us-detail-sidebar__priority--${issue.priority.toLowerCase()}`}>
                    {issue.priority}
                  </span>
                </div>
              )}
              {issue.assignee && (
                <div className="us-detail-sidebar__section">
                  <span className="us-detail-sidebar__label">Assignee</span>
                  <span className="us-detail-sidebar__value">{issue.assignee}</span>
                </div>
              )}
              {issue.labels.length > 0 && (
                <div className="us-detail-sidebar__section us-detail-sidebar__section--vertical">
                  <span className="us-detail-sidebar__label">Labels</span>
                  <span className="us-detail-sidebar__value us-detail-sidebar__labels">
                    {issue.labels.map((label) => (
                      <span key={label} className="us-detail-sidebar__label-tag">{label}</span>
                    ))}
                  </span>
                </div>
              )}
            </div>
          )}

          {/* ACTIVITY */}
          <div className="us-detail-sidebar__group">
            <h3 className="us-detail-sidebar__group-header">Activity</h3>
            {issue && (
              <>
                <div className="us-detail-sidebar__section">
                  <span className="us-detail-sidebar__label">Created</span>
                  <span className="us-detail-sidebar__value">{new Date(issue.created).toLocaleDateString()}</span>
                </div>
                <div className="us-detail-sidebar__section">
                  <span className="us-detail-sidebar__label">Updated</span>
                  <span className="us-detail-sidebar__value">{relativeTime(issue.updated)}</span>
                </div>
              </>
            )}
            <div className="us-detail-sidebar__section">
              <span className="us-detail-sidebar__label">Run count</span>
              <span className="us-detail-sidebar__value">{runsLoading ? "..." : runs.length}</span>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
