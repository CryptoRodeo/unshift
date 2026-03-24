import { useState, useEffect, useMemo } from "react";
import {
  Card,
  CardTitle,
  CardBody,
  Button,
  Flex,
  FlexItem,
  Spinner,
  Alert,
} from "@patternfly/react-core";
import { CopyIcon } from "@patternfly/react-icons";

interface DiffData {
  stat: string;
  diff: string;
  files: number;
  insertions: number;
  deletions: number;
}

interface DiffFile {
  header: string;
  fileName: string;
  hunks: string;
}

const MAX_DIFF_SIZE = 500 * 1024; // 500KB

function parseDiffFiles(raw: string): DiffFile[] {
  const parts = raw.split(/^diff --git /m);
  return parts.slice(1).map((part) => {
    const lines = part.split("\n");
    const header = `diff --git ${lines[0]}`;
    const fileMatch = lines[0].match(/b\/(.+)$/);
    const fileName = fileMatch ? fileMatch[1] : lines[0];
    return { header, fileName, hunks: lines.slice(1).join("\n") };
  });
}

export function DiffViewer({ runId }: { runId: string }) {
  const [data, setData] = useState<DiffData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetch(`/api/runs/${runId}/diff`)
      .then((r) => {
        if (!r.ok) return r.json().then((e) => Promise.reject(new Error(e.error)));
        return r.json();
      })
      .then((d) => setData(d))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [runId]);

  const files = useMemo(() => {
    if (!data?.diff) return [];
    return parseDiffFiles(data.diff);
  }, [data?.diff]);

  const isLarge = data && data.diff.length > MAX_DIFF_SIZE;

  const toggleFile = (idx: number) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  const handleCopy = () => {
    if (!data) return;
    navigator.clipboard.writeText(data.diff).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  if (loading) {
    return (
      <Card>
        <CardBody>
          <Flex justifyContent={{ default: "justifyContentCenter" }}>
            <Spinner size="lg" />
          </Flex>
        </CardBody>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardBody>
          <Alert variant="warning" title="Could not load diff" isInline>
            {error}
          </Alert>
        </CardBody>
      </Card>
    );
  }

  if (!data || (!data.diff && !data.stat)) {
    return null;
  }

  return (
    <Card>
      <CardTitle>
        <Flex justifyContent={{ default: "justifyContentSpaceBetween" }} alignItems={{ default: "alignItemsCenter" }}>
          <FlexItem>
            Code Changes &mdash;{" "}
            <span style={{ fontWeight: "normal", fontSize: "0.9em" }}>
              {data.files} file{data.files !== 1 ? "s" : ""} changed,{" "}
              <span style={{ color: "var(--pf-v5-global--success-color--100)" }}>+{data.insertions}</span>{" "}
              <span style={{ color: "var(--pf-v5-global--danger-color--100)" }}>&minus;{data.deletions}</span>
            </span>
          </FlexItem>
          <FlexItem>
            <Button variant="plain" icon={<CopyIcon />} onClick={handleCopy}>
              {copied ? "Copied!" : "Copy diff"}
            </Button>
          </FlexItem>
        </Flex>
      </CardTitle>
      <CardBody style={{ padding: 0 }}>
        {isLarge ? (
          <div style={{ padding: "1rem" }}>
            <Alert variant="info" title="Diff too large to display inline" isInline>
              <p>This diff is over 500KB. Showing summary only. Open in your editor for the full diff.</p>
            </Alert>
            <pre style={{ marginTop: "1rem", fontSize: "0.85rem", whiteSpace: "pre-wrap" }}>{data.stat}</pre>
          </div>
        ) : (
          files.map((file, idx) => (
            <div key={idx} style={{ borderBottom: "1px solid var(--pf-v5-global--BorderColor--100)" }}>
              <div
                onClick={() => toggleFile(idx)}
                style={{
                  padding: "0.5rem 1rem",
                  cursor: "pointer",
                  fontFamily: "monospace",
                  fontSize: "0.85rem",
                  fontWeight: 600,
                  background: "var(--pf-v5-global--BackgroundColor--200)",
                  userSelect: "none",
                }}
              >
                {collapsed.has(idx) ? "\u25B6" : "\u25BC"} {file.fileName}
              </div>
              {!collapsed.has(idx) && (
                <pre
                  style={{
                    margin: 0,
                    padding: "0.5rem 1rem",
                    fontSize: "0.8rem",
                    overflow: "auto",
                    lineHeight: 1.5,
                  }}
                >
                  {file.hunks.split("\n").map((line, i) => {
                    let bg = "transparent";
                    let color = "inherit";
                    if (line.startsWith("+")) {
                      bg = "var(--pf-v5-global--palette--green-50, #e6f9e6)";
                      color = "var(--pf-v5-global--success-color--200, #1e4620)";
                    } else if (line.startsWith("-")) {
                      bg = "var(--pf-v5-global--palette--red-50, #fce4e4)";
                      color = "var(--pf-v5-global--danger-color--300, #7d1007)";
                    } else if (line.startsWith("@@")) {
                      color = "var(--pf-v5-global--info-color--100, #06c)";
                    }
                    return (
                      <div key={i} style={{ background: bg, color, padding: "0 0.25rem" }}>
                        {line}
                      </div>
                    );
                  })}
                </pre>
              )}
            </div>
          ))
        )}
      </CardBody>
    </Card>
  );
}
