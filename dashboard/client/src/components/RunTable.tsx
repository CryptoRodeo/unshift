import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Tooltip } from "@patternfly/react-core";
import { useElapsedTime } from "../hooks/useElapsedTime";
import type { Run, RunPhase } from "../types";
import { PHASE_LABELS, STATUS_COLORS } from "../types";
import { getRepoName } from "../hooks/useRunFilters";

interface RunTableProps {
  runs: Run[];
}

type SortableField = "issueKey" | "status" | "startedAt" | "duration";
type SortDir = "asc" | "desc";

const COLUMNS: { title: string; field: SortableField; sortable: boolean }[] = [
  { title: "Issue", field: "issueKey", sortable: true },
  { title: "Summary", field: "issueKey", sortable: false },
  { title: "Status", field: "status", sortable: true },
  { title: "Repo", field: "issueKey", sortable: false },
  { title: "Duration", field: "duration", sortable: true },
  { title: "Phase", field: "status", sortable: false },
];

const PHASE_ORDER: RunPhase[] = ["phase0", "phase1", "phase2", "awaiting_approval", "phase3"];

function getDuration(run: Run): number {
  const end = run.completedAt ? Date.parse(run.completedAt) : Date.now();
  return end - Date.parse(run.startedAt);
}

function MiniProgressBar({ status }: { status: RunPhase }) {
  const currentIdx = PHASE_ORDER.indexOf(status);
  const isSuccess = status === "success";
  const isFailed = status === "failed" || status === "stopped" || status === "rejected";

  return (
    <div className="us-table-progress">
      {PHASE_ORDER.map((phase, idx) => {
        let cls = "us-table-progress__seg";
        if (isSuccess || idx < currentIdx) {
          cls += " us-table-progress__seg--done";
        } else if (isFailed && idx <= Math.max(currentIdx, 0)) {
          cls += " us-table-progress__seg--failed";
        } else if (idx === currentIdx && !isSuccess && !isFailed) {
          cls += " us-table-progress__seg--active";
        }
        return (
          <Tooltip key={phase} content={PHASE_LABELS[phase] ?? phase}>
            <div className={cls} />
          </Tooltip>
        );
      })}
    </div>
  );
}

function StatusDot({ status }: { status: string }) {
  const color = STATUS_COLORS[status] ?? STATUS_COLORS.pending;
  return (
    <span className="us-table-status">
      <span className="us-table-status__dot" style={{ backgroundColor: color }} />
      <span className="us-table-status__label">{PHASE_LABELS[status] ?? status}</span>
    </span>
  );
}

export function RunTable({ runs }: RunTableProps) {
  const navigate = useNavigate();
  const [sortField, setSortField] = useState<SortableField>("startedAt");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const sorted = useMemo(() => {
    const dir = sortDir === "asc" ? 1 : -1;
    return [...runs].sort((a, b) => {
      switch (sortField) {
        case "issueKey":
          return dir * (a.issueKey ?? "").localeCompare(b.issueKey ?? "");
        case "status":
          return dir * a.status.localeCompare(b.status);
        case "startedAt":
          return dir * (Date.parse(a.startedAt) - Date.parse(b.startedAt));
        case "duration":
          return dir * (getDuration(a) - getDuration(b));
        default:
          return 0;
      }
    });
  }, [runs, sortField, sortDir]);

  const handleSort = (field: SortableField) => {
    if (sortField === field) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDir("asc");
    }
  };

  return (
    <div className="us-table-wrapper">
      <table className="us-table" aria-label="Runs table">
        <thead>
          <tr>
            {COLUMNS.map((col) => (
              <th
                key={col.title}
                className={`us-table__th${col.sortable ? " us-table__th--sortable" : ""}`}
                onClick={col.sortable ? () => handleSort(col.field) : undefined}
                aria-sort={
                  col.sortable && sortField === col.field
                    ? sortDir === "asc" ? "ascending" : "descending"
                    : undefined
                }
              >
                <span className="us-table__th-content">
                  {col.title}
                  {col.sortable && sortField === col.field && (
                    <span className="us-table__sort-arrow">
                      {sortDir === "asc" ? "↑" : "↓"}
                    </span>
                  )}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((run) => (
            <RunRow key={run.id} run={run} onClick={() => navigate(`/runs/${run.id}`)} statusColor={STATUS_COLORS[run.status] ?? STATUS_COLORS.pending} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RunRow({ run, onClick, statusColor }: { run: Run; onClick: () => void; statusColor: string }) {
  const elapsed = useElapsedTime(run.startedAt, run.completedAt);
  const repo = getRepoName(run);

  return (
    <tr
      className={`us-table__row${run.status === "awaiting_approval" ? " us-table__row--awaiting" : ""}`}
      style={{ "--row-status-color": statusColor } as React.CSSProperties}
      onClick={onClick}
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); } }}
    >
      <td className="us-table__td us-table__td--issue">
        {run.issueKey || run.id.slice(0, 8)}
      </td>
      <td className="us-table__td us-table__td--summary">
        {run.context?.summary || "—"}
      </td>
      <td className="us-table__td">
        <StatusDot status={run.status} />
      </td>
      <td className="us-table__td us-table__td--muted">{repo ?? "—"}</td>
      <td className="us-table__td us-table__td--muted">{elapsed}</td>
      <td className="us-table__td">
        <MiniProgressBar status={run.status} />
      </td>
    </tr>
  );
}
