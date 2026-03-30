import type { RunContext, PrdEntry } from "../../../shared/types";

/**
 * Repo entry shape matching repos.yaml structure.
 * Used by the orchestrator to pass resolved repo info to prompt builders.
 */
export interface RepoEntry {
  repo_url: string;
  default_branch: string;
  host: string;
  validation: string[];
  jira_projects?: string[];
  component?: string;
  labels?: string[];
}

export interface PromptPair {
  system: string;
  user: string;
}

/**
 * Builds the Phase 1 (planning) prompt.
 * Adapts cli/prompts/phase1.md: replaces ISSUE_KEY_VALUE and RESOLVED_REPO_JSON
 * placeholders with actual values. Context is returned programmatically by the
 * phase runner instead of written to a file.
 */
export function buildPhase1Prompt(
  issueKey: string,
  repoEntry: RepoEntry,
  workDir: string
): PromptPair {
  const repoInfo = {
    repo_url: repoEntry.repo_url,
    default_branch: repoEntry.default_branch,
    host: repoEntry.host,
    validation: repoEntry.validation,
  };
  const repoJson = JSON.stringify(repoInfo, null, 2);

  const system = `You are the Phase 1 planning agent for the unshift automation workflow.

Execute the steps below autonomously. Do NOT implement any code - only plan.`;

  const user = `You are given a single Jira issue key: **${issueKey}**

## Step 1: Read the Jira issue details

Use the jira_get_issue tool to look up the Jira issue.

Extract:
- **Summary** - short description
- **Description** - full details, acceptance criteria
- **Issue Type** - Story/Feature/Enhancement, Bug, or Task/Sub-task/Chore

### Repository Information

The target repository has already been cloned to: \`${workDir}\`

Repository metadata:

\`\`\`json
${repoJson}
\`\`\`

Fields: \`default_branch\`, \`host\` (GitHub or GitLab), \`repo_url\`, \`validation\` (array of command strings).

## Step 2: Create a branch

The working directory is an isolated worktree at the latest default branch (\`${repoEntry.default_branch}\`). No checkout or pull is needed.

1. Create a branch:
   - \`feat/${issueKey}-<short-slug>\` for Stories/Features
   - \`fix/${issueKey}-<short-slug>\` for Bugs
   - \`chore/${issueKey}-<short-slug>\` for Tasks/Chores

## Step 3: Generate prd.json and progress.txt

Create \`prd.json\` in the repo root with an implementation plan based on the Jira issue.
Create an empty \`progress.txt\` if it does not exist.

**prd.json MUST be a JSON array** (not an object). Each element is an object with: id, category, description, steps, validation, completed (starts false).
Use the validation commands from the repository entry above.

Example format:
\`\`\`json
[
  { "id": 1, "category": "Feature", "description": "...", "steps": ["..."], "validation": ["..."], "completed": false }
]
\`\`\`

If \`prd.json\` already exists, preserve completed entries; only add/modify incomplete ones.

## CRITICAL: Return the context as your final output

After completing all steps above, you MUST output a JSON block with exactly these fields as your final response. This is consumed by later phases:

\`\`\`json
{
  "issue_key": "${issueKey}",
  "summary": "<issue summary>",
  "description": "<issue description>",
  "issue_type": "<Story|Bug|Task|etc>",
  "repo_path": "${workDir}",
  "branch_name": "<branch name created>",
  "default_branch": "${repoEntry.default_branch}",
  "host": "${repoEntry.host.toLowerCase()}",
  "commit_prefix": "<feat:|fix:|chore:>"
}
\`\`\`

Do NOT implement any code. Only plan and set up.`;

  return { system, user };
}

/**
 * Builds the Ralph (Phase 2 implementation) prompt for a single prd.json entry.
 * Adapts the inline ralph prompt from cli/ralph/ralph.sh.
 */
export function buildRalphPrompt(
  entry: PrdEntry,
  repoPath: string
): PromptPair {
  const system = `You are a strict implementation agent operating in the repository at ${repoPath}.

You implement EXACTLY ONE feature at a time. You follow the execution contract precisely.`;

  const user = `You are operating in a STRICT Ralph Loop.

If you attempt to work on more than one feature, you have FAILED this task.

=== CURRENT FEATURE ===
${JSON.stringify(entry, null, 2)}

=== EXECUTION CONTRACT ===
You MUST:
- Work ONLY on the feature above (id: ${entry.id}, "${entry.description}")
- Make ONLY the minimal changes required to implement this feature
- STOP IMMEDIATELY after completing this feature

You MUST NOT:
- Start, partially implement, or plan any other feature
- Refactor, clean up, or improve unrelated code
- Add follow-up features, enhancements, or "while I'm here" changes

=== STEP-BY-STEP ===
1. Implement the feature described above.
2. Run EVERY command in the feature's validation array. Each command must exit 0.
   Validation commands: ${JSON.stringify(entry.validation)}
3. If ANY validation command fails:
   - STOP - do not retry or continue
   - Report which command failed and its output
4. If ALL validation commands pass:
   - Read the current \`prd.json\` file
   - Update the entry with id "${entry.id}" to set \`"completed": true\`
   - Write the updated \`prd.json\` back to disk
   - Append a brief summary of changes made to \`progress.txt\` (create it if it doesn't exist)
   - Report success with a concise summary of files changed

=== HARD STOP CONDITION ===
After completing the steps above, EXIT immediately.
Do NOT continue reasoning, planning, or coding.`;

  return { system, user };
}

/**
 * Builds the retry variant of the Ralph prompt that includes previous failure context.
 */
export function buildRetryPrompt(
  entry: PrdEntry,
  lastProgress: string,
  repoPath: string
): PromptPair {
  const base = buildRalphPrompt(entry, repoPath);

  const user = `${base.user}

=== PREVIOUS ATTEMPT FAILED ===
The previous attempt at this feature failed. Here is what went wrong:
${lastProgress}

Analyze the failure, fix the root cause, and try again.`;

  return { system: base.system, user };
}

/**
 * Builds the Phase 3 (delivery) prompt.
 * Adapts cli/prompts/phase3.md: injects context fields directly instead of
 * pointing at a context file. Uses tool calls for Jira and git operations
 * instead of curl/acli.
 */
export function buildPhase3Prompt(context: RunContext): PromptPair {
  const system = `You are the Phase 3 delivery agent for the unshift automation workflow.

Execute all steps autonomously in the repo at ${context.repoPath}.`;

  const commitType = getCommitType(context.issueType);
  const host = (context.host || "github").toLowerCase();

  const user = `## Context

- Issue key: ${context.issueKey}
- Summary: ${context.summary}
- Description: ${context.description || "N/A"}
- Issue type: ${context.issueType || "Task"}
- Repo path: ${context.repoPath}
- Branch name: ${context.branchName}
- Default branch: ${context.defaultBranch || "main"}
- Host: ${host}
- Commit type: ${commitType}

## Step 1: Verify all work is complete

Read \`prd.json\` in the repo root. Confirm ALL entries have \`"completed": true\`.
Run all validation commands from all entries as a final pass.
If any entry is incomplete or validation fails, report which ones and STOP.

## Step 2: Commit

Exclude agent working files from the commit.

Write a concise commit message in conventional commit format. Do NOT copy the Jira summary verbatim - instead, write a short, lowercase description that captures the essence of the change.

\`\`\`bash
git add -A -- ':!prd.json' ':!progress.txt' ':!ralph.sh'
git commit -m "(${commitType}): ${context.issueKey} <concise-description>"
\`\`\`

Example: \`git commit -m "(fix): PROJ-123 handle null response in user lookup"\`

## Step 3: Push

\`\`\`bash
git push origin ${context.branchName}
\`\`\`

## Step 4: Create PR/MR

Use the create_pr tool to create a draft pull/merge request:
- Title: \`(${commitType}): <concise-summary>\` (conventional commit format, do NOT copy the Jira title verbatim)
- Base branch: ${context.defaultBranch || "main"}
- Branch: ${context.branchName}
- Host: ${host}
- Labels: ["llm-assisted"]
- Draft: true
- Body should include:
  - Resolves: ${context.issueKey}
  - Description section with the summary
  - Changes section with a bulleted list from progress.txt

Capture the PR/MR URL from the result.

## Step 5: Update Jira

### 1. Transition the issue to "In Review"
Use the jira_transition tool to transition ${context.issueKey} to "In Review".

### 2. Add a comment with the PR/MR URL
Use the jira_comment tool to add a comment to ${context.issueKey} with the PR/MR URL.

## Step 6: Cleanup

Remove agent working files:

\`\`\`bash
rm -f prd.json progress.txt ralph.sh
\`\`\``;

  return { system, user };
}

function getCommitType(issueType?: string): string {
  if (!issueType) return "chore";
  const lower = issueType.toLowerCase();
  if (lower === "bug") return "fix";
  if (lower === "story" || lower === "feature" || lower === "enhancement")
    return "feat";
  return "chore";
}
