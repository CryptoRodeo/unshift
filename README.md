# Unshift

A CLI tool that picks up Jira issues labeled `llm-candidate`, implements them using Claude, and opens a pull request.

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
| [Claude Code](https://docs.anthropic.com/en/docs/claude-code) | CLI agent that runs each phase | `npm install -g @anthropic-ai/claude-code` |
| [Jira CLI](https://github.com/ankitpokhrel/jira-cli) | Query and update Jira issues | See [Jira CLI Setup](#jira-cli-setup) below |
| [gh](https://cli.github.com/) | Create GitHub PRs | `dnf install gh` / `brew install gh` |
| [glab](https://gitlab.com/gitlab-org/cli) | Create GitLab MRs | `dnf install glab` / `brew install glab` |
| [jq](https://jqlang.github.io/jq/) | Used by the installer and orchestrator | `dnf install jq` / `brew install jq` |
| [Git](https://git-scm.com/) | Version control | Pre-installed on most systems |

You only need `gh` or `glab` depending on which repositories you work with.

## Installation

Clone the repo and run the init script to configure Claude Code permissions:

```bash
git clone https://github.com/CryptoRodeo/unshift.git
cd unshift
./init.sh
```

This adds CLI permissions (`jira`, `gh`, `glab`) to `~/.claude/settings.json`.

Agent working files (`prd.json`, `progress.txt`, `ralph.sh`) are created in the target repository at runtime and cleaned up after the PR is created.

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
Each Jira project should have some repository where the pull requests will be created.

The **Project-to-Repository Mapping** table in `prompts/phase1.md` includes a **Local directory** column that defaults to example paths (e.g. `~/work/trustify-ui`). Update these values to match the actual directory paths where you have each project cloned on your machine.

To add a new repository, add a row to the same table. Use `None` for optional columns (e.g. `Component`, `Validation commands`) when they don't apply.

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
