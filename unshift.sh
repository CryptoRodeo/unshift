#!/usr/bin/env bash
# unshift.sh — Outer orchestrator for the Jira-to-PR automation workflow
# Usage: ./unshift.sh
#
# Processes ALL llm-candidate Jira issues in a single run, looping
# Phase 1 → Phase 2 (ralph) → Phase 3 for each issue independently.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONTEXT_FILE="${SCRIPT_DIR}/unshift_context.json"

usage() {
  echo "Usage: $0" >&2
  echo "" >&2
  echo "Orchestrates the full Jira-to-PR workflow for all llm-candidate issues:" >&2
  echo "  Phase 0: Pre-flight checks and Jira discovery (all issues)" >&2
  echo "  Per issue:" >&2
  echo "    Phase 1: Repo setup, branch creation, prd.json generation" >&2
  echo "    Phase 2: Implementation via ralph.sh loop" >&2
  echo "    Phase 3: Commit, push, PR creation, Jira update, cleanup" >&2
  exit 1
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
fi

# ---------------------------------------------------------------------------
# Phase 0 — Pre-flight checks and Jira discovery
# ---------------------------------------------------------------------------
echo "=== Phase 0: Pre-flight checks and Jira discovery ===" >&2

# Pre-flight: verify required tools
MISSING_TOOLS=()
for tool in jira git gh glab jq; do
  if ! command -v "$tool" &>/dev/null; then
    MISSING_TOOLS+=("$tool")
  fi
done

if [[ ${#MISSING_TOOLS[@]} -gt 0 ]]; then
  echo "Error: Missing required tools: ${MISSING_TOOLS[*]}" >&2
  echo "Install them before running unshift.sh." >&2
  exit 1
fi

# Query Jira for all llm-candidate issues
ISSUE_KEYS=()
while IFS= read -r line; do
  key="$(echo "$line" | awk '{print $1}')"
  [[ -n "$key" ]] && ISSUE_KEYS+=("$key")
done < <(jira issue list -l "llm-candidate" --plain --no-headers --columns KEY,SUMMARY,TYPE,STATUS 2>/dev/null || true)

if [[ ${#ISSUE_KEYS[@]} -eq 0 ]]; then
  echo "No llm-candidate issues found." >&2
  exit 0
fi

echo "Found ${#ISSUE_KEYS[@]} issue(s): ${ISSUE_KEYS[*]}" >&2

# Track results per issue
declare -A RESULTS

# ---------------------------------------------------------------------------
# Process each issue: Phase 1 → Phase 2 → Phase 3
# ---------------------------------------------------------------------------
for ISSUE_KEY in "${ISSUE_KEYS[@]}"; do
  echo "" >&2
  echo "================================================================" >&2
  echo "Processing issue: $ISSUE_KEY" >&2
  echo "================================================================" >&2

  # Clean up any leftover context file from a previous iteration
  rm -f "$CONTEXT_FILE"

  # -----------------------------------------------------------------------
  # Phase 1 — Repo setup, branch creation, planning
  # -----------------------------------------------------------------------
  echo "" >&2
  echo "--- Phase 1: Planning for $ISSUE_KEY ---" >&2

  PHASE1_PROMPT="$(cat "${SCRIPT_DIR}/prompts/phase1.md")"
  PHASE1_PROMPT="${PHASE1_PROMPT//CONTEXT_FILE_PATH/$CONTEXT_FILE}"
  PHASE1_PROMPT="${PHASE1_PROMPT//ISSUE_KEY_VALUE/$ISSUE_KEY}"

  if ! claude -p --permission-mode bypassPermissions "$PHASE1_PROMPT"; then
    echo "Error: Phase 1 failed for $ISSUE_KEY. Skipping to next issue." >&2
    RESULTS["$ISSUE_KEY"]="FAILED (Phase 1)"
    continue
  fi

  if [[ ! -f "$CONTEXT_FILE" ]]; then
    echo "Error: Phase 1 did not produce context file for $ISSUE_KEY. Skipping." >&2
    RESULTS["$ISSUE_KEY"]="FAILED (Phase 1 — no context file)"
    continue
  fi

  REPO_PATH="$(jq -r '.repo_path' "$CONTEXT_FILE")"
  BRANCH_NAME="$(jq -r '.branch_name' "$CONTEXT_FILE")"

  if [[ -z "$REPO_PATH" || "$REPO_PATH" == "null" ]]; then
    echo "Error: repo_path missing from context file for $ISSUE_KEY. Skipping." >&2
    RESULTS["$ISSUE_KEY"]="FAILED (Phase 1 — no repo_path)"
    continue
  fi

  echo "Phase 1 complete. Repo: $REPO_PATH, Branch: $BRANCH_NAME" >&2

  # -----------------------------------------------------------------------
  # Phase 2 — Implementation via ralph.sh
  # -----------------------------------------------------------------------
  echo "" >&2
  echo "--- Phase 2: Implementation for $ISSUE_KEY ---" >&2

  RALPH_SRC="${SCRIPT_DIR}/ralph/ralph.sh"

  if [[ ! -f "$RALPH_SRC" ]]; then
    echo "Error: Cannot find ralph/ralph.sh. Skipping $ISSUE_KEY." >&2
    RESULTS["$ISSUE_KEY"]="FAILED (Phase 2 — ralph.sh not found)"
    continue
  fi

  # Copy ralph.sh to the repository where the changes
  # will take place.
  cp "$RALPH_SRC" "${REPO_PATH}/ralph.sh"
  chmod +x "${REPO_PATH}/ralph.sh"

  if [[ ! -f "${REPO_PATH}/prd.json" ]]; then
    echo "Error: prd.json not found in ${REPO_PATH}. Skipping $ISSUE_KEY." >&2
    RESULTS["$ISSUE_KEY"]="FAILED (Phase 2 — no prd.json)"
    continue
  fi

  INCOMPLETE_COUNT="$(jq '[.[] | select(.completed == false)] | length' "${REPO_PATH}/prd.json")"

  if [[ "$INCOMPLETE_COUNT" -eq 0 ]]; then
    echo "All prd.json entries already completed. Skipping Phase 2." >&2
  else
    echo "Running ralph.sh with ${INCOMPLETE_COUNT} iteration(s)..." >&2
    cd "$REPO_PATH"
    if ! ./ralph.sh --auto "$INCOMPLETE_COUNT"; then
      echo "Error: Phase 2 (ralph.sh) failed for $ISSUE_KEY. Skipping to next issue." >&2
      RESULTS["$ISSUE_KEY"]="FAILED (Phase 2 — ralph.sh)"
      continue
    fi
  fi

  echo "Phase 2 complete." >&2

  # -----------------------------------------------------------------------
  # Phase 3 — Verify, commit, push, PR, Jira update, cleanup
  # -----------------------------------------------------------------------
  echo "" >&2
  echo "--- Phase 3: PR creation for $ISSUE_KEY ---" >&2

  PHASE3_PROMPT="$(cat "${SCRIPT_DIR}/prompts/phase3.md")"
  PHASE3_PROMPT="${PHASE3_PROMPT//CONTEXT_FILE_PATH/$CONTEXT_FILE}"

  cd "$REPO_PATH"
  if ! claude -p --permission-mode bypassPermissions --directory "$REPO_PATH" "$PHASE3_PROMPT"; then
    echo "Error: Phase 3 failed for $ISSUE_KEY." >&2
    RESULTS["$ISSUE_KEY"]="FAILED (Phase 3)"
    continue
  fi

  RESULTS["$ISSUE_KEY"]="SUCCESS"
  echo "Issue $ISSUE_KEY completed successfully." >&2

done

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
rm -f "$CONTEXT_FILE"

echo "" >&2
echo "================================================================" >&2
echo "=== unshift run complete ===" >&2
echo "================================================================" >&2
echo "" >&2
echo "Results:" >&2
for key in "${ISSUE_KEYS[@]}"; do
  echo "  $key: ${RESULTS[$key]:-UNKNOWN}" >&2
done

# Exit with error if any issue failed
for key in "${ISSUE_KEYS[@]}"; do
  if [[ "${RESULTS[$key]:-}" != "SUCCESS" ]]; then
    exit 1
  fi
done
