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
  TokenData,
  Comment,
  WorktreeInfo,
} from "../../shared/types";

export {
  TERMINAL_STATES,
  COMPLETED_STATES,
  isTerminal,
  isCompleted,
  isRunError,
  formatDuration,
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

export function relativeTime(dateStr: string): string {
  const parsed = Date.parse(dateStr);
  if (Number.isNaN(parsed)) return dateStr;
  const diff = Date.now() - parsed;
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export const STATUS_COLORS: Record<string, string> = {
  phase0: "#0066cc",
  phase1: "#0066cc",
  phase2: "#0066cc",
  awaiting_approval: "#e67700",
  phase3: "#0066cc",
  success: "#22863a",
  failed: "#d1242f",
  stopped: "#e67700",
  rejected: "#d1242f",
  pending: "#8b8b8b",
};
