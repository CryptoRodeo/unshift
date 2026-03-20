import type { RunPhase } from "../../shared/types";

export type {
  PrdEntry,
  RunPhase,
  LogEntry,
  RunContext,
  Run,
  WsMessage,
  CompletedStatus,
  RunErrorCode,
  RunError,
} from "../../shared/types";

export {
  TERMINAL_STATES,
  COMPLETED_STATES,
  isTerminal,
  isCompleted,
} from "../../shared/types";

export const PHASE_CONFIG: { key: RunPhase; label: string }[] = [
  { key: "phase0", label: "Pre-flight" },
  { key: "phase1", label: "Planning" },
  { key: "phase2", label: "Implementation" },
  { key: "awaiting_approval", label: "Approval" },
  { key: "phase3", label: "Delivery" },
];

export const PHASE_LABELS: Record<string, string> = Object.fromEntries(
  PHASE_CONFIG.map((p) => [p.key, p.label])
);
