import {
  Card,
  CardTitle,
  CardBody,
  DescriptionList,
  DescriptionListGroup,
  DescriptionListTerm,
  DescriptionListDescription,
} from "@patternfly/react-core";
import type { RunContext } from "../types";

export function RunContextCard({ context }: { context: RunContext }) {
  return (
    <Card>
      <CardTitle>Issue Context</CardTitle>
      <CardBody>
        <DescriptionList isCompact isHorizontal>
          <DescriptionListGroup>
            <DescriptionListTerm>Issue</DescriptionListTerm>
            <DescriptionListDescription>
              <strong>{context.issueKey}</strong>
            </DescriptionListDescription>
          </DescriptionListGroup>
          <DescriptionListGroup>
            <DescriptionListTerm>Summary</DescriptionListTerm>
            <DescriptionListDescription>
              {context.summary}
            </DescriptionListDescription>
          </DescriptionListGroup>
          <DescriptionListGroup>
            <DescriptionListTerm>Repository</DescriptionListTerm>
            <DescriptionListDescription>
              <code>{context.repoPath}</code>
            </DescriptionListDescription>
          </DescriptionListGroup>
          <DescriptionListGroup>
            <DescriptionListTerm>Branch</DescriptionListTerm>
            <DescriptionListDescription>
              <code>{context.branchName}</code>
            </DescriptionListDescription>
          </DescriptionListGroup>
        </DescriptionList>
      </CardBody>
    </Card>
  );
}
