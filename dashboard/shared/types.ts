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

/** Runs in a terminal failure state (eligible for retry) */
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
  return typeof value === "object" && value !== null && "error" in value && "code" in value;
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

export interface TokenData {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  model?: string;
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
  retryCount?: number;
  sourceRunId?: string;
  phaseTimestamps?: Record<string, string>;
  tokens?: TokenData;
}

/** Messages sent from the server over WebSocket */
export type WsMessage =
  | { type: "run:created"; run: Run }
  | { type: "run:phase"; runId: string; phase: RunPhase; timestamp?: string }
  | { type: "run:log"; runId: string; line: string; phase: RunPhase }
  | { type: "run:context"; runId: string; context: RunContext }
  | { type: "run:prd"; runId: string; prd: PrdEntry[] }
  | { type: "run:complete"; runId: string; status: CompletedStatus }
  | { type: "run:progress"; runId: string; content: string }
  | { type: "run:skipped"; skipped: { issueKey: string; reason: string }[] }
  | { type: "run:deleted"; runId: string }
  | { type: "run:tokens"; runId: string; tokens: TokenData };

export function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}
