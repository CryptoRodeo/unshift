# Unshift

An automation tool that picks up Jira issues labeled `llm-candidate`, implements them using Claude, and opens a pull request.

> This project uses [Claude Code](https://docs.anthropic.com/en/docs/claude-code) as its runtime. All phases are executed via `claude -p` sessions, so a working Claude Code installation is required.

## How it works

Unshift uses a three-phase architecture orchestrated by `unshift.sh`:

1. **Phase 1 (Planning)** - A `claude -p` session queries Jira via `acli` for `llm-candidate` issues, reads the issue details, maps it to the correct repository, creates a branch, and generates an implementation plan (`prd.json`).
2. **Phase 2 (Implementation)** - `ralph.sh --auto <N>` executes the plan one entry at a time, each in an isolated `claude -p` session.
3. **Phase 3 (Delivery)** - A `claude -p` session verifies all work is complete, commits, pushes, opens a PR, updates the Jira issue, and cleans up.

Each phase runs in a separate Claude session with minimal context, keeping token usage low and focus tight.

## Ralph loops and context minimization

The implementation phase uses `ralph.sh` to run one `claude -p` invocation per `prd.json` entry. Each iteration:

- Picks the next incomplete entry
- Implements only that single entry
- Runs validation commands from the entry
- Records status in `progress.txt`
- Marks the entry as completed (or logs failure)

Because each iteration starts a fresh Claude session, there is no accumulated context from previous iterations. Token usage stays flat regardless of how many entries exist, and each entry gets the full context window for its implementation.

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
| `host` | `GitHub` or `GitLab` — determines whether `gh` or `glab` is used for PRs |
| `validation` | Array of shell commands to verify correctness (e.g. `["npm test", "npx tsc --noEmit"]`), or `[]` if none |

### 5. Run

```bash
./unshift.sh
```

Or start a run from the dashboard instead (see "Dashboard" below):

```bash
cd dashboard && npm install && npm run dev
```

## Claude Code via Vertex AI

If your Claude Code installation was provisioned through an internal GCP Vertex AI setup, you do **not** need an `ANTHROPIC_API_KEY`. Authentication goes through Google Cloud instead.

Make sure the following environment variables are set in your `~/.bashrc` or `~/.zshrc`:

```bash
export CLAUDE_CODE_USE_VERTEX=1
export CLOUD_ML_REGION=us-eastx
export ANTHROPIC_VERTEX_PROJECT_ID=<your-gcp-project-id>
```

You also need active GCP credentials:

```bash
gcloud auth application-default login
gcloud auth application-default set-quota-project cloudability-it-gemini
```

To verify your setup, run `claude` and then `/status` - the provider should show "Google Vertex AI".

> **Note:** Everything else in this README (init.sh, unshift.sh, ralph, etc.) works the same regardless of whether you use a direct API key or Vertex AI. The only difference is how Claude Code authenticates.

## Usage

Run the orchestrator script from the repo directory:

```bash
./unshift.sh
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

### How it works

1. **Phase 0 (Discovery)** — `unshift.sh` uses `curl` to query the Jira REST API for issues labeled `llm-candidate`.
2. **Phase 1 (Planning)** and **Phase 3 (Delivery)** — Claude Code uses `acli` to read issue details, transition issues, and add comments.
3. If `acli` is unavailable, the prompts include a `curl` fallback using `JIRA_BASE_URL`, `JIRA_USER_EMAIL`, and `JIRA_API_TOKEN`.

### Creating a Jira API token

For **Jira Cloud**: Go to [Atlassian API token management](https://id.atlassian.com/manage-profile/security/api-tokens), click "Create API token", and copy the value. Use the email address of the Atlassian account that created the token as `JIRA_USER_EMAIL`.

For **Jira Data Center / Server**: Create a Personal Access Token from your Jira profile (Profile > Personal Access Tokens). Note that the REST API endpoint differs — see the note below.

> **Jira Data Center / Server note:** Set `JIRA_AUTH_TYPE=bearer` and `JIRA_API_VERSION=2` in your `.unshift.env`. Data Center uses Personal Access Tokens (Bearer auth) and the `/rest/api/2/search` endpoint. You do not need to set `JIRA_USER_EMAIL` when using bearer auth.

## Dashboard (optional)

The `dashboard/` directory contains a web UI for monitoring unshift runs in real time. It is not required to use unshift — the CLI works on its own.

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

## File Reference

| File | Location | Purpose |
|---|---|---|
| `unshift.sh` | This repo | Top-level orchestrator — drives all three phases |
| `ralph/ralph.sh` | This repo | Implementation loop — one `claude -p` per prd.json entry |
| `prompts/phase1.md` | This repo | Phase 1 prompt template for Jira discovery and planning |
| `prompts/phase3.md` | This repo | Phase 3 prompt template for PR creation and Jira update |
| `init.sh` | This repo | Configures Claude Code permissions and authenticates `acli` |
| `prd.json` | Target repo root (at runtime) | Implementation plan, created per issue, cleaned up after |
| `progress.txt` | Target repo root (at runtime) | Append-only execution log, cleaned up after |
