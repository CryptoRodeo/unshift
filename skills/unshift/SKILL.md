---
name: unshift
description: Pick up a Jira issue labeled llm-candidate, implement it, and open a PR.
user-invocable: true
---

The unshift workflow runs as a standalone shell script that orchestrates three phases using `claude -p`. Since Claude Code cannot invoke `claude -p` from within a session, this skill prints the command for the user to run directly in their terminal.

## Instructions

When the user invokes `/unshift`, do the following:

1. Print a brief explanation that the unshift workflow must be run outside of Claude Code as a shell script.
2. Print the command the user should run:

```
~/.claude/skills/unshift/unshift.sh
```

3. Explain what the script does:
   - **Phase 1**: Queries Jira for `llm-candidate` issues, reads the issue, navigates to the correct repo, creates a branch, and generates `prd.json`
   - **Phase 2**: Runs `ralph.sh` to implement each `prd.json` entry one at a time in isolated Claude sessions
   - **Phase 3**: Verifies completion, commits, pushes, creates a PR/MR, updates Jira, and cleans up

Do NOT attempt to run unshift.sh yourself or execute any of the workflow steps directly.
