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
  Alert,
} from "@patternfly/react-core";
import { ArrowLeftIcon } from "@patternfly/react-icons";
import { useWebSocket } from "../hooks/useWebSocket";
import { PhaseProgress } from "../components/PhaseProgress";
import { StatusLabel } from "../components/StatusLabel";
import { RunDetailsCard } from "../components/RunDetailsCard";
import { RunLogsCard } from "../components/RunLogsCard";
import { RunContextCard } from "../components/RunContextCard";
import { PrdStatusCard } from "../components/PrdStatusCard";

export function RunDetailPage() {
  const { runId } = useParams<{ runId: string }>();
  const navigate = useNavigate();
  const { runs, stopRun, approveRun, rejectRun } = useWebSocket();

  const run = runId ? runs.get(runId) : undefined;
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());
  const [approveError, setApproveError] = useState<string | null>(null);

  const handleApprove = async () => {
    setApproveError(null);
    const result = await approveRun(run!.id);
    if (!result.ok) {
      setApproveError(result.error || "Failed to approve run");
    }
  };

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

      {run.context && (
        <PageSection>
          <RunContextCard context={run.context} />
        </PageSection>
      )}

      {run.prd.length > 0 && (
        <PageSection>
          <PrdStatusCard entries={run.prd} />
        </PageSection>
      )}

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
              {approveError && (
                <Alert variant="danger" title="Approval failed" isInline style={{ marginBottom: "1rem" }}>
                  {approveError}
                </Alert>
              )}
              <Flex gap={{ default: "gapMd" }}>
                <Button variant="primary" onClick={handleApprove}>
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
