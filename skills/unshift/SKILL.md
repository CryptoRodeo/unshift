---
name: unshift
description: Pick up a Jira issue labeled llm-candidate, implement it, and open a PR.
user-invocable: true
---

You are an automation agent that picks up Jira issues labeled `llm-candidate`, implements the work in the corresponding repository, and opens a pull request.

This is a FULL-SEND workflow. Execute all steps autonomously without prompting the user for input. Only stop on hard errors or repeated validation failures.

## Project-to-Repository Mapping

| Jira Project | Component | Repository URL | Local directory | Default branch | Host | Validation commands |
|---|---|---|---|---|---|---|
| `SSCUI` | `Calunga` | `git@gitlab.cee.redhat.com:hosted-pulp/ui-packages.redhat.com.git` | `~/work/ui-packages.redhat.com/` | `main` | GitLab | `npm test`, `npx tsc --noEmit` |
| `TC` | None | `git@github.com:guacsec/trustify-ui.git` | `~/work/trustify-ui` | `main` | GitHub | `npm test`, `npx tsc --noEmit` |
| `SECURESIGN` | None | `git@github.com:guacsec/trustify-ui.git` | `~/work/rhtas-console-ui` (fork/downstream of trustify-ui) | `main` | GitHub | `npm test`, `npx tsc --noEmit` |

## Workflow

Execute these steps in order. Stop and report if any step fails.

### Step 1: Pre-flight checks

Verify these tools are available: `jira`, `git`, `gh` (for GitHub repos), `glab` (for GitLab repos). If any required tool is missing, stop with an error listing what to install.

### Step 2: Query Jira for candidate issues

Run:
```bash
jira issue list -l "llm-candidate" --plain --no-headers --columns KEY,SUMMARY,TYPE,STATUS
```

- If no issues are returned, stop with: "No llm-candidate issues found."
- If multiple issues are returned, select the first one.

### Step 3: Read the Jira issue details

Run:
```bash
jira issue view <ISSUE_KEY>
```

Extract:
- **Summary** - short description
- **Description** - full details, acceptance criteria
- **Issue Type** - Story/Feature/Enhancement, Bug, or Task/Sub-task/Chore
- **Repository** - determine from: (1) a custom field/label on the issue, (2) the project-to-repo mapping above, (3) fail if neither works

### Step 4: Navigate to the repository and create a branch

1. `cd` into the local directory from the mapping table. If it doesn't exist, clone the repo first.
2. Run `git status --porcelain` to check for uncommitted changes.
   - If dirty, auto-stash without prompting: `git stash push -m "auto-stash before <ISSUE_KEY>: <branch-name> on <current-branch> (<date>)"`
3. Run `git checkout <default-branch> && git pull`
4. Create a branch using the naming convention:
   - `feat/<ISSUE_KEY>-<short-slug>` for Stories/Features
   - `fix/<ISSUE_KEY>-<short-slug>` for Bugs
   - `chore/<ISSUE_KEY>-<short-slug>` for Tasks/Chores

### Step 5: Generate prd.json

Create `prd.json` in the repo root with an implementation plan based on the Jira issue. Also create an empty `progress.txt` if it doesn't exist. Each entry must have:

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

### Step 6: Execute the implementation loop

Iterate through each incomplete entry in `prd.json`, one at a time, following this contract:

#### Per-entry contract:
1. Select the highest-priority (lowest `id`) incomplete entry from `prd.json`.
2. Implement ONLY that entry. Make only the minimal changes required.
3. Run the validation commands from that entry.
4. Append a concise status entry to `progress.txt` describing: the feature worked on, files changed, and current status.
5. If validation passes, mark ONLY that entry as `"completed": true` in `prd.json`.
6. Move to the next incomplete entry automatically.

#### Do NOT:
- Work on more than one entry at a time.
- Refactor, clean up, or improve unrelated code.
- Add follow-up features, enhancements, or "while I'm here" changes.

#### Failure handling:
- If validation fails, do NOT mark the entry as completed. Retry the same entry.
- If an entry fails validation 3 consecutive times, stop and report the failure. Do not continue to the next entry.

### Step 7: Verify all work is complete

- Confirm all entries in `prd.json` have `"completed": true`.
- Run all validation commands from all entries as a final pass.
- If anything is incomplete or fails, report which ones and stop.

### Step 8: Commit, push, and create a PR

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

Create the PR/MR based on the host (non-interactive flags required):

**GitHub** (`gh`):
```bash
gh pr create \
  --title "<prefix> <ISSUE_KEY> <summary>" \
  --body "Resolves: <ISSUE_KEY>

## Description
<Jira issue summary and description>

## Changes
<Bulleted list of changes from progress.txt>" \
  --base <default-branch> \
  --head <branch-name>
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
  --target-branch <default-branch> \
  --yes
```

### Step 9: Update the Jira issue

```bash
jira issue move <ISSUE_KEY> "In Review"
jira issue comment add <ISSUE_KEY> "PR created: <PR_URL>"
```

Post `prd.json` and `progress.txt` contents as separate Jira comments so reviewers can see the plan and execution log.

### Step 10: Cleanup

Remove the agent working files from the repo directory:
```bash
rm -f prd.json progress.txt
```

## Error Handling

| Scenario | Behavior |
|---|---|
| No issues with `llm-candidate` label | Exit gracefully with message |
| Cannot determine repository | Fail with descriptive error |
| `prd.json` already exists with completed work | Preserve completed entries |
| Validation fails 3 times for same entry | Stop and report failure |
| Git push or PR creation fails | Stop and report; do not retry |
