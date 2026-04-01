import React, { useState } from "react";
import type { PrdEntry } from "../types";

interface PlanViewerProps {
  prd: PrdEntry[];
  runIsActive: boolean;
}

function CategoryBadge({ category }: { category: string }) {
  const variant =
    category === "feature"
      ? "us-plan__cat--feature"
      : category === "chore"
        ? "us-plan__cat--chore"
        : category === "bug"
          ? "us-plan__cat--bug"
          : "us-plan__cat--other";
  return <span className={`us-plan__cat ${variant}`}>{category}</span>;
}

export function PlanViewer({ prd, runIsActive }: PlanViewerProps) {
  const [expandedIds, setExpandedIds] = useState<Set<number>>(() => {
    // Expand incomplete entries by default, collapse completed ones
    const set = new Set<number>();
    for (const entry of prd) {
      if (!entry.completed) set.add(entry.id);
    }
    return set;
  });

  if (prd.length === 0) {
    return (
      <div className="us-plan us-plan--empty">
        <p className="us-plan__empty-text">
          {runIsActive ? "No plan entries yet" : "No plan was recorded"}
        </p>
      </div>
    );
  }

  const toggle = (id: number) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="us-plan">
      {prd.map((entry) => {
        const expanded = expandedIds.has(entry.id);
        return (
          <div
            key={entry.id}
            className={`us-plan__entry${entry.completed ? " us-plan__entry--done" : ""}`}
          >
            <button
              className="us-plan__entry-header"
              onClick={() => toggle(entry.id)}
              aria-expanded={expanded}
            >
              <span className={`us-plan__check${entry.completed ? " us-plan__check--done" : ""}`}>
                {entry.completed ? (
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                    <path d="M13.5 4.5L6.5 11.5L2.5 7.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                ) : (
                  <span className="us-plan__check-empty" />
                )}
              </span>
              <span className="us-plan__entry-title">
                <span className="us-plan__entry-id">#{entry.id}</span>
                {entry.description}
              </span>
              <CategoryBadge category={entry.category} />
              <svg
                className={`us-plan__chevron${expanded ? " us-plan__chevron--open" : ""}`}
                width="14"
                height="14"
                viewBox="0 0 16 16"
                fill="none"
              >
                <path d="M6 4L10 8L6 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>

            {expanded && (
              <div className="us-plan__entry-body">
                {entry.steps.length > 0 && (
                  <ol className="us-plan__steps">
                    {entry.steps.map((step, i) => (
                      <li key={i} className="us-plan__step">{step}</li>
                    ))}
                  </ol>
                )}
                {entry.validation.length > 0 && (
                  <div className="us-plan__validation">
                    <span className="us-plan__validation-label">Validation</span>
                    {entry.validation.map((cmd, i) => (
                      <code key={i} className="us-plan__validation-cmd">{cmd}</code>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
