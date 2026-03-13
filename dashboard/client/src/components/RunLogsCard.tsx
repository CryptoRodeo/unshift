import {
  Card,
  CardBody,
  CardTitle,
  CodeBlock,
  CodeBlockCode,
  ExpandableSection,
} from "@patternfly/react-core";
import { PHASE_LABELS } from "../types";
import type { RunPhase, LogEntry } from "../types";

function groupLogsByPhase(logs: LogEntry[]) {
  const groups: { phase: RunPhase; lines: string[] }[] = [];
  for (const entry of logs) {
    const last = groups[groups.length - 1];
    if (last && last.phase === entry.phase) {
      last.lines.push(entry.line);
    } else {
      groups.push({ phase: entry.phase, lines: [entry.line] });
    }
  }
  return groups;
}

export function RunLogsCard({
  logs,
  status,
  expandedSections,
  onToggleSection,
}: {
  logs: LogEntry[];
  status: RunPhase;
  expandedSections: Set<string>;
  onToggleSection: (phase: string, expanded: boolean) => void;
}) {
  return (
    <Card>
      <CardTitle>Logs</CardTitle>
      <CardBody>
        {logs.length === 0 ? (
          <CodeBlock>
            <CodeBlockCode id="log-output">
              Waiting for output...
            </CodeBlockCode>
          </CodeBlock>
        ) : (
          groupLogsByPhase(logs).map((group, i) => {
            const sectionKey = `${group.phase}-${i}`;
            const isActive = group.phase === status;
            const isExpanded = expandedSections.has(group.phase) || isActive;
            return (
              <ExpandableSection
                key={sectionKey}
                toggleText={PHASE_LABELS[group.phase] ?? group.phase}
                isExpanded={isExpanded}
                onToggle={(_event, expanded) => {
                  onToggleSection(group.phase, expanded);
                }}
              >
                <CodeBlock>
                  <CodeBlockCode>
                    {group.lines.join("\n")}
                  </CodeBlockCode>
                </CodeBlock>
              </ExpandableSection>
            );
          })
        )}
      </CardBody>
    </Card>
  );
}
