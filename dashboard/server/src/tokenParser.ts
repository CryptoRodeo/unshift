export interface TokenUpdate {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
  model?: string;
}

/**
 * Parse a line of Claude Code output for token metrics.
 *
 * Detects two formats:
 * 1. Claude Code JSON result (--output-format json): full JSON with usage/modelUsage
 * 2. Claude Code stderr summary lines: "Total input tokens: N" etc.
 */
export function parseTokenLine(line: string): TokenUpdate | null {
  // Try JSON result format first (claude -p --output-format json)
  if (line.includes('"type":"result"')) {
    try {
      const parsed = JSON.parse(line);
      if (parsed.type === "result" && parsed.usage) {
        const update: TokenUpdate = {};
        const u = parsed.usage;
        if (typeof u.input_tokens === "number") update.inputTokens = u.input_tokens;
        if (typeof u.output_tokens === "number") update.outputTokens = u.output_tokens;
        if (typeof u.cache_read_input_tokens === "number") update.cacheReadTokens = u.cache_read_input_tokens;
        if (typeof u.cache_creation_input_tokens === "number") update.cacheCreationTokens = u.cache_creation_input_tokens;
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
  const inputMatch = line.match(/(?:Total )?[Ii]nput tokens?:\s*([\d,]+)/);
  if (inputMatch) {
    return { inputTokens: parseInt(inputMatch[1].replace(/,/g, ""), 10) };
  }

  const outputMatch = line.match(/(?:Total )?[Oo]utput tokens?:\s*([\d,]+)/);
  if (outputMatch) {
    return { outputTokens: parseInt(outputMatch[1].replace(/,/g, ""), 10) };
  }

  return null;
}
