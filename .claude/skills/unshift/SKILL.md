---
name: unshift
description: Pick up Jira issues with the configured label (JIRA_LABEL, default llm-candidate), implement them using Claude, and open a pull request. Use when the user wants to run the Jira-to-PR automation workflow.
disable-model-invocation: true
argument-hint: "[optional-issue-key]"
---

# Unshift  - Jira-to-PR Automation

You are running the unshift workflow: find Jira issues with the configured label, implement them, and open pull requests. The label is controlled by the `JIRA_LABEL` environment variable (defaults to `llm-candidate`).

If `$ARGUMENTS` contains a Jira issue key (e.g. `PROJ-123`), process only that issue. Otherwise, discover all candidate issues.

## Configuration

The project-to-repository mapping is in `projects.yaml` at the repo root (`${CLAUDE_SKILL_DIR}/../../../projects.yaml`). Read it before starting. Each entry has:

- `jira_projects`  - array of Jira project keys
- `component`  - nullable, for disambiguation
- `labels`  - array, for disambiguation when component is null
- `repo_url`, `local_dir`, `default_branch`, `host` (GitHub or GitLab), `validation` (array of shell commands)

**Matching rules** (in order):
1. Match the issue's project key to an entry's `jira_projects` array
2. If multiple entries match, disambiguate by `component` (match issue's components)
3. Then by `labels` (match issue's labels)
4. Fallback: entry with `component: null` and empty `labels`

## Phase 0: Discovery

Use the Jira MCP tools to find candidate issues:

```
mcp__jira__searchJiraIssuesUsingJql with JQL: "labels = <JIRA_LABEL>"
```

where `<JIRA_LABEL>` is the value of the `JIRA_LABEL` environment variable (default: `llm-candidate`).

If a specific issue key was provided via `$ARGUMENTS`, skip discovery and use that key directly.

If no issues are found, stop with: "No issues with label '<JIRA_LABEL>' found."

Collect all issue keys. Process each one through Phases 1-3 sequentially. If a phase fails for an issue, log the error and continue to the next issue.

## Phase 1: Planning (per issue)

### 1.1 Read the issue

Use `mcp__jira__getJiraIssue` to read the issue. Extract:
- Summary
- Description (full details, acceptance criteria)
- Issue type (Story/Bug/Task/etc.)
- Components and labels (for repo matching)

### 1.2 Match to repository

Use the mapping from `projects.yaml` to find the correct repo entry. If no match, fail with: "Could not determine repository for issue `<KEY>`."

### 1.3 Prepare the repository

```bash
cd <local_dir>
```

If `git status --porcelain` shows uncommitted changes, auto-stash:
```bash
git stash push -m "auto-stash before <KEY>: <branch> on $(git branch --show-current) ($(date +%Y-%m-%d-%H:%M))"
```

Then:
```bash
git checkout <default_branch> && git pull
```

Create a branch:
- `feat/<KEY>-<short-slug>` for Stories/Features/Enhancements
- `fix/<KEY>-<short-slug>` for Bugs
- `chore/<KEY>-<short-slug>` for Tasks/Sub-tasks/Chores

```bash
git checkout -b <branch-name>
```

### 1.4 Generate the implementation plan

Create `prd.json` in the repo root. Schema:

```json
[
  {
    "id": 1,
    "category": "feature | bugfix | chore",
    "description": "Concise description of this implementation unit",
    "steps": ["Step-by-step instruction to implement this unit"],
    "validation": ["Shell command to verify correctness"],
    "completed": false
  }
]
```

Rules:
- Each entry should be a single, focused change
- Steps must reference specific files, functions, or modules
- Use validation commands from the repo mapping entry
- If `prd.json` already exists, preserve completed entries

Also create an empty `progress.txt` if it doesn't exist.

## Phase 2: Implementation (per issue)

Process each incomplete `prd.json` entry one at a time using a subagent for context isolation.

For each incomplete entry (lowest `id` first), launch an Agent with this prompt:

> You are implementing a single entry from prd.json in the repository at `<repo_path>`.
>
> Read `prd.json` and `progress.txt`. Select the entry with id `<id>` and implement ONLY that entry.
>
> EXECUTION CONTRACT:
> - Implement ONLY entry `<id>`. Make only the minimal changes required.
> - Do NOT refactor, clean up, or improve unrelated code.
> - Do NOT add follow-up features or "while I'm here" changes.
> - Run EVERY command in the entry's "validation" array. Each must exit 0.
> - If any validation fails: do NOT mark the entry completed. Append failure to progress.txt. STOP.
> - If all validation passes: mark ONLY entry `<id>` as `"completed": true` in prd.json.
> - Append a concise status to progress.txt: feature worked on, files changed, status.
> - STOP after this single entry.

Wait for each subagent to complete before launching the next one.

After all entries are processed, read `prd.json` and verify all entries have `"completed": true`. If any failed, report which ones and stop processing this issue (continue to the next issue if there are more).

## Phase 3: Delivery (per issue)

### 3.1 Final validation

Run all validation commands from all prd.json entries as a final pass. If any fail, stop.

### 3.2 Commit

Determine the commit prefix from the issue type:
- Story/Feature/Enhancement → `feat:`
- Bug → `fix:`
- Task/Sub-task/Chore → `chore:`

```bash
cd <repo_path>
git add -A -- ':!prd.json' ':!progress.txt' ':!ralph.sh'
git commit -m "<prefix> <KEY> <concise-description>"
```

Write a concise description  - do NOT copy the Jira summary verbatim.

### 3.3 Push and create PR

```bash
git push origin <branch-name>
```

**GitHub** (`host` == "GitHub"):
```bash
gh pr create \
  --title "<prefix> <KEY> <concise-summary>" \
  --body "Resolves: <KEY>

## Description
<summary and description>

## Changes
<bulleted list from progress.txt>" \
  --base <default_branch> \
  --head <branch-name> \
  --draft \
  --label "llm-assisted"
```

**GitLab** (`host` == "GitLab"):
```bash
glab mr create \
  --title "<prefix> <KEY> <concise-summary>" \
  --description "Resolves: <KEY>

## Description
<summary and description>

## Changes
<bulleted list from progress.txt>" \
  --target-branch <default_branch> \
  --draft \
  --label "llm-assisted" \
  --yes
```

Capture the PR/MR URL from the output.

### 3.4 Update Jira

Use the Jira MCP tools:

1. **Transition to "In Review"**: Use `mcp__jira__getTransitionsForJiraIssue` to find the "In Review" transition, then `mcp__jira__transitionJiraIssue` to apply it.

2. **Comment with PR URL**: Use `mcp__jira__addCommentToJiraIssue` with body: `"PR created: <PR_URL>"`

3. **Comment on PR/MR with implementation plan**: Post the contents of `prd.json` as a comment on the PR/MR (not Jira) under heading "Implementation Plan".

   **GitHub**: `gh pr comment <branch_name> --body "## Implementation Plan\n\`\`\`json\n<contents of prd.json>\n\`\`\`"`
   **GitLab**: `glab mr note <branch_name> --message "## Implementation Plan\n\`\`\`json\n<contents of prd.json>\n\`\`\`"`

4. **Comment on PR/MR with execution log**: Post the contents of `progress.txt` as a comment on the PR/MR (not Jira) under heading "Execution Log".

   **GitHub**: `gh pr comment <branch_name> --body "## Execution Log\n<contents of progress.txt>"`
   **GitLab**: `glab mr note <branch_name> --message "## Execution Log\n<contents of progress.txt>"`

### 3.5 Cleanup

```bash
cd <repo_path>
rm -f prd.json progress.txt ralph.sh
```

## Summary

After all issues are processed, print a summary:

```
=== Unshift complete ===
<KEY>: SUCCESS
<KEY>: FAILED (reason)
<KEY>: STOPPED
```
