#!/usr/bin/env bash
# unshift.sh — Outer orchestrator for the Jira-to-PR automation workflow
# Usage: ./unshift.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONTEXT_FILE="/tmp/unshift_context.json"

usage() {
  echo "Usage: $0" >&2
  echo "" >&2
  echo "Orchestrates the full Jira-to-PR workflow in three phases:" >&2
  echo "  Phase 1: Jira discovery, repo setup, branch creation, prd.json generation" >&2
  echo "  Phase 2: Implementation via ralph.sh loop" >&2
  echo "  Phase 3: Commit, push, PR creation, Jira update, cleanup" >&2
  exit 1
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
fi

# ---------------------------------------------------------------------------
# Phase 1 — Jira discovery, repo setup, planning
# ---------------------------------------------------------------------------
echo "=== Phase 1: Jira discovery and planning ===" >&2

PHASE1_PROMPT=$(cat <<'PHASE1'
You are the Phase 1 planning agent for the unshift automation workflow.

Execute Steps 1-5 below autonomously. Do NOT implement any code — only plan.

## Step 1: Pre-flight checks

Verify these tools are available by running `command -v` for each:
- `jira`
- `git`
- `gh` (for GitHub repos)
- `glab` (for GitLab repos)

If any required tool is missing, stop with an actionable error listing what to install.

## Step 2: Query Jira for candidate issues

```bash
jira issue list -l "llm-candidate" --plain --no-headers --columns KEY,SUMMARY,TYPE,STATUS
```

- If no issues are returned, exit with: "No llm-candidate issues found."
- If multiple issues, select the first one.

## Step 3: Read the Jira issue details

```bash
jira issue view <ISSUE_KEY>
```

Extract:
- **Summary** — short description
- **Description** — full details, acceptance criteria
- **Issue Type** — Story/Feature/Enhancement, Bug, or Task/Sub-task/Chore
- **Repository** — determine from the project-to-repo mapping below

### Project-to-Repository Mapping

| Jira Project | Component | Repository URL | Local directory | Default branch | Host | Validation commands |
|---|---|---|---|---|---|---|
| `SSCUI` | `Calunga` | `git@gitlab.cee.redhat.com:hosted-pulp/ui-packages.redhat.com.git` | `~/work/ui-packages.redhat.com/` | `main` | GitLab | `npm test`, `npx tsc --noEmit` |
| `TC` | None | `git@github.com:guacsec/trustify-ui.git` | `~/work/trustify-ui` | `main` | GitHub | `npm test`, `npx tsc --noEmit` |
| `SECURESIGN` | None | `git@github.com:guacsec/trustify-ui.git` | `~/work/rhtas-console-ui` (fork/downstream of trustify-ui) | `main` | GitHub | `npm test`, `npx tsc --noEmit` |

If the repository cannot be determined, fail with: "Could not determine repository for issue `<ISSUE_KEY>`."

## Step 4: Navigate to the repository and create a branch

1. `cd` into the local directory from the mapping table.
2. If `git status --porcelain` shows uncommitted changes, auto-stash:
   `git stash push -m "auto-stash before <ISSUE_KEY>: <branch-name> on <current-branch> (<date>)"`
3. `git checkout <default-branch> && git pull`
4. Create a branch:
   - `feat/<ISSUE_KEY>-<short-slug>` for Stories/Features
   - `fix/<ISSUE_KEY>-<short-slug>` for Bugs
   - `chore/<ISSUE_KEY>-<short-slug>` for Tasks/Chores

## Step 5: Generate prd.json and progress.txt

Create `prd.json` in the repo root with an implementation plan based on the Jira issue.
Create an empty `progress.txt` if it does not exist.

Each prd.json entry must have: id, category, description, steps, validation, completed (starts false).
Use the validation commands from the mapping table for the matched project.

If `prd.json` already exists, preserve completed entries; only add/modify incomplete ones.

## CRITICAL: Write the context file

After completing all steps above, you MUST write a JSON file to the path provided below.
This file is consumed by later phases. It must contain exactly these fields:

```json
{
  "issue_key": "<ISSUE_KEY>",
  "summary": "<issue summary>",
  "description": "<issue description>",
  "issue_type": "<Story|Bug|Task|etc>",
  "repo_path": "<absolute path to the repo>",
  "branch_name": "<branch name created>",
  "default_branch": "<default branch e.g. main>",
  "host": "<github|gitlab>",
  "commit_prefix": "<feat:|fix:|chore:>"
}
```

Write the context file to: CONTEXT_FILE_PATH

Do NOT implement any code. Only plan and set up.
PHASE1)

# Substitute the actual context file path into the prompt
PHASE1_PROMPT="${PHASE1_PROMPT//CONTEXT_FILE_PATH/$CONTEXT_FILE}"

if ! claude -p --permission-mode acceptEdits "$PHASE1_PROMPT"; then
  echo "Error: Phase 1 failed." >&2
  exit 1
fi

# Verify context file was created
if [[ ! -f "$CONTEXT_FILE" ]]; then
  echo "Error: Phase 1 did not produce context file at $CONTEXT_FILE" >&2
  exit 1
fi

# Read context values
REPO_PATH="$(jq -r '.repo_path' "$CONTEXT_FILE")"
BRANCH_NAME="$(jq -r '.branch_name' "$CONTEXT_FILE")"

if [[ -z "$REPO_PATH" || "$REPO_PATH" == "null" ]]; then
  echo "Error: repo_path missing from context file." >&2
  exit 1
fi

echo "Phase 1 complete. Repo: $REPO_PATH, Branch: $BRANCH_NAME" >&2

# ---------------------------------------------------------------------------
# Phase 2 — Implementation via ralph.sh
# ---------------------------------------------------------------------------
echo "" >&2
echo "=== Phase 2: Implementation via ralph.sh ===" >&2

# Copy ralph.sh into the target repo
RALPH_SRC="${SCRIPT_DIR}/ralph/ralph.sh"
if [[ ! -f "$RALPH_SRC" ]]; then
  # Fallback: try the root-level ralph.sh
  RALPH_SRC="${SCRIPT_DIR}/ralph.sh"
fi

if [[ ! -f "$RALPH_SRC" ]]; then
  echo "Error: Cannot find ralph.sh in ${SCRIPT_DIR}/ralph/ or ${SCRIPT_DIR}/" >&2
  exit 1
fi

cp "$RALPH_SRC" "${REPO_PATH}/ralph.sh"
chmod +x "${REPO_PATH}/ralph.sh"

# Count incomplete prd.json entries
if [[ ! -f "${REPO_PATH}/prd.json" ]]; then
  echo "Error: prd.json not found in ${REPO_PATH}" >&2
  exit 1
fi

INCOMPLETE_COUNT="$(jq '[.[] | select(.completed == false)] | length' "${REPO_PATH}/prd.json")"

if [[ "$INCOMPLETE_COUNT" -eq 0 ]]; then
  echo "All prd.json entries already completed. Skipping Phase 2." >&2
else
  echo "Running ralph.sh with ${INCOMPLETE_COUNT} iteration(s)..." >&2
  cd "$REPO_PATH"
  if ! ./ralph.sh --auto "$INCOMPLETE_COUNT"; then
    echo "Error: Phase 2 (ralph.sh) failed." >&2
    exit 1
  fi
fi

echo "Phase 2 complete." >&2

# ---------------------------------------------------------------------------
# Phase 3 — Verify, commit, push, PR, Jira update, cleanup
# ---------------------------------------------------------------------------
echo "" >&2
echo "=== Phase 3: PR creation and Jira update ===" >&2

PHASE3_PROMPT=$(cat <<'PHASE3'
You are the Phase 3 delivery agent for the unshift automation workflow.

Read the context file at CONTEXT_FILE_PATH to get: issue_key, summary, description, issue_type, repo_path, branch_name, default_branch, host, commit_prefix.

Execute these steps autonomously in the repo at the repo_path from the context file.

## Step 1: Verify all work is complete

Read `prd.json` in the repo root. Confirm ALL entries have `"completed": true`.
Run all validation commands from all entries as a final pass.
If any entry is incomplete or validation fails, report which ones and STOP.

## Step 2: Commit

Exclude agent working files from the commit:

```bash
git add -A -- ':!prd.json' ':!progress.txt' ':!ralph.sh'
git commit -m "<commit_prefix> <issue_key> <short description based on summary>"
```

## Step 3: Push

```bash
git push origin <branch_name>
```

## Step 4: Create PR/MR

Based on the `host` field:

**GitHub** (host == "github"):
```bash
gh pr create \
  --title "<commit_prefix> <issue_key> <summary>" \
  --body "Resolves: <issue_key>

## Description
<summary and description from context>

## Changes
<Bulleted list of changes from progress.txt>" \
  --base <default_branch> \
  --head <branch_name>
```

**GitLab** (host == "gitlab"):
```bash
glab mr create \
  --title "<commit_prefix> <issue_key> <summary>" \
  --description "Resolves: <issue_key>

## Description
<summary and description from context>

## Changes
<Bulleted list of changes from progress.txt>" \
  --target-branch <default_branch> \
  --yes
```

Capture the PR/MR URL from the output.

## Step 5: Update Jira

```bash
jira issue move <issue_key> "In Review"
jira issue comment add <issue_key> "PR created: <PR_URL>"
```

Post `prd.json` and `progress.txt` contents as separate Jira comments:

```bash
jira issue comment add <issue_key> "## Implementation Plan (prd.json)
$(cat prd.json)"

jira issue comment add <issue_key> "## Execution Log (progress.txt)
$(cat progress.txt)"
```

## Step 6: Cleanup

Remove agent working files:

```bash
rm -f prd.json progress.txt ralph.sh
```
PHASE3)

# Substitute the actual context file path into the prompt
PHASE3_PROMPT="${PHASE3_PROMPT//CONTEXT_FILE_PATH/$CONTEXT_FILE}"

cd "$REPO_PATH"
if ! claude -p --permission-mode acceptEdits "$PHASE3_PROMPT"; then
  echo "Error: Phase 3 failed." >&2
  exit 1
fi

# Cleanup context file
rm -f "$CONTEXT_FILE"

echo "" >&2
echo "=== unshift complete ===" >&2
