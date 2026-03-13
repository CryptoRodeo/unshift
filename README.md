# Unshift

A CLI tool that picks up Jira issues labeled `llm-candidate`, implements them using Claude, and opens a pull request.

> This project uses [Claude Code](https://docs.anthropic.com/en/docs/claude-code) as its runtime. All phases are executed via `claude -p` sessions, so a working Claude Code installation is required.

## How it works

Unshift uses a three-phase architecture orchestrated by `unshift.sh`:

1. **Phase 1 (Planning)** — A `claude -p` session queries Jira for `llm-candidate` issues, reads the issue details, maps it to the correct repository, creates a branch, and generates an implementation plan (`prd.json`).
2. **Phase 2 (Implementation)** — `ralph.sh --auto <N>` executes the plan one entry at a time, each in an isolated `claude -p` session.
3. **Phase 3 (Delivery)** — A `claude -p` session verifies all work is complete, commits, pushes, opens a PR, updates the Jira issue, and cleans up.

Each phase runs in a separate Claude session with minimal context, keeping token usage low and focus tight.

## Ralph loops and context minimization

The implementation phase uses `ralph.sh` to run one `claude -p` invocation per `prd.json` entry. Each iteration:

- Picks the next incomplete entry
- Implements only that single entry
- Runs validation commands from the entry
- Records status in `progress.txt`
- Marks the entry as completed (or logs failure)

Because each iteration starts a fresh Claude session, there is no accumulated context from previous iterations. Token usage stays flat regardless of how many entries exist, and each entry gets the full context window for its implementation.

## Prerequisites

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

## Installation

Clone the repo and run the init script to configure Claude Code permissions:

```bash
git clone https://github.com/CryptoRodeo/unshift.git
cd unshift
./init.sh
```

This creates or updates `~/.claude/settings.json` to allow the following CLI tools to run without interactive prompts during `claude -p` sessions:

- `Bash(jira *)` — query and update Jira issues
- `Bash(gh *)` — create GitHub pull requests
- `Bash(glab *)` — create GitLab merge requests

If the settings file already exists, `init.sh` merges the permissions into it (requires `jq`). If `jq` is not installed, it prints the permissions for you to add manually.

Agent working files (`prd.json`, `progress.txt`, `ralph.sh`) are created in the target repository at runtime and cleaned up after the PR is created.

## Quickstart

```bash
# 1. Install prerequisites (Node.js, Go, jq, gh/glab, Claude Code)
npm install -g @anthropic-ai/claude-code
go install github.com/ankitpokhrel/jira-cli/cmd/jira@latest

# 2. Clone and initialize
git clone https://github.com/CryptoRodeo/unshift.git
cd unshift
./init.sh

# 3. Configure Jira CLI (see "Jira CLI Setup" below)
jira init

# 4. Edit prompts/phase1.md — replace the example Project-to-Repository
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

### 2. Create a Personal Access Token

1. Go to [your Jira profile](https://issues.redhat.com/secure/ViewProfile.jspa)
2. Create a new Personal Access Token
3. Copy the token value

See the [Personal Access Token Usage](https://spaces.redhat.com/display/OMEGA/Personal+Access+Token+Usage) docs and the [API Script / Bot Policy](https://spaces.redhat.com/display/OMEGA/API%2C+Script%2C+and+Bot+Policy) for details.

### 3. Configure environment variables

Add to your `~/.bashrc` or `~/.zshrc`:

```bash
export JIRA_API_TOKEN="<your-personal-access-token>"
export JIRA_AUTH_TYPE="bearer"
```

Then reload your shell:

```bash
source ~/.bashrc  # or source ~/.zshrc
```

### 4. Initialize

Find your username at [issues.redhat.com](https://issues.redhat.com) (profile picture > Profile > Summary), then run:

```bash
jira init
```

Provide the following when prompted:

```
Installation type: Local
Authentication type: bearer
Link to Jira server: https://issues.redhat.com
Login username: <your-username>
Default project: <your-project>
Default board: <your-board or None>
```

### 5. Verify

```bash
jira issue list
```

## Project to Repository Mapping

The **Project-to-Repository Mapping** table in `prompts/phase1.md` tells the agent which repository to use for each Jira project. The table shipped with this repo contains example entries — **you must replace them with your own projects** before running unshift.

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

To get started, open `prompts/phase1.md`, clear the example rows, and add one row per repository you want unshift to work with. The same table appears in `spec.md` for reference, but only `prompts/phase1.md` is read at runtime.

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
| `init.sh` | This repo | Configures Claude Code permissions |
| `prd.json` | Target repo root (at runtime) | Implementation plan, created per issue, cleaned up after |
| `progress.txt` | Target repo root (at runtime) | Append-only execution log, cleaned up after |
