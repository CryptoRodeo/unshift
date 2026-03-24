import { useEffect, useRef, useCallback, useReducer, useState } from "react";
import type { WsMessage, Run, RunContext, PrdEntry, RunPhase, CompletedStatus, TokenData } from "../types";
import { isTerminal } from "../types";

export interface StartRunResponse {
  runs: Run[];
  errors: string[];
  skipped: { issueKey: string; reason: string }[];
}

type RunsAction =
  | { type: "BulkLoad"; runs: Run[] }
  | { type: "RunCreated"; run: Run }
  | { type: "PhaseChanged"; runId: string; phase: RunPhase; timestamp?: string }
  | { type: "LogAppended"; runId: string; phase: RunPhase; line: string }
  | { type: "LogsBulkLoaded"; runId: string; logs: { phase: RunPhase; line: string }[] }
  | { type: "ContextUpdated"; runId: string; context: RunContext }
  | { type: "PrdUpdated"; runId: string; prd: PrdEntry[] }
  | { type: "RunCompleted"; runId: string; status: CompletedStatus }
  | { type: "RunDeleted"; runId: string }
  | { type: "TokensUpdated"; runId: string; tokens: TokenData };

function runsReducer(
  state: Map<string, Run>,
  action: RunsAction
): Map<string, Run> {
  switch (action.type) {
    case "BulkLoad": {
      const next = new Map(state);
      for (const run of action.runs) {
        const existing = state.get(run.id);
        // listRuns() returns runs with empty logs; preserve logs already in state
        if (existing && existing.logs.length > 0 && run.logs.length === 0) {
          next.set(run.id, { ...run, logs: existing.logs });
        } else {
          next.set(run.id, run);
        }
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
      const phaseTimestamps = action.timestamp
        ? { ...run.phaseTimestamps, [action.phase]: action.timestamp }
        : run.phaseTimestamps;
      next.set(action.runId, { ...run, status: action.phase, phaseTimestamps });
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

    case "LogsBulkLoaded": {
      const run = state.get(action.runId);
      if (!run) return state;
      // Only replace logs if fetched set is larger (WS may have appended more)
      if (run.logs.length >= action.logs.length) return state;
      const next = new Map(state);
      next.set(action.runId, { ...run, logs: action.logs });
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

    case "RunDeleted": {
      const next = new Map(state);
      next.delete(action.runId);
      return next;
    }

    case "TokensUpdated": {
      const run = state.get(action.runId);
      if (!run) return state;
      const next = new Map(state);
      next.set(action.runId, { ...run, tokens: action.tokens });
      return next;
    }

    default:
      return state;
  }
}

export type RunEventCallback = (event: { runId: string; issueKey: string; status: RunPhase | CompletedStatus }) => void;

export function useWebSocket() {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const backoffRef = useRef(1000);
  const [runs, dispatch] = useReducer(runsReducer, new Map<string, Run>());
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [progressMap, setProgressMap] = useState<Map<string, string>>(new Map());
  const onRunEventRef = useRef<RunEventCallback | null>(null);
  const runsRef = useRef(runs);
  runsRef.current = runs;

  const fetchRuns = useCallback(() => {
    fetch("/api/runs")
      .then((res) => res.json())
      .then((existing: Run[]) => {
        dispatch({ type: "BulkLoad", runs: existing });
        setLoading(false);

        const activeRuns = existing.filter((r) => !isTerminal(r.status));
        Promise.all(
          activeRuns.map((r) =>
            fetch(`/api/runs/${r.id}/progress`)
              .then((res) => (res.ok ? res.text() : null))
              .catch(() => null)
              .then((content) => content ? { runId: r.id, content } : null)
          )
        ).then((results) => {
          const entries = results.filter(Boolean) as { runId: string; content: string }[];
          if (entries.length === 0) return;
          setProgressMap((prev) => {
            const next = new Map(prev);
            for (const { runId, content } of entries) {
              next.set(runId, content);
            }
            return next;
          });
        });
      })
      .catch(() => {
        setLoading(false);
      });
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
        let msg: WsMessage;
        try {
          msg = JSON.parse(event.data);
        } catch {
          return;
        }

        switch (msg.type) {
          case "run:created":
            dispatch({ type: "RunCreated", run: msg.run });
            break;
          case "run:phase":
            dispatch({
              type: "PhaseChanged",
              runId: msg.runId,
              phase: msg.phase,
              timestamp: msg.timestamp,
            });
            if (msg.phase === "awaiting_approval" && onRunEventRef.current) {
              const run = runsRef.current.get(msg.runId);
              onRunEventRef.current({ runId: msg.runId, issueKey: run?.issueKey ?? msg.runId, status: msg.phase });
            }
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
            if (onRunEventRef.current) {
              const run = runsRef.current.get(msg.runId);
              onRunEventRef.current({ runId: msg.runId, issueKey: run?.issueKey ?? msg.runId, status: msg.status });
            }
            setProgressMap((prev) => {
              if (!prev.has(msg.runId)) return prev;
              const next = new Map(prev);
              next.delete(msg.runId);
              return next;
            });
            break;
          case "run:progress":
            setProgressMap((prev) => {
              const next = new Map(prev);
              next.set(msg.runId, msg.content);
              return next;
            });
            break;
          case "run:tokens":
            dispatch({ type: "TokensUpdated", runId: msg.runId, tokens: msg.tokens });
            break;
          case "run:deleted":
            dispatch({ type: "RunDeleted", runId: msg.runId });
            setProgressMap((prev) => {
              if (!prev.has(msg.runId)) return prev;
              const next = new Map(prev);
              next.delete(msg.runId);
              return next;
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

  const startRun = useCallback(async (options?: { force?: boolean }): Promise<StartRunResponse> => {
    const res = await fetch("/api/runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ force: options?.force }),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || "Failed to start runs");
    }
    return data;
  }, []);

  const startRunForIssue = useCallback(async (issueKey: string, force?: boolean) => {
    const res = await fetch("/api/runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ issueKey, force }),
    });
    const data = await res.json();
    return data;
  }, []);

  const fetchRunHistory = useCallback(async (issueKey: string): Promise<Run[]> => {
    const res = await fetch(`/api/history/${encodeURIComponent(issueKey)}`);
    if (!res.ok) return [];
    return res.json();
  }, []);

  const fetchRunLogs = useCallback(async (runId: string) => {
    try {
      const res = await fetch(`/api/runs/${runId}/logs`);
      if (!res.ok) return;
      const logs: { phase: RunPhase; line: string }[] = await res.json();
      dispatch({ type: "LogsBulkLoaded", runId, logs });
    } catch {
      // ignore fetch errors
    }
  }, []);

  const fetchProgress = useCallback(async (runId: string): Promise<string | null> => {
    const res = await fetch(`/api/runs/${runId}/progress`);
    if (!res.ok) return null;
    return res.text();
  }, []);

  const stopRun = useCallback(async (runId: string) => {
    await fetch(`/api/runs/${runId}/stop`, { method: "POST" });
  }, []);

  const approveRun = useCallback(async (runId: string) => {
    const res = await fetch(`/api/runs/${runId}/approve`, { method: "POST" });
    return res.json();
  }, []);

  const rejectRun = useCallback(async (runId: string) => {
    await fetch(`/api/runs/${runId}/reject`, { method: "POST" });
  }, []);

  const retryRun = useCallback(async (runId: string) => {
    const res = await fetch(`/api/runs/${runId}/retry`, { method: "POST" });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || "Retry failed");
    }
    return data;
  }, []);

  const openInEditor = useCallback(async (runId: string) => {
    const res = await fetch(`/api/runs/${runId}/open-editor`, { method: "POST" });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || "Failed to open editor");
    }
    return data;
  }, []);

  const setOnRunEvent = useCallback((cb: RunEventCallback | null) => {
    onRunEventRef.current = cb;
  }, []);

  const deleteRun = useCallback(async (runId: string) => {
    const res = await fetch(`/api/runs/${runId}`, { method: "DELETE" });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || "Delete failed");
    }
    return data;
  }, []);

  return {
    runs,
    loading,
    connected,
    startRun,
    startRunForIssue,
    stopRun,
    approveRun,
    rejectRun,
    retryRun,
    deleteRun,
    openInEditor,
    setOnRunEvent,
    fetchRunHistory,
    fetchRunLogs,
    fetchProgress,
    progressMap,
  };
}
