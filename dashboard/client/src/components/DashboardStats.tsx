import { useMemo } from "react";
import {
  BoltIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
  ClockIcon,
  ListIcon,
} from "@patternfly/react-icons";
import type { Run } from "../types";
import { COMPLETED_STATES } from "../types";
import type { StatusFilter } from "../hooks/useRunFilters";

interface DashboardStatsProps {
  runs: Run[];
  onStatusClick: (status: StatusFilter) => void;
}

interface StatItem {
  label: string;
  value: number;
  filterKey: StatusFilter | null;
  color: string;
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
}

const STAT_COLORS = {
  total: "#8e8e93",
  active: "#007aff",
  awaiting: "#ff9f0a",
  succeeded: "#34c759",
  failed: "#ff3b30",
};

export function DashboardStats({ runs, onStatusClick }: DashboardStatsProps) {
  const stats = useMemo(() => {
    let active = 0;
    let awaiting = 0;
    let succeeded = 0;
    let failed = 0;
    for (const run of runs) {
      if (run.status === "awaiting_approval") {
        awaiting++;
      } else if (run.status === "success") {
        succeeded++;
      } else if (run.status === "failed" || run.status === "stopped" || run.status === "rejected") {
        failed++;
      } else if (!COMPLETED_STATES.has(run.status)) {
        active++;
      }
    }

    return { total: runs.length, active, awaiting, succeeded, failed };
  }, [runs]);

  const items: StatItem[] = [
    { label: "Total", value: stats.total, filterKey: null, color: STAT_COLORS.total, icon: ListIcon },
    { label: "Active", value: stats.active, filterKey: "active", color: STAT_COLORS.active, icon: BoltIcon },
    { label: "Awaiting", value: stats.awaiting, filterKey: "awaiting_approval", color: STAT_COLORS.awaiting, icon: ClockIcon },
    { label: "Succeeded", value: stats.succeeded, filterKey: "succeeded", color: STAT_COLORS.succeeded, icon: CheckCircleIcon },
    { label: "Failed", value: stats.failed, filterKey: "failed", color: STAT_COLORS.failed, icon: ExclamationTriangleIcon },
  ];

  return (
    <div className="us-stats-bar">
      {items.map((item) => {
        const Icon = item.icon;
        const isClickable = item.filterKey !== null;
        const isZero = item.value === 0;

        return (
          <button
            key={item.label}
            className={`us-stats-bar__item${isClickable ? " us-stats-bar__item--clickable" : ""}`}
            style={{ opacity: isZero ? 0.5 : 1 }}
            onClick={isClickable ? () => onStatusClick(item.filterKey!) : undefined}
            disabled={!isClickable}
            type="button"
          >
            <Icon style={{ color: item.color, fontSize: "13px", flexShrink: 0 }} />
            <span className="us-stats-bar__value" style={{ color: item.color }}>{item.value}</span>
            <span className="us-stats-bar__label">{item.label}</span>
          </button>
        );
      })}
    </div>
  );
}
