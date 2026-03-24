import { useState, useEffect } from "react";
import {
  ProgressStepper,
  ProgressStep,
} from "@patternfly/react-core";
import { PHASE_CONFIG, isTerminal, isCompleted, formatDuration } from "../types";
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

function getPhaseDuration(
  phaseKey: RunPhase,
  currentStatus: RunPhase,
  phaseTimestamps?: Record<string, string>,
  completedAt?: string,
  now?: number,
): string | undefined {
  if (!phaseTimestamps) return undefined;
  const ts = phaseTimestamps[phaseKey];
  if (!ts) return undefined;

  const phaseIdx = phaseOrder.indexOf(phaseKey);
  const currentIdx = phaseOrder.indexOf(currentStatus);

  // Phase hasn't started yet
  if (phaseIdx > currentIdx && !isCompleted(currentStatus) && !isTerminal(currentStatus)) return undefined;

  // Find the next phase's timestamp to compute this phase's duration
  const nextPhaseKey = phaseOrder[phaseIdx + 1];
  const nextTs = nextPhaseKey ? phaseTimestamps[nextPhaseKey] : undefined;

  if (nextTs) {
    // Phase is completed — static duration
    return formatDuration(Date.parse(nextTs) - Date.parse(ts));
  }

  if (phaseIdx === currentIdx || (isCompleted(currentStatus) || isTerminal(currentStatus))) {
    // This is the current/last active phase
    if (completedAt && (isCompleted(currentStatus) || isTerminal(currentStatus))) {
      return formatDuration(Date.parse(completedAt) - Date.parse(ts));
    }
    // Live timer
    return formatDuration((now ?? Date.now()) - Date.parse(ts));
  }

  return undefined;
}

interface PhaseProgressProps {
  status: RunPhase;
  phaseTimestamps?: Record<string, string>;
  completedAt?: string;
}

export function PhaseProgress({ status, phaseTimestamps, completedAt }: PhaseProgressProps) {
  const [now, setNow] = useState(Date.now());
  const isActive = !isCompleted(status) && !isTerminal(status);

  useEffect(() => {
    if (!isActive || !phaseTimestamps) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [isActive, phaseTimestamps]);

  return (
    <ProgressStepper isCompact>
      {PHASE_CONFIG.map((p) => {
        const duration = getPhaseDuration(p.key, status, phaseTimestamps, completedAt, now);
        return (
          <ProgressStep
            key={p.key}
            id={p.key}
            titleId={p.key}
            variant={getVariant(p.key, status)}
            isCurrent={p.key === status}
          >
            {duration ? `${p.label} (${duration})` : p.label}
          </ProgressStep>
        );
      })}
    </ProgressStepper>
  );
}
