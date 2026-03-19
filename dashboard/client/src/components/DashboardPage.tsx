import { useNavigate } from "react-router-dom";
import {
  PageSection,
  Title,
  Button,
  Toolbar,
  ToolbarContent,
  ToolbarItem,
  Card,
  CardBody,
  Gallery,
  Label,
  Flex,
  FlexItem,
  EmptyState,
  EmptyStateBody,
} from "@patternfly/react-core";
import { useWebSocket } from "../hooks/useWebSocket";
import { PhaseProgress } from "./PhaseProgress";
import { StatusLabel } from "./StatusLabel";
import type { Run } from "../types";
import { PHASE_LABELS } from "../types";

export function DashboardPage() {
  const { runs, connected, startRun } = useWebSocket();
  const navigate = useNavigate();

  const runList = Array.from(runs.values()).sort(
    (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
  );

  return (
    <>
      <PageSection>
        <Toolbar>
          <ToolbarContent>
            <ToolbarItem>
              <Title headingLevel="h2">Runs</Title>
            </ToolbarItem>
            <ToolbarItem align={{ default: "alignEnd" }}>
              <Label color={connected ? "green" : "red"}>
                {connected ? "Connected" : "Disconnected"}
              </Label>
            </ToolbarItem>
            <ToolbarItem>
              <Button variant="primary" onClick={startRun}>
                Start run
              </Button>
            </ToolbarItem>
          </ToolbarContent>
        </Toolbar>
      </PageSection>

      <PageSection isFilled>
        {runList.length === 0 ? (
          <EmptyState titleText="No runs yet" headingLevel="h3">
            <EmptyStateBody>
              Click <strong>Start run</strong> to process llm-candidate Jira
              issues.
            </EmptyStateBody>
          </EmptyState>
        ) : (
          <Gallery hasGutter minWidths={{ default: "400px" }}>
            {runList.map((run) => (
              <RunCard
                key={run.id}
                run={run}
                onClick={() => navigate(`/runs/${run.id}`)}
              />
            ))}
          </Gallery>
        )}
      </PageSection>
    </>
  );
}

function RunCard({ run, onClick }: { run: Run; onClick: () => void }) {
  return (
    <Card isClickable isCompact onClick={onClick}>
      <CardBody>
        <Flex direction={{ default: "column" }} gap={{ default: "gapSm" }}>
          <Flex justifyContent={{ default: "justifyContentSpaceBetween" }}>
            <FlexItem>
              <Title headingLevel="h3" size="lg">
                {run.issueKey || run.id.slice(0, 8)}
              </Title>
            </FlexItem>
            <FlexItem>
              <StatusLabel status={run.status} />
            </FlexItem>
          </Flex>

          <FlexItem>
            <PhaseProgress status={run.status} />
          </FlexItem>

          {run.context && (
            <FlexItem>
              <small>{run.context.summary}</small>
            </FlexItem>
          )}

          <FlexItem>
            <small>
              Started {new Date(run.startedAt).toLocaleString()}
              {PHASE_LABELS[run.status] && ` \u00b7 ${PHASE_LABELS[run.status]}`}
            </small>
          </FlexItem>
        </Flex>
      </CardBody>
    </Card>
  );
}