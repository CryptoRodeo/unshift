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
  | "phase3"
  | "success"
  | "failed";

export interface LogEntry {
  phase: RunPhase;
  line: string;
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
  prd: PrdEntry[];
  logs: LogEntry[];
}

/** Messages sent from the server over WebSocket */
export type WsMessage =
  | { type: "run:created"; run: Run }
  | { type: "run:phase"; runId: string; phase: RunPhase }
  | { type: "run:log"; runId: string; line: string; phase: RunPhase }
  | { type: "run:prd"; runId: string; prd: PrdEntry[] }
  | { type: "run:complete"; runId: string; status: "success" | "failed" };
