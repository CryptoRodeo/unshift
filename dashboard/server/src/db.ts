import Database from "better-sqlite3";
import path from "node:path";
import { mkdirSync } from "node:fs";

let db: Database.Database | null = null;

const DB_PATH = path.resolve(__dirname, "..", "data", "runs.db");

export function initDb(): Database.Database {
  if (db) return db;

  mkdirSync(path.dirname(DB_PATH), { recursive: true });

  db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");

  db.exec(`
    CREATE TABLE IF NOT EXISTS runs (
      id TEXT PRIMARY KEY,
      issue_key TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      started_at TEXT NOT NULL,
      completed_at TEXT,
      repo_path TEXT,
      branch_name TEXT,
      pr_url TEXT,
      context_json TEXT,
      prd_json TEXT,
      retry_count INTEGER NOT NULL DEFAULT 0,
      source_run_id TEXT
    );

    CREATE TABLE IF NOT EXISTS run_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT NOT NULL REFERENCES runs(id),
      phase TEXT NOT NULL,
      line TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS run_progress (
      run_id TEXT PRIMARY KEY REFERENCES runs(id),
      content TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_runs_issue_key ON runs(issue_key);
    CREATE INDEX IF NOT EXISTS idx_runs_status ON runs(status);
    CREATE INDEX IF NOT EXISTS idx_run_logs_run_id ON run_logs(run_id);
  `);

  // Migration: add phase_timestamps_json column
  try {
    db.exec(`ALTER TABLE runs ADD COLUMN phase_timestamps_json TEXT`);
  } catch {
    // Column already exists — safe to ignore
  }

  // Migration: add token tracking columns
  const tokenColumns = [
    "input_tokens INTEGER DEFAULT 0",
    "output_tokens INTEGER DEFAULT 0",
    "cache_read_tokens INTEGER DEFAULT 0",
    "cache_creation_tokens INTEGER DEFAULT 0",
    "model TEXT",
  ];
  for (const col of tokenColumns) {
    try {
      db.exec(`ALTER TABLE runs ADD COLUMN ${col}`);
    } catch {
      // Column already exists — safe to ignore
    }
  }

  return db;
}

export function getDb(): Database.Database {
  if (!db) return initDb();
  return db;
}
