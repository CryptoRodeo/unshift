# Unshift

An automation tool that picks up Jira issues labeled `llm-candidate`, implements them using Claude, and opens a pull request.

> This project uses [Claude Code](https://docs.anthropic.com/en/docs/claude-code) as its runtime. All phases are executed via `claude -p` sessions, so a working Claude Code installation is required.

## How it works

`unshift.sh` runs four phases per issue:

0. **Discover** - Queries the Jira REST API for issues labeled `llm-candidate`, checks required tools are installed, and determines which issues to process.
1. **Plan** - Reads the Jira issue, maps it to a repo via `repos.json`, creates a branch, and generates an implementation plan (`prd.json`). Runs in its own `claude -p` session.
2. **Implement** - `ralph.sh` works through the plan one entry at a time, each in a fresh `claude -p` session. If a validation step fails, it automatically retries once with the error context. This keeps token usage flat and gives every entry the full context window.
3. **Deliver** - Commits, pushes, opens a PR, updates Jira, and cleans up. Runs in its own `claude -p` session. When started from the dashboard, the run pauses here for approval before proceeding.

## Quickstart

### 1. Install prerequisites

| Tool | Purpose | Install |
|---|---|---|
| [Node.js](https://nodejs.org/) (v18+) | Runtime for Claude Code and the dashboard | [Download](https://nodejs.org/) or `dnf install nodejs` / `brew install node` |
| [Claude Code](https://docs.anthropic.com/en/docs/claude-code) | CLI agent that runs each phase | `npm install -g @anthropic-ai/claude-code` |
| [acli](https://developer.atlassian.com/cloud/acli/) | Atlassian CLI for Jira integration | [Install guide](https://developer.atlassian.com/cloud/acli/guides/install-acli/) |
| [curl](https://curl.se/) | Jira REST API fallback | Pre-installed on most systems |
| [gh](https://cli.github.com/) | Create GitHub PRs | `dnf install gh` / `brew install gh` |
| [glab](https://gitlab.com/gitlab-org/cli) | Create GitLab MRs | `dnf install glab` / `brew install glab` |
| [jq](https://jqlang.github.io/jq/) | Used by the installer and orchestrator | `dnf install jq` / `brew install jq` |
| [Git](https://git-scm.com/) | Version control | Pre-installed on most systems |

You only need `gh` or `glab` depending on which repositories you work with.

Git must be configured with push access to your target repositories (e.g. via SSH keys or a credential helper).

### 2. Clone and initialize

```bash
git clone https://github.com/CryptoRodeo/unshift.git
cd unshift
./init.sh
```

### 3. Configure credentials

Copy the template and fill in your tokens:

```bash
cp .env.example .unshift.env
```

Then source it (or export the variables in your shell):

```bash
source .unshift.env
```

**With an Anthropic API key:**

```bash
ANTHROPIC_API_KEY=sk-ant-...
JIRA_BASE_URL=https://mycompany.atlassian.net
JIRA_USER_EMAIL=you@company.com
JIRA_API_TOKEN=your-jira-token
GH_TOKEN=ghp_...
# Or, if using GitLab instead:
# GITLAB_TOKEN=glpat-...
```

**With Vertex AI (Google Cloud):**

```bash
CLAUDE_CODE_USE_VERTEX=1
CLOUD_ML_REGION=us-eastx
ANTHROPIC_VERTEX_PROJECT_ID=<your-gcp-project-id>
JIRA_BASE_URL=https://mycompany.atlassian.net
JIRA_USER_EMAIL=you@company.com
JIRA_API_TOKEN=your-jira-token
GH_TOKEN=ghp_...
# Or, if using GitLab instead:
# GITLAB_TOKEN=glpat-...
```

> **Vertex AI users:** You also need active GCP credentials (`gcloud auth application-default login`). Run `claude` then `/status` to confirm the provider shows "Google Vertex AI".

See [Credentials Reference](#credentials-reference) for how to create each token and for Data Center configuration.

### 4. Edit the project-to-repository mapping

Open `repos.json` in the repo root and replace the example entries with your own Jira projects and local repo paths.

Each entry is a JSON object with the following fields:

| Field | Description |
|---|---|
| `jira_projects` | Array of Jira project keys that map to this repo (e.g. `["MYPROJ"]` or `["PROJ1", "PROJ2"]`) |
| `component` | Optional Jira component to disambiguate projects that map to multiple repos (use `null` if not needed) |
| `labels` | Array of Jira labels to disambiguate when the project cannot use components (e.g. `["TSD-UI"]`), or `[]` if not needed |
| `repo_url` | The git remote URL |
| `local_dir` | Absolute path where the repo is cloned on your machine |
| `default_branch` | Branch to base new work on (e.g. `main`) |
| `host` | `GitHub` or `GitLab`  - determines whether `gh` or `glab` is used for PRs |
| `validation` | Array of shell commands to verify correctness (e.g. `["npm test", "npx tsc --noEmit"]`), or `[]` if none |

### 5. Run

```bash
./unshift.sh
```

You can also target a single issue or just list what's available:

```bash
./unshift.sh --issue PROJ-123   # process one issue
./unshift.sh --discover         # list llm-candidate issues and exit
./unshift.sh --retry --issue PROJ-123  # retry from prd.json (skips planning)
```

`--retry` resets the branch to its merge-base, marks all prd.json entries as incomplete, and re-runs Phase 2 and 3. It requires the `UNSHIFT_CONTEXT_FILE` env var to point at the context file from the original run.

Or start a run from the dashboard instead (see "Dashboard" below):

```bash
cd dashboard && npm install && npm run dev
```

## Credentials Reference

### Jira API token

**Jira Cloud:** Create a token at [Atlassian API token management](https://id.atlassian.com/manage-profile/security/api-tokens). Use the email of the account that created the token as `JIRA_USER_EMAIL`.

**Jira Data Center / Server:** Create a Personal Access Token from your Jira profile (Profile > Personal Access Tokens). Set `JIRA_AUTH_TYPE=bearer` and `JIRA_API_VERSION=2` in your `.unshift.env`. You do not need to set `JIRA_USER_EMAIL` when using bearer auth.

### GitHub token (`GH_TOKEN`)

Create a token with the **`repo`** scope (classic) or **Contents + Pull requests** read/write (fine-grained) at [GitHub token settings](https://github.com/settings/tokens). The `gh` CLI recognizes `GH_TOKEN` automatically -no separate `gh auth login` is needed.

### GitLab token (`GITLAB_TOKEN`)

Create a token with the **`api`** scope at [GitLab access tokens](https://gitlab.com/-/user_settings/personal_access_tokens). The `glab` CLI recognizes `GITLAB_TOKEN` automatically -no separate `glab auth login` is needed.

## Dashboard (optional)

The `dashboard/` directory contains a web UI for monitoring unshift runs in real time. It is not required -the CLI works on its own.

### Setup

```bash
cd dashboard
npm install
```

### Run in development mode

```bash
npm run dev
```

This starts both the Express/WebSocket server and the Vite dev server using `concurrently`. The client is available at `http://localhost:5173` and the API server runs on `http://localhost:3000`.

From the dashboard you can start and stop runs, view per-phase progress, and stream logs. After Phase 2 completes, the run pauses for your approval. You can review the changes and then approve, reject, or retry before Phase 3 creates the PR.

## Claude Code Skill (`/unshift`)

Unshift also ships as a Claude Code [custom skill](https://docs.anthropic.com/en/docs/claude-code/skills) that you can invoke inside any Claude Code session with `/unshift`. The skill uses Jira MCP tools directly (instead of `acli`) and runs the full Jira-to-PR workflow from within Claude Code.

The skill uses the `gh` or `glab` CLI to create pull/merge requests -see [Install prerequisites](#1-install-prerequisites) and [Credentials Reference](#credentials-reference).

### Install the skill

From the project where you want to use the skill, run:

```bash
mkdir -p .claude/skills/unshift
curl -fsSL https://raw.githubusercontent.com/CryptoRodeo/unshift/main/.claude/skills/unshift/SKILL.md \
  -o .claude/skills/unshift/SKILL.md
```

Claude Code automatically discovers skills in `.claude/skills/`.

### Configure the Jira MCP server

The skill communicates with Jira via the [Atlassian MCP server](https://support.atlassian.com/atlassian-rovo-mcp-server/docs/getting-started-with-the-atlassian-remote-mcp-server/).

Add the MCP server with your credentials in `.claude/settings.local.json` (this file should not be committed):

```json
{
  "mcpServers": {
    "atlassian": {
      "type": "url",
      "url": "https://mcp.atlassian.com/v1/sse",
      "headers": {
        "Authorization": "Basic <base64-encoded email:api-token>"
      }
    }
  }
}
```

To generate the Base64 value, run:

```bash
echo -n "you@company.com:your-jira-api-token" | base64
```

See [Credentials Reference](#credentials-reference) for how to get the token.

### Usage

Inside a Claude Code session, run:

```
/unshift              # discover and process all llm-candidate issues
/unshift PROJ-123     # process a specific issue
```

The skill reads `repos.json` from this repo's root to map Jira projects to repositories. See [Edit the project-to-repository mapping](#4-edit-the-project-to-repository-mapping) for the schema.

## File Reference

| File | Location | Purpose |
|---|---|---|
| `unshift.sh` | This repo | Top-level orchestrator  - drives all four phases |
| `ralph/ralph.sh` | This repo | Implementation loop  - one `claude -p` per prd.json entry, with automatic retry on failure |
| `prompts/phase1.md` | This repo | Phase 1 prompt template for repo setup and planning |
| `prompts/phase3.md` | This repo | Phase 3 prompt template for PR creation and Jira update |
| `init.sh` | This repo | Configures Claude Code permissions and authenticates `acli` |
| `.claude/skills/unshift/SKILL.md` | This repo | Claude Code custom skill  - run `/unshift` inside a session |
| `prd.json` | Target repo root (at runtime) | Implementation plan, created per issue, cleaned up after |
| `progress.txt` | Target repo root (at runtime) | Append-only execution log, cleaned up after |
