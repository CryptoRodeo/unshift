import { EventEmitter } from "node:events";
import * as pty from "node-pty";

const DEFAULT_HISTORY_BYTES = 256 * 1024; // 256KB

interface PtySession {
  pty: pty.IPty;
  historyBuffer: Buffer[];
  historySize: number;
}

export class PtyManager extends EventEmitter {
  private sessions = new Map<string, PtySession>();
  private maxHistoryBytes: number;

  constructor(maxHistoryBytes = DEFAULT_HISTORY_BYTES) {
    super();
    this.maxHistoryBytes = maxHistoryBytes;
  }

  spawn(
    runId: string,
    command: string,
    args: string[],
    cwd: string,
    env: Record<string, string>,
  ): pty.IPty {
    const term = pty.spawn(command, args, {
      name: "xterm-256color",
      cols: 120,
      rows: 40,
      cwd,
      env: { ...process.env, ...env } as Record<string, string>,
    });

    const session: PtySession = {
      pty: term,
      historyBuffer: [],
      historySize: 0,
    };
    this.sessions.set(runId, session);

    // UTF-8 byte buffer for preventing split multi-byte characters
    let pendingBytes = Buffer.alloc(0);

    term.onData((rawData: string) => {
      const chunk = Buffer.from(rawData, "binary");
      const combined = pendingBytes.length > 0
        ? Buffer.concat([pendingBytes, chunk])
        : chunk;

      const { safe, remainder } = splitUtf8(combined);
      pendingBytes = remainder;

      if (safe.length === 0) return;

      // Buffer for history replay
      session.historyBuffer.push(safe);
      session.historySize += safe.length;

      // Trim history if over limit
      while (session.historySize > this.maxHistoryBytes && session.historyBuffer.length > 1) {
        const removed = session.historyBuffer.shift()!;
        session.historySize -= removed.length;
      }

      this.emit("output", runId, safe.toString("utf-8"));
    });

    term.onExit(({ exitCode }) => {
      // Flush remaining bytes
      if (pendingBytes.length > 0) {
        const flushed = pendingBytes.toString("utf-8");
        pendingBytes = Buffer.alloc(0);
        this.emit("output", runId, flushed);
      }
      this.sessions.delete(runId);
      this.emit("exit", runId, exitCode);
    });

    return term;
  }

  write(runId: string, data: string): void {
    this.sessions.get(runId)?.pty.write(data);
  }

  resize(runId: string, cols: number, rows: number): void {
    this.sessions.get(runId)?.pty.resize(cols, rows);
  }

  kill(runId: string): void {
    const session = this.sessions.get(runId);
    if (session) {
      session.pty.kill();
    }
  }

  getHistory(runId: string): string | null {
    const session = this.sessions.get(runId);
    if (!session) return null;
    return Buffer.concat(session.historyBuffer).toString("utf-8");
  }

  has(runId: string): boolean {
    return this.sessions.has(runId);
  }

  getPid(runId: string): number | undefined {
    return this.sessions.get(runId)?.pty.pid;
  }
}

/**
 * Split a buffer at a UTF-8 safe boundary.
 * Returns { safe, remainder } where `safe` ends at a complete character
 * and `remainder` contains any trailing incomplete bytes.
 */
function splitUtf8(buf: Buffer): { safe: Buffer; remainder: Buffer } {
  if (buf.length === 0) return { safe: buf, remainder: Buffer.alloc(0) };

  // Walk backwards from the end to find any incomplete multi-byte sequence
  let i = buf.length - 1;
  // If last byte is a continuation byte (10xxxxxx), walk back to find the lead byte
  while (i >= 0 && (buf[i] & 0xc0) === 0x80) {
    i--;
  }

  if (i < 0) {
    // All continuation bytes with no lead — treat as remainder
    return { safe: Buffer.alloc(0), remainder: buf };
  }

  const leadByte = buf[i];
  let expectedLen: number;
  if ((leadByte & 0x80) === 0) expectedLen = 1;       // 0xxxxxxx
  else if ((leadByte & 0xe0) === 0xc0) expectedLen = 2; // 110xxxxx
  else if ((leadByte & 0xf0) === 0xe0) expectedLen = 3; // 1110xxxx
  else if ((leadByte & 0xf8) === 0xf0) expectedLen = 4; // 11110xxx
  else expectedLen = 1; // Invalid lead byte, treat as single byte

  const available = buf.length - i;
  if (available >= expectedLen) {
    // Complete character at the end
    return { safe: buf, remainder: Buffer.alloc(0) };
  }

  // Incomplete character — split before the lead byte
  return {
    safe: buf.subarray(0, i),
    remainder: buf.subarray(i),
  };
}
