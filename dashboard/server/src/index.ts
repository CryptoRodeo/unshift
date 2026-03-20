import express from "express";
import http from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { UnshiftRunner } from "./unshift";
import { isRunError } from "../../shared/types";
import type { RunErrorCode } from "../../shared/types";

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
runner.on("run:phase", (runId, phase) =>
  broadcast({ type: "run:phase", runId, phase })
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

app.post("/api/runs", async (req, res) => {
  const { issueKey, force } = req.body ?? {};

  if (issueKey) {
    // Start a single run for the specified issue
    const result = runner.startRun(issueKey, force === true);
    if (isRunError(result)) {
      res.status(ERROR_CODE_TO_STATUS[result.code]).json(result);
    } else {
      res.json(result);
    }
  } else {
    // Discover all issues and start a run for each
    try {
      const result = await runner.startRuns();
      res.json(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    }
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
    const result = await runner.retryRun(req.params.id);
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

const PORT = process.env.SERVER_PORT ?? 3000;
server.listen(PORT, () => {
  console.log(`Unshift server listening on http://localhost:${PORT}`);
});
