import { useEffect, useRef, useCallback, useState } from "react";
import type { WsMessage, Run } from "../types";

export function useWebSocket() {
  const wsRef = useRef<WebSocket | null>(null);
  const [runs, setRuns] = useState<Map<string, Run>>(new Map());
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
    wsRef.current = ws;

    ws.onopen = () => setConnected(true);
    ws.onclose = () => setConnected(false);

    ws.onmessage = (event) => {
      const msg: WsMessage = JSON.parse(event.data);

      setRuns((prev) => {
        const next = new Map(prev);

        switch (msg.type) {
          case "run:created":
            next.set(msg.run.id, msg.run);
            break;

          case "run:phase": {
            const run = next.get(msg.runId);
            if (run) next.set(msg.runId, { ...run, status: msg.phase });
            break;
          }

          case "run:log": {
            const run = next.get(msg.runId);
            if (run)
              next.set(msg.runId, {
                ...run,
                logs: [...run.logs, { phase: msg.phase, line: msg.line }],
              });
            break;
          }

          case "run:prd": {
            const run = next.get(msg.runId);
            if (run) next.set(msg.runId, { ...run, prd: msg.prd });
            break;
          }

          case "run:complete": {
            const run = next.get(msg.runId);
            if (run)
              next.set(msg.runId, {
                ...run,
                status: msg.status,
                completedAt: new Date().toISOString(),
              });
            break;
          }
        }

        return next;
      });
    };

    // On connect, fetch existing runs
    fetch("/api/runs")
      .then((res) => res.json())
      .then((existing: Run[]) => {
        setRuns((prev) => {
          const next = new Map(prev);
          for (const run of existing) {
            if (!next.has(run.id)) next.set(run.id, run);
          }
          return next;
        });
      })
      .catch(() => {});

    return () => ws.close();
  }, []);

  const startRun = useCallback(async () => {
    const res = await fetch("/api/runs", { method: "POST" });
    return res.json();
  }, []);

  const stopRun = useCallback(async (runId: string) => {
    await fetch(`/api/runs/${runId}/stop`, { method: "POST" });
  }, []);

  return { runs, connected, startRun, stopRun };
}
