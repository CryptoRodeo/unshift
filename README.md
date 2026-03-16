# Unshift

An automation tool that picks up Jira issues labeled llm-candidate, implements them using Claude, and opens a pull request.

> This project uses [Claude Code](https://docs.anthropic.com/en/docs/claude-code) as its runtime. All phases are executed via `claude -p` sessions, so a working Claude Code installation is required.

## How it works

Unshift uses a three-phase architecture orchestrated by `unshift.sh`:

1. **Phase 1 (Planning)** - A `claude -p` session queries Jira for `llm-candidate` issues, reads the issue details, maps it to the correct repository, creates a branch, and generates an implementation plan (`prd.json`).
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

## Quickstart (Docker Compose)

The fastest way to get running. The container image bundles Node.js, Claude Code, Go, Jira CLI, gh, glab, jq, and git — no host-level installs needed beyond Docker.

### 1. Clone the repo

```bash
git clone https://github.com/CryptoRodeo/unshift.git
cd unshift
```

### 2. Configure credentials

Copy the template and fill in your tokens:

```bash
cp .env.example .unshift.env
```

**With an Anthropic API key:**

```bash
ANTHROPIC_API_KEY=sk-ant-...
JIRA_API_TOKEN=your-jira-token
JIRA_AUTH_TYPE=bearer
GITHUB_TOKEN=ghp_...
# Or, if using GitLab instead:
# GITLAB_TOKEN=glpat-...
```

**With Vertex AI (Google Cloud):**

```bash
CLAUDE_CODE_USE_VERTEX=1
CLOUD_ML_REGION=us-eastx
ANTHROPIC_VERTEX_PROJECT_ID=<your-gcp-project-id>
JIRA_API_TOKEN=your-jira-token
JIRA_AUTH_TYPE=bearer
GITHUB_TOKEN=ghp_...
# Or, if using GitLab instead:
# GITLAB_TOKEN=glpat-...
```

When using Vertex AI, also uncomment the gcloud volume mount in `compose.yml`:

```yaml
- ${HOME}/.config/gcloud:/home/unshift/.config/gcloud:ro
```

### 3. Configure Jira CLI

Unshift needs a Jira CLI config directory at `~/.config/jira`. If you don't have one yet, the easiest way is to run `jira init` inside the container:

```bash
docker compose run --rm unshift jira init
```

When prompted, provide:

```
Installation type: Local
Authentication type: bearer
Link to Jira server: https://issues.<company>.com
Login username: <your-username>
Default project: <your-project>
Default board: <your-board or None>
```

### 4. Edit the project-to-repository mapping

Open `prompts/phase1.md` and replace the example rows in the **Project-to-Repository Mapping** table with your own Jira projects and local repo paths.

Each row has the following columns:

| Column | Description |
|---|---|
| Jira Project | The Jira project key (e.g. `MYPROJ`) |
| Component | Optional Jira component to disambiguate projects that map to multiple repos |
| Repository URL | The git remote URL |
| Local directory | Absolute path where the repo is cloned on your machine |
| Default branch | Branch to base new work on (e.g. `main`) |
| Host | `GitHub` or `GitLab` — determines whether `gh` or `glab` is used for PRs |
| Validation commands | Shell commands to verify correctness (e.g. `npm test`, `npx tsc --noEmit`) |

> **Note:** Inside the container, your `~/work` directory is mounted at `/work`. Use `/work/...` paths in the mapping table when running via Docker Compose, or `~/work/...` paths when running locally.

### 5. Run

```bash
docker compose up
```

The dashboard will be available at `http://localhost:5173` (Vite dev server) and `http://localhost:3000` (API server). From the dashboard you can start and stop runs, view per-phase progress, and stream logs.

The container bind-mounts the following from your host:

| Host path | Container path | Mode |
|---|---|---|
| `~/work` (or `$UNSHIFT_WORK_DIR`) | `/work` | read-write |
| `~/.ssh` | `/home/unshift/.ssh` | read-only |
| `~/.config/jira` | `/home/unshift/.config/jira` | read-only |
| `~/.gitconfig` | `/home/unshift/.gitconfig` | read-only |

To use a different workspace directory:

```bash
UNSHIFT_WORK_DIR=/path/to/your/repos docker compose up
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

## Manual Installation (without Docker)

If you prefer to run unshift directly on your host machine without Docker, install the prerequisites below and follow the manual quickstart.

### Prerequisites

| Tool | Purpose | Install |
|---|---|---|
| [Node.js](https://nodejs.org/) (v18+) | Runtime for Claude Code and the dashboard | [Download](https://nodejs.org/) or `dnf install nodejs` / `brew install node` |
| [Claude Code](https://docs.anthropic.com/en/docs/claude-code) | CLI agent that runs each phase | `npm install -g @anthropic-ai/claude-code` |
| [Go](https://go.dev/) (1.21+) | Required to install the Jira CLI | [Download](https://go.dev/dl/) or `dnf install golang` / `brew install go` |
| [Jira CLI](https://github.com/ankitpokhrel/jira-cli) | Query and update Jira issues | See [Jira CLI Setup](#jira-cli-setup) below |
| [gh](https://cli.github.com/) | Create GitHub PRs | `dnf install gh` / `brew install gh` |
| [glab](https://gitlab.com/gitlab-org/cli) | Create GitLab MRs | `dnf install glab` / `brew install glab` |
| [jq](https://jqlang.github.io/jq/) | Used by the installer and orchestrator | `dnf install jq` / `brew install jq` |
| [Git](https://git-scm.com/) | Version control | Pre-installed on most systems |

You only need `gh` or `glab` depending on which repositories you work with.

Git must be configured with push access to your target repositories (e.g. via SSH keys or a credential helper).

### Manual quickstart

```bash
# 1. Install prerequisites (Node.js, Go, jq, gh/glab, Claude Code)
#    If using Vertex AI (Google Cloud), see "Claude Code via Vertex AI" above
npm install -g @anthropic-ai/claude-code
go install github.com/ankitpokhrel/jira-cli/cmd/jira@latest

# 2. Clone and initialize
git clone https://github.com/CryptoRodeo/unshift.git
cd unshift
./init.sh

# 3. Configure Jira CLI (see "Jira CLI Setup" below)
jira init

# 4. Edit prompts/phase1.md - replace the example Project-to-Repository
#    Mapping table with your own Jira projects and local repo paths.

# 5. Label a Jira issue with "llm-candidate" and run
./unshift.sh

# Or start a run from the dashboard instead (see "Dashboard" below)
cd dashboard && npm install && npm run dev
```

## Usage

Run the orchestrator script from the repo directory:

```bash
./unshift.sh
```

## Jira CLI Setup

### 1. Install

```bash
go install github.com/ankitpokhrel/jira-cli/cmd/jira@latest
```

If that doesn't work, build from source:

```bash
git clone https://github.com/ankitpokhrel/jira-cli.git
cd jira-cli
make install
```

### 2. Create an API Token

Choose the section that matches your Jira deployment.

#### Local / Data Center instances

1. Go to [your Jira profile](https://issues.<company>.com/secure/ViewProfile.jspa)
2. Create a new Personal Access Token
3. Copy the token value

See your organization's internal docs on Personal Access Token usage and API/bot policies for details.

#### Cloud instances

1. Create a personal API token for Jira Cloud

   Use this when you want a token tied to your own Atlassian user (same permissions as you in Jira).

2. Open your Atlassian account security page

   Go to:
   https://id.atlassian.com/manage-profile/security
   (Atlassian docs reference: https://support.atlassian.com/atlassian-account/docs/manage-api-tokens-for-your-atlassian-account/)

3. Sign in (if prompted)

   Use the same account you use for https://<company>.atlassian.net.

4. Create an API token

   - Scroll to "API tokens".
   - Click "Create API token" (or "Create API token with scopes" if visible).
   - Enter a label (for example, `Jira - CI script`, `Postman`, `Local tooling`).

5. Set token expiration

   - Choose an expiration between 1 and 365 days.
   - By default, tokens expire in 1 year.
   - Pick the shortest lifetime that still works for your use case.

6. (If offered) Choose scopes

   Depending on your UI you may see:

   - **Token with scopes** – recommended:
     - Select only what is needed, e.g.:
       - `read:jira-work` to read issues
       - `write:jira-work` to create/update issues
   - **Token without scopes / classic token** – full access equivalent to your user permissions.

7. Create and copy the token

   - Click **Create**.
   - Click **Copy to clipboard** and store it somewhere safe (e.g., a password manager or a secure secret store in your CI/CD).
   - You cannot view it again after closing the dialog; if lost, you must create a new one.

### 3. Configure environment variables

Add to your `~/.bashrc` or `~/.zshrc`:

For **local / Data Center** instances:

```bash
export JIRA_API_TOKEN="<your-personal-access-token>"
export JIRA_AUTH_TYPE="bearer"
```

For **cloud** instances:

```bash
export JIRA_API_TOKEN="<your-api-token>"
# Cloud supports bearer and basic auth
export JIRA_AUTH_TYPE="bearer"   # or "basic"
```

Then reload your shell:

```bash
source ~/.bashrc  # or source ~/.zshrc
```

### 4. Initialize

#### Local / Data Center

Find your username at [issues.<company>.com](https://issues.<company>.com) (profile picture > Profile > Summary), then run:

```bash
jira init
```

Provide the following when prompted:

```
Installation type: Local
Authentication type: bearer
Link to Jira server: https://issues.<company>.com
Login username: <your-username>
Default project: <your-project>
Default board: <your-board or None>
```

#### Cloud

```bash
jira init
```

Provide the following when prompted (Cloud mode uses basic auth by default but also supports bearer auth):

```
Installation type: Cloud
Link to Jira server: https://<company>.atlassian.net
Login email: <your-email>
Default project: <your-project>
Default board: <your-board or None>
```

The config file is stored at `~/.config/.jira.yml`. To reconfigure, delete it and re-run `jira init`.

> **Note:** If your on-premise Jira uses a non-English language, you may need to manually configure `epic.name`, `epic.link`, and `issue.types.*.handle` in the config file. See the [Jira CLI README](https://github.com/ankitpokhrel/jira-cli) for details.

### 5. Verify

```bash
jira issue list
```

## Dashboard (optional)

The `dashboard/` directory contains a web UI for monitoring unshift runs in real time. It is not required to use unshift — the CLI works on its own.

When using Docker Compose, the dashboard starts automatically. For manual installs:

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
| `init.sh` | This repo | Configures Claude Code permissions |
| `compose.yml` | This repo | Docker Compose configuration |
| `Dockerfile` | This repo | Container image definition (all tools bundled) |
| `prd.json` | Target repo root (at runtime) | Implementation plan, created per issue, cleaned up after |
| `progress.txt` | Target repo root (at runtime) | Append-only execution log, cleaned up after |
