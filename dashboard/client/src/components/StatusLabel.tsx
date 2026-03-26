import { useRef, useEffect, useState } from "react";
import { Label } from "@patternfly/react-core";
import type { RunPhase } from "../../../shared/types";

type LabelColor =
  | "blue"
  | "green"
  | "red"
  | "grey"
  | "teal"
  | "orange";

const colorMap: Record<RunPhase, LabelColor> = {
  pending: "grey",
  phase0: "blue",
  phase1: "blue",
  phase2: "teal",
  awaiting_approval: "orange",
  phase3: "blue",
  success: "green",
  failed: "red",
  stopped: "orange",
  rejected: "red",
};

export function StatusLabel({ status }: { status: RunPhase }) {
  const prevStatusRef = useRef(status);
  const [pulse, setPulse] = useState(false);

  useEffect(() => {

    if (prevStatusRef.current === status) return;

    prevStatusRef.current = status;
    setPulse(true);

    const timer = setTimeout(() => setPulse(false), 400);

    return () => clearTimeout(timer);
  }, [status]);

  return (
    <span className={pulse ? "us-status-label--pulse" : ""} style={{ display: "inline-flex" }}>
      <Label color={colorMap[status] ?? "grey"}>{status}</Label>
    </span>
  );
}
