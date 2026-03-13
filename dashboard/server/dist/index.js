"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const node_http_1 = __importDefault(require("node:http"));
const ws_1 = require("ws");
const unshift_js_1 = require("./unshift.js");
const app = (0, express_1.default)();
const server = node_http_1.default.createServer(app);
const wss = new ws_1.WebSocketServer({ server, path: "/ws" });
const runner = new unshift_js_1.UnshiftRunner();
// Broadcast helper
function broadcast(data) {
    const json = JSON.stringify(data);
    for (const client of wss.clients) {
        if (client.readyState === ws_1.WebSocket.OPEN) {
            client.send(json);
        }
    }
}
runner.on("run:created", (run) => broadcast({ type: "run:created", run }));
runner.on("run:phase", (runId, phase) => broadcast({ type: "run:phase", runId, phase }));
runner.on("run:log", (runId, line, phase) => broadcast({ type: "run:log", runId, line, phase }));
runner.on("run:prd", (runId, prd) => broadcast({ type: "run:prd", runId, prd }));
runner.on("run:complete", (runId, status) => broadcast({ type: "run:complete", runId, status }));
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
