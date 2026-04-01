import React, { useEffect, useRef } from "react";

interface ProgressViewerProps {
  progressText: string | undefined;
  runIsActive: boolean;
}

export function ProgressViewer({ progressText, runIsActive }: ProgressViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new content arrives
  useEffect(() => {
    if (containerRef.current && progressText) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [progressText]);

  if (!progressText) {
    return (
      <div className="us-progress us-progress--empty">
        <p className="us-progress__empty-text">
          {runIsActive ? "No progress updates yet" : "No progress was recorded"}
        </p>
      </div>
    );
  }

  return (
    <div className="us-progress">
      {runIsActive && (
        <div className="us-progress__live-bar">
          <span className="us-progress__live-dot" />
          <span className="us-progress__live-label">Live</span>
        </div>
      )}
      <div className="us-progress__container" ref={containerRef}>
        <pre className="us-progress__text">{progressText}</pre>
      </div>
    </div>
  );
}
