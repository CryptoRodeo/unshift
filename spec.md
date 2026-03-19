# LLM Agent Spec: Jira-to-PR Automation

## Overview

An LLM agent that picks up Jira issues labeled `llm-candidate`, implements the work in the corresponding repository, and opens a pull request, fully autonomously with no manual intervention.

The workflow is orchestrated by `unshift.sh`, a shell script that drives four phases:

1. **Phase 0** - Pre-flight checks and Jira discovery, handled directly by `unshift.sh` in bash (Steps 1-2)
2. **Phase 1** - `claude -p` for reading the issue, repo setup, branch creation, and `prd.json` generation (Steps 3-5)
3. **Phase 2** - `ralph.sh --auto <N>` for implementation, executing one `prd.json` entry per iteration in isolated Claude sessions (Step 6)
4. **Phase 3** - `claude -p` for verification, commit, push, PR creation, Jira update, and cleanup (Steps 7-10)

Phase 0 runs once at startup. Phases 1-3 run per issue in a loop. Each `claude -p` invocation runs in a separate session with minimal context, keeping token usage low and focus tight. All `claude -p` calls use the `--permission-mode bypassPermissions` flag to run non-interactively. The script is run directly from the command line.

---

## Prerequisites

- `acli` (Atlassian CLI) installed and configured (via `init.sh`)
- `JIRA_BASE_URL`, `JIRA_USER_EMAIL`, and `JIRA_API_TOKEN` environment variables set (used by Phase 0 curl discovery and `acli` authentication)
- `claude` CLI available on the host
- `gh` CLI for GitHub repositories
- `glab` CLI for GitLab repositories
- `jq` for the installer to merge settings and for counting incomplete entries
- Git credentials configured for push access to target repositories
- The scripts installed via `init.sh`

---

## Workflow

This is a full-send workflow. Once invoked, the orchestrator executes all phases autonomously. It only stops on hard errors or repeated validation failures, never to ask for user input.

### Step 1: Pre-flight checks (Phase 0)

Before starting, verify these tools are available: `curl`, `git`, `gh` (for GitHub repos), `glab` (for GitLab repos), `jq`. If any required tool is missing, stop with an actionable error listing what to install.

### Step 2: Query Jira for candidate issues (Phase 0)

```bash
curl -s -u "${JIRA_USER_EMAIL}:${JIRA_API_TOKEN}" -H "Content-Type: application/json" \
  "${JIRA_BASE_URL}/rest/api/3/search/jql?jql=labels%3Dllm-candidate&fields=key,summary,issuetype,status" \
  2>/dev/null | jq -r '.issues[].key'
```

- If no issues are returned, exit gracefully with a message: "No llm-candidate issues found."
- Process ALL returned issues. The orchestrator (`unshift.sh`) collects all issue keys, then loops through each one, running Phase 1 → Phase 2 (ralph.sh) → Phase 3 per issue. If any phase fails for an issue, log the error and continue to the next issue. A summary of successes and failures is printed at the end.

> **Note:** Steps 1 and 2 are handled directly by `unshift.sh` in bash. No `claude -p` session is used.

### Step 3: Read the Jira issue details

Use `acli` to look up the Jira issue:

```bash
acli jira workitem view <ISSUE_KEY> --json
```

> **Fallback:** If `acli` is unavailable, fall back to a curl call against the Jira REST API using the `JIRA_BASE_URL` and `JIRA_API_TOKEN` environment variables:
> ```bash
> curl -s -u "${JIRA_USER_EMAIL}:${JIRA_API_TOKEN}" -H "Content-Type: application/json" \
>   "${JIRA_BASE_URL}/rest/api/3/issue/<ISSUE_KEY>?fields=summary,description,issuetype,components,labels" 2>/dev/null
> ```

Extract the following from the issue:
- **Summary** - short description of the work
- **Description** - full details, acceptance criteria
- **Issue Type** - used to determine the commit prefix (see Step 8)
- **Repository** - identified from one of these sources (in priority order):
  1. A custom field or label on the issue containing the repository URL or name
  2. The Jira project-to-repo mapping provided below
  3. If neither is available, fail with: "Could not determine repository for issue `<ISSUE_KEY>`."

#### Project-to-Repository Mapping

| Jira Project | Component | Repository URL | Local directory | Default branch | Host | Validation commands |
|---|---|---|---|---|---|---|
| `SSCUI` | `Calunga` | `git@gitlab.cee.redhat.com:hosted-pulp/ui-packages.redhat.com.git` | `/work/ui-packages.redhat.com/` | `main` | GitLab | `npm test`, `npx tsc --noEmit` |
| `TC` | None | `git@github.com:guacsec/trustify-ui.git` | `/work/trustify-ui` | `main` | GitHub | `npm test`, `npx tsc --noEmit` |
| `SECURESIGN` | None | `git@github.com:guacsec/trustify-ui.git` | `/work/rhtas-console-ui` (fork/downstream of trustify-ui) | `main` | GitHub | `npm test`, `npx tsc --noEmit` |
| `SSCUI` | `AI` | `git@github.com:CryptoRodeo/unshift.git` | `/work/unshift` | `v2` | GitHub | None |

### Step 4: Navigate to the repository and create a branch

- If the repo is already cloned locally, `cd` into it.
- Otherwise, clone it into a working directory and `cd` into it.

**Auto-stash dirty working trees:** If `git status --porcelain` shows uncommitted changes, automatically stash them without prompting:

```bash
git stash push -m "auto-stash before <ISSUE_KEY>: <branch-name> on <current-branch> ($(date +%Y-%m-%d-%H:%M))"
```

Example stash name: `auto-stash before TC-456: feat/TC-456-add-search on main (2026-03-11-14:30)`

Once the working tree is clean:

```bash
git checkout <default-branch> && git pull
```

Create a new branch from the default branch:

```bash
git checkout -b <branch-name>
```

**Branch naming convention:**
- `feat/<ISSUE_KEY>-<short-slug>` for Stories/Features
- `fix/<ISSUE_KEY>-<short-slug>` for Bugs
- `chore/<ISSUE_KEY>-<short-slug>` for Tasks/Chores

Example: `feat/OCM-1234-add-cluster-validation`

### Step 5: Generate `prd.json`

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
- `id` - integer, unique, sequential starting at 1.
- `category` - one of `feature`, `bugfix`, or `chore`. Derived from the Jira issue type.
- `description` - a short, specific summary of the implementation unit. Each entry should be a single, focused change.
- `steps` - ordered list of concrete instructions. Each step should reference specific files, functions, or modules. Avoid vague steps like "implement the feature."
- `validation` - list of commands to run to confirm the unit is correctly implemented. Must be runnable shell commands. Common examples: `go test ./...`, `npm test`, `make build`, `npx tsc --noEmit`.
- `completed` - boolean, starts as `false`. Set to `true` only after all validation commands pass.

**When updating an existing `prd.json`:**
- Do NOT overwrite completed entries.
- Append new entries or modify incomplete ones only.

Also create an empty `progress.txt` if it does not already exist.

Phase 1 also writes a context file (`/tmp/unshift_context.json`) consumed by later phases, containing: `issue_key`, `summary`, `description`, `issue_type`, `repo_path`, `branch_name`, `default_branch`, `host`, `commit_prefix`.

> **Note:** Phase 3's `claude -p` invocation additionally uses `--add-dir="$REPO_PATH"` so the agent can access the target repository's files.

### Step 6: Execute the implementation loop (ralph.sh)

Implementation is handled by `ralph.sh`, which runs in a loop, one `claude -p` invocation per `prd.json` entry. Each iteration is an isolated Claude session with a strict execution contract.

`unshift.sh` copies `ralph.sh` into the target repo, counts incomplete entries via `jq`, and runs:

```bash
./ralph.sh --auto <N>
```

Where `<N>` is the number of incomplete `prd.json` entries. The `--auto` flag skips confirmation prompts between iterations.

#### Per-entry contract (enforced by ralph.sh prompt):

1. Select the highest-priority (lowest `id`) incomplete entry from `prd.json`.
2. Implement ONLY that entry. Make only the minimal changes required.
3. Run the validation commands from that entry. If validation fails, do NOT mark the entry as completed; append failure status to `progress.txt`.
4. Append a concise status entry to `progress.txt` describing: the feature worked on, files changed, and current status.
5. If validation passes, mark ONLY that entry as `"completed": true` in `prd.json`.
6. STOP. Each ralph iteration handles exactly one entry.

#### Constraints:

- Work on exactly one entry at a time.
- Do NOT refactor, clean up, or improve unrelated code.
- Do NOT add follow-up features, enhancements, or "while I'm here" changes.

#### Context minimization:

Each ralph iteration starts a fresh `claude -p` session. This means:
- No accumulated context from previous iterations
- Token usage stays flat regardless of how many entries exist
- Each entry gets the full context window for its implementation

### Step 7: Verify all work is complete

After the implementation loop finishes, confirm:
- All entries in `prd.json` have `"completed": true`
- A final full validation pass succeeds (run all validation commands from all entries)

If any entry is still incomplete, report which ones failed and stop.

### Step 8: Commit, push, and create a pull request

**Commit message format** (conventional commits, derived from Jira issue type):

| Jira Issue Type | Prefix |
|---|---|
| Story, Feature, Enhancement | `feat:` |
| Bug | `fix:` |
| Task, Sub-task, Chore | `chore:` |

Format: `<prefix> <ISSUE_KEY> <short description>`

Example: `feat: OCM-1234 add cluster validation for managed namespaces`

```bash
git add -A -- ':!prd.json' ':!progress.txt' ':!ralph.sh'
git commit -m "<commit message>"
git push origin <branch-name>
```

> **Note:** `prd.json`, `progress.txt`, and `ralph.sh` are agent working files and must NOT be committed to the PR.

**Create a pull request** using the appropriate CLI based on the repository host (see mapping table). Use non-interactive flags to avoid prompts:

**GitHub repos** (use `gh`):
```bash
gh pr create \
  --title "<commit prefix> <ISSUE_KEY> <summary>" \
  --body "Resolves: <ISSUE_KEY>

## Description
<Jira issue summary and description>

## Changes
<Bulleted list of changes from progress.txt>" \
  --base <default-branch> \
  --head <branch-name>
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
  --target-branch <default-branch> \
  --yes
```

### Step 9: Update the Jira issue

Use `acli` to update the Jira issue:

1. Transition the issue to "In Review":
   ```bash
   acli jira workitem transition --key <ISSUE_KEY> --status "In Review"
   ```
2. Add a comment with the PR URL:
   ```bash
   acli jira workitem comment create --key <ISSUE_KEY> --body "PR created: <PR_URL>"
   ```
3. Add a comment with the contents of `prd.json` under the heading "Implementation Plan":
   ```bash
   acli jira workitem comment create --key <ISSUE_KEY> --body "## Implementation Plan
   $(cat prd.json)"
   ```
4. Add a comment with the contents of `progress.txt` under the heading "Execution Log":
   ```bash
   acli jira workitem comment create --key <ISSUE_KEY> --body "## Execution Log
   $(cat progress.txt)"
   ```

> **Fallback:** If `acli` is unavailable, fall back to curl calls against the Jira REST API using Basic auth: `curl -u "${JIRA_USER_EMAIL}:${JIRA_API_TOKEN}" ...` with the `JIRA_BASE_URL` environment variable.

### Step 10: Cleanup

Remove agent working files from the repo directory:

```bash
rm -f prd.json progress.txt ralph.sh
```

---

## Phase-to-Step Mapping

| Phase | Script / Tool | Steps | Description |
|---|---|---|---|
| Phase 0 | `unshift.sh` (bash directly) | 1-2 | Pre-flight checks, Jira discovery |
| Phase 1 | `claude -p` with `prompts/phase1.md` | 3-5 | Read issue, repo setup, branch, prd.json |
| Phase 2 | `ralph.sh --auto <N>` | 6 | Implementation loop (one claude -p per entry) |
| Phase 3 | `claude -p` with `prompts/phase3.md` | 7-10 | Verify, commit, push, PR, Jira update, cleanup |

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
| Validation fails for a ralph iteration | Do not mark entry as completed; append failure to progress.txt |
| Git push or PR creation fails | Stop and report the error; do not retry |
| Any phase fails for an issue | Log the error, skip remaining phases for that issue, continue to the next issue |

---

## Dashboard

The `dashboard/` directory contains a web UI for monitoring unshift runs in real time. It is a monorepo with two workspaces:

- **`dashboard/server/`** - Express + WebSocket backend. Spawns `unshift.sh` as a subprocess, parses its stderr output to detect phase transitions and metadata (issue key, repo path, branch name), and broadcasts events to connected clients over WebSocket.
- **`dashboard/client/`** - React + Vite + PatternFly frontend. Displays a list of runs, per-run phase progress, PRD checklist, and streaming logs. Supports starting and stopping runs from the UI.

### WebSocket events

| Event | Payload | Description |
|---|---|---|
| `run:created` | `Run` object | New run started |
| `run:phase` | `runId`, `phase` | Phase transition (phase0 → phase1 → phase2 → phase3) |
| `run:log` | `runId`, `line`, `phase` | Log line emitted |
| `run:prd` | `runId`, `prd` | PRD checklist updated |
| `run:complete` | `runId`, `status` | Run finished (`success` or `failed`) |

### REST endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/runs` | List all runs |
| `POST` | `/api/runs` | Start a new run |
| `POST` | `/api/runs/:id/stop` | Stop an active run |

---

## File Reference

| File | Location | Purpose |
|---|---|---|
| `unshift.sh` | Repo root | Top-level orchestrator, drives all four phases |
| `ralph/ralph.sh` | `ralph/` | Implementation loop, one `claude -p` per prd.json entry |
| `prompts/phase1.md` | `prompts/` | Phase 1 prompt template for reading the issue and planning |
| `prompts/phase3.md` | `prompts/` | Phase 3 prompt template for PR creation and Jira update |
| `init.sh` | Repo root | Configures Claude Code permissions and authenticates `acli` |
| `dashboard/server/src/index.ts` | `dashboard/server/` | Express + WebSocket server |
| `dashboard/server/src/unshift.ts` | `dashboard/server/` | UnshiftRunner, spawns and parses unshift.sh |
| `dashboard/client/src/` | `dashboard/client/` | React frontend (components, hooks, types) |
| `prd.json` | Target repo root (at runtime) | Implementation plan, created per issue, cleaned up after |
| `progress.txt` | Target repo root (at runtime) | Append-only execution log, cleaned up after |
