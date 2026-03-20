import type Database from "better-sqlite3";
import { getDb } from "./db";
import type { Run, RunPhase, PrdEntry, LogEntry } from "../../shared/types";

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
    const row = s.retryCount.get(issueKey) as { count: number };
    return row.count;
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
      context: row.context_json ? JSON.parse(row.context_json) : undefined,
      prd: row.prd_json ? JSON.parse(row.prd_json) : [],
      logs: logs.map((l) => ({ phase: l.phase as RunPhase, line: l.line })),
      retryCount: row.retry_count ?? undefined,
      sourceRunId: row.source_run_id ?? undefined,
    };
  }
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
}
