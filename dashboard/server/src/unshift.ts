import { spawn, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { readFile, writeFile, unlink } from "node:fs/promises";
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

/**
 * Spawns one `unshift.sh --issue <KEY>` per Jira ticket, each as its own Run
 * with a dedicated context file. Prevents duplicate runs for the same ticket.
 */
export class UnshiftRunner extends EventEmitter {
  private runs = new Map<string, Run>();
  private processes = new Map<string, ChildProcess>();
  private contextFiles = new Map<string, string>();
  private activeIssueKeys = new Set<string>();

  /** Path to unshift.sh - two directories up from server/src/ */
  private scriptPath: string;

  constructor() {
    super();
    this.scriptPath = process.env.UNSHIFT_SCRIPT_PATH ?? path.resolve(__dirname, "..", "..", "..", "unshift.sh");
  }

  listRuns(): Run[] {
    return Array.from(this.runs.values());
  }

  /** Discover llm-candidate issues by running unshift.sh --discover */
  discover(): Promise<string[]> {
    return new Promise((resolve, reject) => {
      const proc = spawn("bash", [this.scriptPath, "--discover"], {
        cwd: path.dirname(this.scriptPath),
        stdio: ["ignore", "pipe", "pipe"],
      });

      let stdout = "";
      proc.stdout?.on("data", (chunk: Buffer) => {
        stdout += chunk.toString();
      });

      proc.on("close", (code) => {
        if (code !== 0) {
          reject(new Error(`Discovery failed with exit code ${code}`));
          return;
        }
        const keys = stdout.trim().split("\n").filter(Boolean);
        resolve(keys);
      });
    });
  }

  /** Start a run for a single Jira issue */
  startRun(issueKey: string): Run | { error: string } {
    if (this.activeIssueKeys.has(issueKey)) {
      return { error: `Issue ${issueKey} already has an active run` };
    }

    const id = randomUUID();
    const contextFile = `/tmp/unshift_context_${id}.json`;
    const run: Run = {
      id,
      issueKey,
      status: "pending",
      startedAt: new Date().toISOString(),
      prd: [],
      logs: [],
    };

    this.runs.set(id, run);
    this.activeIssueKeys.add(issueKey);
    this.contextFiles.set(id, contextFile);
    this.emit("run:created", run);
    this.spawn(run, contextFile);
    return run;
  }

  /** Discover issues and start a run for each new one */
  async startRuns(): Promise<{ runs: Run[]; errors: string[] }> {
    const keys = await this.discover();
    const runs: Run[] = [];
    const errors: string[] = [];

    for (const key of keys) {
      const result = this.startRun(key);
      if ("error" in result) {
        errors.push(result.error);
      } else {
        runs.push(result);
      }
    }

    return { runs, errors };
  }

  /** Retry a run that is in a terminal state (rejected, failed, or stopped process) */
  async retryRun(id: string): Promise<Run | { error: string }> {
    const sourceRun = this.runs.get(id);
    if (!sourceRun) {
      return { error: "Run not found" };
    }

    const terminalStates: RunPhase[] = ["rejected", "failed"];
    const isTerminal = terminalStates.includes(sourceRun.status);
    const hasActiveProcess = this.processes.has(id);

    if (!isTerminal && hasActiveProcess) {
      return { error: `Run is not in a terminal state (status: ${sourceRun.status})` };
    }

    if (this.activeIssueKeys.has(sourceRun.issueKey)) {
      return { error: `Issue ${sourceRun.issueKey} already has an active run` };
    }

    const contextData = sourceRun.context;
    if (!contextData) {
      return { error: "Source run has no context data to retry from" };
    }

    const newId = randomUUID();
    const contextFile = `/tmp/unshift_context_${newId}.json`;
    const run: Run = {
      id: newId,
      issueKey: sourceRun.issueKey,
      status: "pending",
      startedAt: new Date().toISOString(),
      repoPath: sourceRun.repoPath,
      branchName: sourceRun.branchName,
      context: { ...contextData },
      prd: [],
      logs: [],
    };

    // Write context file from source run's preserved context
    const contextFileData = {
      issue_key: contextData.issueKey,
      summary: contextData.summary,
      repo_path: contextData.repoPath,
      branch_name: contextData.branchName,
    };
    await writeFile(contextFile, JSON.stringify(contextFileData, null, 2));

    this.runs.set(newId, run);
    this.activeIssueKeys.add(sourceRun.issueKey);
    this.contextFiles.set(newId, contextFile);
    this.emit("run:created", run);
    this.spawn(run, contextFile, true);
    return run;
  }

  stopRun(id: string): void {
    const proc = this.processes.get(id);
    if (proc?.pid) {
      kill(proc.pid);
    }
  }

  approveRun(id: string): { ok: boolean; error?: string } {
    const run = this.runs.get(id);
    const proc = this.processes.get(id);
    if (!run) return { ok: false, error: "Run not found" };
    if (run.status !== "awaiting_approval") return { ok: false, error: `Run is not awaiting approval (status: ${run.status})` };
    if (!proc?.pid) return { ok: false, error: "Process not found or has no PID" };
    try {
      process.kill(-proc.pid, "SIGCONT");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`Failed to send SIGCONT to process group -${proc.pid}: ${msg}`);
      return { ok: false, error: `Failed to resume process: ${msg}` };
    }
    run.status = "phase3";
    this.emit("run:phase", run.id, "phase3");
    return { ok: true };
  }

  rejectRun(id: string): boolean {
    const run = this.runs.get(id);
    const proc = this.processes.get(id);
    if (!run || run.status !== "awaiting_approval") return false;
    run.status = "rejected";
    run.completedAt = new Date().toISOString();
    this.emit("run:complete", run.id, "rejected");
    if (proc?.pid) {
      // Resume then kill so the process group isn't left stopped
      try { process.kill(-proc.pid, "SIGCONT"); } catch {}
      kill(proc.pid);
    }
    this.cleanupRun(id);
    return true;
  }

  private spawn(run: Run, contextFile: string, retry = false): void {
    const args = retry
      ? [this.scriptPath, "--retry", "--issue", run.issueKey]
      : [this.scriptPath, "--issue", run.issueKey];
    const proc = spawn("bash", args, {
      cwd: path.dirname(this.scriptPath),
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
      env: { ...process.env, UNSHIFT_CONTEXT_FILE: contextFile },
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

      // Don't overwrite status if already set (e.g. rejected)
      if (run.status !== "rejected") {
        const status = code === 0 ? "success" : "failed";
        run.status = status;
        run.completedAt = new Date().toISOString();
        this.emit("run:complete", run.id, status);
      }
      this.cleanupRun(run.id);
    });
  }

  private cleanupRun(id: string): void {
    const run = this.runs.get(id);
    if (run) {
      this.activeIssueKeys.delete(run.issueKey);
    }
    this.processes.delete(id);
    const contextFile = this.contextFiles.get(id);
    if (contextFile) {
      unlink(contextFile).catch(() => {});
      this.contextFiles.delete(id);
    }
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
      this.readContextFile(run);
    }

    // Phase 2
    if (line.includes("Phase 2:")) {
      run.status = "phase2";
      this.emit("run:phase", run.id, "phase2");
    }

    // Ralph iteration marker: "=== Ralph iteration N/M ==="
    // When N > 1, the previous iteration just completed, so read updated prd.json
    const ralphMatch = line.match(/Ralph iteration (\d+)\/(\d+)/);
    if (ralphMatch) {
      const iterNum = parseInt(ralphMatch[1], 10);
      if (iterNum > 1 && run.repoPath) {
        this.readPrdFile(run);
      }
    }

    // Phase 2 complete — read final prd.json state
    if (line.includes("Phase 2 complete")) {
      if (run.repoPath) {
        this.readPrdFile(run);
      }
    }

    // Phase 3 — the script self-pauses (kill -STOP $$) after printing this line,
    // so we only need to transition to awaiting_approval. The dashboard sends
    // SIGCONT when the user approves.
    if (line.includes("Phase 3:")) {
      run.status = "awaiting_approval";
      this.emit("run:phase", run.id, "awaiting_approval");
    }
  }

  private async readContextFile(run: Run): Promise<void> {
    const contextPath = this.contextFiles.get(run.id)
      ?? process.env.UNSHIFT_CONTEXT_FILE
      ?? "/tmp/unshift_context.json";
    try {
      const raw = await readFile(contextPath, "utf-8");
      const ctx = JSON.parse(raw);
      run.context = {
        issueKey: ctx.issue_key ?? run.issueKey,
        summary: ctx.summary ?? "",
        repoPath: ctx.repo_path ?? run.repoPath ?? "",
        branchName: ctx.branch_name ?? run.branchName ?? "",
      };
      this.emit("run:context", run.id, run.context);
    } catch {
      // Context file may not exist yet or be unreadable; skip silently
    }
  }

  private async readPrdFile(run: Run): Promise<void> {
    if (!run.repoPath) return;
    const prdPath = path.join(run.repoPath, "prd.json");
    try {
      const raw = await readFile(prdPath, "utf-8");
      const entries: PrdEntry[] = JSON.parse(raw);
      run.prd = entries;
      this.emit("run:prd", run.id, entries);
    } catch {
      // prd.json may not exist yet; skip silently
    }
  }
}
