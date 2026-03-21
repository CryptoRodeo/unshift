# Unshift

An automation tool that picks up Jira issues labeled `llm-candidate`, implements them using Claude, and opens a pull request.

> This project uses [Claude Code](https://docs.anthropic.com/en/docs/claude-code) as its runtime. All phases are executed via `claude -p` sessions, so a working Claude Code installation is required.

## How it works

`unshift.sh` runs three phases, each in its own `claude -p` session:

1. **Plan**  - Finds `llm-candidate` issues in Jira, maps them to a repo, creates a branch, and builds an implementation plan (`prd.json`).
2. **Implement**  - `ralph.sh` works through the plan one entry at a time, each in a fresh Claude session. This keeps token usage flat and gives every entry the full context window.
3. **Deliver**  - Commits, pushes, opens a PR, updates Jira, and cleans up.

## Quickstart
### Prefer Claude Code Skills?
We have a skill for this whole workflow. See [Claude Code Skill setup](#claude-code-skill-setup-unshift).

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

Or start a run from the dashboard instead (see "Dashboard" below):

```bash
cd dashboard && npm install && npm run dev
```

## Jira Integration

Unshift interacts with Jira through the [Atlassian CLI (`acli`)](https://developer.atlassian.com/cloud/acli/), which is authenticated automatically by `init.sh`. Phase 0 discovery also uses a direct `curl` call to the Jira REST API.

### Environment variables

Set the following in your `.unshift.env` file (or export them in your shell):

| Variable | Purpose |
|---|---|
| `JIRA_BASE_URL` | Your Jira instance URL (e.g. `https://mycompany.atlassian.net`) |
| `JIRA_USER_EMAIL` | Email associated with your Jira account (required for Basic auth; not needed for bearer) |
| `JIRA_API_TOKEN` | API token for Phase 0 curl discovery and `acli` authentication |
| `JIRA_AUTH_TYPE` | `basic` (Cloud, default) or `bearer` (Data Center PATs) |
| `JIRA_API_VERSION` | `3` (Cloud, default) or `2` (Data Center) |

### Creating a Jira API token

For **Jira Cloud**: Go to [Atlassian API token management](https://id.atlassian.com/manage-profile/security/api-tokens), click "Create API token", and copy the value. Use the email address of the Atlassian account that created the token as `JIRA_USER_EMAIL`.

For **Jira Data Center / Server**: Create a Personal Access Token from your Jira profile (Profile > Personal Access Tokens). Note that the REST API endpoint differs  - see the note below.

> **Jira Data Center / Server note:** Set `JIRA_AUTH_TYPE=bearer` and `JIRA_API_VERSION=2` in your `.unshift.env`. Data Center uses Personal Access Tokens (Bearer auth) and the `/rest/api/2/search` endpoint. You do not need to set `JIRA_USER_EMAIL` when using bearer auth.

## GitHub & GitLab Tokens

Unshift uses the `gh` or `glab` CLI to open pull/merge requests. Each CLI expects a personal access token in a specific environment variable. You only need to configure the one that matches your repositories' `host` field in `repos.json`.

### GitHub (`GH_TOKEN`)

1. Go to [GitHub > Settings > Developer settings > Personal access tokens](https://github.com/settings/tokens).
2. Click **Generate new token** (classic) or **Generate new token (fine-grained)**.
3. For classic tokens, select the **`repo`** scope (full control of private repositories).
   For fine-grained tokens, grant **Contents** (read/write) and **Pull requests** (read/write) on the target repositories.
4. Copy the token and set it in your `.unshift.env`:

```bash
GH_TOKEN=ghp_...
```

The `gh` CLI recognizes `GH_TOKEN` automatically  - no separate `gh auth login` is needed.

### GitLab (`GITLAB_TOKEN`)

1. Go to **GitLab > Preferences > Access Tokens** (or `https://gitlab.com/-/user_settings/personal_access_tokens`).
2. Click **Add new token**.
3. Select the **`api`** scope (full API access, required for creating merge requests).
4. Copy the token and set it in your `.unshift.env`:

```bash
GITLAB_TOKEN=glpat-...
```

The `glab` CLI recognizes `GITLAB_TOKEN` automatically  - no separate `glab auth login` is needed.

## Dashboard (optional)

The `dashboard/` directory contains a web UI for monitoring unshift runs in real time. It is not required to use unshift  - the CLI works on its own.

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

From the dashboard you can start and stop runs, view per-phase progress, and stream logs.

## Claude Code Skill setup (`/unshift`)

Unshift also ships as a Claude Code [custom skill](https://docs.anthropic.com/en/docs/claude-code/skills) that you can invoke inside any Claude Code session with `/unshift`. The skill uses Jira MCP tools directly (instead of `acli`) and runs the full Jira-to-PR workflow from within Claude Code.

### Prerequisites

The skill uses the `gh` or `glab` CLI to create pull/merge requests. Make sure the relevant CLI is installed and its token is configured  - see [Install prerequisites](#1-install-prerequisites) and [GitHub & GitLab Tokens](#github--gitlab-tokens).

### Install the skill

From the project where you want to use the skill, run:

```bash
mkdir -p .claude/skills/unshift
curl -fsSL https://raw.githubusercontent.com/CryptoRodeo/unshift/main/.claude/skills/unshift/SKILL.md \
  -o .claude/skills/unshift/SKILL.md
```

That's it  - Claude Code automatically discovers skills in `.claude/skills/`.

### Configure the Jira MCP server

The skill communicates with Jira via the [Atlassian MCP server](https://mcp.atlassian.com).

Add the MCP server:

```bash
claude mcp add --transport http jira https://mcp.atlassian.com/v1/mcp
```

#### Configure Auth

Generate an API token. (see [Creating a Jira API token](#creating-a-jira-api-token))

Add the following to your `.claude/settings.local.json` (this file should not be committed):

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

### Usage

Inside a Claude Code session, run:

```
/unshift              # discover and process all llm-candidate issues
/unshift PROJ-123     # process a specific issue
```

The skill reads `repos.json` from this repo's root to map Jira projects to repositories. See the "Edit the project-to-repository mapping" section above for the schema.

## File Reference

| File | Location | Purpose |
|---|---|---|
| `unshift.sh` | This repo | Top-level orchestrator  - drives all three phases |
| `ralph/ralph.sh` | This repo | Implementation loop  - one `claude -p` per prd.json entry |
| `prompts/phase1.md` | This repo | Phase 1 prompt template for Jira discovery and planning |
| `prompts/phase3.md` | This repo | Phase 3 prompt template for PR creation and Jira update |
| `init.sh` | This repo | Configures Claude Code permissions and authenticates `acli` |
| `.claude/skills/unshift/SKILL.md` | This repo | Claude Code custom skill  - run `/unshift` inside a session |
| `prd.json` | Target repo root (at runtime) | Implementation plan, created per issue, cleaned up after |
| `progress.txt` | Target repo root (at runtime) | Append-only execution log, cleaned up after |
