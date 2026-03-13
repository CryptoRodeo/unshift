"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.UnshiftRunner = void 0;
const node_child_process_1 = require("node:child_process");
const node_events_1 = require("node:events");
const node_crypto_1 = require("node:crypto");
const node_path_1 = __importDefault(require("node:path"));
const tree_kill_1 = __importDefault(require("tree-kill"));
/**
 * Spawns `unshift.sh`, parses its stderr output to track phase transitions,
 * and emits events for the WebSocket layer to broadcast.
 */
class UnshiftRunner extends node_events_1.EventEmitter {
    runs = new Map();
    processes = new Map();
    /** Path to unshift.sh — two directories up from server/src/ */
    scriptPath;
    constructor() {
        super();
        this.scriptPath = node_path_1.default.resolve(__dirname, "..", "..", "..", "unshift.sh");
    }
    listRuns() {
        return Array.from(this.runs.values());
    }
    startRun() {
        const id = (0, node_crypto_1.randomUUID)();
        const run = {
            id,
            issueKey: "",
            status: "pending",
            startedAt: new Date().toISOString(),
            prd: [],
            logs: [],
        };
        this.runs.set(id, run);
        this.emit("run:created", run);
        this.spawn(run);
        return run;
    }
    stopRun(id) {
        const proc = this.processes.get(id);
        if (proc?.pid) {
            (0, tree_kill_1.default)(proc.pid);
        }
    }
    spawn(run) {
        const proc = (0, node_child_process_1.spawn)("bash", [this.scriptPath], {
            cwd: node_path_1.default.dirname(this.scriptPath),
            stdio: ["ignore", "pipe", "pipe"],
        });
        this.processes.set(run.id, proc);
        const handleLine = (line) => {
            this.parseLine(run, line);
            run.logs.push({ phase: run.status, line });
            this.emit("run:log", run.id, line, run.status);
        };
        let stdoutBuf = "";
        proc.stdout?.on("data", (chunk) => {
            stdoutBuf += chunk.toString();
            const lines = stdoutBuf.split("\n");
            stdoutBuf = lines.pop();
            for (const line of lines)
                handleLine(line);
        });
        let stderrBuf = "";
        proc.stderr?.on("data", (chunk) => {
            stderrBuf += chunk.toString();
            const lines = stderrBuf.split("\n");
            stderrBuf = lines.pop();
            for (const line of lines)
                handleLine(line);
        });
        proc.on("close", (code) => {
            // Flush remaining buffered output
            if (stdoutBuf)
                handleLine(stdoutBuf);
            if (stderrBuf)
                handleLine(stderrBuf);
            const status = code === 0 ? "success" : "failed";
            run.status = status;
            run.completedAt = new Date().toISOString();
            this.emit("run:complete", run.id, status);
            this.processes.delete(run.id);
        });
    }
    /**
     * Parse stderr lines from unshift.sh to detect phase transitions
     * and extract metadata like issue keys, repo paths, etc.
     */
    parseLine(run, line) {
        // Phase 0
        if (line.includes("Phase 0:")) {
            run.status = "phase0";
            this.emit("run:phase", run.id, "phase0");
        }
        // Issue discovery: "Processing issue: SSCUI-81"
        const issueMatch = line.match(/Processing issue:\s+(\S+)/);
        if (issueMatch) {
            run.issueKey = issueMatch[1];
        }
        // Phase 1
        if (line.includes("Phase 1:")) {
            run.status = "phase1";
            this.emit("run:phase", run.id, "phase1");
        }
        // Phase 1 complete: "Phase 1 complete. Repo: /path, Branch: branch-name"
        const p1Complete = line.match(/Phase 1 complete\. Repo:\s+(\S+),\s+Branch:\s+(\S+)/);
        if (p1Complete) {
            run.repoPath = p1Complete[1];
            run.branchName = p1Complete[2];
        }
        // Phase 2
        if (line.includes("Phase 2:")) {
            run.status = "phase2";
            this.emit("run:phase", run.id, "phase2");
        }
        // Phase 3
        if (line.includes("Phase 3:")) {
            run.status = "phase3";
            this.emit("run:phase", run.id, "phase3");
        }
    }
}
exports.UnshiftRunner = UnshiftRunner;
