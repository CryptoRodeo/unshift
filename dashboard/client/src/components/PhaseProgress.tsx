import {
  ProgressStepper,
  ProgressStep,
} from "@patternfly/react-core";
import type { RunPhase } from "../types";

const phases: { key: RunPhase; label: string }[] = [
  { key: "phase0", label: "Pre-flight" },
  { key: "phase1", label: "Planning" },
  { key: "phase2", label: "Implementation" },
  { key: "phase3", label: "Delivery" },
];

const phaseOrder: RunPhase[] = ["phase0", "phase1", "phase2", "phase3", "success"];

function getVariant(
  phaseKey: RunPhase,
  currentStatus: RunPhase
): "success" | "info" | "pending" | "danger" {
  if (currentStatus === "failed") {
    const currentIdx = phaseOrder.indexOf(currentStatus);
    const phaseIdx = phaseOrder.indexOf(phaseKey);
    if (phaseIdx < currentIdx) return "success";
    return "danger";
  }

  const currentIdx = phaseOrder.indexOf(currentStatus);
  const phaseIdx = phaseOrder.indexOf(phaseKey);

  if (currentStatus === "success") return "success";
  if (phaseIdx < currentIdx) return "success";
  if (phaseIdx === currentIdx) return "info";
  return "pending";
}

export function PhaseProgress({ status }: { status: RunPhase }) {
  return (
    <ProgressStepper isCompact>
      {phases.map((p) => (
        <ProgressStep
          key={p.key}
          id={p.key}
          titleId={p.key}
          variant={getVariant(p.key, status)}
          isCurrent={p.key === status}
        >
          {p.label}
        </ProgressStep>
      ))}
    </ProgressStepper>
  );
}
