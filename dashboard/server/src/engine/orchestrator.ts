import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";
import type { LanguageModel } from "ai";

import type { RunContext, PrdEntry } from "../../../shared/types";
import { JiraClient } from "./jiraClient.js";
import {
  planningTools,
  implementationTools,
  deliveryTools,
} from "./toolDefs.js";
import {
  buildPhase1Prompt,
  buildRalphPrompt,
  buildRetryPrompt,
  buildPhase3Prompt,
  type RepoEntry,
} from "./prompts.js";
import { runPhase, type PhaseResult } from "./phaseRunner.js";
import { readFile as toolReadFile, execCommand } from "./tools.js";

const WORKSPACE_DIR = process.env.WORKSPACE_DIR || "/app/workspace";

export interface EngineRunOptions {
  model: LanguageModel;
  signal: AbortSignal;
  runId: string;
}

/**
 * UnshiftEngine ties the agentic phases together, replacing unshift.sh logic.
 *
 * Events emitted (same as UnshiftRunner for dashboard compatibility):
 * - run:phase(runId, phase, timestamp)
 * - run:log(runId, line, phase)
 * - run:context(runId, context)
 * - run:prd(runId, prd)
 * - run:complete(runId, status)
 * - run:tokens(runId, { inputTokens, outputTokens, model })
 * - run:progress(runId, content)
 */
export class UnshiftEngine extends EventEmitter {
  private jira = new JiraClient();
  private reposYamlPath: string;
  private approvalGates = new Map<
    string,
    { resolve: () => void; reject: (err: Error) => void }
  >();

  constructor() {
    super();
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    // In dev (src/engine/), 4 levels up; bundled (dist/), 3 levels up
    const candidates = [
      path.resolve(__dirname, "..", "..", "..", "..", "repos.yaml"),
      path.resolve(__dirname, "..", "..", "..", "repos.yaml"),
      path.resolve(__dirname, "..", "..", "repos.yaml"),
    ];
    this.reposYamlPath =
      process.env.REPOS_YAML_PATH ??
      candidates.find((p) => existsSync(p)) ??
      candidates[0];
  }

  /** Discover issues labelled llm-candidate via Jira JQL */
  async discover(): Promise<string[]> {
    const issues = await this.jira.searchIssues("labels = llm-candidate");
    return issues.map((i) => i.key);
  }

  /** Resolve a repo entry from repos.yaml for the given issue key */
  async resolveRepo(issueKey: string): Promise<RepoEntry> {
    const projectKey = issueKey.split("-")[0];

    // Fetch issue components and labels from Jira
    const issue = await this.jira.getIssue(issueKey);

    // Parse repos.yaml
    const yamlContent = await readFile(this.reposYamlPath, "utf-8");
    const entries = yaml.load(yamlContent) as RepoEntry[];

    // Filter to entries whose jira_projects contain the project key
    const matching = entries.filter(
      (e) => e.jira_projects && e.jira_projects.includes(projectKey)
    );

    if (matching.length === 0) {
      throw new Error(
        `No repo entry found for project key ${projectKey} (issue ${issueKey})`
      );
    }

    if (matching.length === 1) {
      return matching[0];
    }

    // Disambiguate: match by component
    const byComponent = matching.filter(
      (e) =>
        e.component != null &&
        issue.components.includes(e.component)
    );
    if (byComponent.length === 1) return byComponent[0];

    // Disambiguate: match by label
    const byLabel = matching.filter(
      (e) =>
        e.labels &&
        e.labels.length > 0 &&
        e.labels.some((l) => issue.labels.includes(l))
    );
    if (byLabel.length === 1) return byLabel[0];

    // Fallback: entry with null component and empty labels
    const fallback = matching.filter(
      (e) => e.component == null && (!e.labels || e.labels.length === 0)
    );
    if (fallback.length === 1) return fallback[0];

    throw new Error(
      `Could not disambiguate repo for ${issueKey}. ${matching.length} entries match project ${projectKey}.`
    );
  }

  /**
   * Clone the repo into the workspace directory if not already present.
   * Returns the absolute path to the cloned repo.
   */
  async ensureRepo(repoEntry: RepoEntry): Promise<string> {
    const repoName = path.basename(repoEntry.repo_url, ".git");
    const workDir = path.join(WORKSPACE_DIR, repoName);

    if (existsSync(path.join(workDir, ".git"))) {
      return workDir;
    }

    const result = await execCommand(
      "git", ["clone", repoEntry.repo_url, workDir],
      { timeout: 120_000 }
    );
    if (result.exitCode !== 0) {
      throw new Error(
        `Failed to clone ${repoEntry.repo_url}: ${result.stderr || result.stdout}`
      );
    }

    return workDir;
  }

  /** Phase 1: Planning — read the Jira issue, create a branch, generate prd.json */
  async runPhase1(
    issueKey: string,
    repoEntry: RepoEntry,
    opts: EngineRunOptions
  ): Promise<{ context: RunContext; prd: PrdEntry[] }> {
    const { model, signal, runId } = opts;
    const ts = new Date().toISOString();
    this.emit("run:phase", runId, "phase1", ts);

    const workDir = await this.ensureRepo(repoEntry);
    const prompt = buildPhase1Prompt(issueKey, repoEntry, workDir);
    const tools = planningTools(workDir);

    const result = await runPhase({
      model,
      systemPrompt: prompt.system,
      userPrompt: prompt.user,
      tools,
      maxSteps: 50,
      cwd: workDir,
      onLog: (line) => this.emit("run:log", runId, line, "phase1"),
      signal,
    });

    this.emitTokens(runId, result);

    // Parse context from the model's final output (JSON block)
    const context = this.parseContextFromText(result.text, issueKey, repoEntry, workDir);
    this.emit("run:context", runId, context);

    // Read prd.json from the repo
    const prd = await this.readPrdFromRepo(context.repoPath);
    this.emit("run:prd", runId, prd);

    return { context, prd };
  }

  /** Phase 2: Implementation — iterate over incomplete prd entries */
  async runPhase2(
    context: RunContext,
    prd: PrdEntry[],
    opts: EngineRunOptions
  ): Promise<PrdEntry[]> {
    const { model, signal, runId } = opts;
    const ts = new Date().toISOString();
    this.emit("run:phase", runId, "phase2", ts);

    let currentPrd = prd;
    const tools = implementationTools(context.repoPath);

    // Capture the IDs of incomplete entries upfront so the loop is stable
    // even when currentPrd is re-read from disk (which may reorder/add/remove entries).
    const incompleteIds = prd.filter((e) => !e.completed).map((e) => e.id);

    for (const entryId of incompleteIds) {
      const entry = currentPrd.find((e) => e.id === entryId);
      if (!entry || entry.completed) continue;

      const prompt = buildRalphPrompt(entry, context.repoPath);

      const result = await runPhase({
        model,
        systemPrompt: prompt.system,
        userPrompt: prompt.user,
        tools,
        maxSteps: 100,
        cwd: context.repoPath,
        onLog: (line) => this.emit("run:log", runId, line, "phase2"),
        signal,
      });

      this.emitTokens(runId, result);

      // Re-read prd.json to check completion
      currentPrd = await this.readPrdFromRepo(context.repoPath);
      this.emit("run:prd", runId, currentPrd);

      // Check if entry is still incomplete — retry once
      const updatedEntry = currentPrd.find((e) => e.id === entryId);
      if (updatedEntry && !updatedEntry.completed) {
        const progress = await this.readProgressFromRepo(context.repoPath);

        const retryPrompt = buildRetryPrompt(
          updatedEntry,
          progress || result.text,
          context.repoPath
        );

        const retryResult = await runPhase({
          model,
          systemPrompt: retryPrompt.system,
          userPrompt: retryPrompt.user,
          tools,
          maxSteps: 100,
          cwd: context.repoPath,
          onLog: (line) => this.emit("run:log", runId, line, "phase2"),
          signal,
        });

        this.emitTokens(runId, retryResult);

        // Re-read prd.json after retry
        currentPrd = await this.readPrdFromRepo(context.repoPath);
        this.emit("run:prd", runId, currentPrd);
      }
    }

    // Emit final progress
    const progress = await this.readProgressFromRepo(context.repoPath);
    if (progress) {
      this.emit("run:progress", runId, progress);
    }

    return currentPrd;
  }

  /** Phase 3: Delivery — commit, push, create PR, update Jira */
  async runPhase3(
    context: RunContext,
    opts: EngineRunOptions
  ): Promise<PhaseResult> {
    const { model, signal, runId } = opts;
    const ts = new Date().toISOString();
    this.emit("run:phase", runId, "phase3", ts);

    const prompt = buildPhase3Prompt(context);
    const tools = deliveryTools(context.repoPath);

    const result = await runPhase({
      model,
      systemPrompt: prompt.system,
      userPrompt: prompt.user,
      tools,
      maxSteps: 50,
      cwd: context.repoPath,
      onLog: (line) => this.emit("run:log", runId, line, "phase3"),
      signal,
    });

    this.emitTokens(runId, result);
    return result;
  }

  /**
   * Full issue lifecycle: phase1 → phase2 → (await approval) → phase3
   */
  async runIssue(
    issueKey: string,
    repoEntry: RepoEntry,
    opts: EngineRunOptions
  ): Promise<void> {
    const { runId } = opts;

    // Phase 1: Planning
    const { context, prd } = await this.runPhase1(
      issueKey,
      repoEntry,
      opts
    );

    // Phase 2: Implementation
    await this.runPhase2(context, prd, opts);

    // Await approval gate
    const approvalTs = new Date().toISOString();
    this.emit("run:phase", runId, "awaiting_approval", approvalTs);
    await this.waitForApproval(runId);

    // Phase 3: Delivery
    await this.runPhase3(context, opts);
  }

  /** Resolve the approval gate for a run, allowing phase 3 to proceed */
  approve(runId: string): boolean {
    const gate = this.approvalGates.get(runId);
    if (!gate) return false;
    gate.resolve();
    this.approvalGates.delete(runId);
    return true;
  }

  /** Reject a run's approval gate, causing runIssue to throw */
  reject(runId: string): boolean {
    const gate = this.approvalGates.get(runId);
    if (!gate) return false;
    gate.reject(new Error("Run rejected by user"));
    this.approvalGates.delete(runId);
    return true;
  }

  waitForApproval(runId: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.approvalGates.set(runId, { resolve, reject });
    });
  }

  private emitTokens(runId: string, result: PhaseResult): void {
    this.emit("run:tokens", runId, {
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      model: result.model,
    });
  }

  private parseContextFromText(
    text: string,
    issueKey: string,
    repoEntry: RepoEntry,
    workDir: string
  ): RunContext {
    // Try to extract JSON block from the model's response
    const jsonMatch = text.match(/```json\s*([\s\S]*?)```/);
    const jsonStr = jsonMatch ? jsonMatch[1] : text;

    try {
      const raw = JSON.parse(jsonStr.trim());
      return {
        issueKey: raw.issue_key || issueKey,
        summary: raw.summary || "",
        repoPath: workDir,
        branchName: raw.branch_name || "",
        description: raw.description,
        issueType: raw.issue_type,
        defaultBranch: raw.default_branch || repoEntry.default_branch,
        host: raw.host || repoEntry.host,
        commitPrefix: raw.commit_prefix,
      };
    } catch {
      // Fallback: construct minimal context from what we know
      return {
        issueKey,
        summary: "",
        repoPath: workDir,
        branchName: "",
        defaultBranch: repoEntry.default_branch,
        host: repoEntry.host,
      };
    }
  }

  private async readPrdFromRepo(repoPath: string): Promise<PrdEntry[]> {
    try {
      const content = await toolReadFile("prd.json", repoPath);
      return JSON.parse(content);
    } catch {
      return [];
    }
  }

  private async readProgressFromRepo(repoPath: string): Promise<string | null> {
    try {
      return await toolReadFile("progress.txt", repoPath);
    } catch {
      return null;
    }
  }
}
