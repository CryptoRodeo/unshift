import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  PageSection,
  Title,
  Button,
  Flex,
  FlexItem,
  Card,
  CardBody,
  CardTitle,
  Grid,
  GridItem,
  DescriptionList,
  DescriptionListGroup,
  DescriptionListTerm,
  DescriptionListDescription,
  Label,
  CodeBlock,
  CodeBlockCode,
  ExpandableSection,
} from "@patternfly/react-core";
import { ArrowLeftIcon } from "@patternfly/react-icons";
import { useWebSocket } from "../hooks/useWebSocket";
import { PhaseProgress } from "./PhaseProgress";
import { PrdChecklist } from "./PrdChecklist";
import type { RunPhase, LogEntry } from "../types";

const phaseLabels: Record<string, string> = {
  pending: "Pending",
  phase0: "Pre-flight",
  phase1: "Planning",
  phase2: "Implementation",
  phase3: "Delivery",
};

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

export function RunDetailPage() {
  const { runId } = useParams<{ runId: string }>();
  const navigate = useNavigate();
  const { runs, stopRun } = useWebSocket();

  const run = runId ? runs.get(runId) : undefined;
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());

  // Auto-expand the current phase section when it changes
  useEffect(() => {
    if (run) {
      setExpandedSections((prev) => {
        const next = new Set(prev);
        next.add(run.status);
        return next;
      });
    }
  }, [run?.status]);

  if (!run) {
    return (
      <PageSection>
        <Title headingLevel="h2">Run not found</Title>
        <Button variant="link" icon={<ArrowLeftIcon />} onClick={() => navigate("/")}>
          Back to dashboard
        </Button>
      </PageSection>
    );
  }

  const isActive = !["success", "failed"].includes(run.status);

  return (
    <>
      <PageSection>
        <Flex justifyContent={{ default: "justifyContentSpaceBetween" }}>
          <FlexItem>
            <Flex alignItems={{ default: "alignItemsCenter" }} gap={{ default: "gapMd" }}>
              <Button variant="plain" icon={<ArrowLeftIcon />} onClick={() => navigate("/")} />
              <Title headingLevel="h2">{run.issueKey || run.id.slice(0, 8)}</Title>
              <Label color={run.status === "success" ? "green" : run.status === "failed" ? "red" : "blue"}>
                {run.status}
              </Label>
            </Flex>
          </FlexItem>
          {isActive && (
            <FlexItem>
              <Button variant="danger" onClick={() => stopRun(run.id)}>
                Stop
              </Button>
            </FlexItem>
          )}
        </Flex>
      </PageSection>

      <PageSection>
        <PhaseProgress status={run.status} />
      </PageSection>

      <PageSection isFilled>
        <Grid hasGutter>
          <GridItem span={4}>
            <Flex direction={{ default: "column" }} gap={{ default: "gapMd" }}>
              <Card>
                <CardTitle>Details</CardTitle>
                <CardBody>
                  <DescriptionList isCompact>
                    <DescriptionListGroup>
                      <DescriptionListTerm>Run ID</DescriptionListTerm>
                      <DescriptionListDescription>
                        <code>{run.id}</code>
                      </DescriptionListDescription>
                    </DescriptionListGroup>
                    <DescriptionListGroup>
                      <DescriptionListTerm>Started</DescriptionListTerm>
                      <DescriptionListDescription>
                        {new Date(run.startedAt).toLocaleString()}
                      </DescriptionListDescription>
                    </DescriptionListGroup>
                    {run.repoPath && (
                      <DescriptionListGroup>
                        <DescriptionListTerm>Repository</DescriptionListTerm>
                        <DescriptionListDescription>
                          <code>{run.repoPath}</code>
                        </DescriptionListDescription>
                      </DescriptionListGroup>
                    )}
                    {run.branchName && (
                      <DescriptionListGroup>
                        <DescriptionListTerm>Branch</DescriptionListTerm>
                        <DescriptionListDescription>
                          <code>{run.branchName}</code>
                        </DescriptionListDescription>
                      </DescriptionListGroup>
                    )}
                    {run.prUrl && (
                      <DescriptionListGroup>
                        <DescriptionListTerm>Pull Request</DescriptionListTerm>
                        <DescriptionListDescription>
                          <a href={run.prUrl} target="_blank" rel="noreferrer">
                            {run.prUrl}
                          </a>
                        </DescriptionListDescription>
                      </DescriptionListGroup>
                    )}
                  </DescriptionList>
                </CardBody>
              </Card>

              {run.prd.length > 0 && (
                <Card>
                  <CardTitle>Implementation Plan</CardTitle>
                  <CardBody>
                    <PrdChecklist entries={run.prd} />
                  </CardBody>
                </Card>
              )}
            </Flex>
          </GridItem>

          <GridItem span={8}>
            <Card>
              <CardTitle>Logs</CardTitle>
              <CardBody>
                {run.logs.length === 0 ? (
                  <CodeBlock>
                    <CodeBlockCode id="log-output">
                      Waiting for output...
                    </CodeBlockCode>
                  </CodeBlock>
                ) : (
                  groupLogsByPhase(run.logs).map((group, i) => {
                    const sectionKey = `${group.phase}-${i}`;
                    const isActive = group.phase === run.status;
                    const isExpanded = expandedSections.has(group.phase) || isActive;
                    return (
                      <ExpandableSection
                        key={sectionKey}
                        toggleText={phaseLabels[group.phase] ?? group.phase}
                        isExpanded={isExpanded}
                        onToggle={(_event, expanded) => {
                          setExpandedSections((prev) => {
                            const next = new Set(prev);
                            if (expanded) {
                              next.add(group.phase);
                            } else {
                              next.delete(group.phase);
                            }
                            return next;
                          });
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
          </GridItem>
        </Grid>
      </PageSection>
    </>
  );
}
