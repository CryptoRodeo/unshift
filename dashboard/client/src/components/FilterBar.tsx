import { useState, useEffect, useMemo, useRef } from "react";
import { Tooltip } from "@patternfly/react-core";
import { FilterIcon } from "@patternfly/react-icons";
import type { Run } from "../types";
import type { StatusFilter } from "../hooks/useRunFilters";
import { getRepoName } from "../hooks/useRunFilters";

interface FilterBarProps {
  query: string;
  statuses: Set<StatusFilter>;
  repo: string | null;
  hasFilters: boolean;
  setQuery: (q: string) => void;
  toggleStatus: (s: StatusFilter) => void;
  setRepo: (r: string | null) => void;
  clearAll: () => void;
  runs: Run[];
  totalCount: number;
  filteredCount: number;
}

const STATUS_PILLS: { key: StatusFilter; label: string; color: string }[] = [
  { key: "active", label: "Active", color: "#0066cc" },
  { key: "awaiting_approval", label: "Awaiting Approval", color: "#f0ab00" },
  { key: "succeeded", label: "Succeeded", color: "#3e8635" },
  { key: "failed", label: "Failed", color: "#c9190b" },
];

export function FilterBar({
  query,
  statuses,
  repo,
  hasFilters,
  setQuery,
  toggleStatus,
  setRepo,
  clearAll,
  runs,
  totalCount,
  filteredCount,
}: FilterBarProps) {
  const [localQuery, setLocalQuery] = useState(query);
  const [repoOpen, setRepoOpen] = useState(false);
  const repoRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setLocalQuery(query);
  }, [query]);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (localQuery !== query) setQuery(localQuery);
    }, 300);
    return () => clearTimeout(timer);
  }, [localQuery, query, setQuery]);

  // Close repo popover on outside click
  useEffect(() => {
    if (!repoOpen) return;
    const handler = (e: MouseEvent) => {
      if (repoRef.current && !repoRef.current.contains(e.target as Node)) {
        setRepoOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [repoOpen]);

  const repos = useMemo(() => {
    const set = new Set<string>();
    for (const run of runs) {
      const name = getRepoName(run);
      if (name) set.add(name);
    }
    return Array.from(set).sort();
  }, [runs]);

  return (
    <div className="us-filter-bar">
      {/* Search input */}
      <div className="us-filter-search">
        <svg className="us-filter-search__icon" width="14" height="14" viewBox="0 0 16 16" fill="none">
          <path d="M11.5 11.5L14.5 14.5M7 13A6 6 0 107 1a6 6 0 000 12z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
        <input
          className="us-filter-search__input"
          type="text"
          placeholder="Search runs..."
          value={localQuery}
          onChange={(e) => setLocalQuery(e.target.value)}
        />
        {localQuery && (
          <button
            className="us-filter-search__clear"
            onClick={() => { setLocalQuery(""); setQuery(""); }}
            aria-label="Clear search"
          >
            &times;
          </button>
        )}
      </div>

      {/* Status pills */}
      <div className="us-filter-pills">
        {STATUS_PILLS.map((pill) => {
          const isSelected = statuses.has(pill.key);
          return (
            <button
              key={pill.key}
              className={`us-filter-pill ${isSelected ? "us-filter-pill--active" : ""}`}
              onClick={() => toggleStatus(pill.key)}
              style={{
                "--pill-color": pill.color,
              } as React.CSSProperties}
            >
              {pill.label}
            </button>
          );
        })}
      </div>

      {/* Repo filter icon + popover */}
      {repos.length > 0 && (
        <div className="us-filter-repo" ref={repoRef}>
          <Tooltip content="Filter by repository">
            <button
              className={`us-filter-repo__btn ${repo ? "us-filter-repo__btn--active" : ""}`}
              onClick={() => setRepoOpen(!repoOpen)}
              aria-label="Filter by repository"
            >
              <FilterIcon />
              {repo && <span className="us-filter-repo__badge">{repo}</span>}
            </button>
          </Tooltip>
          {repoOpen && (
            <div className="us-filter-repo__popover">
              <button
                className={`us-filter-repo__option ${!repo ? "us-filter-repo__option--active" : ""}`}
                onClick={() => { setRepo(null); setRepoOpen(false); }}
              >
                All repos
              </button>
              {repos.map((r) => (
                <button
                  key={r}
                  className={`us-filter-repo__option ${repo === r ? "us-filter-repo__option--active" : ""}`}
                  onClick={() => { setRepo(r); setRepoOpen(false); }}
                >
                  {r}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Filter summary + clear */}
      {hasFilters && (
        <div className="us-filter-meta">
          <span className="us-filter-meta__count">
            {filteredCount} of {totalCount} runs
          </span>
          <button className="us-filter-meta__clear" onClick={clearAll}>
            Clear
          </button>
        </div>
      )}
    </div>
  );
}
