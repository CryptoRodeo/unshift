import express from "express";
import http from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { UnshiftRunner } from "./unshift";
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

// REST endpoints
app.get("/api/runs", (_req, res) => {
  res.json(runner.listRuns());
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
  const { issueKey } = req.body ?? {};

  if (issueKey) {
    // Start a single run for the specified issue
    const result = runner.startRun(issueKey);
    if ("code" in result) {
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
  res.json(result);
});

app.post("/api/runs/:id/reject", async (req, res) => {
  try {
    const ok = await runner.rejectRun(req.params.id);
    res.json({ ok });
  } catch (err) {
    console.error("Failed to reject run:", err);
    res.status(500).json({ ok: false, error: "Failed to reject run" });
  }
});

app.post("/api/runs/:id/retry", async (req, res) => {
  try {
    const result = await runner.retryRun(req.params.id);
    if ("code" in result) {
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
