import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { SearchIcon } from "@patternfly/react-icons";
import type { ProjectSummary } from "../../../shared/types";
import { STATUS_COLORS, PHASE_LABELS, relativeTime } from "../types";

export function ProjectsPage() {
  const navigate = useNavigate();
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");

  useEffect(() => {
    fetch("/api/projects")
      .then((r) => r.json() as Promise<ProjectSummary[]>)
      .then((data) => {
        setProjects(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    if (!query.trim()) return projects;
    const q = query.toLowerCase();
    return projects.filter(
      (p) =>
        p.issueKey.toLowerCase().includes(q) ||
        (p.summary && p.summary.toLowerCase().includes(q))
    );
  }, [projects, query]);

  return (
    <div className="us-dashboard">
      <div className="us-dashboard__toolbar">
        <h2 className="us-dashboard__title">Projects</h2>
      </div>

      {projects.length > 0 && (
        <div className="us-dashboard__section">
          <div className="us-projects-filter">
            <SearchIcon className="us-projects-filter__icon" />
            <input
              className="us-projects-filter__input"
              type="text"
              placeholder="Filter by issue key or summary..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {query && (
              <span className="us-projects-filter__count">
                {filtered.length} of {projects.length}
              </span>
            )}
          </div>
        </div>
      )}

      <div className="us-dashboard__content">
        {loading ? (
          <div className="us-table-wrapper">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="us-skeleton-row us-stagger-enter" style={{ animationDelay: `${i * 40}ms` }}>
                <div className="us-skeleton" style={{ width: 10, height: 10, borderRadius: "50%" }} />
                <div className="us-skeleton" style={{ width: 80, height: 14 }} />
                <div className="us-skeleton" style={{ flex: 1, height: 14, maxWidth: 300 }} />
                <div className="us-skeleton" style={{ width: 40, height: 14 }} />
                <div className="us-skeleton" style={{ width: 50, height: 14 }} />
              </div>
            ))}
          </div>
        ) : projects.length === 0 ? (
          <div className="us-empty-state us-fade-in">
            <div className="us-empty-state__icon">
              <SearchIcon />
            </div>
            <h3 className="us-empty-state__title">No tickets found</h3>
            <p className="us-empty-state__body">
              Start a run to see tickets here.
            </p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="us-empty-state us-fade-in">
            <div className="us-empty-state__icon us-empty-state__icon--warning">
              <SearchIcon />
            </div>
            <h3 className="us-empty-state__title">No matching tickets</h3>
            <p className="us-empty-state__body">
              No tickets match your search. Try a different query.
            </p>
          </div>
        ) : (
          <div className="us-fade-in">
            <div className="us-table-wrapper">
              <table className="us-table" aria-label="Projects table">
                <thead>
                  <tr>
                    <th className="us-table__th">Issue</th>
                    <th className="us-table__th">Summary</th>
                    <th className="us-table__th">Status</th>
                    <th className="us-table__th">Runs</th>
                    <th className="us-table__th">Last Activity</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((project) => {
                    const statusColor = STATUS_COLORS[project.latestStatus] ?? STATUS_COLORS.pending;
                    return (
                      <tr
                        key={project.issueKey}
                        className="us-table__row"
                        style={{ "--row-status-color": statusColor } as React.CSSProperties}
                        onClick={() => navigate(`/projects/${project.issueKey}`)}
                        tabIndex={0}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            navigate(`/projects/${project.issueKey}`);
                          }
                        }}
                      >
                        <td className="us-table__td us-table__td--issue">
                          {project.issueKey}
                        </td>
                        <td className="us-table__td us-table__td--summary">
                          {project.summary || "—"}
                        </td>
                        <td className="us-table__td">
                          <span className="us-table-status">
                            <span className="us-table-status__dot" style={{ backgroundColor: statusColor }} />
                            <span className="us-table-status__label">
                              {PHASE_LABELS[project.latestStatus] ?? project.latestStatus}
                            </span>
                          </span>
                        </td>
                        <td className="us-table__td">
                          <span className="us-projects-run-count">{project.runCount}</span>
                        </td>
                        <td className="us-table__td us-table__td--muted">
                          {relativeTime(project.lastRunAt)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
