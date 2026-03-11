# LLM Agent Spec: Jira-to-PR Automation

## Overview

An LLM agent that picks up Jira issues labeled `llm-candidate`, implements the work in the corresponding repository, and opens a pull request — all driven by a structured `prd.json` plan and the `ralph.sh` execution loop.

---

## Prerequisites

- `jira` CLI installed and configured (see `jira-cli-setup.md`)
- `claude` CLI available on the host
- Git credentials configured for push access to target repositories
- The `/unshift` skill installed via `init.sh` (ralph files are bootstrapped automatically when the skill runs)

---

## Workflow

### Step 1: Query Jira for candidate issues

```bash
jira issue list -l "llm-candidate" --plain --no-headers --columns KEY,SUMMARY,TYPE,STATUS
```

- If no issues are returned, exit gracefully with a message: "No llm-candidate issues found."
- Process one issue at a time. If multiple issues are returned, select the first one.

### Step 2: Read the Jira issue details

```bash
jira issue view <ISSUE_KEY>
```

Extract the following from the issue:
- **Summary** — short description of the work
- **Description** — full details, acceptance criteria
- **Issue Type** — used to determine the commit prefix (see Step 7)
- **Repository** — identified from one of these sources (in priority order):
  1. A custom field or label on the issue containing the repository URL or name
  2. The Jira project-to-repo mapping provided below
  3. If neither is available, fail with: "Could not determine repository for issue `<ISSUE_KEY>`."

#### Project-to-Repository Mapping

| Jira Project | Component | Repository URL | Local directory | Default branch | Host | Validation commands |
|---|---|---|---|---|---|---|
| `SSCUI` | `Calunga` | `git@gitlab.cee.redhat.com:hosted-pulp/ui-packages.redhat.com.git` | `~/work/ui-packages.redhat.com/` | `main` | GitLab | `npm test`, `npx tsc --noEmit` |
| `TC` | None | `git@github.com:guacsec/trustify-ui.git` | `~/work/trustify-ui` | `main` | GitHub | `npm test`, `npx tsc --noEmit` |
| `SECURESIGN` | None | `git@github.com:guacsec/trustify-ui.git` | `~/work/rhtas-console-ui` (fork/downstream of trustify-ui) | `main` | GitHub | `npm test`, `npx tsc --noEmit` |

### Step 3: Clone or navigate to the repository
- If the repo is already cloned locally, `cd` into it.
- Otherwise, clone it into a working directory and `cd` into it.

**Pre-flight check:** Before switching branches, verify the working tree is clean:

```bash
git status --porcelain
```

- If the output is empty, proceed.
- If there are uncommitted changes, prompt the user: "Working tree is dirty in `<local-directory>`. Stash changes and continue?" If approved, stash with a descriptive name:

```bash
git stash push -m "auto-stash before <ISSUE_KEY>: <branch-name> on <current-branch> ($(date +%Y-%m-%d-%H:%M))"
```

Example stash name: `auto-stash before TC-456: feat/TC-456-add-search on main (2026-03-11-14:30)`

If the user declines, stop and exit.

Once the working tree is clean:

```bash
git checkout <default-branch> && git pull
```

**Bootstrap agent files:** If any of `ralph.sh`, `prd.json`, or `progress.txt` are missing from the repository root, download them from the unshift repo:

```bash
UNSHIFT_REPO="https://raw.githubusercontent.com/CryptoRodeo/unshift/refs/heads/main/ralph"
[ -f ralph.sh ] || curl -fsSL -o ralph.sh "${UNSHIFT_REPO}/ralph.sh" && chmod +x ralph.sh
[ -f prd.json ] || curl -fsSL -o prd.json "${UNSHIFT_REPO}/prd.json"
[ -f progress.txt ] || touch progress.txt
```

Step 4 will overwrite `prd.json` with the real implementation plan.

(Use the default branch from the mapping table.)

- Create a new branch from the default branch:

```bash
git checkout -b <branch-name>
```

**Branch naming convention:**
- `feat/<ISSUE_KEY>-<short-slug>` for Stories/Features
- `fix/<ISSUE_KEY>-<short-slug>` for Bugs
- `chore/<ISSUE_KEY>-<short-slug>` for Tasks/Chores

Example: `feat/OCM-1234-add-cluster-validation`

### Step 4: Generate or update `prd.json`

Create `prd.json` in the repository root (or update it if one already exists). The file must conform to this schema:

```json
[
  {
    "id": 1,
    "category": "feature | bugfix | chore",
    "description": "Concise description of this implementation unit",
    "steps": [
      "Step-by-step instruction the LLM will follow to implement this unit"
    ],
    "validation": [
      "Command or check to verify correctness (e.g., 'go test ./...', 'npm test', 'make lint')"
    ],
    "completed": false
  }
]
```

**Schema rules:**
- `id` — integer, unique, sequential starting at 1.
- `category` — one of `feature`, `bugfix`, or `chore`. Derived from the Jira issue type.
- `description` — a short, specific summary of the implementation unit. Each entry should be a single, focused change.
- `steps` — ordered list of concrete instructions. Each step should reference specific files, functions, or modules. Avoid vague steps like "implement the feature."
- `validation` — list of commands to run to confirm the unit is correctly implemented. Must be runnable shell commands. Common examples: `go test ./...`, `npm test`, `make build`, `npx tsc --noEmit`.
- `completed` — boolean, starts as `false`. Set to `true` only after all validation commands pass.

**When updating an existing `prd.json`:**
- Do NOT overwrite completed entries.
- Append new entries or modify incomplete ones only.

Also create an empty `progress.txt` if it does not already exist.

### Step 5: Execute implementation via `ralph.sh`

Run the ralph loop to implement each feature in `prd.json`:

```bash
./ralph.sh <N>
```

Where `<N>` is the number of incomplete entries in `prd.json`. The ralph loop will:
1. Pick the highest-priority incomplete feature from `prd.json`
2. Implement only that feature
3. Run validation checks
4. Update `progress.txt` with what was done
5. Mark the feature as completed if validation passes
6. Stop and prompt before the next iteration

**If validation fails:**
- Do NOT mark the feature as completed.
- The next ralph iteration will retry the same feature.
- If a feature fails validation 3 times consecutively, stop and report the failure. Do not continue to the next feature.

### Step 6: Verify all work is complete

After `ralph.sh` finishes, confirm:
- All entries in `prd.json` have `"completed": true`
- A final full validation pass succeeds (run all validation commands from all entries)

If any entry is still incomplete, report which ones failed and stop.

### Step 7: Commit, push, and create a pull request

**Commit message format** (conventional commits, derived from Jira issue type):

| Jira Issue Type | Prefix |
|---|---|
| Story, Feature, Enhancement | `feat:` |
| Bug | `fix:` |
| Task, Sub-task, Chore | `chore:` |

Format: `<prefix> <ISSUE_KEY> <short description>`

Example: `feat: OCM-1234 add cluster validation for managed namespaces`

```bash
git add -A -- ':!prd.json' ':!progress.txt'
git commit -m "<commit message>"
git push origin <branch-name>
```

> **Note:** `prd.json` and `progress.txt` are agent working files and must NOT be committed to the PR.

**Create a pull request** using the appropriate CLI based on the repository host (see mapping table):

**GitHub repos** (use `gh`):
```bash
gh pr create \
  --title "<commit prefix> <ISSUE_KEY> <summary>" \
  --body "Resolves: <ISSUE_KEY>

## Description
<Jira issue summary and description>

## Changes
<Bulleted list of changes from progress.txt>" \
  --base <default-branch>
```

**GitLab repos** (use `glab`):
```bash
glab mr create \
  --title "<commit prefix> <ISSUE_KEY> <summary>" \
  --description "Resolves: <ISSUE_KEY>

## Description
<Jira issue summary and description>

## Changes
<Bulleted list of changes from progress.txt>" \
  --target-branch <default-branch>
```

### Step 8: Update the Jira issue

Transition the issue and attach the implementation details:

```bash
jira issue move <ISSUE_KEY> "In Review"
jira issue comment add <ISSUE_KEY> "PR created: <PR_URL>"
```

Then post the contents of `prd.json` and `progress.txt` as separate comments so reviewers can see the implementation plan and execution log:

```bash
jira issue comment add <ISSUE_KEY> "## Implementation Plan (prd.json)

\`\`\`json
$(cat prd.json)
\`\`\`"

jira issue comment add <ISSUE_KEY> "## Execution Log (progress.txt)

\`\`\`
$(cat progress.txt)
\`\`\`"
```

---

## PR Creation tooling

The host should have the `gh` and `glab` tools configured to do this. If not, exit and recommend they install those tools.

---

## Change validations

Use the validation commands from the project mapping table. If none are listed, review the project for test infrastructure and run whatever is available.

## Error Handling

| Scenario | Behavior |
|---|---|
| No issues with `llm-candidate` label | Exit gracefully with message |
| Cannot determine repository from issue | Fail with descriptive error |
| `prd.json` already exists with completed work | Preserve completed entries, add/update incomplete ones |
| Validation fails 3 times for same feature | Stop and report failure |
| `ralph.sh` exits with non-zero code | Stop and report the error |
| Git push or PR creation fails | Stop and report the error; do not retry |


---

## File Reference

| File | Purpose |
|---|---|
| `prd.json` | Implementation plan — array of feature units with steps and validation |
| `progress.txt` | Append-only log of what was done each ralph iteration |
| `ralph.sh` | Execution loop — invokes `claude` CLI once per feature in `prd.json` |

