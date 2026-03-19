import { useEffect, useRef, useCallback, useReducer, useState } from "react";
import type { WsMessage, Run, RunContext, PrdEntry, RunPhase } from "../types";

type RunsAction =
  | { type: "BulkLoad"; runs: Run[] }
  | { type: "RunCreated"; run: Run }
  | { type: "PhaseChanged"; runId: string; phase: RunPhase }
  | { type: "LogAppended"; runId: string; phase: RunPhase; line: string }
  | { type: "ContextUpdated"; runId: string; context: RunContext }
  | { type: "PrdUpdated"; runId: string; prd: PrdEntry[] }
  | { type: "RunCompleted"; runId: string; status: "success" | "failed" | "rejected" };

function runsReducer(
  state: Map<string, Run>,
  action: RunsAction
): Map<string, Run> {
  switch (action.type) {
    case "BulkLoad": {
      const next = new Map(state);
      for (const run of action.runs) {
        next.set(run.id, run);
      }
      return next;
    }

    case "RunCreated": {
      const next = new Map(state);
      next.set(action.run.id, action.run);
      return next;
    }

    case "PhaseChanged": {
      const run = state.get(action.runId);
      if (!run) return state;
      const next = new Map(state);
      next.set(action.runId, { ...run, status: action.phase });
      return next;
    }

    case "LogAppended": {
      const run = state.get(action.runId);
      if (!run) return state;
      const next = new Map(state);
      const logs = run.logs.slice();
      logs.push({ phase: action.phase, line: action.line });
      next.set(action.runId, { ...run, logs });
      return next;
    }

    case "ContextUpdated": {
      const run = state.get(action.runId);
      if (!run) return state;
      const next = new Map(state);
      next.set(action.runId, { ...run, context: action.context });
      return next;
    }

    case "PrdUpdated": {
      const run = state.get(action.runId);
      if (!run) return state;
      const next = new Map(state);
      next.set(action.runId, { ...run, prd: action.prd });
      return next;
    }

    case "RunCompleted": {
      const run = state.get(action.runId);
      if (!run) return state;
      const next = new Map(state);
      next.set(action.runId, {
        ...run,
        status: action.status,
        completedAt: new Date().toISOString(),
      });
      return next;
    }

    default:
      return state;
  }
}

export function useWebSocket() {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const backoffRef = useRef(1000);
  const [runs, dispatch] = useReducer(runsReducer, new Map<string, Run>());
  const [connected, setConnected] = useState(false);

  const fetchRuns = useCallback(() => {
    fetch("/api/runs")
      .then((res) => res.json())
      .then((existing: Run[]) => {
        dispatch({ type: "BulkLoad", runs: existing });
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    let unmounted = false;

    function connect() {
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
      wsRef.current = ws;

      ws.onopen = () => {
        if (unmounted) return;
        setConnected(true);
        backoffRef.current = 1000;
        fetchRuns();
      };

      ws.onclose = () => {
        if (unmounted) return;
        setConnected(false);
        const delay = backoffRef.current;
        backoffRef.current = Math.min(delay * 2, 30000);
        reconnectTimerRef.current = setTimeout(connect, delay);
      };

      ws.onmessage = (event) => {
        if (unmounted) return;
        const msg: WsMessage = JSON.parse(event.data);

        switch (msg.type) {
          case "run:created":
            dispatch({ type: "RunCreated", run: msg.run });
            break;
          case "run:phase":
            dispatch({
              type: "PhaseChanged",
              runId: msg.runId,
              phase: msg.phase,
            });
            break;
          case "run:log":
            dispatch({
              type: "LogAppended",
              runId: msg.runId,
              phase: msg.phase,
              line: msg.line,
            });
            break;
          case "run:context":
            dispatch({
              type: "ContextUpdated",
              runId: msg.runId,
              context: msg.context,
            });
            break;
          case "run:prd":
            dispatch({
              type: "PrdUpdated",
              runId: msg.runId,
              prd: msg.prd,
            });
            break;
          case "run:complete":
            dispatch({
              type: "RunCompleted",
              runId: msg.runId,
              status: msg.status,
            });
            break;
        }
      };
    }

    connect();

    return () => {
      unmounted = true;
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      wsRef.current?.close();
    };
  }, [fetchRuns]);

  const startRun = useCallback(async () => {
    const res = await fetch("/api/runs", { method: "POST" });
    return res.json();
  }, []);

  const stopRun = useCallback(async (runId: string) => {
    await fetch(`/api/runs/${runId}/stop`, { method: "POST" });
  }, []);

  const approveRun = useCallback(async (runId: string) => {
    await fetch(`/api/runs/${runId}/approve`, { method: "POST" });
  }, []);

  const rejectRun = useCallback(async (runId: string) => {
    await fetch(`/api/runs/${runId}/reject`, { method: "POST" });
  }, []);

  return { runs, connected, startRun, stopRun, approveRun, rejectRun };
}
