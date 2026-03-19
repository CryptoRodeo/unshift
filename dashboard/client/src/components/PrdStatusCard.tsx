import {
  Card,
  CardTitle,
  CardBody,
} from "@patternfly/react-core";
import { PrdChecklist } from "./PrdChecklist";
import type { PrdEntry } from "../types";

export function PrdStatusCard({ entries }: { entries: PrdEntry[] }) {
  return (
    <Card>
      <CardTitle>Implementation Plan</CardTitle>
      <CardBody>
        <PrdChecklist entries={entries} />
      </CardBody>
    </Card>
  );
}
