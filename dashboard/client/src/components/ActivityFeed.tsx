import { useState, useMemo, useRef, useEffect, useReducer } from "react";
import { PHASE_LABELS, formatDuration, isCompleted, isTerminal, relativeTime } from "../types";
import type { Run, RunPhase, LogEntry, PrdEntry, Comment } from "../types";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type ActorKind = "system" | "coder" | "user";

interface ActivityEntry {
  id: string;
  type: "phase_change" | "log" | "prd_update" | "approval" | "pr_created" | "comment";
  actor: ActorKind;
  timestamp: string;            // ISO 8601
  content: string;
  metadata?: {
    phase?: RunPhase;
    duration?: string;
    logs?: LogEntry[];
    prUrl?: string;
    prdEntry?: PrdEntry;
    variant?: "success" | "danger" | "warning" | "info";
  };
}

/* ------------------------------------------------------------------ */
/*  Build the unified timeline                                         */
/* ------------------------------------------------------------------ */

const PHASE_ORDER: RunPhase[] = [
  "phase0", "phase1", "phase2", "awaiting_approval", "phase3", "success",
];

export function buildActivityFeed(run: Run, comments?: Comment[]): ActivityEntry[] {
  const entries: ActivityEntry[] = [];
  const ts = run.phaseTimestamps ?? {};

  // 1. Phase transitions
  for (let i = 0; i < PHASE_ORDER.length; i++) {
    const phase = PHASE_ORDER[i];
    const timestamp = ts[phase];
    if (!timestamp) continue;

    const label = PHASE_LABELS[phase] ?? phase;
    const nextPhase = PHASE_ORDER[i + 1];
    const nextTs = nextPhase ? ts[nextPhase] : undefined;
    let duration: string | undefined;
    if (nextTs) {
      duration = formatDuration(Date.parse(nextTs) - Date.parse(timestamp));
    } else if (run.completedAt && phase !== "success") {
      duration = formatDuration(Date.parse(run.completedAt) - Date.parse(timestamp));
    }

    let variant: NonNullable<ActivityEntry["metadata"]>["variant"] = "info";
    if (phase === "success") variant = "success";
    else if (phase === "awaiting_approval") variant = "warning";

    entries.push({
      id: `phase-${phase}`,
      type: "phase_change",
      actor: "system",
      timestamp,
      content: `Moved to ${label}`,
      metadata: { phase, duration, variant },
    });
  }

  // 2. Log entries — batched per phase into collapsible blocks
  if (run.logs.length > 0) {
    let currentPhase: RunPhase | null = null;
    let batch: LogEntry[] = [];
    const flushBatch = () => {
      if (batch.length === 0) return;
      const phase = batch[0].phase;
      const phaseLabel = PHASE_LABELS[phase] ?? phase;
      // Timestamp: use phaseTimestamp if available, otherwise startedAt
      const batchTs = ts[phase] ?? run.startedAt;
      entries.push({
        id: `logs-${phase}`,
        type: "log",
        actor: "coder",
        timestamp: batchTs,
        content: `${phaseLabel} output (${batch.length} line${batch.length !== 1 ? "s" : ""})`,
        metadata: { phase, logs: [...batch] },
      });
    };

    for (const log of run.logs) {
      if (log.phase !== currentPhase) {
        flushBatch();
        batch = [];
        currentPhase = log.phase;
      }
      batch.push(log);
    }
    flushBatch();
  }

  // 3. PRD completions
  for (const entry of run.prd) {
    if (entry.completed) {
      entries.push({
        id: `prd-${entry.id}`,
        type: "prd_update",
        actor: "coder",
        timestamp: run.completedAt ?? run.startedAt,
        content: entry.description,
        metadata: { prdEntry: entry, variant: "success" },
      });
    }
  }

  // 4. Terminal status events (failed / stopped / rejected)
  if (run.status === "failed" && run.completedAt) {
    entries.push({
      id: "status-failed",
      type: "phase_change",
      actor: "system",
      timestamp: run.completedAt,
      content: "Run failed",
      metadata: { variant: "danger" },
    });
  }
  if (run.status === "stopped" && run.completedAt) {
    entries.push({
      id: "status-stopped",
      type: "phase_change",
      actor: "system",
      timestamp: run.completedAt,
      content: "Run stopped by user",
      metadata: { variant: "warning" },
    });
  }
  if (run.status === "rejected" && run.completedAt) {
    entries.push({
      id: "status-rejected",
      type: "approval",
      actor: "user",
      timestamp: run.completedAt,
      content: "Changes rejected",
      metadata: { variant: "danger" },
    });
  }

  // 5. PR creation
  if (run.prUrl) {
    entries.push({
      id: "pr-created",
      type: "pr_created",
      actor: "coder",
      timestamp: run.completedAt ?? run.startedAt,
      content: "Pull request created",
      metadata: { prUrl: run.prUrl, variant: "success" },
    });
  }

  // 6. Comments
  if (comments) {
    for (const comment of comments) {
      entries.push({
        id: `comment-${comment.id}`,
        type: "comment",
        actor: "user",
        timestamp: comment.createdAt,
        content: comment.content,
      });
    }
  }

  // Sort chronologically, then by type priority for same timestamp
  const typePriority: Record<ActivityEntry["type"], number> = {
    phase_change: 0,
    log: 1,
    prd_update: 2,
    comment: 3,
    approval: 4,
    pr_created: 5,
  };

  entries.sort((a, b) => {
    const timeDiff = Date.parse(a.timestamp) - Date.parse(b.timestamp);
    if (timeDiff !== 0) return timeDiff;
    return (typePriority[a.type] ?? 0) - (typePriority[b.type] ?? 0);
  });

  return entries;
}

/* ------------------------------------------------------------------ */
/*  Rendering helpers                                                  */
/* ------------------------------------------------------------------ */

function ActorAvatar({ actor }: { actor: ActorKind }) {
  if (actor === "coder") {
    return (
      <div className="us-activity__avatar us-activity__avatar--coder" aria-label="Coder">
        {/* Gear/bot icon */}
        <svg viewBox="0 0 16 16" fill="currentColor" width="14" height="14">
          <path d="M8 0a1 1 0 011 1v1.07A5.98 5.98 0 0112.93 5H14a1 1 0 110 2h-1.07A5.98 5.98 0 019 10.93V12a1 1 0 11-2 0v-1.07A5.98 5.98 0 013.07 7H2a1 1 0 010-2h1.07A5.98 5.98 0 017 2.07V1a1 1 0 011-1zM8 4a4 4 0 100 8 4 4 0 000-8zm0 2a2 2 0 110 4 2 2 0 010-4z" />
        </svg>
      </div>
    );
  }
  if (actor === "user") {
    return (
      <div className="us-activity__avatar us-activity__avatar--user" aria-label="User">
        <svg viewBox="0 0 16 16" fill="currentColor" width="14" height="14">
          <path d="M8 0a4 4 0 110 8A4 4 0 018 0zm0 10c4.42 0 8 1.79 8 4v2H0v-2c0-2.21 3.58-4 8-4z" />
        </svg>
      </div>
    );
  }
  // system
  return (
    <div className="us-activity__avatar us-activity__avatar--system" aria-label="System">
      <svg viewBox="0 0 16 16" fill="currentColor" width="14" height="14">
        <path d="M8 1.5a6.5 6.5 0 100 13 6.5 6.5 0 000-13zM0 8a8 8 0 1116 0A8 8 0 010 8zm9-3a1 1 0 11-2 0 1 1 0 012 0zM7 7.5a1 1 0 012 0v4a1 1 0 01-2 0v-4z" />
      </svg>
    </div>
  );
}

function actorLabel(actor: ActorKind): string {
  if (actor === "coder") return "Coder";
  if (actor === "user") return "User";
  return "System";
}


function VariantDot({ variant }: { variant?: string }) {
  if (!variant) return null;
  return <span className={`us-activity__dot us-activity__dot--${variant}`} />;
}

/* ------------------------------------------------------------------ */
/*  Log block — collapsible                                            */
/* ------------------------------------------------------------------ */

function LogBlock({ logs, label }: { logs: LogEntry[]; label: string }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="us-activity__log-block">
      <button
        className="us-activity__log-toggle"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        <svg
          className={`us-activity__log-chevron${expanded ? " us-activity__log-chevron--open" : ""}`}
          viewBox="0 0 16 16"
          fill="currentColor"
          width="12"
          height="12"
        >
          <path d="M6.22 3.22a.75.75 0 011.06 0l4.25 4.25a.75.75 0 010 1.06l-4.25 4.25a.75.75 0 01-1.06-1.06L9.94 8 6.22 4.28a.75.75 0 010-1.06z" />
        </svg>
        <span className="us-activity__log-label">{label}</span>
      </button>
      {expanded && (
        <pre className="us-activity__log-body">
          {logs.map((l) => l.line).join("\n")}
        </pre>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main component                                                     */
/* ------------------------------------------------------------------ */

interface ActivityFeedProps {
  run: Run;
  modelName?: string;
  comments?: Comment[];
  onAddComment?: (content: string) => void;
  progressText?: string;
}

export function ActivityFeed({ run, modelName, comments, onAddComment, progressText }: ActivityFeedProps) {
  const entries = useMemo(() => buildActivityFeed(run, comments), [run, comments]);
  const runIsActive = !isCompleted(run.status) && !isTerminal(run.status);

  // Force re-render every 60s so relative timestamps ("just now", "5m ago") stay current
  const [, tick] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    const id = setInterval(tick, 60_000);
    return () => clearInterval(id);
  }, []);

  if (entries.length === 0) {
    return (
      <div className="us-activity us-activity--empty">
        <span className="us-activity__empty-text">Waiting for activity...</span>
      </div>
    );
  }

  return (
    <div className="us-activity">
      <h3 className="us-activity__title">Activity</h3>
      <div className="us-activity__timeline">
        {entries.map((entry) => (
          <div key={entry.id} className={`us-activity__entry us-activity__entry--${entry.type}`}>
            <div className="us-activity__gutter">
              <ActorAvatar actor={entry.actor} />
              <div className="us-activity__line" />
            </div>
            <div className="us-activity__body">
              <div className="us-activity__header">
                <span className="us-activity__actor">
                  {actorLabel(entry.actor)}
                  {entry.actor === "coder" && modelName && (
                    <span className="us-activity__model-badge">{modelName}</span>
                  )}
                </span>
                <span className="us-activity__time" title={new Date(entry.timestamp).toLocaleString()}>
                  {relativeTime(entry.timestamp)}
                </span>
              </div>
              <div className="us-activity__content">
                {entry.type === "phase_change" && (
                  <div className="us-activity__phase-change">
                    <VariantDot variant={entry.metadata?.variant} />
                    <span>{entry.content}</span>
                    {entry.metadata?.duration && (
                      <span className="us-activity__duration">{entry.metadata.duration}</span>
                    )}
                  </div>
                )}

                {entry.type === "log" && entry.metadata?.logs && (
                  <LogBlock logs={entry.metadata.logs} label={entry.content} />
                )}

                {entry.type === "prd_update" && (
                  <div className="us-activity__prd">
                    <svg viewBox="0 0 16 16" fill="currentColor" width="14" height="14" className="us-activity__prd-check">
                      <path d="M13.78 4.22a.75.75 0 010 1.06l-7.25 7.25a.75.75 0 01-1.06 0L2.22 9.28a.75.75 0 011.06-1.06L6 10.94l6.72-6.72a.75.75 0 011.06 0z" />
                    </svg>
                    <span>Completed: {entry.content}</span>
                  </div>
                )}

                {entry.type === "approval" && (
                  <div className="us-activity__phase-change">
                    <VariantDot variant={entry.metadata?.variant} />
                    <span>{entry.content}</span>
                  </div>
                )}

                {entry.type === "pr_created" && entry.metadata?.prUrl && (
                  <div className="us-activity__pr">
                    <svg viewBox="0 0 16 16" fill="currentColor" width="14" height="14" className="us-activity__pr-icon">
                      <path d="M7.177 3.073L9.573.677A.25.25 0 0110 .854v4.792a.25.25 0 01-.427.177L7.177 3.427a.25.25 0 010-.354zM3.75 2.5a.75.75 0 100 1.5.75.75 0 000-1.5zm-2.25.75a2.25 2.25 0 113 2.122v5.256a2.251 2.251 0 11-1.5 0V5.372A2.25 2.25 0 011.5 3.25zM11 2.5h-1V4h1a1 1 0 011 1v5.628a2.251 2.251 0 101.5 0V5A2.5 2.5 0 0011 2.5zm1 10.25a.75.75 0 111.5 0 .75.75 0 01-1.5 0zM3.75 12a.75.75 0 100 1.5.75.75 0 000-1.5z" />
                    </svg>
                    <a href={entry.metadata.prUrl} target="_blank" rel="noreferrer" className="us-activity__pr-link">
                      {entry.metadata.prUrl.replace(/^https?:\/\/[^/]+\//, "")}
                    </a>
                  </div>
                )}

                {entry.type === "comment" && (
                  <div className="us-activity__comment-text">{entry.content}</div>
                )}
              </div>
            </div>
          </div>
        ))}

        {/* Live progress indicator for active runs */}
        {runIsActive && (
          <div className="us-activity__entry us-activity__entry--progress">
            <div className="us-activity__gutter">
              <div className="us-activity__avatar us-activity__avatar--coder us-activity__avatar--pulse" aria-label="Coder working">
                <svg viewBox="0 0 16 16" fill="currentColor" width="14" height="14">
                  <path d="M8 0a1 1 0 011 1v1.07A5.98 5.98 0 0112.93 5H14a1 1 0 110 2h-1.07A5.98 5.98 0 019 10.93V12a1 1 0 11-2 0v-1.07A5.98 5.98 0 013.07 7H2a1 1 0 010-2h1.07A5.98 5.98 0 017 2.07V1a1 1 0 011-1zM8 4a4 4 0 100 8 4 4 0 000-8zm0 2a2 2 0 110 4 2 2 0 010-4z" />
                </svg>
              </div>
              <div className="us-activity__line" />
            </div>
            <div className="us-activity__body">
              <div className="us-activity__header">
                <span className="us-activity__actor">
                  Coder
                  {modelName && <span className="us-activity__model-badge">{modelName}</span>}
                  <span className="us-activity__typing-indicator">
                    <span className="us-activity__typing-dot" />
                    <span className="us-activity__typing-dot" />
                    <span className="us-activity__typing-dot" />
                  </span>
                </span>
                <span className="us-activity__time">working...</span>
              </div>
              {progressText && (
                <div className="us-activity__content">
                  <div className="us-activity__progress-text">{progressText}</div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
      {onAddComment && <CommentInput onSubmit={onAddComment} />}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Comment input                                                      */
/* ------------------------------------------------------------------ */

function CommentInput({ onSubmit }: { onSubmit: (content: string) => void }) {
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const handleSubmit = () => {
    const trimmed = value.trim();
    if (!trimmed) return;
    onSubmit(trimmed);
    setValue("");
  };

  return (
    <div className="us-activity__comment-box">
      <input
        ref={inputRef}
        type="text"
        className="us-activity__comment-input"
        placeholder="Add a comment..."
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            handleSubmit();
          }
        }}
      />
      <button
        className="us-activity__comment-send"
        onClick={handleSubmit}
        disabled={value.trim().length === 0}
        aria-label="Send comment"
      >
        <svg viewBox="0 0 16 16" fill="currentColor" width="14" height="14">
          <path d="M1.724 1.053a.5.5 0 00-.714.545L2.535 8l-1.525 6.402a.5.5 0 00.714.545l13-6a.5.5 0 000-.894l-13-6zM3.845 7.25L2.672 2.327 13.405 8 2.672 13.673 3.845 8.75H7.5a.75.75 0 000-1.5H3.845z" />
        </svg>
      </button>
    </div>
  );
}
