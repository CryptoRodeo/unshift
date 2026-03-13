import { Label } from "@patternfly/react-core";

export function StatusLabel({ status }: { status: string }) {
  const colorMap: Record<string, "blue" | "green" | "red" | "grey" | "teal"> = {
    pending: "grey",
    phase0: "blue",
    phase1: "blue",
    phase2: "teal",
    phase3: "blue",
    success: "green",
    failed: "red",
  };

  return <Label color={colorMap[status] ?? "grey"}>{status}</Label>;
}
