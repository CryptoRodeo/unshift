import { Label } from "@patternfly/react-core";

export function StatusLabel({ status }: { status: string }) {
  const colorMap: Record<string, "blue" | "green" | "red" | "grey" | "teal" | "orange"> = {
    pending: "grey",
    phase0: "blue",
    phase1: "blue",
    phase2: "teal",
    awaiting_approval: "orange",
    phase3: "blue",
    success: "green",
    failed: "red",
    rejected: "red",
  };

  return <Label color={colorMap[status] ?? "grey"}>{status}</Label>;
}
