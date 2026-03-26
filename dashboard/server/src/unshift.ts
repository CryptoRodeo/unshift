import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";

import type { RunContext, Run, RunError, PrdEntry, LogEntry, RunPhase, TokenData } from "../../shared/types";
import { isTerminal, isCompleted, isRunError } from "../../shared/types";
import { RunRepository } from "./runRepository";
import { UnshiftEngine, type EngineRunOptions } from "./engine/orchestrator";
import { getModel, getDefaultConfig, type ProviderConfig } from "./engine/providers";

/**
 * Manages Jira-issue runs using the UnshiftEngine (Vercel AI SDK agentic loop)
 * instead of spawning shell processes.
 */
export class UnshiftRunner extends EventEmitter {
  private abortControllers = new Map<string, AbortController>();
  /** Maps issueKey → owning runId to prevent duplicate runs */
  private activeIssueKeys = new Map<string, string>();
  private repository = new RunRepository();
  private engine = new UnshiftEngine();

  constructor() {
    super();

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
  async startRuns(providerConfig?: ProviderConfig): Promise<{ runs: Run[]; errors: string[]; skipped: { issueKey: string; reason: string }[] }> {
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
      const result = this.startRun(key, false, providerConfig);
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

  approveRun(id: string): { ok: true } | RunError {
    const run = this.repository.getRun(id);
    if (!run) return { error: "Run not found", code: "NOT_FOUND" };
    if (run.status !== "awaiting_approval") return { error: `Run is not awaiting approval (status: ${run.status})`, code: "INVALID_STATE" };

    const approved = this.engine.approve(id);
    if (!approved) return { error: "No approval gate found for this run", code: "INVALID_STATE" };

    // Status transition to phase3 is handled by the engine emitting run:phase,
    // which wireEngineEvents picks up and persists to the repository.
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

    const cleanup = this.wireEngineEvents(runId);

    work(opts).then(() => {
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
      this.engine.cleanupRun(runId).catch((e) => {
        console.warn(`Failed to clean up worktree for run ${runId}:`, e);
      }).finally(() => {
        cleanup();
        this.cleanupRun(runId, issueKey);
      });
    });
  }

  /** Wire engine events for a specific run to this runner's EventEmitter + repository */
  private wireEngineEvents(runId: string): () => void {
    const onPhase = (id: string, phase: RunPhase, ts: string) => {
      if (id !== runId) return;
      this.repository.updateRunStatus(id, phase);
      this.repository.updatePhaseTimestamp(id, phase, ts);
      this.emit("run:phase", id, phase, ts);
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
