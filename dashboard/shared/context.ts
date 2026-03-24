/** Known context window sizes per model (in tokens) */
const CONTEXT_WINDOWS: Record<string, number> = {
  "claude-opus-4-6": 200_000,
  "claude-opus-4-20250916": 200_000,
  "claude-sonnet-4-6": 200_000,
  "claude-sonnet-4-20250514": 200_000,
  "claude-haiku-4-5": 200_000,
  "claude-haiku-4-5-20251001": 200_000,
};

const DEFAULT_CONTEXT_WINDOW = 200_000;

/** Visual tiers for dynamic scaling — contracts the bar max when usage is low */
const CONTEXT_TIERS = [50_000, 100_000, 150_000, 200_000, 300_000, 500_000, 1_000_000];

/**
 * Get the effective context window for display.
 * Uses dynamic scaling: when usage is low, contracts the visual max
 * so the progress bar stays meaningful. Expands when usage grows.
 */
export function getContextWindow(model: string | undefined, tokensUsed: number): number {
  const modelMax = model && CONTEXT_WINDOWS[model] ? CONTEXT_WINDOWS[model] : DEFAULT_CONTEXT_WINDOW;

  // If usage exceeds the known model max, expand to next tier
  if (tokensUsed > modelMax) {
    for (const tier of CONTEXT_TIERS) {
      if (tier > tokensUsed) return tier;
    }
    return CONTEXT_TIERS[CONTEXT_TIERS.length - 1];
  }

  // Dynamic scaling: find the smallest tier that's >= modelMax
  // but also >= tokensUsed * 1.25 (so bar is never > 80% at low usage)
  const minDisplay = Math.max(tokensUsed * 1.25, 50_000);
  if (minDisplay >= modelMax) return modelMax;

  for (const tier of CONTEXT_TIERS) {
    if (tier >= minDisplay && tier <= modelMax) return tier;
  }
  return modelMax;
}

/** Returns a CSS color class name based on context usage percentage */
export function getProgressColor(pct: number): "green" | "orange" | "red" {
  if (pct >= 80) return "red";
  if (pct >= 50) return "orange";
  return "green";
}
