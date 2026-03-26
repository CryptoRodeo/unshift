import { useState, useEffect } from "react";
import { Tooltip } from "@patternfly/react-core";
import { PHASE_CONFIG, isTerminal, isCompleted, formatDuration } from "../types";
import type { RunPhase } from "../types";

const phaseOrder: RunPhase[] = ["phase0", "phase1", "phase2", "awaiting_approval", "phase3", "success"];

type PhaseState = "completed" | "active" | "pending" | "failed";

function getPhaseState(phaseKey: RunPhase, currentStatus: RunPhase): PhaseState {
  if (isTerminal(currentStatus)) {
    const currentIdx = phaseOrder.indexOf(currentStatus);
    const phaseIdx = phaseOrder.indexOf(phaseKey);
    // For terminal states, the failed phase is the one at or before the current index
    const failedIdx = Math.max(phaseOrder.indexOf(currentStatus), 0);
    if (phaseIdx < failedIdx) return "completed";
    return phaseIdx <= failedIdx ? "failed" : "pending";
  }

  if (currentStatus === "success") return "completed";

  const currentIdx = phaseOrder.indexOf(currentStatus);
  const phaseIdx = phaseOrder.indexOf(phaseKey);

  if (phaseIdx < currentIdx) return "completed";
  if (phaseIdx === currentIdx) return "active";
  return "pending";
}

function getLineState(afterPhaseIdx: number, currentStatus: RunPhase): PhaseState {
  if (currentStatus === "success") return "completed";
  if (isTerminal(currentStatus)) {
    return afterPhaseIdx < PHASE_CONFIG.length ? "failed" : "pending";
  }

  const currentIdx = PHASE_CONFIG.findIndex(p => p.key === currentStatus);
  if (afterPhaseIdx < currentIdx) return "completed";
  if (afterPhaseIdx === currentIdx) return "active";
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

  if (phaseIdx > currentIdx && !isCompleted(currentStatus) && !isTerminal(currentStatus)) return undefined;

  const nextPhaseKey = phaseOrder[phaseIdx + 1];
  const nextTs = nextPhaseKey ? phaseTimestamps[nextPhaseKey] : undefined;

  if (nextTs) {
    return formatDuration(Date.parse(nextTs) - Date.parse(ts));
  }

  if (phaseIdx === currentIdx || isCompleted(currentStatus) || isTerminal(currentStatus)) {
    if (completedAt && (isCompleted(currentStatus) || isTerminal(currentStatus))) {
      return formatDuration(Date.parse(completedAt) - Date.parse(ts));
    }
    return formatDuration((now ?? Date.now()) - Date.parse(ts));
  }

  return undefined;
}

const PHASE_PROGRESS_ESTIMATE: Record<string, number> = {
  pending: 0,
  phase0: 10,
  phase1: 25,
  phase2: 55,
  awaiting_approval: 80,
  phase3: 92,
  success: 100,
};

interface PhaseProgressProps {
  status: RunPhase;
  phaseTimestamps?: Record<string, string>;
  completedAt?: string;
  compact?: boolean;
}

export function PhaseProgress({ status, phaseTimestamps, completedAt, compact = false }: PhaseProgressProps) {
  const [now, setNow] = useState(Date.now());
  const isActive = !isCompleted(status) && !isTerminal(status);

  useEffect(() => {
    if (!isActive || !phaseTimestamps) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [isActive, phaseTimestamps]);

  const estimatedPercent = isActive ? (PHASE_PROGRESS_ESTIMATE[status] ?? 0) : (isCompleted(status) ? 100 : 0);

  return (
    <div className={`us-phase-progress${compact ? " us-phase-progress--compact" : ""}`}>
      {isActive && !compact && (
        <div className="us-phase-progress__bar-wrap">
          <div className="us-phase-progress__bar">
            <div className="us-phase-progress__bar-fill" style={{ width: `${estimatedPercent}%` }} />
          </div>
          <span className="us-phase-progress__bar-label">{estimatedPercent}%</span>
        </div>
      )}
      {PHASE_CONFIG.map((p, idx) => {
        const state = getPhaseState(p.key, status);
        const duration = getPhaseDuration(p.key, status, phaseTimestamps, completedAt, now);
        const isCurrent = p.key === status;
        const showLine = idx < PHASE_CONFIG.length - 1;
        const lineState = showLine ? getLineState(idx, status) : undefined;

        const circle = (
          <div
            className={`us-phase-progress__circle us-phase-progress__circle--${state}${isCurrent ? " us-phase-progress__circle--current" : ""}`}
          >
            {state === "completed" && (
              <svg viewBox="0 0 16 16" fill="currentColor" className="us-phase-progress__check">
                <path d="M13.78 4.22a.75.75 0 010 1.06l-7.25 7.25a.75.75 0 01-1.06 0L2.22 9.28a.75.75 0 011.06-1.06L6 10.94l6.72-6.72a.75.75 0 011.06 0z" />
              </svg>
            )}
            {state === "failed" && (
              <svg viewBox="0 0 16 16" fill="currentColor" className="us-phase-progress__x">
                <path d="M3.72 3.72a.75.75 0 011.06 0L8 6.94l3.22-3.22a.75.75 0 111.06 1.06L9.06 8l3.22 3.22a.75.75 0 11-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 01-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 010-1.06z" />
              </svg>
            )}
          </div>
        );

        return (
          <div key={p.key} className="us-phase-progress__step">
            {compact ? (
              <Tooltip content={duration ? `${p.label} (${duration})` : p.label}>
                {circle}
              </Tooltip>
            ) : (
              circle
            )}

            {showLine && (
              <div className={`us-phase-progress__line us-phase-progress__line--${lineState}`} />
            )}

            {!compact && (
              <div className="us-phase-progress__label-group">
                <span className={`us-phase-progress__label${isCurrent ? " us-phase-progress__label--current" : ""}`}>
                  {p.label}
                </span>
                {duration && (
                  <span className="us-phase-progress__duration">{duration}</span>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
