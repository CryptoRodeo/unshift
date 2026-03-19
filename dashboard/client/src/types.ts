export interface PrdEntry {
  id: number;
  category: string;
  description: string;
  steps: string[];
  validation: string[];
  completed: boolean;
}

export type RunPhase =
  | "pending"
  | "phase0"
  | "phase1"
  | "phase2"
  | "awaiting_approval"
  | "phase3"
  | "success"
  | "failed"
  | "rejected";

export interface LogEntry {
  phase: RunPhase;
  line: string;
}

export interface RunContext {
  issueKey: string;
  summary: string;
  repoPath: string;
  branchName: string;
}

export interface Run {
  id: string;
  issueKey: string;
  status: RunPhase;
  startedAt: string;
  completedAt?: string;
  repoPath?: string;
  branchName?: string;
  prUrl?: string;
  context?: RunContext;
  prd: PrdEntry[];
  logs: LogEntry[];
}

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

/** Messages sent from the server over WebSocket */
export type WsMessage =
  | { type: "run:created"; run: Run }
  | { type: "run:phase"; runId: string; phase: RunPhase }
  | { type: "run:log"; runId: string; line: string; phase: RunPhase }
  | { type: "run:context"; runId: string; context: RunContext }
  | { type: "run:prd"; runId: string; prd: PrdEntry[] }
  | { type: "run:complete"; runId: string; status: "success" | "failed" | "rejected" };
