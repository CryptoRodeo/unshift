import express from "express";
import http from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { UnshiftRunner } from "./unshift.js";

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });

const runner = new UnshiftRunner();

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

app.post("/api/runs", (_req, res) => {
  const run = runner.startRun();
  res.json(run);
});

app.post("/api/runs/:id/stop", (req, res) => {
  runner.stopRun(req.params.id);
  res.json({ ok: true });
});

const PORT = process.env.PORT ?? 3001;
server.listen(PORT, () => {
  console.log(`Unshift server listening on http://localhost:${PORT}`);
});
