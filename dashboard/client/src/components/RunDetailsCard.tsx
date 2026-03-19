import {
  Card,
  CardBody,
  CardTitle,
  DescriptionList,
  DescriptionListGroup,
  DescriptionListTerm,
  DescriptionListDescription,
} from "@patternfly/react-core";
import type { Run } from "../types";

export function RunDetailsCard({ run }: { run: Run }) {
  return (
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
  );
}
