import express from "express";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer, WebSocket } from "ws";
import yaml from "js-yaml";
import { UnshiftRunner } from "./unshift";
import { isRunError } from "../../shared/types";
import type { RunErrorCode } from "../../shared/types";
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

const ERROR_CODE_TO_STATUS: Record<RunErrorCode, number> = {
  NOT_FOUND: 404,
  CONFLICT: 409,
  BAD_REQUEST: 400,
  INVALID_STATE: 400,
};

// Broadcast helper
function broadcast(data: object) {
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
runner.on("run:tokens", (runId: string, tokens: object) =>
  broadcast({ type: "run:tokens", runId, tokens })
);

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
  res.json(config);
});

app.post("/api/runs", async (req, res) => {
  const { issueKey, force, provider, model } = req.body ?? {};

  // Build optional provider config if provider/model specified
  const providerConfig = provider || model
    ? { provider: provider || "anthropic", model: model || DEFAULT_MODELS[provider as Provider || "anthropic"] }
    : undefined;

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
    try {
      const result = await runner.startRuns(providerConfig);
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

app.post("/api/runs/:id/approve", (req, res) => {
  const result = runner.approveRun(req.params.id);
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

interface ReposYamlEntry {
  repo_url: string;
  local_dir: string;
}

function loadReposYaml(): ReposYamlEntry[] {
  // In dev: src/ → ../../repos.yaml; in prod: dist/ → ../../../repos.yaml
  const thisDir = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(thisDir, "../../../repos.yaml"),
    path.resolve(thisDir, "../../repos.yaml"),
  ];
  const reposPath = candidates.find((p) => fs.existsSync(p));
  if (!reposPath) return [];
  const content = fs.readFileSync(reposPath, "utf-8");
  const parsed = yaml.load(content);
  if (!parsed) return [];
  if (!Array.isArray(parsed)) {
    throw new Error(`repos.yaml must contain a YAML array, got ${typeof parsed}`);
  }
  return parsed as ReposYamlEntry[];
}

function resolveLocalDir(repoPath: string): string | undefined {
  const repos = loadReposYaml();
  const repoBasename = path.basename(repoPath);
  const entry = repos.find((r) => {
    const localBasename = path.basename(r.local_dir.replace(/\/+$/, ""));
    return localBasename === repoBasename;
  });
  return entry?.local_dir;
}

app.get("/api/runs/:id/editor-info", (req, res) => {
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
    const localDir = resolveLocalDir(run.repoPath);
    if (!localDir) {
      res.status(400).json({ error: "Could not resolve local directory from repos.yaml", code: "BAD_REQUEST" });
      return;
    }
    const gitCommand = run.branchName
      ? `cd ${localDir} && git fetch origin && git checkout ${run.branchName}`
      : undefined;
    res.json({ localDir, branchName: run.branchName || null, gitCommand: gitCommand || null });
  } catch (err) {
    console.error("Failed to resolve editor info:", err);
    res.status(500).json({ error: "Failed to resolve editor info" });
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


const PORT = process.env.SERVER_PORT ?? 3000;
server.listen(PORT, () => {
  console.log(`Unshift server listening on http://localhost:${PORT}`);
});
