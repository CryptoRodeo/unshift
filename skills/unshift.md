---
name: unshift
description: Pick up a Jira issue labeled llm-candidate, implement it, and open a PR.
user-invocable: true
---

You are an automation agent that picks up Jira issues labeled `llm-candidate`, implements the work in the corresponding repository, and opens a pull request.

## Project-to-Repository Mapping

| Jira Project | Component | Repository URL | Local directory | Default branch | Host | Validation commands |
|---|---|---|---|---|---|---|
| `SSCUI` | `Calunga` | `git@gitlab.cee.redhat.com:hosted-pulp/ui-packages.redhat.com.git` | `~/work/ui-packages.redhat.com/` | `main` | GitLab | `npm test`, `npx tsc --noEmit` |
| `TC` | None | `git@github.com:guacsec/trustify-ui.git` | `~/work/trustify-ui` | `main` | GitHub | `npm test`, `npx tsc --noEmit` |
| `SECURESIGN` | None | `git@github.com:guacsec/trustify-ui.git` | `~/work/rhtas-console-ui` (fork/downstream of trustify-ui) | `main` | GitHub | `npm test`, `npx tsc --noEmit` |

## Workflow

Execute these steps in order. Stop and report if any step fails.

### Step 1: Query Jira for candidate issues

Run:
```bash
jira issue list -l "llm-candidate" --plain --no-headers --columns KEY,SUMMARY,TYPE,STATUS
```

- If no issues are returned, stop with: "No llm-candidate issues found."
- If multiple issues are returned, select the first one.

### Step 2: Read the Jira issue details

Run:
```bash
jira issue view <ISSUE_KEY>
```

Extract:
- **Summary** - short description
- **Description** - full details, acceptance criteria
- **Issue Type** - Story/Feature/Enhancement, Bug, or Task/Sub-task/Chore
- **Repository** - determine from: (1) a custom field/label on the issue, (2) the project-to-repo mapping above, (3) fail if neither works

### Step 3: Navigate to the repository and create a branch

1. `cd` into the local directory from the mapping table. If it doesn't exist, clone the repo first.
2. Run `git status --porcelain` to check for uncommitted changes.
   - If dirty, ask the user: "Working tree is dirty in `<dir>`. Stash changes and continue?"
   - If approved, stash with: `git stash push -m "auto-stash before <ISSUE_KEY>: <branch-name> on <current-branch> (<date>)"`
   - If declined, stop.
3. Run `git checkout <default-branch> && git pull`
4. If any of `ralph.sh`, `prd.json`, or `progress.txt` are missing from the repo root, bootstrap them:
   ```bash
   UNSHIFT_REPO="https://raw.githubusercontent.com/CryptoRodeo/unshift/refs/heads/main/ralph"
   [ -f ralph.sh ] || curl -fsSL -o ralph.sh "${UNSHIFT_REPO}/ralph.sh" && chmod +x ralph.sh
   [ -f prd.json ] || curl -fsSL -o prd.json "${UNSHIFT_REPO}/prd.json"
   [ -f progress.txt ] || touch progress.txt
   ```
   Step 4 will overwrite `prd.json` with the real implementation plan.
5. Create a branch using the naming convention:
   - `feat/<ISSUE_KEY>-<short-slug>` for Stories/Features
   - `fix/<ISSUE_KEY>-<short-slug>` for Bugs
   - `chore/<ISSUE_KEY>-<short-slug>` for Tasks/Chores

### Step 4: Generate prd.json

Create `prd.json` in the repo root with an implementation plan based on the Jira issue. Each entry must have:

```json
{
  "id": 1,
  "category": "feature | bugfix | chore",
  "description": "Concise description of this implementation unit",
  "steps": ["Step-by-step instructions referencing specific files/functions"],
  "validation": ["Runnable shell commands to verify correctness"],
  "completed": false
}
```

Rules:
- If `prd.json` already exists, preserve completed entries; only add/modify incomplete ones.
- Use the validation commands from the mapping table.
- Create an empty `progress.txt` if it doesn't exist.

### Step 5: Execute implementation via ralph.sh

Count incomplete entries in `prd.json` and run:
```bash
./ralph.sh <N>
```

- If `ralph.sh` exits non-zero, stop and report the error.
- If a feature fails validation 3 consecutive times, stop and report.

### Step 6: Verify all work is complete

- Confirm all entries in `prd.json` have `"completed": true`.
- Run all validation commands from all entries as a final pass.
- If anything is incomplete or fails, report which ones and stop.

### Step 7: Commit, push, and create a PR

Commit prefix by issue type:
| Jira Issue Type | Prefix |
|---|---|
| Story, Feature, Enhancement | `feat:` |
| Bug | `fix:` |
| Task, Sub-task, Chore | `chore:` |

```bash
git add -A -- ':!prd.json' ':!progress.txt'
git commit -m "<prefix> <ISSUE_KEY> <short description>"
git push origin <branch-name>
```

Create the PR/MR based on the host:

**GitHub** (`gh`):
```bash
gh pr create \
  --title "<prefix> <ISSUE_KEY> <summary>" \
  --body "Resolves: <ISSUE_KEY>

## Description
<Jira issue summary and description>

## Changes
<Bulleted list of changes from progress.txt>" \
  --base <default-branch>
```

**GitLab** (`glab`):
```bash
glab mr create \
  --title "<prefix> <ISSUE_KEY> <summary>" \
  --description "Resolves: <ISSUE_KEY>

## Description
<Jira issue summary and description>

## Changes
<Bulleted list of changes from progress.txt>" \
  --target-branch <default-branch>
```

### Step 8: Update the Jira issue

```bash
jira issue move <ISSUE_KEY> "In Review"
jira issue comment add <ISSUE_KEY> "PR created: <PR_URL>"
```

Post `prd.json` and `progress.txt` contents as separate Jira comments so reviewers can see the plan and execution log.

## Error Handling

| Scenario | Behavior |
|---|---|
| No issues with `llm-candidate` label | Exit gracefully with message |
| Cannot determine repository | Fail with descriptive error |
| `prd.json` already exists with completed work | Preserve completed entries |
| Validation fails 3 times for same feature | Stop and report failure |
| `ralph.sh` exits non-zero | Stop and report error |
| Git push or PR creation fails | Stop and report; do not retry |

## Pre-flight checks

Before starting, verify these tools are available: `jira`, `claude`, `git`, `gh` (for GitHub repos), `glab` (for GitLab repos). If any required tool is missing, stop and tell the user what to install.
