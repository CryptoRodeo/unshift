import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import type { RunContext, Run, RunError, PrdEntry, LogEntry, RunPhase, TokenData, Comment } from "../../shared/types";
import { isTerminal, isCompleted, isRunError } from "../../shared/types";
import { RunRepository } from "./runRepository";
import { UnshiftEngine, type EngineRunOptions } from "./engine/orchestrator";
import { getModel, getDefaultConfig, type ProviderConfig } from "./engine/providers";

/**
 * Manages Jira-issue runs using the UnshiftEngine (Vercel AI SDK agentic loop)
 * instead of spawning shell processes.
 */
const WORKSPACE_DIR = process.env.WORKSPACE_DIR || "/app/workspace";
const WORKTREE_TTL_HOURS = parseInt(process.env.WORKTREE_TTL_HOURS || "24", 10);

export class UnshiftRunner extends EventEmitter {
  private abortControllers = new Map<string, AbortController>();
  /** Maps issueKey → owning runId to prevent duplicate runs */
  private activeIssueKeys = new Map<string, string>();
  private repository = new RunRepository();
  private engine = new UnshiftEngine();
  private cleanupInterval: ReturnType<typeof setInterval> | undefined;

  constructor() {
    super();

    // Rebuild activeIssueKeys from DB for runs that survived a restart
    for (const run of this.repository.listRuns()) {
      if (!isCompleted(run.status)) {
        this.activeIssueKeys.set(run.issueKey, run.id);
      }
    }

    // Run initial worktree TTL cleanup and schedule hourly scans
    this.runWorktreeTtlCleanup();
    this.cleanupInterval = setInterval(() => this.runWorktreeTtlCleanup(), 60 * 60 * 1000);
    this.cleanupInterval.unref();
  }

  /** Stop the periodic worktree cleanup timer */
  stopCleanupTimer(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = undefined;
    }
  }

  /** Scan filesystem for worktrees whose runs exceeded the TTL and remove them */
  private runWorktreeTtlCleanup(): void {
    try {
      if (!fs.existsSync(WORKSPACE_DIR)) return;

      const ttlMs = WORKTREE_TTL_HOURS * 60 * 60 * 1000;
      const now = Date.now();

      // Scan workspace/<repo>/.worktrees/<runId> directories
      for (const repoDir of fs.readdirSync(WORKSPACE_DIR, { withFileTypes: true })) {
        if (!repoDir.isDirectory()) continue;
        const worktreesDir = path.join(WORKSPACE_DIR, repoDir.name, ".worktrees");
        if (!fs.existsSync(worktreesDir)) continue;

        for (const wtDir of fs.readdirSync(worktreesDir, { withFileTypes: true })) {
          if (!wtDir.isDirectory()) continue;
          const runId = wtDir.name;
          const worktreePath = path.join(worktreesDir, runId);

          const run = this.repository.getRun(runId);
          if (!run) {
            // Orphaned worktree with no DB entry — remove it
            console.log(`Removing orphaned worktree: ${worktreePath}`);
            fs.rmSync(worktreePath, { recursive: true, force: true });
            continue;
          }

          if (!isTerminal(run.status) && run.status !== "success") continue;

          const completedAt = run.completedAt ? new Date(run.completedAt).getTime() : 0;
          if (completedAt > 0 && now - completedAt > ttlMs) {
            console.log(`TTL expired for run ${runId}, removing worktree: ${worktreePath}`);
            fs.rmSync(worktreePath, { recursive: true, force: true });
          }
        }
      }
    } catch (e) {
      console.warn("Worktree TTL cleanup scan failed:", e);
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

  addComment(runId: string, content: string): Comment | RunError {
    const run = this.repository.getRun(runId);
    if (!run) return { error: "Run not found", code: "NOT_FOUND" };
    return this.repository.addComment(runId, "user", content);
  }

  getComments(runId: string): Comment[] {
    return this.repository.getComments(runId);
  }

  /** Returns the worktree path for a run from the engine's in-memory map */
  getWorktreePath(runId: string): string | undefined {
    return this.engine.getWorktreePath(runId);
  }

  /** Explicitly clean up a run's worktree (for the cleanup API endpoint) */
  async cleanupRunWorktree(runId: string): Promise<void> {
    await this.engine.cleanupRun(runId);
  }

  /** Get project summaries (unique issue keys with aggregated metadata) */
  getProjectSummaries() {
    return this.repository.getProjectSummaries();
  }

  /** Fetch a Jira issue's live status */
  async getJiraIssueStatus(issueKey: string): Promise<{ status: string }> {
    const issue = await this.engine.getJiraIssue(issueKey);
    return { status: issue.status };
  }

  /** Fetch full Jira issue details */
  async getFullJiraIssue(issueKey: string) {
    return this.engine.getFullJiraIssue(issueKey);
  }

  /** Fetch Jira issue comments */
  async getJiraIssueComments(issueKey: string, maxResults?: number) {
    return this.engine.getJiraIssueComments(issueKey, maxResults);
  }

  /** Files excluded from diffs (generated artifacts, not part of the deliverable) */
  private static readonly DIFF_EXCLUDE_PATHS = [":!prd.json", ":!progress.txt", ":!ralph.sh"];

  /** Persist the current worktree diff to DB so it survives worktree cleanup / container restarts */
  private async persistDiff(runId: string): Promise<void> {
    const run = this.repository.getRun(runId);
    if (!run?.repoPath || !run.context?.defaultBranch || !fs.existsSync(run.repoPath)) return;

    try {
      const { execCommand } = await import("./engine/tools.js");
      const result = await execCommand(
        "git",
        ["diff", `origin/${run.context.defaultBranch}`, "--", ".", ...UnshiftRunner.DIFF_EXCLUDE_PATHS],
        { cwd: run.repoPath, timeout: 30_000 }
      );
      if (result.exitCode === 0 && result.stdout) {
        this.capAndCacheDiff(runId, result.stdout);
      }
    } catch (e) {
      console.warn(`Failed to persist diff for run ${runId}:`, e);
    }
  }

  /** Get the git diff for a run — live from worktree, main clone, or DB cache */
  async getRunDiff(id: string): Promise<{ diff: string | null }> {
    const run = this.repository.getRun(id);
    if (!run) return { diff: null };

    const { execCommand } = await import("./engine/tools.js");
    const defaultBranch = run.context?.defaultBranch;

    // Try live diff from worktree (committed changes only, excludes generated files)
    if (run.repoPath && defaultBranch && fs.existsSync(run.repoPath)) {
      const result = await execCommand(
        "git",
        ["diff", `origin/${defaultBranch}`, "--", ".", ...UnshiftRunner.DIFF_EXCLUDE_PATHS],
        { cwd: run.repoPath, timeout: 30_000 }
      );
      if (result.exitCode === 0 && result.stdout) {
        return { diff: this.capAndCacheDiff(id, result.stdout) };
      }
      console.warn(`Diff tier 1 (worktree) failed for run ${id}: exit=${result.exitCode}, stdout=${result.stdout?.length ?? 0}B, stderr=${result.stderr || "(none)"}`);
    }

    // Worktree is gone — try diffing the branch from the main clone
    if (run.branchName && defaultBranch && run.repoPath) {
      const mainClone = path.resolve(run.repoPath, "..", "..");
      if (fs.existsSync(mainClone)) {
        const result = await execCommand(
          "git",
          ["diff", `origin/${defaultBranch}...${run.branchName}`, "--", ".", ...UnshiftRunner.DIFF_EXCLUDE_PATHS],
          { cwd: mainClone, timeout: 30_000 }
        );
        if (result.exitCode === 0 && result.stdout) {
          return { diff: this.capAndCacheDiff(id, result.stdout) };
        }
        console.warn(`Diff tier 2 (main clone) failed for run ${id}: exit=${result.exitCode}, stdout=${result.stdout?.length ?? 0}B, stderr=${result.stderr || "(none)"}`);
      }
    }

    // Fall back to persisted diff
    const cached = this.repository.getDiff(id);
    return { diff: cached ?? null };
  }

  private capAndCacheDiff(runId: string, raw: string): string {
    const MAX_DIFF_SIZE = 512_000; // 500KB
    let diff = raw;
    if (diff.length > MAX_DIFF_SIZE) {
      diff = diff.slice(0, MAX_DIFF_SIZE) + "\n\n… diff truncated (exceeded 500KB)";
    }
    this.repository.saveDiff(runId, diff);
    return diff;
  }

  /** Discover llm-candidate issues via Jira JQL */
  async discover(): Promise<string[]> {
    return this.engine.discover();
  }

  /** Start a run for a single Jira issue */
  startRun(issueKey: string, force = false, providerConfig?: ProviderConfig): Run | RunError {
    if (this.activeIssueKeys.has(issueKey)) {
      return { error: `Issue ${issueKey} already has an active run`, code: 'CONFLICT' };
    }

    if (!force) {
      const successfulKeys = this.repository.getSuccessfulIssueKeys();
      if (successfulKeys.has(issueKey)) {
        return { error: `Issue ${issueKey} was previously completed successfully`, code: 'CONFLICT' };
      }
    }

    const run: Run = {
      id: randomUUID(),
      issueKey,
      status: "pending",
      startedAt: new Date().toISOString(),
      prd: [],
      logs: [],
      retryCount: force ? this.repository.getRetryCount(issueKey) : undefined,
    };

    if (force) {
      const previousRuns = this.repository.getRunsByIssueKey(issueKey);
      const previousSuccessful = previousRuns.find(r => r.status === "success");
      if (previousSuccessful) {
        run.sourceRunId = previousSuccessful.id;
      }
    }

    this.repository.createRun(run);
    this.activeIssueKeys.set(run.issueKey, run.id);
    this.emit("run:created", run);

    // Launch the engine run asynchronously
    this.launchEngineRun(run.id, issueKey, providerConfig);

    return run;
  }

  /** Discover issues and start a run for each new one */
  async startRuns(
    providerConfig?: ProviderConfig,
    overrides?: Record<string, ProviderConfig>,
  ): Promise<{ runs: Run[]; errors: string[]; skipped: { issueKey: string; reason: string }[] }> {
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
      const issueConfig = overrides?.[key] ?? providerConfig;
      const result = this.startRun(key, false, issueConfig);
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

  /** Retry a run that is in a terminal state */
  async retryRun(id: string, providerConfig?: ProviderConfig): Promise<Run | RunError> {
    const sourceRun = this.repository.getRun(id);
    if (!sourceRun) {
      return { error: "Run not found", code: 'NOT_FOUND' };
    }

    if (!isTerminal(sourceRun.status)) {
      return { error: `Run is not in a terminal state (status: ${sourceRun.status})`, code: 'INVALID_STATE' };
    }

    // If the run was stopped before context was built, start a fresh run
    if (!sourceRun.context) {
      return this.startRun(sourceRun.issueKey, true, providerConfig);
    }

    if (this.activeIssueKeys.has(sourceRun.issueKey)) {
      return { error: `Issue ${sourceRun.issueKey} already has an active run`, code: 'CONFLICT' };
    }

    const run: Run = {
      id: randomUUID(),
      issueKey: sourceRun.issueKey,
      status: "pending",
      startedAt: new Date().toISOString(),
      repoPath: sourceRun.repoPath,
      branchName: sourceRun.branchName,
      context: { ...sourceRun.context },
      prd: [],
      logs: [],
      retryCount: this.repository.getRetryCount(sourceRun.issueKey),
      sourceRunId: id,
    };

    this.repository.createRun(run);
    this.activeIssueKeys.set(run.issueKey, run.id);
    this.emit("run:created", run);

    // For retry, we have context already — launch from phase2 onward
    this.launchEngineRetry(run.id, sourceRun.context, sourceRun.prd, providerConfig);

    return run;
  }

  async stopRun(id: string): Promise<void> {
    const run = this.repository.getRun(id);
    if (!run) return;

    const controller = this.abortControllers.get(id);
    if (controller) {
      controller.abort();
      // The engine run promise will handle finalization via its catch/finally
    } else if (!isCompleted(run.status)) {
      const completedAt = new Date().toISOString();
      this.repository.updateRunStatus(id, "stopped", completedAt);
      this.emit("run:complete", run.id, "stopped");
      await this.engine.cleanupRun(id);
      this.cleanupRun(id, run.issueKey);
    }
  }

  async approveRun(id: string, providerConfig?: ProviderConfig): Promise<{ ok: true } | RunError> {
    const run = this.repository.getRun(id);
    if (!run) return { error: "Run not found", code: "NOT_FOUND" };
    if (run.status !== "awaiting_approval") return { error: `Run is not awaiting approval (status: ${run.status})`, code: "INVALID_STATE" };

    // Re-persist diff to capture any manual edits made in VSCode
    await this.persistDiff(id);

    const approved = this.engine.approve(id);
    if (!approved) {
      // Gate lost (e.g. container restart) — resume phase 3 from persisted state
      if (!run.context) return { error: "No context available to resume phase 3", code: "INVALID_STATE" };
      this.launchPhase3(id, run.context, providerConfig);
    }

    return { ok: true };
  }

  async deleteRun(id: string): Promise<{ ok: true } | RunError> {
    const run = this.repository.getRun(id);
    if (!run) return { error: "Run not found", code: "NOT_FOUND" };
    if (this.abortControllers.has(id)) return { error: "Cannot delete an active run", code: "INVALID_STATE" };
    await this.engine.cleanupRun(id);
    this.activeIssueKeys.delete(run.issueKey);
    this.repository.deleteRun(id);
    this.emit("run:deleted", id);
    return { ok: true };
  }

  async rejectRun(id: string): Promise<{ ok: true } | RunError> {
    const run = this.repository.getRun(id);
    if (!run) return { error: "Run not found", code: "NOT_FOUND" };
    if (run.status !== "awaiting_approval") return { error: `Run is not awaiting approval (status: ${run.status})`, code: "INVALID_STATE" };

    const completedAt = new Date().toISOString();
    this.repository.updateRunStatus(run.id, "rejected", completedAt);
    this.emit("run:complete", run.id, "rejected");

    // Reject the approval gate (causes the engine runIssue to throw)
    this.engine.reject(id);

    // Also abort the engine run
    const controller = this.abortControllers.get(id);
    if (controller) {
      controller.abort();
    }

    this.cleanupRun(id, run.issueKey);
    return { ok: true };
  }

  private cleanupRun(id: string, issueKey: string): void {
    if (this.activeIssueKeys.get(issueKey) === id) {
      this.activeIssueKeys.delete(issueKey);
    }
    this.abortControllers.delete(id);
  }

  /** Launch a full engine run (phase1 → phase2 → approval → phase3) */
  private launchEngineRun(runId: string, issueKey: string, providerConfig?: ProviderConfig): void {
    this.launchWithErrorHandling(runId, issueKey, providerConfig, async (opts) => {
      const repoEntry = await this.engine.resolveRepo(issueKey);
      await this.engine.runIssue(issueKey, repoEntry, opts);
    });
  }

  /** Launch an engine retry (phase2 → approval → phase3 using existing context) */
  private launchEngineRetry(runId: string, context: RunContext, prd: PrdEntry[], providerConfig?: ProviderConfig): void {
    this.launchWithErrorHandling(runId, context.issueKey, providerConfig, async (opts) => {
      await this.engine.runFromPhase2(context, prd, opts);
    });
  }

  /** Launch phase 3 directly (used to resume after container restart loses the approval gate) */
  private launchPhase3(runId: string, context: RunContext, providerConfig?: ProviderConfig): void {
    this.launchWithErrorHandling(runId, context.issueKey, providerConfig, async (opts) => {
      await this.engine.runPhase3(context, opts);
    });
  }

  /**
   * Shared wrapper for launching async engine work with consistent
   * abort handling, error finalization, and cleanup.
   */
  private launchWithErrorHandling(
    runId: string,
    issueKey: string,
    providerConfig: ProviderConfig | undefined,
    work: (opts: EngineRunOptions) => Promise<void>
  ): void {
    const controller = new AbortController();
    this.abortControllers.set(runId, controller);

    const config = providerConfig ?? getDefaultConfig();
    const model = getModel(config);
    const opts: EngineRunOptions = { model, signal: controller.signal, runId };

    // Persist the model name immediately so the UI can show it before tokens arrive
    this.repository.updateTokens(runId, { model: config.model });
    this.emit("run:tokens", runId, { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, model: config.model });

    const cleanup = this.wireEngineEvents(runId);

    work(opts).then(async () => {
      // Persist diff before worktree cleanup so it survives container restarts
      await this.persistDiff(runId);
      const completedAt = new Date().toISOString();
      this.repository.updateRunStatus(runId, "success", completedAt);
      this.emit("run:complete", runId, "success");
    }).catch((err: unknown) => {
      const currentRun = this.repository.getRun(runId);
      const currentStatus = currentRun?.status;
      if (currentStatus && isCompleted(currentStatus)) return;

      const isAborted = (err instanceof Error && err.name === "AbortError") || controller.signal.aborted;
      const status = isAborted ? "stopped" : "failed";
      const completedAt = new Date().toISOString();
      this.repository.updateRunStatus(runId, status, completedAt);
      this.emit("run:complete", runId, status);

      if (!isAborted) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`Run ${runId} failed:`, msg);
        this.repository.appendLog(runId, "failed", msg);
      }
    }).finally(() => {
      const finalRun = this.repository.getRun(runId);
      const finalStatus = finalRun?.status;

      // Keep worktree on disk for awaiting_approval and success so users can open in VSCode
      const shouldKeepWorktree = finalStatus === "awaiting_approval" || finalStatus === "success";

      const afterCleanup = () => {
        cleanup();
        this.cleanupRun(runId, issueKey);
      };

      if (shouldKeepWorktree) {
        afterCleanup();
      } else {
        this.engine.cleanupRun(runId).catch((e) => {
          console.warn(`Failed to clean up worktree for run ${runId}:`, e);
        }).finally(afterCleanup);
      }
    });
  }

  /** Wire engine events for a specific run to this runner's EventEmitter + repository */
  private wireEngineEvents(runId: string): () => void {
    const onPhase = (id: string, phase: RunPhase, ts: string) => {
      if (id !== runId) return;
      this.repository.updateRunStatus(id, phase);
      this.repository.updatePhaseTimestamp(id, phase, ts);
      this.emit("run:phase", id, phase, ts);

      // Persist the diff when entering approval so it survives container restarts
      if (phase === "awaiting_approval") {
        this.persistDiff(id).catch((e) =>
          console.warn(`Failed to persist diff on approval for run ${id}:`, e)
        );
      }
    };

    const onLog = (id: string, line: string, phase: RunPhase) => {
      if (id !== runId) return;
      this.repository.appendLog(id, phase, line);
      this.emit("run:log", id, line, phase);
    };

    const onContext = (id: string, context: RunContext) => {
      if (id !== runId) return;
      this.repository.updateRun(id, { context, repoPath: context.repoPath, branchName: context.branchName });
      this.emit("run:context", id, context);
    };

    const onPrd = (id: string, prd: PrdEntry[]) => {
      if (id !== runId) return;
      this.repository.savePrd(id, prd);
      this.emit("run:prd", id, prd);
    };

    const onTokens = (id: string, tokens: TokenData) => {
      if (id !== runId) return;
      const updated = this.repository.updateTokens(id, tokens);
      this.emit("run:tokens", id, updated);
    };

    const onProgress = (id: string, content: string) => {
      if (id !== runId) return;
      this.repository.saveProgressTxt(id, content);
      this.emit("run:progress", id, content);
    };

    this.engine.on("run:phase", onPhase);
    this.engine.on("run:log", onLog);
    this.engine.on("run:context", onContext);
    this.engine.on("run:prd", onPrd);
    this.engine.on("run:tokens", onTokens);
    this.engine.on("run:progress", onProgress);

    return () => {
      this.engine.removeListener("run:phase", onPhase);
      this.engine.removeListener("run:log", onLog);
      this.engine.removeListener("run:context", onContext);
      this.engine.removeListener("run:prd", onPrd);
      this.engine.removeListener("run:tokens", onTokens);
      this.engine.removeListener("run:progress", onProgress);
    };
  }
}
