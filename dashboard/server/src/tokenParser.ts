export interface TokenUpdate {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
  totalCostUsd?: number;
  model?: string;
  contextTokens?: number;
}

/**
 * Parse a line of Claude Code output for token metrics.
 *
 * Detects two formats:
 * 1. Claude Code JSON result (--output-format json): full JSON with usage/modelUsage/total_cost_usd
 * 2. Claude Code stderr summary lines: "Total cost: $X.XX" / "Total input tokens: N" etc.
 */
export function parseTokenLine(line: string): TokenUpdate | null {
  // Try JSON result format first (claude -p --output-format json)
  if (line.includes('"type":"result"') || line.includes('"total_cost_usd"')) {
    try {
      const parsed = JSON.parse(line);
      if (parsed.type === "result" && parsed.usage) {
        const update: TokenUpdate = {};
        const u = parsed.usage;
        if (typeof u.input_tokens === "number") update.inputTokens = u.input_tokens;
        if (typeof u.output_tokens === "number") update.outputTokens = u.output_tokens;
        if (typeof u.cache_read_input_tokens === "number") update.cacheReadTokens = u.cache_read_input_tokens;
        if (typeof u.cache_creation_input_tokens === "number") update.cacheCreationTokens = u.cache_creation_input_tokens;
        if (typeof parsed.total_cost_usd === "number") update.totalCostUsd = parsed.total_cost_usd;

        // Compute context tokens as sum of all input tokens (input + cache_read + cache_creation)
        const totalInput = (update.inputTokens ?? 0) + (update.cacheReadTokens ?? 0) + (update.cacheCreationTokens ?? 0) + (update.outputTokens ?? 0);
        if (totalInput > 0) update.contextTokens = totalInput;

        // Extract model from modelUsage keys
        if (parsed.modelUsage && typeof parsed.modelUsage === "object") {
          const models = Object.keys(parsed.modelUsage);
          if (models.length > 0) update.model = models[0];
        }

        return update;
      }
    } catch {
      // Not valid JSON, fall through
    }
  }

  // Try text-based patterns from Claude Code stderr
  const costMatch = line.match(/Total cost:\s*\$([0-9.]+)/i);
  if (costMatch) {
    return { totalCostUsd: parseFloat(costMatch[1]) };
  }

  const inputMatch = line.match(/(?:Total )?[Ii]nput tokens?:\s*([\d,]+)/);
  if (inputMatch) {
    return { inputTokens: parseInt(inputMatch[1].replace(/,/g, ""), 10) };
  }

  const outputMatch = line.match(/(?:Total )?[Oo]utput tokens?:\s*([\d,]+)/);
  if (outputMatch) {
    return { outputTokens: parseInt(outputMatch[1].replace(/,/g, ""), 10) };
  }

  // Context tokens pattern (Claude Code may report current context usage)
  const contextMatch = line.match(/[Cc]ontext.?tokens?:\s*([\d,]+)/);
  if (contextMatch) {
    return { contextTokens: parseInt(contextMatch[1].replace(/,/g, ""), 10) };
  }

  return null;
}
