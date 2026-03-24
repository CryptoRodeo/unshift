import { spawn, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { readFile, writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import kill from "tree-kill";

import type { RunContext, Run, RunError, PrdEntry, LogEntry, RunPhase } from "../../shared/types";
import { isTerminal, isCompleted, isRunError } from "../../shared/types";
import { RunRepository } from "./runRepository";
import { parseTokenLine } from "./tokenParser";
import { PtyManager } from "./ptyManager";

/**
 * Spawns one `unshift.sh --issue <KEY>` per Jira ticket, each as its own Run
 * with a dedicated context file. Prevents duplicate runs for the same ticket.
 */
export class UnshiftRunner extends EventEmitter {
  private processes = new Map<string, ChildProcess>();
  private contextFiles = new Map<string, string>();
  /** Maps issueKey → owning runId to prevent duplicate runs */
  private activeIssueKeys = new Map<string, string>();
  /** Tracks runs that are being gracefully stopped so the close handler uses "stopped" instead of "failed" */
  private stoppingRuns = new Set<string>();
  private repository = new RunRepository();
  readonly ptyManager = new PtyManager();
  /** Set of run IDs using PTY mode */
  private ptyRuns = new Set<string>();

  /** Path to unshift.sh in the cli/ directory */
  private scriptPath: string;

  constructor() {
    super();
    this.scriptPath = process.env.UNSHIFT_SCRIPT_PATH ?? path.resolve(__dirname, "..", "..", "..", "cli", "unshift.sh");

    // Rebuild activeIssueKeys from DB for runs that survived a restart
    for (const run of this.repository.listRuns()) {
      if (!isCompleted(run.status)) {
        this.activeIssueKeys.set(run.issueKey, run.id);
      }
    }
  }

  listRuns(): Run[] {
    return this.repository.listRuns();
  }

  getRun(id: string): Run | undefined {
    return this.repository.getRun(id);
  }

  getRunsByIssueKey(issueKey: string): Run[] {
    return this.repository.getRunsByIssueKey(issueKey);
  }

  getRunProgress(id: string): string | undefined {
    return this.repository.getProgressTxt(id);
  }

  getRunLogs(id: string): LogEntry[] {
    return this.repository.getRunLogs(id);
  }

  getRunLogsSince(id: string, sinceId: number): { id: number; phase: RunPhase; line: string }[] {
    return this.repository.getRunLogsSince(id, sinceId);
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

  /** Register a new run, emit the created event, and spawn the process */
  private registerAndSpawn(
    fields: Pick<Run, "issueKey"> & Partial<Pick<Run, "repoPath" | "branchName" | "context" | "retryCount" | "sourceRunId">>,
    contextFile: string,
    retry = false,
  ): Run {
    const run: Run = {
      id: randomUUID(),
      issueKey: fields.issueKey,
      status: "pending",
      startedAt: new Date().toISOString(),
      repoPath: fields.repoPath,
      branchName: fields.branchName,
      context: fields.context,
      prd: [],
      logs: [],
      retryCount: fields.retryCount,
      sourceRunId: fields.sourceRunId,
    };

    this.repository.createRun(run);
    this.activeIssueKeys.set(run.issueKey, run.id);
    this.contextFiles.set(run.id, contextFile);
    this.emit("run:created", run);
    // Use PTY mode by default for terminal emulation; disable with UNSHIFT_NO_PTY=1
    if (process.env.UNSHIFT_NO_PTY === "1") {
      this.spawn(run, contextFile, retry);
    } else {
      this.spawnWithPty(run, contextFile, retry);
    }
    return run;
  }

  /** Start a run for a single Jira issue */
  startRun(issueKey: string, force = false): Run | RunError {
    if (this.activeIssueKeys.has(issueKey)) {
      return { error: `Issue ${issueKey} already has an active run`, code: 'CONFLICT' };
    }

    if (!force) {
      const successfulKeys = this.repository.getSuccessfulIssueKeys();
      if (successfulKeys.has(issueKey)) {
        return { error: `Issue ${issueKey} was previously completed successfully`, code: 'CONFLICT' };
      }
    }

    const contextFile = `/tmp/unshift_context_${randomUUID()}.json`;
    const fields: Pick<Run, "issueKey"> & Partial<Pick<Run, "repoPath" | "branchName" | "context" | "retryCount" | "sourceRunId">> = { issueKey };

    if (force) {
      fields.retryCount = this.repository.getRetryCount(issueKey);
      const previousRuns = this.repository.getRunsByIssueKey(issueKey);
      const previousSuccessful = previousRuns.find(r => r.status === "success");
      if (previousSuccessful) {
        fields.sourceRunId = previousSuccessful.id;
      }
    }

    return this.registerAndSpawn(fields, contextFile);
  }

  /** Discover issues and start a run for each new one */
  async startRuns(): Promise<{ runs: Run[]; errors: string[]; skipped: { issueKey: string; reason: string }[] }> {
    const keys = await this.discover();
    const successfulKeys = this.repository.getSuccessfulIssueKeys();
    const runs: Run[] = [];
    const errors: string[] = [];
    const skipped: { issueKey: string; reason: string }[] = [];

    for (const key of keys) {
      if (successfulKeys.has(key)) {
        const reason = `Issue ${key} was previously completed successfully`;
        skipped.push({ issueKey: key, reason });
        console.log(`Skipping ${key}: ${reason}`);
        continue;
      }
      const result = this.startRun(key);
      if (isRunError(result)) {
        errors.push(result.error);
      } else {
        runs.push(result);
      }
    }

    if (skipped.length > 0) {
      this.emit("run:skipped", skipped);
    }

    return { runs, errors, skipped };
  }

  /** Retry a run that is in a terminal state (rejected, failed, or stopped process) */
  async retryRun(id: string): Promise<Run | RunError> {
    const sourceRun = this.repository.getRun(id);
    if (!sourceRun) {
      return { error: "Run not found", code: 'NOT_FOUND' };
    }

    if (!isTerminal(sourceRun.status)) {
      return { error: `Run is not in a terminal state (status: ${sourceRun.status})`, code: 'INVALID_STATE' };
    }

    // If the run was stopped before context was built, start a fresh run
    if (!sourceRun.context) {
      return this.startRun(sourceRun.issueKey);
    }

    if (this.activeIssueKeys.has(sourceRun.issueKey)) {
      return { error: `Issue ${sourceRun.issueKey} already has an active run`, code: 'CONFLICT' };
    }

    const contextFile = `/tmp/unshift_context_${randomUUID()}.json`;

    // Reserve the issue key before the async writeFile to prevent races.
    // registerAndSpawn will overwrite the value with the real new run ID.
    this.activeIssueKeys.set(sourceRun.issueKey, id);

    const contextFileData = this.serializeContext(sourceRun.context);
    try {
      await writeFile(contextFile, JSON.stringify(contextFileData, null, 2));
    } catch (err) {
      this.activeIssueKeys.delete(sourceRun.issueKey);
      throw err;
    }

    return this.registerAndSpawn(
      {
        issueKey: sourceRun.issueKey,
        repoPath: sourceRun.repoPath,
        branchName: sourceRun.branchName,
        context: { ...sourceRun.context },
        retryCount: this.repository.getRetryCount(sourceRun.issueKey),
        sourceRunId: id,
      },
      contextFile,
      true,
    );
  }

  async stopRun(id: string): Promise<void> {
    const run = this.repository.getRun(id);
    if (!run) return;
    // Preserve context data before killing so retry can reuse it
    if (!run.context) {
      await this.readContextFile(run);
    }
    // Handle PTY-based runs
    if (this.ptyRuns.has(id)) {
      const pid = this.ptyManager.getPid(id);
      if (pid) {
        this.stoppingRuns.add(id);
        kill(pid);
      }
      return;
    }
    const proc = this.processes.get(id);
    if (proc?.pid) {
      // Mark as stopping; the process `close` handler will finalize status to "stopped"
      this.stoppingRuns.add(id);
      kill(proc.pid);
    } else if (!isCompleted(run.status)) {
      // No process found — mark as stopped and clean up so retry is possible
      const completedAt = new Date().toISOString();
      this.repository.updateRunStatus(id, "stopped", completedAt);
      this.emit("run:complete", run.id, "stopped");
      this.cleanupRun(id, run.issueKey);
    }
  }

  approveRun(id: string): { ok: true } | RunError {
    const run = this.repository.getRun(id);
    if (!run) return { error: "Run not found", code: "NOT_FOUND" };
    if (run.status !== "awaiting_approval") return { error: `Run is not awaiting approval (status: ${run.status})`, code: "INVALID_STATE" };
    // Resolve PID from either PTY or child_process
    const pid = this.ptyRuns.has(id) ? this.ptyManager.getPid(id) : this.processes.get(id)?.pid;
    if (!pid) return { error: "Process not found or has no PID", code: "INVALID_STATE" };
    try {
      process.kill(-pid, "SIGCONT");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`Failed to send SIGCONT to process group -${pid}: ${msg}`);
      return { error: `Failed to resume process: ${msg}`, code: "INVALID_STATE" };
    }
    const ts = new Date().toISOString();
    this.repository.updateRunStatus(run.id, "phase3");
    this.repository.updatePhaseTimestamp(run.id, "phase3", ts);
    this.emit("run:phase", run.id, "phase3", ts);
    return { ok: true };
  }

  deleteRun(id: string): { ok: true } | RunError {
    const run = this.repository.getRun(id);
    if (!run) return { error: "Run not found", code: "NOT_FOUND" };
    if (this.processes.has(id) || this.ptyRuns.has(id)) return { error: "Cannot delete an active run", code: "INVALID_STATE" };
    this.activeIssueKeys.delete(run.issueKey);
    this.contextFiles.delete(id);
    this.stoppingRuns.delete(id);
    this.repository.deleteRun(id);
    this.emit("run:deleted", id);
    return { ok: true };
  }

  async rejectRun(id: string): Promise<{ ok: true } | RunError> {
    const run = this.repository.getRun(id);
    if (!run) return { error: "Run not found", code: "NOT_FOUND" };
    if (run.status !== "awaiting_approval") return { error: `Run is not awaiting approval (status: ${run.status})`, code: "INVALID_STATE" };
    // Preserve context data before cleanup so retry can reuse it
    if (!run.context) {
      await this.readContextFile(run);
    }
    const completedAt = new Date().toISOString();
    this.repository.updateRunStatus(run.id, "rejected", completedAt);
    this.emit("run:complete", run.id, "rejected");
    if (this.ptyRuns.has(id)) {
      const pid = this.ptyManager.getPid(id);
      if (pid) {
        try { process.kill(-pid, "SIGCONT"); } catch {}
        kill(pid);
      }
    } else {
      const proc = this.processes.get(id);
      if (proc?.pid) {
        try { process.kill(-proc.pid, "SIGCONT"); } catch {}
        kill(proc.pid);
      }
    }
    this.cleanupRun(id, run.issueKey);
    return { ok: true };
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

    const handleLine = this.createLineHandler(run);

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
      this.handleProcessExit(run, code ?? 1);
    });
  }

  private spawnWithPty(run: Run, contextFile: string, retry = false): void {
    const args = retry
      ? [this.scriptPath, "--retry", "--issue", run.issueKey]
      : [this.scriptPath, "--issue", run.issueKey];

    this.ptyRuns.add(run.id);

    let lineBuf = "";
    const handleLine = this.createLineHandler(run);

    const ptyTerm = this.ptyManager.spawn(
      run.id,
      "bash",
      args,
      path.dirname(this.scriptPath),
      { UNSHIFT_CONTEXT_FILE: contextFile },
    );

    // Listen for PTY output — emit terminal data and parse lines for log/phase tracking
    const onOutput = (id: string, data: string) => {
      if (id !== run.id) return;
      this.emit("terminal:output", run.id, data);

      // Parse lines for the log pipeline
      lineBuf += data;
      const lines = lineBuf.split("\n");
      lineBuf = lines.pop()!;
      for (const line of lines) {
        // Strip ANSI escape sequences for log parsing
        handleLine(stripAnsi(line));
      }
    };
    this.ptyManager.on("output", onOutput);

    const onExit = (id: string, exitCode: number) => {
      if (id !== run.id) return;
      // Remove listeners to prevent accumulation across runs
      this.ptyManager.removeListener("output", onOutput);
      this.ptyManager.removeListener("exit", onExit);
      // Flush remaining line buffer
      if (lineBuf) {
        handleLine(stripAnsi(lineBuf));
        lineBuf = "";
      }
      this.handleProcessExit(run, exitCode, () => this.ptyRuns.delete(run.id));
    };
    this.ptyManager.on("exit", onExit);
  }

  /** Common handler for process close/exit — captures context & progress, finalizes status, and cleans up */
  private handleProcessExit(run: Run, exitCode: number, extraCleanup?: () => void): void {
    const finish = () => {
      const currentRun = this.repository.getRun(run.id);
      const currentStatus = currentRun?.status ?? run.status;
      if (!isCompleted(currentStatus)) {
        const wasStopping = this.stoppingRuns.delete(run.id);
        const status = wasStopping ? "stopped" : exitCode === 0 ? "success" : "failed";
        const completedAt = new Date().toISOString();
        this.repository.updateRunStatus(run.id, status, completedAt);
        this.emit("run:complete", run.id, status);
      } else {
        this.stoppingRuns.delete(run.id);
      }
      extraCleanup?.();
      this.cleanupRun(run.id, run.issueKey);
    };

    const captureAndFinish = () => {
      this.readProgressFile(run).catch(() => {}).finally(finish);
    };

    const currentRun = this.repository.getRun(run.id);
    const closingStatus = currentRun?.status ?? run.status;
    const failed = exitCode !== 0 && !isCompleted(closingStatus);
    if (failed && !run.context) {
      this.readContextFile(run).catch(() => {}).finally(captureAndFinish);
    } else {
      captureAndFinish();
    }
  }

  /** Check if a run is using PTY mode */
  hasPty(id: string): boolean {
    return this.ptyRuns.has(id);
  }

  /** Create a line handler for a run that parses phases, logs, and token updates */
  private createLineHandler(run: Run): (line: string) => void {
    return (line: string) => {
      this.parseLine(run, line);
      this.repository.appendLog(run.id, run.status, line);
      this.emit("run:log", run.id, line, run.status);

      const tokenUpdate = parseTokenLine(line);
      if (tokenUpdate) {
        const tokens = this.repository.updateTokens(run.id, tokenUpdate);
        this.emit("run:tokens", run.id, tokens);
      }
    };
  }

  private cleanupRun(id: string, issueKey: string): void {
    if (this.activeIssueKeys.get(issueKey) === id) {
      this.activeIssueKeys.delete(issueKey);
    }
    this.processes.delete(id);
    const contextFile = this.contextFiles.get(id);
    if (contextFile) {
      // Only delete the context file on success; keep it for failed/stopped/rejected
      // runs so retry has a fallback if in-memory context was not captured
      const run = this.repository.getRun(id);
      if (run?.status === "success") {
        unlink(contextFile).catch(() => {});
      }
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
      const ts = new Date().toISOString();
      this.repository.updateRunStatus(run.id, "phase0");
      this.repository.updatePhaseTimestamp(run.id, "phase0", ts);
      this.emit("run:phase", run.id, "phase0", ts);
    }

    // Issue discovery: "Processing issue: SSCUI-81" or "Retrying issue: SSCUI-81"
    const issueMatch = line.match(/(?:Processing|Retrying) issue:\s+(\S+)/);
    if (issueMatch) {
      run.issueKey = issueMatch[1];
      this.repository.updateRun(run.id, { issueKey: issueMatch[1] });
    }

    // Phase 1
    if (line.includes("Phase 1:")) {
      run.status = "phase1";
      const ts = new Date().toISOString();
      this.repository.updateRunStatus(run.id, "phase1");
      this.repository.updatePhaseTimestamp(run.id, "phase1", ts);
      this.emit("run:phase", run.id, "phase1", ts);
    }

    // Phase 1 complete: "Phase 1 complete. Repo: /path, Branch: branch-name"
    const p1Complete = line.match(
      /Phase 1 complete\. Repo:\s+(\S+),\s+Branch:\s+(\S+)/
    );
    if (p1Complete) {
      run.repoPath = p1Complete[1];
      run.branchName = p1Complete[2];
      this.repository.updateRun(run.id, { repoPath: p1Complete[1], branchName: p1Complete[2] });
      this.readContextFile(run);
    }

    // Phase 2
    if (line.includes("Phase 2:")) {
      run.status = "phase2";
      const ts = new Date().toISOString();
      this.repository.updateRunStatus(run.id, "phase2");
      this.repository.updatePhaseTimestamp(run.id, "phase2", ts);
      this.emit("run:phase", run.id, "phase2", ts);
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

    // Phase 2 complete  - read final prd.json state
    if (line.includes("Phase 2 complete")) {
      if (run.repoPath) {
        this.readPrdFile(run);
        this.readProgressFile(run);
      }
    }

    // Phase 3  - the script self-pauses (kill -STOP $$) after printing this line,
    // so we only need to transition to awaiting_approval. The dashboard sends
    // SIGCONT when the user approves.
    if (line.includes("Phase 3:")) {
      run.status = "awaiting_approval";
      const ts = new Date().toISOString();
      this.repository.updateRunStatus(run.id, "awaiting_approval");
      this.repository.updatePhaseTimestamp(run.id, "awaiting_approval", ts);
      this.emit("run:phase", run.id, "awaiting_approval", ts);
    }
  }

  /** Mapping from RunContext camelCase keys to snake_case context file keys.
   *  Typed as Record<keyof RunContext, string> so adding a field to RunContext
   *  without updating this map is a compile error. */
  private static readonly CONTEXT_KEYS: Record<keyof RunContext, string> = {
    issueKey: "issue_key",
    summary: "summary",
    repoPath: "repo_path",
    branchName: "branch_name",
    description: "description",
    issueType: "issue_type",
    defaultBranch: "default_branch",
    host: "host",
    commitPrefix: "commit_prefix",
  };

  private serializeContext(ctx: RunContext): Record<string, string | undefined> {
    const result: Record<string, string | undefined> = {};
    for (const [camel, snake] of Object.entries(UnshiftRunner.CONTEXT_KEYS)) {
      result[snake] = ctx[camel as keyof RunContext];
    }
    return result;
  }

  private deserializeContext(raw: Record<string, unknown>, run: Run): RunContext {
    const mapped: Partial<RunContext> = {};
    for (const [camel, snake] of Object.entries(UnshiftRunner.CONTEXT_KEYS)) {
      const value = raw[snake];
      if (typeof value === "string") {
        (mapped as Record<string, string>)[camel] = value;
      }
    }
    return {
      ...mapped,
      issueKey: mapped.issueKey ?? run.issueKey,
      summary: mapped.summary ?? "",
      repoPath: mapped.repoPath ?? run.repoPath ?? "",
      branchName: mapped.branchName ?? run.branchName ?? "",
    };
  }

  private async readContextFile(run: Run): Promise<void> {
    const contextPath = this.contextFiles.get(run.id);
    if (!contextPath) {
      console.warn(`No context file path registered for run ${run.id}`);
      return;
    }
    try {
      const raw = await readFile(contextPath, "utf-8");
      const ctx: Record<string, unknown> = JSON.parse(raw);
      run.context = this.deserializeContext(ctx, run);
      this.repository.updateRun(run.id, { context: run.context });
      this.emit("run:context", run.id, run.context);
    } catch (err: unknown) {
      const code = typeof err === "object" && err !== null && "code" in err ? (err as { code: string }).code : undefined;
      if (code !== "ENOENT") {
        console.warn(`Failed to read context file for run ${run.id} at ${contextPath}:`, err);
      }
    }
  }

  private async readProgressFile(run: Run): Promise<void> {
    if (!run.repoPath) return;
    const progressPath = path.join(run.repoPath, "progress.txt");
    try {
      const content = await readFile(progressPath, "utf-8");
      this.repository.saveProgressTxt(run.id, content);
      this.emit("run:progress", run.id, content);
    } catch {
      // progress.txt may not exist yet; skip silently
    }
  }

  private async readPrdFile(run: Run): Promise<void> {
    if (!run.repoPath) return;
    const prdPath = path.join(run.repoPath, "prd.json");
    try {
      const raw = await readFile(prdPath, "utf-8");
      const entries: PrdEntry[] = JSON.parse(raw);
      run.prd = entries;
      this.repository.savePrd(run.id, entries);
      this.emit("run:prd", run.id, entries);
    } catch {
      // prd.json may not exist yet; skip silently
    }
  }
}

/** Strip ANSI escape sequences from a string for clean log parsing */
function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "").replace(/\x1b\][^\x07]*\x07/g, "");
}
