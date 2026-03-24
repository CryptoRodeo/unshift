import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { PHASE_LABELS } from "../types";
import type { RunPhase, LogEntry } from "../types";
import { SearchIcon, TimesIcon, AngleUpIcon, AngleDownIcon, AngleDoubleDownIcon } from "@patternfly/react-icons";

interface LogLine {
  lineNumber: number;
  text: string;
  phase: RunPhase;
  level: "error" | "warn" | "success" | "info";
}

function classifyLevel(line: string): LogLine["level"] {
  if (/\berror\b|\bERROR\b|\bfailed\b|\bFAILED\b|\bException\b/i.test(line)) return "error";
  if (/\bwarn\b|\bWARN\b|\bwarning\b|\bWARNING\b/i.test(line)) return "warn";
  if (/\bsuccess\b|\bSUCCESS\b|\bcomplete[d]?\b|\bCOMPLETE[D]?\b|\bpassed\b|\bPASSED\b/i.test(line)) return "success";
  return "info";
}

function buildLogLines(logs: LogEntry[]): { lines: LogLine[]; phaseBoundaries: Map<number, RunPhase> } {
  const lines: LogLine[] = [];
  const phaseBoundaries = new Map<number, RunPhase>();
  let currentPhase: RunPhase | null = null;
  let lineNumber = 1;

  for (const entry of logs) {
    if (entry.phase !== currentPhase) {
      phaseBoundaries.set(lineNumber, entry.phase);
      currentPhase = entry.phase;
    }
    lines.push({
      lineNumber: lineNumber++,
      text: entry.line,
      phase: entry.phase,
      level: classifyLevel(entry.line),
    });
  }
  return { lines, phaseBoundaries };
}

export function RunLogsCard({
  logs,
  status,
}: {
  logs: LogEntry[];
  status: RunPhase;
  expandedSections?: Set<string>;
  onToggleSection?: (phase: string, expanded: boolean) => void;
}) {
  const [searchQuery, setSearchQuery] = useState("");
  const [matchIndex, setMatchIndex] = useState(0);
  const [showSearch, setShowSearch] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const [showScrollBtn, setShowScrollBtn] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const prevLogCount = useRef(logs.length);

  const isActive = !["success", "failed", "stopped", "rejected"].includes(status);

  const { lines, phaseBoundaries } = useMemo(() => buildLogLines(logs), [logs]);

  // Find search matches
  const matchedLineNumbers = useMemo(() => {
    if (!searchQuery.trim()) return [];
    const q = searchQuery.toLowerCase();
    return lines
      .filter((l) => l.text.toLowerCase().includes(q))
      .map((l) => l.lineNumber);
  }, [lines, searchQuery]);

  // Clamp matchIndex
  useEffect(() => {
    if (matchedLineNumbers.length > 0 && matchIndex >= matchedLineNumbers.length) {
      setMatchIndex(0);
    }
  }, [matchedLineNumbers, matchIndex]);

  // Scroll to current match
  useEffect(() => {
    if (matchedLineNumbers.length === 0) return;
    const lineNum = matchedLineNumbers[matchIndex];
    const el = containerRef.current?.querySelector(`[data-line="${lineNum}"]`);
    if (el) el.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [matchIndex, matchedLineNumbers]);

  // Auto-scroll on new logs
  useEffect(() => {
    if (autoScroll && logs.length > prevLogCount.current) {
      const el = containerRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    }
    prevLogCount.current = logs.length;
  }, [logs.length, autoScroll]);

  // Detect scroll position
  const handleScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    setAutoScroll(nearBottom);
    setShowScrollBtn(!nearBottom && el.scrollHeight > el.clientHeight);
  }, []);

  const scrollToBottom = useCallback(() => {
    const el = containerRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
      setAutoScroll(true);
      setShowScrollBtn(false);
    }
  }, []);

  // Toggle search with Ctrl+F / Cmd+F
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "f") {
        e.preventDefault();
        setShowSearch(true);
        setTimeout(() => searchInputRef.current?.focus(), 0);
      }
      if (e.key === "Escape" && showSearch) {
        setShowSearch(false);
        setSearchQuery("");
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [showSearch]);

  const matchedSet = useMemo(() => new Set(matchedLineNumbers), [matchedLineNumbers]);
  const currentMatchLine = matchedLineNumbers[matchIndex] ?? -1;

  const currentPhaseLabel = PHASE_LABELS[status] ?? status;

  return (
    <div className="us-log-viewer">
      {/* Header with phase label and search */}
      <div className="us-log-viewer__header">
        <span className="us-log-viewer__phase-label">
          {isActive ? `● ${currentPhaseLabel}` : "Logs"}
        </span>
        <div className="us-log-viewer__header-actions">
          {showSearch ? (
            <div className="us-log-viewer__search">
              <SearchIcon className="us-log-viewer__search-icon" />
              <input
                ref={searchInputRef}
                className="us-log-viewer__search-input"
                type="text"
                placeholder="Search logs..."
                value={searchQuery}
                onChange={(e) => { setSearchQuery(e.target.value); setMatchIndex(0); }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    if (e.shiftKey) {
                      setMatchIndex((i) => (i - 1 + matchedLineNumbers.length) % matchedLineNumbers.length);
                    } else {
                      setMatchIndex((i) => (i + 1) % matchedLineNumbers.length);
                    }
                  }
                }}
              />
              {matchedLineNumbers.length > 0 && (
                <span className="us-log-viewer__search-count">
                  {matchIndex + 1}/{matchedLineNumbers.length}
                </span>
              )}
              {searchQuery && matchedLineNumbers.length === 0 && (
                <span className="us-log-viewer__search-count us-log-viewer__search-count--none">
                  0 results
                </span>
              )}
              <button
                className="us-log-viewer__search-nav"
                onClick={() => setMatchIndex((i) => (i - 1 + matchedLineNumbers.length) % matchedLineNumbers.length)}
                disabled={matchedLineNumbers.length === 0}
                aria-label="Previous match"
              >
                <AngleUpIcon />
              </button>
              <button
                className="us-log-viewer__search-nav"
                onClick={() => setMatchIndex((i) => (i + 1) % matchedLineNumbers.length)}
                disabled={matchedLineNumbers.length === 0}
                aria-label="Next match"
              >
                <AngleDownIcon />
              </button>
              <button
                className="us-log-viewer__search-nav"
                onClick={() => { setShowSearch(false); setSearchQuery(""); }}
                aria-label="Close search"
              >
                <TimesIcon />
              </button>
            </div>
          ) : (
            <button
              className="us-log-viewer__search-toggle"
              onClick={() => { setShowSearch(true); setTimeout(() => searchInputRef.current?.focus(), 0); }}
              aria-label="Search logs"
            >
              <SearchIcon />
            </button>
          )}
        </div>
      </div>

      {/* Log content */}
      <div className="us-log-viewer__body" ref={containerRef} onScroll={handleScroll}>
        {lines.length === 0 ? (
          <div className="us-log-viewer__empty">Waiting for output...</div>
        ) : (
          lines.map((line) => {
            const showSeparator = phaseBoundaries.has(line.lineNumber);
            const isMatch = matchedSet.has(line.lineNumber);
            const isCurrent = line.lineNumber === currentMatchLine;
            return (
              <div key={line.lineNumber}>
                {showSeparator && (
                  <div className="us-log-viewer__separator">
                    <span className="us-log-viewer__separator-label">
                      {PHASE_LABELS[phaseBoundaries.get(line.lineNumber)!] ?? phaseBoundaries.get(line.lineNumber)}
                    </span>
                  </div>
                )}
                <div
                  className={`us-log-viewer__line us-log-viewer__line--${line.level}${isMatch ? " us-log-viewer__line--match" : ""}${isCurrent ? " us-log-viewer__line--current" : ""}`}
                  data-line={line.lineNumber}
                >
                  <span className="us-log-viewer__gutter">{line.lineNumber}</span>
                  <span className="us-log-viewer__text">{line.text}</span>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Scroll to bottom button */}
      {showScrollBtn && (
        <button className="us-log-viewer__scroll-btn" onClick={scrollToBottom} aria-label="Scroll to bottom">
          <AngleDoubleDownIcon />
          {isActive && <span>Follow</span>}
        </button>
      )}
    </div>
  );
}
