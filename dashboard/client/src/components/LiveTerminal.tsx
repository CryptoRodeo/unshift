import { useEffect, useRef, useCallback, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";

interface LiveTerminalProps {
  runId: string;
  isActive: boolean;
  /** If true, render full-screen for popup mode */
  fullScreen?: boolean;
}

export function LiveTerminal({ runId, isActive, fullScreen }: LiveTerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const rafBufferRef = useRef<string[]>([]);
  const rafIdRef = useRef<number | null>(null);
  const historyCompleteRef = useRef(false);
  const [connected, setConnected] = useState(false);

  const flushBuffer = useCallback(() => {
    rafIdRef.current = null;
    const term = termRef.current;
    if (!term || rafBufferRef.current.length === 0) return;
    const combined = rafBufferRef.current.join("");
    rafBufferRef.current = [];
    term.write(combined);
  }, []);

  useEffect(() => {
    if (!containerRef.current) return;

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', Menlo, monospace",
      theme: {
        background: "#1e1e2e",
        foreground: "#cdd6f4",
        cursor: "#f5e0dc",
        selectionBackground: "#585b7066",
      },
      scrollback: 10000,
      convertEol: true,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(containerRef.current);
    fitAddon.fit();

    termRef.current = term;
    fitAddonRef.current = fitAddon;

    // Connect to WebSocket
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      ws.send(JSON.stringify({ type: "terminal:attach", runId }));
    };

    ws.onclose = () => {
      setConnected(false);
    };

    ws.onmessage = (event) => {
      let msg: { type: string; runId?: string; data?: string };
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }

      if (msg.runId !== runId) return;

      if (msg.type === "terminal:output" && msg.data) {
        if (!historyCompleteRef.current) {
          // During history replay, batch everything
          rafBufferRef.current.push(msg.data);
        } else {
          // Live output — buffer per animation frame for smooth rendering
          rafBufferRef.current.push(msg.data);
          if (rafIdRef.current === null) {
            rafIdRef.current = requestAnimationFrame(flushBuffer);
          }
        }
      }

      if (msg.type === "terminal:history_complete") {
        // Flush all history at once
        historyCompleteRef.current = true;
        if (rafBufferRef.current.length > 0) {
          const combined = rafBufferRef.current.join("");
          rafBufferRef.current = [];
          term.write(combined);
        }
      }
    };

    // Send terminal input to server
    term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "terminal:input", runId, data }));
      }
    });

    // Handle resize
    const resizeObserver = new ResizeObserver(() => {
      fitAddon.fit();
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: "terminal:resize",
          runId,
          cols: term.cols,
          rows: term.rows,
        }));
      }
    });
    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
      if (rafIdRef.current !== null) cancelAnimationFrame(rafIdRef.current);
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "terminal:detach", runId }));
        ws.close();
      }
      term.dispose();
      termRef.current = null;
      fitAddonRef.current = null;
      wsRef.current = null;
    };
  }, [runId, flushBuffer]);

  const handlePopOut = () => {
    const url = `/terminal/${runId}`;
    const title = `Terminal — ${runId.slice(0, 8)}`;
    window.open(url, title, "width=900,height=600,menubar=no,toolbar=no");
  };

  const containerStyle: React.CSSProperties = fullScreen
    ? { width: "100vw", height: "100vh", background: "#1e1e2e" }
    : { height: "500px", background: "#1e1e2e", borderRadius: "6px", overflow: "hidden" };

  return (
    <div style={{ position: "relative" }}>
      {!fullScreen && (
        <div style={{
          display: "flex",
          justifyContent: "flex-end",
          padding: "4px 8px",
          background: "#313244",
          borderRadius: "6px 6px 0 0",
          gap: "8px",
          alignItems: "center",
        }}>
          <span style={{ fontSize: "0.75rem", color: connected ? "#a6e3a1" : "#f38ba8", marginRight: "auto" }}>
            {connected ? "Connected" : "Disconnected"}
            {!isActive && " (session ended)"}
          </span>
          <button
            onClick={handlePopOut}
            style={{
              background: "none",
              border: "1px solid #585b70",
              color: "#cdd6f4",
              padding: "2px 8px",
              borderRadius: "4px",
              cursor: "pointer",
              fontSize: "0.75rem",
            }}
          >
            Pop Out
          </button>
        </div>
      )}
      <div ref={containerRef} style={containerStyle} />
    </div>
  );
}
