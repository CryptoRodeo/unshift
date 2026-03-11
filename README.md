# Unshift

A Claude Code skill that picks up Jira issues labeled `llm-candidate`, implements them, and opens a pull request.

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
| [Claude Code](https://docs.anthropic.com/en/docs/claude-code) | CLI agent that runs the skill | `npm install -g @anthropic-ai/claude-code` |
| [Jira CLI](https://github.com/ankitpokhrel/jira-cli) | Query and update Jira issues | See [Jira CLI Setup](#jira-cli-setup) below |
| [gh](https://cli.github.com/) | Create GitHub PRs | `dnf install gh` / `brew install gh` |
| [glab](https://gitlab.com/gitlab-org/cli) | Create GitLab MRs | `dnf install glab` / `brew install glab` |
| [jq](https://jqlang.github.io/jq/) | Used by the installer and orchestrator | `dnf install jq` / `brew install jq` |
| [Git](https://git-scm.com/) | Version control | Pre-installed on most systems |

You only need `gh` or `glab` depending on which repositories you work with.

## Installation

Run the init script from within any project repository:

```bash
curl -sSL https://raw.githubusercontent.com/CryptoRodeo/unshift/refs/heads/main/init.sh | bash
```

This installs:

1. The `/unshift` skill to `~/.claude/skills/unshift/SKILL.md`
2. The orchestrator script `unshift.sh` to `~/.claude/skills/unshift/`
3. The implementation loop `ralph.sh` to `~/.claude/skills/unshift/ralph/`
4. Prompt templates (`phase1.md`, `phase3.md`) to `~/.claude/skills/unshift/prompts/`
5. CLI permissions (`jira`, `gh`, `glab`) to `~/.claude/settings.json`

Agent working files (`prd.json`, `progress.txt`, `ralph.sh`) are created in the target repository at runtime and cleaned up after the PR is created.

## Usage

The primary way to run unshift is directly via the shell script:

```bash
~/.claude/skills/unshift/unshift.sh
```

Alternatively, open Claude Code and run `/unshift` — this prints the command above for you to execute outside of Claude Code (since the orchestrator invokes `claude -p` itself).

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

## Supported Repositories

| Jira Project | Repository | Host |
|---|---|---|
| `SSCUI` | `ui-packages.redhat.com` | GitLab |
| `TC` | `trustify-ui` | GitHub |
| `SECURESIGN` | `rhtas-console-ui` | GitHub |

To add or update a repository, see [Customizing the Skill](#customizing-the-skill) below.

## Customizing the Skill

The installed skill lives at `~/.claude/skills/unshift/SKILL.md`, but you should treat `skills/unshift/SKILL.md` in this repo as the source of truth. To make changes (e.g. adding a new Jira project-to-repository mapping):

1. Edit `skills/unshift/SKILL.md` in this repo
2. Copy it to the installed location:

```bash
cp skills/unshift/SKILL.md ~/.claude/skills/unshift/SKILL.md
```

### Example: Adding a new repository

Open `skills/unshift/SKILL.md` and add a row to the **Project-to-Repository Mapping** table:

```markdown
| `MYPROJ` | None | `git@github.com:org/my-repo.git` | `~/work/my-repo` | `main` | GitHub | `npm test` |
```

Then copy the updated file:

```bash
cp skills/unshift/SKILL.md ~/.claude/skills/unshift/SKILL.md
```

The next time you use this skill Claude will use the updated mapping.

## File Reference

| File | Location | Purpose |
|---|---|---|
| `unshift.sh` | This repo (source) / `~/.claude/skills/unshift/` (installed) | Top-level orchestrator — drives all three phases |
| `ralph/ralph.sh` | This repo (source) / `~/.claude/skills/unshift/ralph/` (installed) | Implementation loop — one `claude -p` per prd.json entry |
| `prompts/phase1.md` | This repo (source) / `~/.claude/skills/unshift/prompts/` (installed) | Phase 1 prompt template for Jira discovery and planning |
| `prompts/phase3.md` | This repo (source) / `~/.claude/skills/unshift/prompts/` (installed) | Phase 3 prompt template for PR creation and Jira update |
| `skills/unshift/SKILL.md` | This repo (source) / `~/.claude/skills/unshift/` (installed) | Claude Code skill definition (convenience wrapper) |
| `init.sh` | This repo | Installer script (skill, scripts, prompts, and settings) |
| `prd.json` | Target repo root (at runtime) | Implementation plan, created per issue, cleaned up after |
| `progress.txt` | Target repo root (at runtime) | Append-only execution log, cleaned up after |
