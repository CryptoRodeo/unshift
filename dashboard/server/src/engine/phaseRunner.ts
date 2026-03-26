import {
  generateText,
  stepCountIs,
  type LanguageModel,
  type StepResult,
  type ToolSet,
} from "ai";

export interface PhaseRunnerOptions {
  model: LanguageModel;
  systemPrompt: string;
  userPrompt: string;
  tools: ToolSet;
  maxSteps?: number;
  cwd: string;
  onLog?: (line: string) => void;
  onStepFinish?: (step: StepResult<ToolSet>) => void;
  signal?: AbortSignal;
}

export interface PhaseResult {
  text: string;
  usage: { inputTokens: number; outputTokens: number };
  steps: number;
  model: string;
}

export async function runPhase(options: PhaseRunnerOptions): Promise<PhaseResult> {
  const {
    model,
    systemPrompt,
    userPrompt,
    tools,
    maxSteps = 50,
    onLog,
    onStepFinish,
    signal,
  } = options;

  const result = await generateText({
    model,
    system: systemPrompt,
    prompt: userPrompt,
    tools,
    stopWhen: stepCountIs(maxSteps),
    abortSignal: signal,
    onStepFinish(step) {
      if (onStepFinish) {
        onStepFinish(step);
      }
      if (onLog) {
        if (step.text) {
          onLog(`[assistant] ${step.text}`);
        }
        for (const toolCall of step.toolCalls) {
          onLog(`[tool_call] ${toolCall.toolName}(${JSON.stringify(toolCall.input)})`);
        }
        for (const toolResult of step.toolResults) {
          const resultStr = typeof toolResult.output === "string"
            ? toolResult.output
            : JSON.stringify(toolResult.output);
          const truncated = resultStr.length > 500
            ? resultStr.slice(0, 500) + "..."
            : resultStr;
          onLog(`[tool_result] ${toolResult.toolName}: ${truncated}`);
        }
      }
    },
  });

  return {
    text: result.text,
    usage: {
      inputTokens: result.totalUsage.inputTokens ?? 0,
      outputTokens: result.totalUsage.outputTokens ?? 0,
    },
    steps: result.steps.length,
    model: result.response.modelId,
  };
}
