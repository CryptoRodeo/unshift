# Improvements

## Observability & Cost Management

1. **Cost dashboard** — Tokens are tracked per run but not aggregated or visualized. A cost breakdown view (by provider, model, project, time period) would help budget and optimize LLM spend.

2. **Phase-level token tracking** — Currently tokens are tracked per-run. Breaking this down per-phase would reveal whether planning or implementation is the expensive part, enabling targeted model selection (e.g., cheaper model for phase 1, stronger for phase 2).

3. **Run analytics / success-rate trends** — A chart showing success/failure rates over time, average durations by phase, and retry rates. This helps identify systemic issues (e.g., "phase 2 fails 40% of the time on repo X").

## Workflow Improvements

4. **Auto-approval rules** — The approval gate is always manual. Allow configuring auto-approval for low-risk changes (e.g., test-only PRs, docs, issues with a specific label) to reduce human bottleneck.

5. **Diff preview at approval gate** — Before approving, show the actual git diff in the UI rather than requiring users to open the repo externally. This is the most critical decision point and deserves first-class UX.

6. **Partial retry from specific phase** — Currently retry restarts the whole workflow. Allowing retry from phase 2 (keeping the existing plan) or phase 3 (keeping the implementation) would save time and tokens.

7. **Scheduling / rate limiting** — Run queuing with configurable concurrency limits. If someone kicks off 20 discovered issues, you probably don't want 20 parallel LLM calls and worktrees.

## Developer Experience

8. **Webhook / notification integrations** — Beyond browser notifications, support Slack/Teams/email webhooks on run completion, failure, or approval-needed events. This is table stakes for a team tool.

9. **Run comparison view** — Compare two runs of the same issue side-by-side (logs, PRD, tokens, outcome). Useful when debugging why a retry succeeded or a model change helped.

10. **Template / prompt customization UI** — Prompts are currently hardcoded in `prompts.ts`. A settings page to customize system prompts, commit prefixes, or validation rules per-repo would make the platform more adaptable without code changes.

## Reliability & Resilience

11. **Run persistence across restarts** — The approval gate uses an in-memory `Map` of Promises. If the server restarts, runs awaiting approval are lost. Persisting the phase state in SQLite and resuming on startup would fix this.

12. **Validation result storage** — Phase 2 runs validation commands but doesn't store the output. Persisting test/lint results would help diagnose failures without re-running.

13. **Health check endpoint** — Useful for Docker/k8s deployments. A `/healthz` that checks DB connectivity, active run count, and WebSocket status.

## Multi-User & Team Features

14. **Authentication & RBAC** — No auth currently exists. Even basic auth or SSO would be important before team adoption, especially since this tool creates PRs and transitions Jira issues.

15. **Run ownership / assignment** — Track who triggered a run and who approved it for audit purposes.

16. **Audit log** — A persistent log of all actions (run created, approved, rejected, deleted) with timestamps and actors. Important for compliance in enterprise settings.

## Quick Wins

17. **Dark mode toggle** — PatternFly supports it natively; just toggle the theme class.

18. **Keyboard shortcuts** — Approve/reject, navigate between runs, refresh for power users.

19. **Export runs to CSV/JSON** — For reporting or external analysis.

20. **Favicon / title updates** — Show active run count or failure state in the browser tab title.
