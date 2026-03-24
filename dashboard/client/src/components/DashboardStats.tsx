import { useMemo } from "react";
import {
  Card,
  CardBody,
  Flex,
  FlexItem,
  Title,
} from "@patternfly/react-core";
import type { Run } from "../types";
import { COMPLETED_STATES } from "../types";
import type { StatusFilter } from "../hooks/useRunFilters";

interface DashboardStatsProps {
  runs: Run[];
  onStatusClick: (status: StatusFilter) => void;
}

interface StatItem {
  label: string;
  value: string | number;
  filterKey: StatusFilter | null;
  color?: string;
}

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
    { label: "Total", value: stats.total, filterKey: null },
    { label: "Active", value: stats.active, filterKey: "active", color: "var(--pf-t--global--color--status--info--default)" },
    { label: "Awaiting", value: stats.awaiting, filterKey: "awaiting_approval", color: "var(--pf-t--global--color--status--warning--default)" },
    { label: "Succeeded", value: stats.succeeded, filterKey: "succeeded", color: "var(--pf-t--global--color--status--success--default)" },
    { label: "Failed", value: stats.failed, filterKey: "failed", color: "var(--pf-t--global--color--status--danger--default)" },
  ];

  return (
    <Flex gap={{ default: "gapMd" }} flexWrap={{ default: "wrap" }}>
      {items.map((item) => (
        <FlexItem key={item.label}>
          <Card
            isCompact
            isClickable={item.filterKey !== null}
            onClick={item.filterKey ? () => onStatusClick(item.filterKey!) : undefined}
            style={{ minWidth: 100, textAlign: "center" }}
          >
            <CardBody>
              <Title headingLevel="h4" size="2xl" style={item.color ? { color: item.color } : undefined}>
                {item.value}
              </Title>
              <small>{item.label}</small>
            </CardBody>
          </Card>
        </FlexItem>
      ))}
    </Flex>
  );
}
