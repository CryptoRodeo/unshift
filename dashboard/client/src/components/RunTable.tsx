import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Table, Thead, Tbody, Tr, Th, Td } from "@patternfly/react-table";
import type { ISortBy } from "@patternfly/react-table";
import { StatusLabel } from "./StatusLabel";
import { useElapsedTime } from "../hooks/useElapsedTime";
import type { Run } from "../types";
import { PHASE_LABELS } from "../types";
import { getRepoName } from "../hooks/useRunFilters";

interface RunTableProps {
  runs: Run[];
}

type SortableField = "issueKey" | "status" | "startedAt" | "duration";

const COLUMNS: { title: string; field: SortableField }[] = [
  { title: "Issue", field: "issueKey" },
  { title: "Status", field: "status" },
  { title: "Phase", field: "status" },
  { title: "Repo", field: "issueKey" },
  { title: "Duration", field: "duration" },
  { title: "Started", field: "startedAt" },
];

function getDuration(run: Run): number {
  const end = run.completedAt ? Date.parse(run.completedAt) : Date.now();
  return end - Date.parse(run.startedAt);
}

export function RunTable({ runs }: RunTableProps) {
  const navigate = useNavigate();
  const [sortBy, setSortBy] = useState<ISortBy>({ index: 5, direction: "desc" });

  const sorted = useMemo(() => {
    if (sortBy.index === undefined || !sortBy.direction) return runs;

    const col = COLUMNS[sortBy.index];
    if (!col) return runs;
    const dir = sortBy.direction === "asc" ? 1 : -1;

    return [...runs].sort((a, b) => {
      switch (col.field) {
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
  }, [runs, sortBy]);

  const sortableIndices = [0, 1, 4, 5]; // Issue, Status, Duration, Started

  return (
    <Table aria-label="Runs table" variant="compact">
      <Thead>
        <Tr>
          {COLUMNS.map((col, i) => (
            <Th
              key={col.title}
              sort={
                sortableIndices.includes(i)
                  ? {
                      sortBy,
                      onSort: (_e, index, direction) => setSortBy({ index, direction }),
                      columnIndex: i,
                    }
                  : undefined
              }
            >
              {col.title}
            </Th>
          ))}
        </Tr>
      </Thead>
      <Tbody>
        {sorted.map((run) => (
          <RunRow key={run.id} run={run} onClick={() => navigate(`/runs/${run.id}`)} />
        ))}
      </Tbody>
    </Table>
  );
}

function RunRow({ run, onClick }: { run: Run; onClick: () => void }) {
  const elapsed = useElapsedTime(run.startedAt, run.completedAt);
  const repo = getRepoName(run);

  return (
    <Tr isClickable onRowClick={onClick} style={{ cursor: "pointer" }}>
      <Td dataLabel="Issue">{run.issueKey || run.id.slice(0, 8)}</Td>
      <Td dataLabel="Status"><StatusLabel status={run.status} /></Td>
      <Td dataLabel="Phase">{PHASE_LABELS[run.status] ?? run.status}</Td>
      <Td dataLabel="Repo">{repo ?? "—"}</Td>
      <Td dataLabel="Duration">{elapsed}</Td>
      <Td dataLabel="Started">{new Date(run.startedAt).toLocaleString()}</Td>
    </Tr>
  );
}
