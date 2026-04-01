import express from "express";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer, WebSocket } from "ws";
import yaml from "js-yaml";
import { UnshiftRunner } from "./unshift";
import { isRunError } from "../../shared/types";
import type { RunErrorCode, WsMessage, TokenData, WorktreeInfo } from "../../shared/types";
import { DEFAULT_MODELS, AVAILABLE_MODELS, getDefaultConfig, type Provider, type ProviderConfig } from "./engine/providers";

function parseProviderConfig(body: Record<string, unknown> | undefined): ProviderConfig | undefined {
  const rawProvider = typeof body?.provider === "string" ? body.provider : undefined;
  const model = typeof body?.model === "string" ? body.model : undefined;
  if (!rawProvider && !model) return undefined;
  const providerStr = rawProvider || "anthropic";
  if (!(providerStr in DEFAULT_MODELS)) {
    throw new Error(`Unknown provider: ${providerStr}. Must be one of: ${Object.keys(DEFAULT_MODELS).join(", ")}`);
  }
  const provider = providerStr as Provider;
  return { provider, model: model || DEFAULT_MODELS[provider] };
}

const app = express();
app.use(express.json());

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });

const runner = new UnshiftRunner();

// Workspace path configuration for the Open in VSCode feature
const WORKSPACE_DIR = process.env.WORKSPACE_DIR || "/app/workspace";
const WORKSPACE_HOST_PATH = process.env.WORKSPACE_HOST_PATH;
if (WORKSPACE_HOST_PATH) {
  if (!path.isAbsolute(WORKSPACE_HOST_PATH)) {
    console.warn(`WORKSPACE_HOST_PATH must be an absolute path, got: ${WORKSPACE_HOST_PATH}. Open in VSCode feature will be unavailable.`);
  }
} else {
  console.warn("WORKSPACE_HOST_PATH is not set. Open in VSCode feature will be unavailable.");
}

const ERROR_CODE_TO_STATUS: Record<RunErrorCode, number> = {
  NOT_FOUND: 404,
  CONFLICT: 409,
  BAD_REQUEST: 400,
  INVALID_STATE: 400,
};

// Broadcast helper
function broadcast(data: WsMessage) {
  const json = JSON.stringify(data);
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(json);
    }
  }
}

runner.on("run:created", (run) => broadcast({ type: "run:created", run }));
runner.on("run:phase", (runId, phase, timestamp) =>
  broadcast({ type: "run:phase", runId, phase, timestamp })
);
runner.on("run:log", (runId, line, phase) =>
  broadcast({ type: "run:log", runId, line, phase })
);
runner.on("run:context", (runId, context) =>
  broadcast({ type: "run:context", runId, context })
);
runner.on("run:prd", (runId, prd) =>
  broadcast({ type: "run:prd", runId, prd })
);
runner.on("run:complete", (runId, status) =>
  broadcast({ type: "run:complete", runId, status })
);
runner.on("run:progress", (runId: string, content: string) =>
  broadcast({ type: "run:progress", runId, content })
);
runner.on("run:skipped", (skipped: { issueKey: string; reason: string }[]) =>
  broadcast({ type: "run:skipped", skipped })
);
runner.on("run:deleted", (runId: string) =>
  broadcast({ type: "run:deleted", runId })
);
runner.on("run:tokens", (runId: string, tokens: TokenData) =>
  broadcast({ type: "run:tokens", runId, tokens })
);

// Jira status cache: issueKey → { status, fetchedAt }
const jiraStatusCache = new Map<string, { status: string; fetchedAt: number }>();
const JIRA_STATUS_TTL_MS = 60_000; // 1 minute

// Jira detail caches (5-minute TTL)
const JIRA_DETAIL_TTL_MS = 300_000;
const jiraIssueCache = new Map<string, { data: unknown; fetchedAt: number }>();
const jiraCommentsCache = new Map<string, { data: unknown; fetchedAt: number }>();

// Evict expired entries periodically to prevent unbounded cache growth
const CACHE_EVICT_INTERVAL_MS = 300_000; // 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of jiraStatusCache) if (now - v.fetchedAt > JIRA_STATUS_TTL_MS) jiraStatusCache.delete(k);
  for (const [k, v] of jiraIssueCache) if (now - v.fetchedAt > JIRA_DETAIL_TTL_MS) jiraIssueCache.delete(k);
  for (const [k, v] of jiraCommentsCache) if (now - v.fetchedAt > JIRA_DETAIL_TTL_MS) jiraCommentsCache.delete(k);
}, CACHE_EVICT_INTERVAL_MS).unref();

// REST endpoints
app.get("/api/runs", (_req, res) => {
  res.json(runner.listRuns());
});

app.get("/api/runs/:id", (req, res) => {
  const run = runner.getRun(req.params.id);
  if (!run) {
    res.status(404).json({ error: "Run not found", code: "NOT_FOUND" });
  } else {
    res.json(run);
  }
});

app.get("/api/runs/:id/logs", (req, res) => {
  const parsed = req.query.since ? parseInt(req.query.since as string, 10) : NaN;
  const since = Number.isNaN(parsed) ? undefined : parsed;
  if (since !== undefined) {
    res.json(runner.getRunLogsSince(req.params.id, since));
  } else {
    res.json(runner.getRunLogs(req.params.id));
  }
});

app.get("/api/runs/:id/diff", async (req, res) => {
  try {
    const result = await runner.getRunDiff(req.params.id);
    res.json(result);
  } catch (err) {
    console.error("Failed to get diff:", err);
    res.status(500).json({ diff: null });
  }
});

app.get("/api/runs/:id/progress", (req, res) => {
  const content = runner.getRunProgress(req.params.id);
  if (content === undefined) {
    res.status(404).json({ error: "No progress data found" });
  } else {
    res.type("text/plain").send(content);
  }
});

app.get("/api/history/:issueKey", (req, res) => {
  res.json(runner.getRunsByIssueKey(req.params.issueKey));
});

app.get("/api/discover", async (_req, res) => {
  try {
    const keys = await runner.discover();
    res.json({ issueKeys: keys });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

app.get("/api/providers", (_req, res) => {
  const providers = Object.entries(DEFAULT_MODELS).map(([provider, defaultModel]) => ({
    provider,
    defaultModel,
    models: AVAILABLE_MODELS[provider as Provider],
  }));
  res.json({ providers });
});

app.get("/api/config", (_req, res) => {
  const config = getDefaultConfig();
  res.json({ ...config, jiraBaseUrl: process.env.JIRA_BASE_URL ?? null, jiraLabel: process.env.JIRA_LABEL ?? "llm-candidate" });
});

app.get("/api/jira/issue/:key/status", async (req, res) => {
  const issueKey = req.params.key;
  const cached = jiraStatusCache.get(issueKey);
  if (cached && Date.now() - cached.fetchedAt < JIRA_STATUS_TTL_MS) {
    res.json({ status: cached.status, cached: true });
    return;
  }
  try {
    const result = await runner.getJiraIssueStatus(issueKey);
    jiraStatusCache.set(issueKey, { status: result.status, fetchedAt: Date.now() });
    res.json({ status: result.status, cached: false });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(502).json({ error: msg });
  }
});

app.get("/api/jira/issue/:key", async (req, res) => {
  const issueKey = req.params.key;
  const cached = jiraIssueCache.get(issueKey);
  if (cached && Date.now() - cached.fetchedAt < JIRA_DETAIL_TTL_MS) {
    res.json(cached.data);
    return;
  }
  try {
    const issue = await runner.getFullJiraIssue(issueKey);
    jiraIssueCache.set(issueKey, { data: issue, fetchedAt: Date.now() });
    res.json(issue);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(502).json({ error: msg });
  }
});

app.get("/api/jira/issue/:key/comments", async (req, res) => {
  const issueKey = req.params.key;
  const cached = jiraCommentsCache.get(issueKey);
  if (cached && Date.now() - cached.fetchedAt < JIRA_DETAIL_TTL_MS) {
    res.json({ comments: cached.data });
    return;
  }
  try {
    const comments = await runner.getJiraIssueComments(issueKey, 10);
    jiraCommentsCache.set(issueKey, { data: comments, fetchedAt: Date.now() });
    res.json({ comments });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(502).json({ error: msg });
  }
});

app.get("/api/projects", (_req, res) => {
  res.json(runner.getProjectSummaries());
});

app.post("/api/runs", async (req, res) => {
  const { issueKey, force } = req.body ?? {};

  let providerConfig: ProviderConfig | undefined;
  try {
    providerConfig = parseProviderConfig(req.body);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(400).json({ error: msg, code: "BAD_REQUEST" });
    return;
  }

  if (issueKey) {
    // Start a single run for the specified issue
    const result = runner.startRun(issueKey, force === true, providerConfig);
    if (isRunError(result)) {
      res.status(ERROR_CODE_TO_STATUS[result.code]).json(result);
    } else {
      res.json(result);
    }
  } else {
    // Discover all issues and start a run for each
    // Parse per-issue provider/model overrides
    let overrides: Record<string, ProviderConfig> | undefined;
    const rawOverrides = req.body?.overrides;
    if (rawOverrides && typeof rawOverrides === "object" && !Array.isArray(rawOverrides)) {
      overrides = {};
      for (const [key, val] of Object.entries(rawOverrides)) {
        try {
          const parsed = parseProviderConfig(val as Record<string, unknown>);
          if (parsed) overrides[key] = parsed;
        } catch {
          // skip invalid per-issue overrides
        }
      }
      if (Object.keys(overrides).length === 0) overrides = undefined;
    }

    try {
      const result = await runner.startRuns(providerConfig, overrides);
      res.json(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    }
  }
});

app.delete("/api/runs/:id", async (req, res) => {
  const result = await runner.deleteRun(req.params.id);
  if (isRunError(result)) {
    res.status(ERROR_CODE_TO_STATUS[result.code]).json(result);
  } else {
    res.json(result);
  }
});

app.post("/api/runs/:id/stop", async (req, res) => {
  try {
    await runner.stopRun(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    console.error("Failed to stop run:", err);
    res.status(500).json({ ok: false, error: "Failed to stop run" });
  }
});

app.post("/api/runs/:id/approve", async (req, res) => {
  const result = await runner.approveRun(req.params.id);
  if (isRunError(result)) {
    res.status(ERROR_CODE_TO_STATUS[result.code]).json(result);
  } else {
    res.json(result);
  }
});

app.post("/api/runs/:id/reject", async (req, res) => {
  try {
    const result = await runner.rejectRun(req.params.id);
    if (isRunError(result)) {
      res.status(ERROR_CODE_TO_STATUS[result.code]).json(result);
    } else {
      res.json(result);
    }
  } catch (err) {
    console.error("Failed to reject run:", err);
    res.status(500).json({ error: "Failed to reject run" });
  }
});

app.post("/api/runs/:id/cleanup", async (req, res) => {
  const run = runner.getRun(req.params.id);
  if (!run) {
    res.status(404).json({ error: "Run not found", code: "NOT_FOUND" });
    return;
  }
  try {
    await runner.cleanupRunWorktree(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    console.error("Failed to cleanup worktree:", err);
    res.status(500).json({ error: "Failed to cleanup worktree" });
  }
});

app.get("/api/runs/:id/worktree", (req, res) => {
  const run = runner.getRun(req.params.id);
  if (!run) {
    res.status(404).json({ error: "Run not found", code: "NOT_FOUND" });
    return;
  }

  // Check if WORKSPACE_HOST_PATH is configured and valid
  if (!WORKSPACE_HOST_PATH || !path.isAbsolute(WORKSPACE_HOST_PATH)) {
    const info: WorktreeInfo = {
      containerPath: "",
      hostPath: "",
      vsCodeUri: "",
      devContainerUri: "",
      available: false,
      hasDevContainer: false,
      error: "WORKSPACE_HOST_PATH is not configured on the server",
    };
    res.json(info);
    return;
  }

  // Get the container path: prefer live in-memory worktree path, fall back to run's repoPath
  const containerPath = runner.getWorktreePath(req.params.id) || run.repoPath;
  if (!containerPath) {
    const info: WorktreeInfo = {
      containerPath: "",
      hostPath: "",
      vsCodeUri: "",
      devContainerUri: "",
      available: false,
      hasDevContainer: false,
      error: "No worktree path available — run may still be in pending/phase0",
    };
    res.json(info);
    return;
  }

  // Derive host path by replacing the workspace dir prefix
  const hostPath = containerPath.startsWith(WORKSPACE_DIR)
    ? WORKSPACE_HOST_PATH + containerPath.slice(WORKSPACE_DIR.length)
    : containerPath;

  const available = fs.existsSync(containerPath);
  const hasDevContainer = available && fs.existsSync(path.join(containerPath, ".devcontainer", "devcontainer.json"));

  const vsCodeUri = `vscode://file/${hostPath}`;
  const devContainerUri = `vscode://ms-vscode-remote.remote-containers/openFolder?folderUri=${encodeURIComponent(hostPath)}`;

  const info: WorktreeInfo = {
    containerPath,
    hostPath,
    vsCodeUri,
    devContainerUri,
    available,
    hasDevContainer,
    error: available ? undefined : "Worktree has been cleaned up",
  };
  res.json(info);
});

app.post("/api/runs/:id/retry", async (req, res) => {
  try {
    const retryProviderConfig = parseProviderConfig(req.body);
    const result = await runner.retryRun(req.params.id, retryProviderConfig);
    if (isRunError(result)) {
      res.status(ERROR_CODE_TO_STATUS[result.code]).json(result);
    } else {
      res.json(result);
    }
  } catch (err) {
    console.error("Failed to retry run:", err);
    res.status(500).json({ error: "Failed to retry run" });
  }
});

app.get("/api/runs/:id/comments", (req, res) => {
  res.json(runner.getComments(req.params.id));
});

app.post("/api/runs/:id/comments", (req, res) => {
  const { content } = req.body ?? {};
  if (!content || typeof content !== "string" || content.trim().length === 0) {
    res.status(400).json({ error: "Content is required", code: "BAD_REQUEST" });
    return;
  }
  const result = runner.addComment(req.params.id, content.trim());
  if (isRunError(result)) {
    res.status(ERROR_CODE_TO_STATUS[result.code]).json(result);
  } else {
    broadcast({ type: "run:comment", runId: req.params.id, comment: result });
    res.json(result);
  }
});

interface ProjectEntry {
  repo_url: string;
}

function loadProjects(): ProjectEntry[] {
  // In dev: src/ → ../../projects.yaml; in prod: dist/ → ../../../projects.yaml
  const thisDir = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(thisDir, "../../../projects.yaml"),
    path.resolve(thisDir, "../../projects.yaml"),
  ];
  const projectsPath = candidates.find((p) => fs.existsSync(p));
  if (!projectsPath) return [];
  const content = fs.readFileSync(projectsPath, "utf-8");
  const parsed = yaml.load(content);
  if (!parsed) return [];
  if (!Array.isArray(parsed)) {
    throw new Error(`projects.yaml must contain a YAML array, got ${typeof parsed}`);
  }
  return (parsed as unknown[]).filter(
    (entry): entry is ProjectEntry =>
      typeof entry === "object" &&
      entry !== null &&
      typeof (entry as Record<string, unknown>).repo_url === "string"
  );
}

function resolveRepoEntry(repoPath: string): ProjectEntry | undefined {
  const projects = loadProjects();
  // Strip .worktrees/<id> suffix so worktree paths resolve to the parent repo
  const normalized = repoPath.replace(/\/\.worktrees\/[^/]+\/?$/, "");
  const repoBasename = path.basename(normalized);
  return projects.find((r) => {
    const repoName = path.basename(r.repo_url, ".git");
    return repoName === repoBasename;
  });
}

/** Convert a git clone URL (https or ssh) to a browsable HTTPS URL */
function toBrowsableUrl(repoUrl: string): string {
  // Handle ssh: git@github.com:org/repo.git → https://github.com/org/repo
  const sshMatch = repoUrl.match(/^git@([^:]+):(.+?)(?:\.git)?$/);
  if (sshMatch) return `https://${sshMatch[1]}/${sshMatch[2]}`;
  // Handle https: strip trailing .git
  return repoUrl.replace(/\.git$/, "");
}

app.get("/api/runs/:id/repo-url", (req, res) => {
  try {
    const run = runner.getRun(req.params.id);
    if (!run) {
      res.status(404).json({ error: "Run not found", code: "NOT_FOUND" });
      return;
    }
    if (!run.repoPath) {
      res.status(400).json({ error: "Run has no repo path yet", code: "BAD_REQUEST" });
      return;
    }
    const entry = resolveRepoEntry(run.repoPath);
    if (!entry) {
      res.status(400).json({ error: "Could not resolve repository from projects.yaml", code: "BAD_REQUEST" });
      return;
    }
    const repoUrl = toBrowsableUrl(entry.repo_url);
    res.json({ repoUrl });
  } catch (err) {
    console.error("Failed to resolve repo URL:", err);
    res.status(500).json({ error: "Failed to resolve repo URL" });
  }
});

// Static asset serving (production / built client)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const clientDistPath = process.env.CLIENT_DIST_PATH || path.resolve(__dirname, "../../client/dist");

if (fs.existsSync(clientDistPath)) {
  app.use(express.static(clientDistPath));
  app.use((req, res, next) => {
    if (req.method === "GET" && !req.path.startsWith("/api") && !req.path.startsWith("/ws")) {
      res.sendFile(path.join(clientDistPath, "index.html"));
    } else {
      next();
    }
  });
}


// Graceful shutdown: stop worktree cleanup timer
function shutdown() {
  runner.stopCleanupTimer();
  process.exit(0);
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

const PORT = process.env.SERVER_PORT ?? 3000;
server.listen(PORT, () => {
  console.log(`Unshift server listening on http://localhost:${PORT}`);
});
