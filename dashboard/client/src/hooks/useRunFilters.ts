import { useSearchParams } from "react-router-dom";
import { useCallback, useMemo } from "react";
import type { Run, RunPhase } from "../types";

export type StatusFilter = "active" | "awaiting_approval" | "succeeded" | "failed";

const STATUS_FILTER_PHASES: Record<StatusFilter, RunPhase[]> = {
  active: ["pending", "phase0", "phase1", "phase2", "phase3"],
  awaiting_approval: ["awaiting_approval"],
  succeeded: ["success"],
  failed: ["failed", "stopped", "rejected"],
};

export function getRepoName(run: Run): string | null {
  const repoPath = run.context?.repoPath ?? run.repoPath;
  if (!repoPath) return null;
  return repoPath.split("/").pop() ?? null;
}

export function useRunFilters() {
  const [searchParams, setSearchParams] = useSearchParams();

  const query = searchParams.get("q") ?? "";
  const statuses: Set<StatusFilter> = useMemo(() => {
    const raw = searchParams.get("status");
    if (!raw) return new Set<StatusFilter>();
    return new Set(raw.split(",").filter(Boolean) as StatusFilter[]);
  }, [searchParams]);
  const repo = searchParams.get("repo") ?? null;

  const setQuery = useCallback(
    (q: string) => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        if (q) next.set("q", q);
        else next.delete("q");
        return next;
      });
    },
    [setSearchParams]
  );

  const toggleStatus = useCallback(
    (status: StatusFilter) => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        const current = new Set(
          (next.get("status") ?? "").split(",").filter(Boolean) as StatusFilter[]
        );
        if (current.has(status)) current.delete(status);
        else current.add(status);
        if (current.size === 0) next.delete("status");
        else next.set("status", Array.from(current).join(","));
        return next;
      });
    },
    [setSearchParams]
  );

  const setRepo = useCallback(
    (r: string | null) => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        if (r) next.set("repo", r);
        else next.delete("repo");
        return next;
      });
    },
    [setSearchParams]
  );

  const clearAll = useCallback(() => {
    setSearchParams({});
  }, [setSearchParams]);

  const hasFilters = query !== "" || statuses.size > 0 || repo !== null;

  const filterRuns = useCallback(
    (runs: Run[]): Run[] => {
      return runs.filter((run) => {
        if (query) {
          const key = run.issueKey ?? "";
          if (!key.toLowerCase().includes(query.toLowerCase())) return false;
        }
        if (statuses.size > 0) {
          const allowedPhases = Array.from(statuses).flatMap(
            (s) => STATUS_FILTER_PHASES[s]
          );
          if (!allowedPhases.includes(run.status)) return false;
        }
        if (repo) {
          const runRepo = getRepoName(run);
          if (runRepo !== repo) return false;
        }
        return true;
      });
    },
    [query, statuses, repo]
  );

  return {
    query,
    statuses,
    repo,
    hasFilters,
    setQuery,
    toggleStatus,
    setRepo,
    clearAll,
    filterRuns,
  };
}
