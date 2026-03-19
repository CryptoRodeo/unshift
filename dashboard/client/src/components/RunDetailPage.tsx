import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  PageSection,
  Title,
  Button,
  Flex,
  FlexItem,
  Grid,
  GridItem,
  Card,
  CardTitle,
  CardBody,
} from "@patternfly/react-core";
import { ArrowLeftIcon } from "@patternfly/react-icons";
import { useWebSocket } from "../hooks/useWebSocket";
import { PhaseProgress } from "./PhaseProgress";
import { StatusLabel } from "./StatusLabel";
import { RunDetailsCard } from "./RunDetailsCard";
import { RunLogsCard } from "./RunLogsCard";

export function RunDetailPage() {
  const { runId } = useParams<{ runId: string }>();
  const navigate = useNavigate();
  const { runs, stopRun, approveRun, rejectRun } = useWebSocket();

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

  const isActive = !["success", "failed", "rejected"].includes(run.status);

  return (
    <>
      <PageSection>
        <Flex justifyContent={{ default: "justifyContentSpaceBetween" }}>
          <FlexItem>
            <Flex alignItems={{ default: "alignItemsCenter" }} gap={{ default: "gapMd" }}>
              <Button variant="plain" icon={<ArrowLeftIcon />} onClick={() => navigate("/")} />
              <Title headingLevel="h2">{run.issueKey || run.id.slice(0, 8)}</Title>
              <StatusLabel status={run.status} />
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

      {run.status === "awaiting_approval" && (
        <PageSection>
          <Card>
            <CardTitle>Approval Required</CardTitle>
            <CardBody>
              <p style={{ marginBottom: "1rem" }}>
                Implementation is complete. Review the changes below before proceeding to create a PR.
              </p>
              {run.logs.length > 0 && (
                <pre style={{ maxHeight: "200px", overflow: "auto", marginBottom: "1rem", padding: "0.5rem", background: "var(--pf-v5-global--BackgroundColor--200)", color: "var(--pf-v5-global--Color--100)", fontSize: "0.85rem" }}>
                  {run.logs
                    .filter((l) => l.phase === "phase2")
                    .slice(-20)
                    .map((l) => l.line)
                    .join("\n")}
                </pre>
              )}
              <Flex gap={{ default: "gapMd" }}>
                <Button variant="primary" onClick={() => approveRun(run.id)}>
                  Approve &amp; Create PR
                </Button>
                <Button variant="danger" onClick={() => rejectRun(run.id)}>
                  Reject
                </Button>
              </Flex>
            </CardBody>
          </Card>
        </PageSection>
      )}

      <PageSection isFilled>
        <Grid hasGutter>
          <GridItem span={4}>
            <RunDetailsCard run={run} />
          </GridItem>

          <GridItem span={8}>
            <RunLogsCard
              logs={run.logs}
              status={run.status}
              expandedSections={expandedSections}
              onToggleSection={(phase, expanded) => {
                setExpandedSections((prev) => {
                  const next = new Set(prev);
                  if (expanded) {
                    next.add(phase);
                  } else {
                    next.delete(phase);
                  }
                  return next;
                });
              }}
            />
          </GridItem>
        </Grid>
      </PageSection>
    </>
  );
}
