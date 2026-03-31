import { useState, useCallback, useMemo } from "react";

/* ------------------------------------------------------------------ */
/*  Diff parser                                                        */
/* ------------------------------------------------------------------ */

interface DiffFile {
  filename: string;
  hunks: DiffLine[][];
}

interface DiffLine {
  type: "add" | "del" | "context" | "hunk-header";
  content: string;
}

function parseDiff(raw: string): DiffFile[] {
  const files: DiffFile[] = [];
  // Split on "diff --git" boundaries
  const chunks = raw.split(/^diff --git /m).filter(Boolean);

  for (const chunk of chunks) {
    const lines = chunk.split("\n");
    let filename = "";

    // Extract filename from +++ b/... line
    for (const line of lines) {
      if (line.startsWith("+++ b/")) {
        filename = line.slice(6);
        break;
      }
      if (line.startsWith("+++ /dev/null")) {
        // File was deleted — use --- a/... instead
        const minusLine = lines.find((l) => l.startsWith("--- a/"));
        filename = minusLine ? minusLine.slice(6) + " (deleted)" : "(deleted)";
        break;
      }
    }

    if (!filename) {
      // Fallback: parse from the "diff --git a/... b/..." header
      const match = lines[0]?.match(/^a\/(.+?) b\//);
      if (match) filename = match[1];
      else continue;
    }

    const hunks: DiffLine[][] = [];
    let currentHunk: DiffLine[] = [];

    for (const line of lines) {
      if (line.startsWith("@@")) {
        if (currentHunk.length > 0) hunks.push(currentHunk);
        currentHunk = [{ type: "hunk-header", content: line }];
      } else if (line.startsWith("+") && !line.startsWith("+++")) {
        currentHunk.push({ type: "add", content: line });
      } else if (line.startsWith("-") && !line.startsWith("---")) {
        currentHunk.push({ type: "del", content: line });
      } else if (line.startsWith(" ")) {
        currentHunk.push({ type: "context", content: line });
      } else if (line.startsWith("Binary files")) {
        currentHunk.push({ type: "context", content: line });
      }
    }
    if (currentHunk.length > 0) hunks.push(currentHunk);

    if (hunks.length > 0) {
      files.push({ filename, hunks });
    }
  }

  return files;
}

/* ------------------------------------------------------------------ */
/*  File section                                                       */
/* ------------------------------------------------------------------ */

function DiffFileSection({ file }: { file: DiffFile }) {
  const [expanded, setExpanded] = useState(true);

  const stats = useMemo(() => {
    let adds = 0;
    let dels = 0;
    for (const hunk of file.hunks) {
      for (const line of hunk) {
        if (line.type === "add") adds++;
        else if (line.type === "del") dels++;
      }
    }
    return { adds, dels };
  }, [file]);

  return (
    <div className="us-diff__file">
      <button
        className="us-diff__file-header"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        <svg
          className={`us-diff__chevron${expanded ? " us-diff__chevron--open" : ""}`}
          viewBox="0 0 16 16"
          fill="currentColor"
          width="12"
          height="12"
        >
          <path d="M6.22 3.22a.75.75 0 011.06 0l4.25 4.25a.75.75 0 010 1.06l-4.25 4.25a.75.75 0 01-1.06-1.06L9.94 8 6.22 4.28a.75.75 0 010-1.06z" />
        </svg>
        <span className="us-diff__filename">{file.filename}</span>
        <span className="us-diff__stats">
          {stats.adds > 0 && <span className="us-diff__stat-add">+{stats.adds}</span>}
          {stats.dels > 0 && <span className="us-diff__stat-del">-{stats.dels}</span>}
        </span>
      </button>
      {expanded && (
        <pre className="us-diff__code">
          {file.hunks.map((hunk, hi) =>
            hunk.map((line, li) => (
              <div
                key={`${hi}-${li}`}
                className={`us-diff__line us-diff__line--${line.type}`}
              >
                {line.content}
              </div>
            ))
          )}
        </pre>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main DiffViewer component                                          */
/* ------------------------------------------------------------------ */

interface DiffViewerProps {
  runId: string;
}

export function DiffViewer({ runId }: DiffViewerProps) {
  const [expanded, setExpanded] = useState(false);
  const [diff, setDiff] = useState<string | null | undefined>(undefined); // undefined = not fetched
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  const handleToggle = useCallback(() => {
    const willExpand = !expanded;
    setExpanded(willExpand);

    // Fetch on first expand only
    if (willExpand && diff === undefined && !loading) {
      setLoading(true);
      setError(false);
      fetch(`/api/runs/${runId}/diff`)
        .then((res) => res.json() as Promise<{ diff: string | null }>)
        .then((data) => {
          setDiff(data.diff);
        })
        .catch(() => {
          setError(true);
        })
        .finally(() => {
          setLoading(false);
        });
    }
  }, [expanded, diff, loading, runId]);

  const files = useMemo(() => {
    if (!diff) return [];
    return parseDiff(diff);
  }, [diff]);

  return (
    <div className="us-diff">
      <button
        className="us-diff__toggle"
        onClick={handleToggle}
        aria-expanded={expanded}
      >
        <svg
          className={`us-diff__chevron${expanded ? " us-diff__chevron--open" : ""}`}
          viewBox="0 0 16 16"
          fill="currentColor"
          width="14"
          height="14"
        >
          <path d="M6.22 3.22a.75.75 0 011.06 0l4.25 4.25a.75.75 0 010 1.06l-4.25 4.25a.75.75 0 01-1.06-1.06L9.94 8 6.22 4.28a.75.75 0 010-1.06z" />
        </svg>
        <svg viewBox="0 0 16 16" fill="currentColor" width="16" height="16" className="us-diff__icon">
          <path d="M8.75 1.75a.75.75 0 00-1.5 0V5H4a.75.75 0 000 1.5h3.25v3.25a.75.75 0 001.5 0V6.5H12A.75.75 0 0012 5H8.75V1.75zM4 13a.75.75 0 000 1.5h8a.75.75 0 000-1.5H4z" />
        </svg>
        <span className="us-diff__title">Changes</span>
        {files.length > 0 && (
          <span className="us-diff__file-count">
            {files.length} file{files.length !== 1 ? "s" : ""}
          </span>
        )}
      </button>

      {expanded && (
        <div className="us-diff__content">
          {loading && (
            <div className="us-diff__status">Loading diff...</div>
          )}
          {error && (
            <div className="us-diff__status us-diff__status--error">
              Failed to load diff.
            </div>
          )}
          {!loading && !error && diff === null && (
            <div className="us-diff__status">
              Diff unavailable. The worktree may have been cleaned up.
            </div>
          )}
          {!loading && !error && diff !== null && diff !== undefined && files.length === 0 && (
            <div className="us-diff__status">No changes detected.</div>
          )}
          {files.map((file) => (
            <DiffFileSection key={file.filename} file={file} />
          ))}
        </div>
      )}
    </div>
  );
}
