import {
  ProgressStepper,
  ProgressStep,
} from "@patternfly/react-core";
import { PHASE_CONFIG, isTerminal } from "../types";
import type { RunPhase } from "../types";

const phaseOrder: RunPhase[] = ["phase0", "phase1", "phase2", "awaiting_approval", "phase3", "success"];

function getVariant(
  phaseKey: RunPhase,
  currentStatus: RunPhase
): "success" | "info" | "pending" | "danger" | "warning" {
  if (isTerminal(currentStatus)) return "danger";

  const currentIdx = phaseOrder.indexOf(currentStatus);
  const phaseIdx = phaseOrder.indexOf(phaseKey);

  if (currentStatus === "success") return "success";
  if (currentStatus === "awaiting_approval" && phaseKey === "awaiting_approval") return "warning";
  if (phaseIdx < currentIdx) return "success";
  if (phaseIdx === currentIdx) return "info";
  return "pending";
}

export function PhaseProgress({ status }: { status: RunPhase }) {
  return (
    <ProgressStepper isCompact>
      {PHASE_CONFIG.map((p) => (
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
