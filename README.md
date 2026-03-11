# Unshift

A Claude Code skill that picks up Jira issues labeled `llm-candidate`, implements them, and opens a pull request.

## How it works

1. Queries Jira for issues labeled `llm-candidate`
2. Reads the issue details and maps it to the correct repository
3. Creates a branch, generates an implementation plan (`prd.json`)
4. Executes the plan using the [ralph](https://github.com/CryptoRodeo/ralph) loop
5. Commits, pushes, opens a PR, and updates the Jira issue

## Prerequisites

| Tool | Purpose | Install |
|---|---|---|
| [Claude Code](https://docs.anthropic.com/en/docs/claude-code) | CLI agent that runs the skill | `npm install -g @anthropic-ai/claude-code` |
| [Jira CLI](https://github.com/ankitpokhrel/jira-cli) | Query and update Jira issues | See [Jira CLI Setup](#jira-cli-setup) below |
| [gh](https://cli.github.com/) | Create GitHub PRs | `dnf install gh` / `brew install gh` |
| [glab](https://gitlab.com/gitlab-org/cli) | Create GitLab MRs | `dnf install glab` / `brew install glab` |
| [jq](https://jqlang.github.io/jq/) | Used by the installer to merge settings | `dnf install jq` / `brew install jq` |
| [Git](https://git-scm.com/) | Version control | Pre-installed on most systems |

You only need `gh` or `glab` depending on which repositories you work with.

## Installation

Run the init script from within any project repository:

```bash
curl -sSL https://raw.githubusercontent.com/CryptoRodeo/unshift/refs/heads/main/init.sh | bash
```

This does two things:

1. Installs the `/unshift` skill to `~/.claude/skills/unshift/SKILL.md`
2. Adds CLI permissions (`jira`, `gh`, `glab`) to `~/.claude/settings.json`

Ralph files (`ralph.sh`, `prd.json`, `progress.txt`) are bootstrapped automatically in the target repository when the skill runs.

## Usage

Open Claude Code in any directory and run:

```
/unshift
```

Claude will find the next `llm-candidate` issue, implement it, and open a PR.

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

Use `None` for columns that don't apply to your repository:
- **Component** — set to `None` when the Jira project doesn't use components to distinguish repositories.
- **Validation commands** — set to `None` when there are no validation commands to run.

Then copy the updated file:

```bash
cp skills/unshift/SKILL.md ~/.claude/skills/unshift/SKILL.md
```

The next time you use this skill Claude will use the updated mapping.

## File Reference

| File | Location | Purpose |
|---|---|---|
| `skills/unshift/SKILL.md` | This repo (source) / `~/.claude/skills/unshift/` (installed) | The Claude Code skill definition |
| `init.sh` | This repo | Installer script (skill + settings only) |
| `ralph/ralph.sh` | This repo (source) / target repo root (at runtime) | Execution loop that implements one prd.json entry per iteration |
| `ralph/prd.json` | This repo (source) / target repo root (at runtime) | Template implementation plan, overwritten per issue |
| `ralph/progress.txt` | This repo (source) / target repo root (at runtime) | Append-only execution log |

