import { useRef, useEffect, useState } from "react";
import { Label } from "@patternfly/react-core";

export function StatusLabel({ status }: { status: string }) {
  const prevStatusRef = useRef(status);
  const [pulse, setPulse] = useState(false);

  useEffect(() => {
    if (prevStatusRef.current !== status) {
      prevStatusRef.current = status;
      setPulse(true);
      const timer = setTimeout(() => setPulse(false), 400);
      return () => clearTimeout(timer);
    }
  }, [status]);

  const colorMap: Record<string, "blue" | "green" | "red" | "grey" | "teal" | "orange"> = {
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

  return (
    <span className={pulse ? "us-status-label--pulse" : ""} style={{ display: "inline-flex" }}>
      <Label color={colorMap[status] ?? "grey"}>{status}</Label>
    </span>
  );
}
