import { Progress, ProgressMeasureLocation } from "@patternfly/react-core";
import { getContextWindow, getProgressColor } from "../../../shared/context";
import { formatTokenCount } from "../../../shared/pricing";

interface ContextProgressBarProps {
  contextTokens: number;
  model?: string;
  isActive: boolean;
}

const COLOR_MAP = {
  green: "var(--pf-t--global--color--status--success--default)",
  orange: "var(--pf-t--global--color--status--warning--default)",
  red: "var(--pf-t--global--color--status--danger--default)",
} as const;

export function ContextProgressBar({ contextTokens, model, isActive }: ContextProgressBarProps) {
  if (!isActive || contextTokens <= 0) return null;

  const effectiveMax = getContextWindow(model, contextTokens);
  const pct = Math.min(Math.round((contextTokens / effectiveMax) * 100), 100);
  const color = getProgressColor(pct);

  return (
    <div style={{ maxWidth: 400 }}>
      <div style={{ fontSize: "0.85rem", marginBottom: 4, color: "var(--pf-t--global--text--color--subtle)" }}>
        Context: {formatTokenCount(contextTokens)} / {formatTokenCount(effectiveMax)}
      </div>
      <Progress
        value={pct}
        measureLocation={ProgressMeasureLocation.none}
        style={{ "--pf-v6-c-progress__bar--before--BackgroundColor": COLOR_MAP[color] } as React.CSSProperties}
      />
    </div>
  );
}
