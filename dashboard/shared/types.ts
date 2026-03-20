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
  | "stopped"
  | "rejected";

/** Runs that cannot be retried or acted upon */
const TERMINAL_LIST = ["failed", "stopped", "rejected"] as const;
export type TerminalStatus = (typeof TERMINAL_LIST)[number];
export const TERMINAL_STATES: ReadonlySet<RunPhase> = new Set(TERMINAL_LIST);

/** Runs that have finished (successfully or not) */
const COMPLETED_LIST = ["success", "failed", "stopped", "rejected"] as const;
export type CompletedStatus = (typeof COMPLETED_LIST)[number];
export const COMPLETED_STATES: ReadonlySet<RunPhase> = new Set(COMPLETED_LIST);

export function isTerminal(status: RunPhase): status is TerminalStatus {
  return TERMINAL_STATES.has(status);
}

export function isCompleted(status: RunPhase): status is CompletedStatus {
  return COMPLETED_STATES.has(status);
}

export type RunErrorCode = 'NOT_FOUND' | 'CONFLICT' | 'BAD_REQUEST' | 'INVALID_STATE';

export interface RunError {
  error: string;
  code: RunErrorCode;
}

export function isRunError(value: unknown): value is RunError {
  return typeof value === "object" && value !== null && "code" in value;
}

export interface LogEntry {
  phase: RunPhase;
  line: string;
}

export interface RunContext {
  issueKey: string;
  summary: string;
  repoPath: string;
  branchName: string;
  description?: string;
  issueType?: string;
  defaultBranch?: string;
  host?: string;
  commitPrefix?: string;
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

/** Messages sent from the server over WebSocket */
export type WsMessage =
  | { type: "run:created"; run: Run }
  | { type: "run:phase"; runId: string; phase: RunPhase }
  | { type: "run:log"; runId: string; line: string; phase: RunPhase }
  | { type: "run:context"; runId: string; context: RunContext }
  | { type: "run:prd"; runId: string; prd: PrdEntry[] }
  | { type: "run:complete"; runId: string; status: CompletedStatus };
