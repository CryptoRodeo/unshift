import { runPhase } from "../phaseRunner.js";
import { getDefaultModel, getDefaultConfig } from "../providers.js";
import { createFileTools } from "../toolDefs.js";
import { tmpdir } from "node:os";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import type { LanguageModel } from "ai";

let tempDir: string;

async function setup() {
  tempDir = await mkdtemp(join(tmpdir(), "smoke-phase-"));
  await writeFile(join(tempDir, "hello.txt"), "Hello from smoke test!\n");
  await writeFile(join(tempDir, "data.json"), JSON.stringify({ items: [1, 2, 3] }));
}

async function cleanup() {
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true });
  }
}

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`ASSERTION FAILED: ${message}`);
  }
}

async function resolveModel(): Promise<LanguageModel> {
  // Try direct API key first (standard providers)
  if (process.env.ANTHROPIC_API_KEY?.startsWith("sk-ant-") ||
      process.env.OPENAI_API_KEY ||
      process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    return getDefaultModel();
  }

  // Fall back to Google Vertex AI (Anthropic models via Vertex)
  if (process.env.ANTHROPIC_VERTEX_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT) {
    const { createVertexAnthropic } = await import("@ai-sdk/google-vertex/anthropic");
    const project = process.env.ANTHROPIC_VERTEX_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT!;
    const location = process.env.CLOUD_ML_REGION || "us-east5";
    console.log(`  Using Vertex AI (project=${project}, location=${location})`);
    const vertex = createVertexAnthropic({ project, location });
    return vertex("claude-sonnet-4-6");
  }

  // Last resort: try default (will fail with a clear error if no auth)
  return getDefaultModel();
}

async function testMultiTurnToolUse() {
  console.log("\n=== Test 1: Multi-turn tool use ===");
  const model = await resolveModel();
  const tools = createFileTools(tempDir);

  const stepLogs: string[] = [];
  let stepCount = 0;

  const result = await runPhase({
    model,
    systemPrompt: "You are a helpful assistant. Use the tools provided to answer questions about files in the working directory.",
    userPrompt: "List the files in the current directory using the list_files tool with pattern '**/*' and cwd set to '.', then read the contents of hello.txt using read_file, and summarize what you found.",
    tools,
    maxSteps: 10,
    cwd: tempDir,
    onLog(line) {
      stepLogs.push(line);
    },
    onStepFinish() {
      stepCount++;
    },
  });

  // Verify multi-turn: model should have made at least 2 tool calls (list_files + read_file)
  const toolCallLogs = stepLogs.filter((l) => l.startsWith("[tool_call]"));
  console.log(`  Tool calls made: ${toolCallLogs.length}`);
  for (const log of toolCallLogs) {
    console.log(`    ${log}`);
  }
  assert(toolCallLogs.length >= 2, `Expected at least 2 tool calls, got ${toolCallLogs.length}`);

  // Verify onStepFinish fired
  console.log(`  Steps reported by onStepFinish: ${stepCount}`);
  assert(stepCount > 0, "onStepFinish should have fired at least once");

  // Verify PhaseResult structure
  console.log(`  Result steps: ${result.steps}`);
  console.log(`  Result model: ${result.model}`);
  console.log(`  Token usage: input=${result.usage.inputTokens}, output=${result.usage.outputTokens}`);
  assert(result.steps > 0, "Result should have at least 1 step");
  assert(result.usage.inputTokens > 0, "Input tokens should be > 0");
  assert(result.usage.outputTokens > 0, "Output tokens should be > 0");
  assert(result.model.length > 0, "Model ID should be non-empty");
  assert(result.text.length > 0, "Final text should be non-empty");

  console.log("  PASSED");
}

async function testAbortSignal() {
  console.log("\n=== Test 2: AbortSignal cancellation ===");
  const model = await resolveModel();
  const tools = createFileTools(tempDir);

  const controller = new AbortController();
  // Abort after 500ms to interrupt mid-execution
  setTimeout(() => controller.abort(), 500);

  let aborted = false;
  try {
    await runPhase({
      model,
      systemPrompt: "You are a helpful assistant.",
      userPrompt:
        "Read every file in the directory one at a time using read_file. After reading each file, explain it in great detail with at least 500 words per file. Use list_files first to find all files.",
      tools,
      maxSteps: 50,
      cwd: tempDir,
      signal: controller.signal,
    });
  } catch (err: any) {
    if (err.name === "AbortError" || err.message?.includes("abort")) {
      aborted = true;
    } else {
      throw err;
    }
  }

  assert(aborted, "AbortSignal should have caused an abort error");
  console.log("  PASSED");
}

async function main() {
  console.log("Smoke test: phaseRunner + providers + toolDefs");
  console.log(`Using provider from env: UNSHIFT_PROVIDER=${process.env.UNSHIFT_PROVIDER || "anthropic (default)"}`);

  await setup();

  try {
    await testMultiTurnToolUse();
    await testAbortSignal();
    console.log("\n=== ALL TESTS PASSED ===\n");
  } catch (err) {
    console.error("\n=== TEST FAILED ===");
    console.error(err);
    process.exit(1);
  } finally {
    await cleanup();
  }
}

main();
