import { spawn, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import path from "node:path";
import kill from "tree-kill";

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

/**
 * Spawns `unshift.sh`, parses its stderr output to track phase transitions,
 * and emits events for the WebSocket layer to broadcast.
 */
export class UnshiftRunner extends EventEmitter {
  private runs = new Map<string, Run>();
  private processes = new Map<string, ChildProcess>();

  /** Path to unshift.sh - two directories up from server/src/ */
  private scriptPath: string;

  constructor() {
    super();
    this.scriptPath = process.env.UNSHIFT_SCRIPT_PATH ?? path.resolve(__dirname, "..", "..", "..", "unshift.sh");
  }

  listRuns(): Run[] {
    return Array.from(this.runs.values());
  }

  startRun(): Run {
    const id = randomUUID();
    const run: Run = {
      id,
      issueKey: "",
      status: "pending",
      startedAt: new Date().toISOString(),
      prd: [],
      logs: [],
    };

    this.runs.set(id, run);
    this.emit("run:created", run);
    this.spawn(run);
    return run;
  }

  stopRun(id: string): void {
    const proc = this.processes.get(id);
    if (proc?.pid) {
      kill(proc.pid);
    }
  }

  private spawn(run: Run): void {
    const proc = spawn("bash", [this.scriptPath], {
      cwd: path.dirname(this.scriptPath),
      stdio: ["ignore", "pipe", "pipe"],
    });

    this.processes.set(run.id, proc);

    const handleLine = (line: string) => {
      this.parseLine(run, line);
      run.logs.push({ phase: run.status, line });
      this.emit("run:log", run.id, line, run.status);
    };

    let stdoutBuf = "";
    proc.stdout?.on("data", (chunk: Buffer) => {
      stdoutBuf += chunk.toString();
      const lines = stdoutBuf.split("\n");
      stdoutBuf = lines.pop()!;
      for (const line of lines) handleLine(line);
    });

    let stderrBuf = "";
    proc.stderr?.on("data", (chunk: Buffer) => {
      stderrBuf += chunk.toString();
      const lines = stderrBuf.split("\n");
      stderrBuf = lines.pop()!;
      for (const line of lines) handleLine(line);
    });

    proc.on("close", (code) => {
      // Flush remaining buffered output
      if (stdoutBuf) handleLine(stdoutBuf);
      if (stderrBuf) handleLine(stderrBuf);

      const status = code === 0 ? "success" : "failed";
      run.status = status;
      run.completedAt = new Date().toISOString();
      this.emit("run:complete", run.id, status);
      this.processes.delete(run.id);
    });
  }

  /**
   * Parse stderr lines from unshift.sh to detect phase transitions
   * and extract metadata like issue keys, repo paths, etc.
   */
  private parseLine(run: Run, line: string): void {
    // Phase 0
    if (line.includes("Phase 0:")) {
      run.status = "phase0";
      this.emit("run:phase", run.id, "phase0");
    }

    // Issue discovery: "Processing issue: SSCUI-81"
    const issueMatch = line.match(/Processing issue:\s+(\S+)/);
    if (issueMatch) {
      run.issueKey = issueMatch[1];
    }

    // Phase 1
    if (line.includes("Phase 1:")) {
      run.status = "phase1";
      this.emit("run:phase", run.id, "phase1");
    }

    // Phase 1 complete: "Phase 1 complete. Repo: /path, Branch: branch-name"
    const p1Complete = line.match(
      /Phase 1 complete\. Repo:\s+(\S+),\s+Branch:\s+(\S+)/
    );
    if (p1Complete) {
      run.repoPath = p1Complete[1];
      run.branchName = p1Complete[2];
    }

    // Phase 2
    if (line.includes("Phase 2:")) {
      run.status = "phase2";
      this.emit("run:phase", run.id, "phase2");
    }

    // Phase 3
    if (line.includes("Phase 3:")) {
      run.status = "phase3";
      this.emit("run:phase", run.id, "phase3");
    }
  }
}
