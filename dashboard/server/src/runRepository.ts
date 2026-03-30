import type Database from "better-sqlite3";
import { getDb } from "./db";
import type { Run, RunPhase, PrdEntry, LogEntry, TokenData, Comment, ProjectSummary } from "../../shared/types";

function safeParse<T>(json: string | null, fallback: T): T {
  if (!json) return fallback;
  try { return JSON.parse(json); } catch { return fallback; }
}

export class RunRepository {
  private db: Database.Database | null = null;
  private stmts: ReturnType<typeof this.prepareStatements> | null = null;

  private ensureInit() {
    if (!this.db) {
      this.db = getDb();
      this.stmts = this.prepareStatements(this.db);
    }
    return this.stmts!;
  }

  private prepareStatements(db: Database.Database) {
    return {
      insertRun: db.prepare(`
        INSERT INTO runs (id, issue_key, status, started_at, completed_at, repo_path, branch_name, pr_url, context_json, prd_json, retry_count, source_run_id)
        VALUES (@id, @issueKey, @status, @startedAt, @completedAt, @repoPath, @branchName, @prUrl, @contextJson, @prdJson, @retryCount, @sourceRunId)
      `),
      getRun: db.prepare(`SELECT * FROM runs WHERE id = ?`),
      listRuns: db.prepare(`SELECT * FROM runs ORDER BY started_at DESC`),
      updateRunStatus: db.prepare(`UPDATE runs SET status = @status, completed_at = @completedAt WHERE id = @id`),
      updateRun: db.prepare(`UPDATE runs SET issue_key = @issueKey, status = @status, started_at = @startedAt, completed_at = @completedAt, repo_path = @repoPath, branch_name = @branchName, pr_url = @prUrl, context_json = @contextJson, prd_json = @prdJson, retry_count = @retryCount, source_run_id = @sourceRunId WHERE id = @id`),
      insertLog: db.prepare(`INSERT INTO run_logs (run_id, phase, line) VALUES (?, ?, ?)`),
      getLogs: db.prepare(`SELECT phase, line FROM run_logs WHERE run_id = ? ORDER BY id`),
      getLogsSince: db.prepare(`SELECT id, phase, line FROM run_logs WHERE run_id = ? AND id > ? ORDER BY id`),
      getRunsByIssueKey: db.prepare(`SELECT * FROM runs WHERE issue_key = ? ORDER BY started_at DESC`),
      successfulKeys: db.prepare(`SELECT DISTINCT issue_key FROM runs WHERE status = 'success'`),
      retryCount: db.prepare(`SELECT COUNT(*) as count FROM runs WHERE issue_key = ?`),
      saveProgressTxt: db.prepare(`INSERT OR REPLACE INTO run_progress (run_id, content) VALUES (?, ?)`),
      getProgressTxt: db.prepare(`SELECT content FROM run_progress WHERE run_id = ?`),
      savePrdJson: db.prepare(`UPDATE runs SET prd_json = ? WHERE id = ?`),
      deleteRunLogs: db.prepare(`DELETE FROM run_logs WHERE run_id = ?`),
      deleteRunProgress: db.prepare(`DELETE FROM run_progress WHERE run_id = ?`),
      deleteRun: db.prepare(`DELETE FROM runs WHERE id = ?`),
      getPhaseTimestamps: db.prepare(`SELECT phase_timestamps_json FROM runs WHERE id = ?`),
      updatePhaseTimestamps: db.prepare(`UPDATE runs SET phase_timestamps_json = ? WHERE id = ?`),
      getTokens: db.prepare(`SELECT input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens, model FROM runs WHERE id = ?`),
      updateTokens: db.prepare(`UPDATE runs SET input_tokens = ?, output_tokens = ?, cache_read_tokens = ?, cache_creation_tokens = ?, model = ? WHERE id = ?`),
      insertComment: db.prepare(`INSERT INTO run_comments (run_id, author, content) VALUES (?, ?, ?)`),
      getComments: db.prepare(`SELECT id, run_id, author, content, created_at FROM run_comments WHERE run_id = ? ORDER BY created_at ASC`),
      getComment: db.prepare(`SELECT id, run_id, author, content, created_at FROM run_comments WHERE id = ?`),
      deleteRunComments: db.prepare(`DELETE FROM run_comments WHERE run_id = ?`),
      projectSummaries: db.prepare(`
        SELECT
          issue_key,
          context_json,
          COUNT(*) as run_count,
          MAX(started_at) as last_run_at,
          (SELECT r2.status FROM runs r2 WHERE r2.issue_key = runs.issue_key ORDER BY r2.started_at DESC LIMIT 1) as latest_status
        FROM runs
        GROUP BY issue_key
        ORDER BY last_run_at DESC
      `),
    };
  }

  createRun(run: Run): void {
    const s = this.ensureInit();
    s.insertRun.run({
      id: run.id,
      issueKey: run.issueKey,
      status: run.status,
      startedAt: run.startedAt,
      completedAt: run.completedAt ?? null,
      repoPath: run.repoPath ?? null,
      branchName: run.branchName ?? null,
      prUrl: run.prUrl ?? null,
      contextJson: run.context ? JSON.stringify(run.context) : null,
      prdJson: run.prd.length > 0 ? JSON.stringify(run.prd) : null,
      retryCount: run.retryCount ?? 0,
      sourceRunId: run.sourceRunId ?? null,
    });
  }

  getRun(id: string): Run | undefined {
    const s = this.ensureInit();
    const row = s.getRun.get(id) as RunRow | undefined;
    if (!row) return undefined;
    const logs = s.getLogs.all(id) as { phase: string; line: string }[];
    return this.rowToRun(row, logs);
  }

  listRuns(): Run[] {
    const s = this.ensureInit();
    const rows = s.listRuns.all() as RunRow[];
    return rows.map((row) => this.rowToRun(row, []));
  }

  updateRun(id: string, fields: Partial<Run>): void {
    const s = this.ensureInit();
    const existing = s.getRun.get(id) as RunRow | undefined;
    if (!existing) return;
    const current = this.rowToRun(existing, []);
    const merged = { ...current, ...fields };
    s.updateRun.run({
      id,
      issueKey: merged.issueKey,
      status: merged.status,
      startedAt: merged.startedAt,
      completedAt: merged.completedAt ?? null,
      repoPath: merged.repoPath ?? null,
      branchName: merged.branchName ?? null,
      prUrl: merged.prUrl ?? null,
      contextJson: merged.context ? JSON.stringify(merged.context) : null,
      prdJson: merged.prd.length > 0 ? JSON.stringify(merged.prd) : null,
      retryCount: merged.retryCount ?? 0,
      sourceRunId: merged.sourceRunId ?? null,
    });
  }

  updateRunStatus(id: string, status: RunPhase, completedAt?: string): void {
    const s = this.ensureInit();
    s.updateRunStatus.run({ id, status, completedAt: completedAt ?? null });
  }

  getRunsByIssueKey(issueKey: string): Run[] {
    const s = this.ensureInit();
    const rows = s.getRunsByIssueKey.all(issueKey) as RunRow[];
    return rows.map((row) => this.rowToRun(row, []));
  }

  appendLog(runId: string, phase: RunPhase, line: string): void {
    const s = this.ensureInit();
    s.insertLog.run(runId, phase, line);
  }

  savePrd(runId: string, entries: PrdEntry[]): void {
    const s = this.ensureInit();
    s.savePrdJson.run(JSON.stringify(entries), runId);
  }

  saveProgressTxt(runId: string, content: string): void {
    const s = this.ensureInit();
    s.saveProgressTxt.run(runId, content);
  }

  getProgressTxt(runId: string): string | undefined {
    const s = this.ensureInit();
    const row = s.getProgressTxt.get(runId) as { content: string } | undefined;
    return row?.content;
  }

  getSuccessfulIssueKeys(): Set<string> {
    const s = this.ensureInit();
    const rows = s.successfulKeys.all() as { issue_key: string }[];
    return new Set(rows.map((r) => r.issue_key));
  }

  getRetryCount(issueKey: string): number {
    const s = this.ensureInit();
    const row = s.retryCount.get(issueKey) as { count: number } | undefined;
    return row?.count ?? 0;
  }

  getRunLogs(runId: string): LogEntry[] {
    const s = this.ensureInit();
    const rows = s.getLogs.all(runId) as { phase: string; line: string }[];
    return rows.map((r) => ({ phase: r.phase as RunPhase, line: r.line }));
  }

  getRunLogsSince(runId: string, sinceId: number): { id: number; phase: RunPhase; line: string }[] {
    const s = this.ensureInit();
    const rows = s.getLogsSince.all(runId, sinceId) as { id: number; phase: string; line: string }[];
    return rows.map((r) => ({ id: r.id, phase: r.phase as RunPhase, line: r.line }));
  }

  updateTokens(id: string, delta: { inputTokens?: number; outputTokens?: number; cacheReadTokens?: number; cacheCreationTokens?: number; model?: string }): TokenData {
    const s = this.ensureInit();
    const row = s.getTokens.get(id) as TokenRow | undefined;
    const current = {
      inputTokens: row?.input_tokens ?? 0,
      outputTokens: row?.output_tokens ?? 0,
      cacheReadTokens: row?.cache_read_tokens ?? 0,
      cacheCreationTokens: row?.cache_creation_tokens ?? 0,
      model: delta.model ?? row?.model ?? undefined,
    };
    const updated = {
      inputTokens: current.inputTokens + (delta.inputTokens ?? 0),
      outputTokens: current.outputTokens + (delta.outputTokens ?? 0),
      cacheReadTokens: current.cacheReadTokens + (delta.cacheReadTokens ?? 0),
      cacheCreationTokens: current.cacheCreationTokens + (delta.cacheCreationTokens ?? 0),
      model: current.model,
    };
    s.updateTokens.run(updated.inputTokens, updated.outputTokens, updated.cacheReadTokens, updated.cacheCreationTokens, updated.model ?? null, id);
    return { ...updated };
  }

  getTokens(id: string): TokenData | undefined {
    const s = this.ensureInit();
    const row = s.getTokens.get(id) as TokenRow | undefined;
    if (!row) return undefined;
    return {
      inputTokens: row.input_tokens ?? 0,
      outputTokens: row.output_tokens ?? 0,
      cacheReadTokens: row.cache_read_tokens ?? 0,
      cacheCreationTokens: row.cache_creation_tokens ?? 0,
      model: row.model ?? undefined,
    };
  }

  updatePhaseTimestamp(id: string, phase: string, timestamp: string): void {
    const s = this.ensureInit();
    const row = s.getPhaseTimestamps.get(id) as { phase_timestamps_json: string | null } | undefined;
    const existing = safeParse<Record<string, string>>(row?.phase_timestamps_json ?? null, {});
    existing[phase] = timestamp;
    s.updatePhaseTimestamps.run(JSON.stringify(existing), id);
  }

  addComment(runId: string, author: string, content: string): Comment {
    const s = this.ensureInit();
    const result = s.insertComment.run(runId, author, content);
    const row = s.getComment.get(result.lastInsertRowid) as { id: number; run_id: string; author: string; content: string; created_at: string };
    return { id: row.id, author: row.author, content: row.content, createdAt: row.created_at + "Z" };
  }

  getComments(runId: string): Comment[] {
    const s = this.ensureInit();
    const rows = s.getComments.all(runId) as { id: number; run_id: string; author: string; content: string; created_at: string }[];
    return rows.map((r) => ({ id: r.id, author: r.author, content: r.content, createdAt: r.created_at + "Z" }));
  }

  getProjectSummaries(): ProjectSummary[] {
    const s = this.ensureInit();
    const rows = s.projectSummaries.all() as { issue_key: string; context_json: string | null; run_count: number; last_run_at: string; latest_status: string }[];
    return rows.map((row) => {
      const summary = safeParse<{ summary?: string } | null>(row.context_json, null)?.summary ?? "";
      return {
        issueKey: row.issue_key,
        summary,
        runCount: row.run_count,
        lastRunAt: row.last_run_at,
        latestStatus: row.latest_status as RunPhase,
      };
    });
  }

  deleteRun(id: string): boolean {
    const s = this.ensureInit();
    const deleteAll = this.db!.transaction(() => {
      s.deleteRunLogs.run(id);
      s.deleteRunProgress.run(id);
      s.deleteRunComments.run(id);
      return s.deleteRun.run(id);
    });
    const result = deleteAll();
    return result.changes > 0;
  }

  private rowToRun(row: RunRow, logs: { phase: string; line: string }[]): Run {
    return {
      id: row.id,
      issueKey: row.issue_key,
      status: row.status as RunPhase,
      startedAt: row.started_at,
      completedAt: row.completed_at ?? undefined,
      repoPath: row.repo_path ?? undefined,
      branchName: row.branch_name ?? undefined,
      prUrl: row.pr_url ?? undefined,
      context: safeParse(row.context_json, undefined),
      prd: safeParse(row.prd_json, []),
      logs: logs.map((l) => ({ phase: l.phase as RunPhase, line: l.line })),
      retryCount: row.retry_count ?? undefined,
      sourceRunId: row.source_run_id ?? undefined,
      phaseTimestamps: safeParse(row.phase_timestamps_json, undefined),
      tokens: (row.input_tokens || row.output_tokens || row.cache_read_tokens || row.cache_creation_tokens || row.model)
        ? {
            inputTokens: row.input_tokens ?? 0,
            outputTokens: row.output_tokens ?? 0,
            cacheReadTokens: row.cache_read_tokens ?? 0,
            cacheCreationTokens: row.cache_creation_tokens ?? 0,
            model: row.model ?? undefined,
          }
        : undefined,
    };
  }
}

interface TokenRow {
  input_tokens: number | null;
  output_tokens: number | null;
  cache_read_tokens: number | null;
  cache_creation_tokens: number | null;
  model: string | null;
}

interface RunRow {
  id: string;
  issue_key: string;
  status: string;
  started_at: string;
  completed_at: string | null;
  repo_path: string | null;
  branch_name: string | null;
  pr_url: string | null;
  context_json: string | null;
  prd_json: string | null;
  retry_count: number;
  source_run_id: string | null;
  phase_timestamps_json: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cache_read_tokens: number | null;
  cache_creation_tokens: number | null;
  model: string | null;
}
