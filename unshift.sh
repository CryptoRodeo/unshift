#!/usr/bin/env bash
# unshift.sh - Outer orchestrator for the Jira-to-PR automation workflow (uses Jira REST API via curl)
# Usage: ./unshift.sh [--discover] [--issue KEY] [--retry]
#
# --discover   Print all llm-candidate Jira issue keys to stdout and exit.
# --issue KEY  Process a single Jira issue instead of discovering all.
# --retry      Skip Phase 0/1, resume from prd.json, re-copy ralph.sh, re-run Phase 2.
#              Requires --issue KEY and UNSHIFT_CONTEXT_FILE env var.
# (no flags)   Discover and process ALL llm-candidate issues sequentially.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONTEXT_FILE="${UNSHIFT_CONTEXT_FILE:-/tmp/unshift_context.json}"

usage() {
  echo "Usage: $0 [--discover] [--issue KEY]" >&2
  echo "" >&2
  echo "Options:" >&2
  echo "  --discover   Print llm-candidate issue keys to stdout and exit" >&2
  echo "  --issue KEY  Process a single Jira issue" >&2
  echo "  --retry      Skip Phase 0/1, resume from prd.json, re-copy ralph.sh, re-run Phase 2" >&2
  echo "               Requires --issue KEY and UNSHIFT_CONTEXT_FILE env var" >&2
  echo "  (no flags)   Discover and process all llm-candidate issues" >&2
  echo "" >&2
  echo "Phases per issue:" >&2
  echo "  Phase 1: Repo setup, branch creation, prd.json generation" >&2
  echo "  Phase 2: Implementation via ralph.sh loop" >&2
  echo "  Phase 3: Commit, push, PR creation, Jira update, cleanup" >&2
  exit 1
}

SINGLE_ISSUE=""
DISCOVER_ONLY=false
RETRY_MODE=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --issue)
      SINGLE_ISSUE="${2:?'--issue requires a Jira key'}"
      shift 2
      ;;
    --discover)
      DISCOVER_ONLY=true
      shift
      ;;
    --retry)
      RETRY_MODE=true
      shift
      ;;
    -h|--help)
      usage
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

# Validate --retry requirements
if [[ "$RETRY_MODE" == true ]]; then
  if [[ -z "$SINGLE_ISSUE" ]]; then
    echo "Error: --retry requires --issue KEY" >&2
    exit 1
  fi
  if [[ -z "${UNSHIFT_CONTEXT_FILE:-}" ]]; then
    echo "Error: --retry requires UNSHIFT_CONTEXT_FILE env var to be set" >&2
    exit 1
  fi
fi

# Validate Claude Code authentication
if [[ -z "${ANTHROPIC_API_KEY:-}" && -z "${CLAUDE_CODE_USE_VERTEX:-}" ]]; then
  echo "Error: Set ANTHROPIC_API_KEY or CLAUDE_CODE_USE_VERTEX for Claude Code authentication." >&2
  exit 1
fi

# Validate required environment variables for Jira REST API
if [[ -z "${JIRA_BASE_URL:-}" ]]; then
  echo "Error: JIRA_BASE_URL is not set. Set it to your Jira instance URL (e.g. https://mycompany.atlassian.net)." >&2
  exit 1
fi
if [[ -z "${JIRA_API_TOKEN:-}" ]]; then
  echo "Error: JIRA_API_TOKEN is not set. Set it to a Jira API token for authentication." >&2
  exit 1
fi
JIRA_AUTH_TYPE="${JIRA_AUTH_TYPE:-basic}"
if [[ "$JIRA_AUTH_TYPE" == "basic" && -z "${JIRA_USER_EMAIL:-}" ]]; then
  echo "Error: JIRA_USER_EMAIL is not set. Required for Basic auth (Jira Cloud). Set JIRA_AUTH_TYPE=bearer for Data Center PATs." >&2
  exit 1
fi

# Build curl auth flags based on auth type
if [[ "$JIRA_AUTH_TYPE" == "bearer" ]]; then
  CURL_AUTH=(-H "Authorization: Bearer ${JIRA_API_TOKEN}")
else
  CURL_AUTH=(-u "${JIRA_USER_EMAIL}:${JIRA_API_TOKEN}")
fi

# Determine Jira REST API endpoint based on version
JIRA_API_VERSION="${JIRA_API_VERSION:-3}"

# ---------------------------------------------------------------------------
# Retry mode: skip Phase 0/1, reuse context, reset prd.json, re-run Phase 2
# ---------------------------------------------------------------------------
if [[ "$RETRY_MODE" == true ]]; then
  ISSUE_KEY="$SINGLE_ISSUE"
  declare -A RESULTS

  echo "" >&2
  echo "================================================================" >&2
  echo "Processing issue: $ISSUE_KEY" >&2
  echo "Retrying issue: $ISSUE_KEY" >&2
  echo "================================================================" >&2

  CONTEXT_FILE="$UNSHIFT_CONTEXT_FILE"

  # Read repo_path and branch_name from the existing context file
  if [[ ! -f "$CONTEXT_FILE" ]]; then
    echo "Error: Context file $CONTEXT_FILE not found for retry." >&2
    exit 1
  fi

  REPO_PATH="$(jq -r '.repo_path' "$CONTEXT_FILE")"
  BRANCH_NAME="$(jq -r '.branch_name' "$CONTEXT_FILE")"

  if [[ -z "$REPO_PATH" || "$REPO_PATH" == "null" ]]; then
    echo "Error: repo_path missing from context file." >&2
    exit 1
  fi

  # Ensure we're on the correct branch
  cd "$REPO_PATH"
  git checkout "$BRANCH_NAME"

  # Verify prd.json exists (completed entries are preserved so retry picks up where it left off)
  if [[ ! -f "${REPO_PATH}/prd.json" ]]; then
    echo "Error: prd.json not found in ${REPO_PATH}." >&2
    exit 1
  fi

  # Re-copy ralph.sh from the script directory
  RALPH_SRC="${SCRIPT_DIR}/ralph/ralph.sh"
  if [[ ! -f "$RALPH_SRC" ]]; then
    echo "Error: Cannot find ralph/ralph.sh." >&2
    exit 1
  fi
  cp "$RALPH_SRC" "${REPO_PATH}/ralph.sh"
  chmod +x "${REPO_PATH}/ralph.sh"

  # Count incomplete entries and run Phase 2
  INCOMPLETE_COUNT="$(jq '[.[] | select(.completed == false)] | length' "${REPO_PATH}/prd.json")"

  echo "--- Phase 2: Implementation (retry) for $ISSUE_KEY ---" >&2

  if [[ "$INCOMPLETE_COUNT" -eq 0 ]]; then
    echo "All prd.json entries already completed. Skipping Phase 2." >&2
  else
    echo "Running ralph.sh with ${INCOMPLETE_COUNT} iteration(s)..." >&2

    if ! ./ralph.sh --auto "$INCOMPLETE_COUNT"; then
      echo "Error: Phase 2 (ralph.sh) failed for $ISSUE_KEY." >&2
      RESULTS["$ISSUE_KEY"]="FAILED (Phase 2 - ralph.sh)"
    fi
  fi

  if [[ "${RESULTS[$ISSUE_KEY]:-}" != *"FAILED"* ]]; then
    echo "Phase 2 complete." >&2

    # Self-pause for approval before Phase 3
    echo "" >&2
    echo "--- Phase 3: PR creation for $ISSUE_KEY ---" >&2
    kill -STOP $$

    PHASE3_PROMPT="$(cat "${SCRIPT_DIR}/prompts/phase3.md")"
    PHASE3_PROMPT="${PHASE3_PROMPT//CONTEXT_FILE_PATH/$CONTEXT_FILE}"

    cd "$REPO_PATH"
    if ! claude -p --permission-mode bypassPermissions --add-dir="$REPO_PATH" "$PHASE3_PROMPT"; then
      echo "Error: Phase 3 failed for $ISSUE_KEY." >&2
      RESULTS["$ISSUE_KEY"]="FAILED (Phase 3)"
    else
      RESULTS["$ISSUE_KEY"]="SUCCESS"
      echo "Issue $ISSUE_KEY completed successfully." >&2
    fi
  fi

  # Summary for retry
  rm -f "$CONTEXT_FILE"
  echo "" >&2
  echo "================================================================" >&2
  echo "=== unshift retry run complete ===" >&2
  echo "================================================================" >&2
  echo "" >&2
  echo "  $ISSUE_KEY: ${RESULTS[$ISSUE_KEY]:-UNKNOWN}" >&2

  if [[ "${RESULTS[$ISSUE_KEY]:-}" != "SUCCESS" ]]; then
    exit 1
  fi
  exit 0
fi

# ---------------------------------------------------------------------------
# Phase 0 - Pre-flight checks and Jira discovery
# ---------------------------------------------------------------------------
echo "=== Phase 0: Pre-flight checks and Jira discovery ===" >&2

# Pre-flight: verify required tools
MISSING_TOOLS=()
for tool in git gh glab jq curl; do
  if ! command -v "$tool" &>/dev/null; then
    MISSING_TOOLS+=("$tool")
  fi
done

if [[ ${#MISSING_TOOLS[@]} -gt 0 ]]; then
  echo "Error: Missing required tools: ${MISSING_TOOLS[*]}" >&2
  echo "Install them before running unshift.sh." >&2
  exit 1
fi

if [[ -n "$SINGLE_ISSUE" ]]; then
  # Single-issue mode: skip discovery
  ISSUE_KEYS=("$SINGLE_ISSUE")
  echo "Processing single issue: $SINGLE_ISSUE" >&2
else
  # Query Jira for all llm-candidate issues via REST API
  ISSUE_KEYS=()
  if [[ "$JIRA_API_VERSION" == "2" ]]; then
    JIRA_SEARCH_URL="${JIRA_BASE_URL}/rest/api/2/search?jql=labels%3Dllm-candidate&fields=key,summary,issuetype,status"
  else
    JIRA_SEARCH_URL="${JIRA_BASE_URL}/rest/api/3/search/jql?jql=labels%3Dllm-candidate&fields=key,summary,issuetype,status"
  fi
  while IFS= read -r key; do
    [[ -n "$key" ]] && ISSUE_KEYS+=("$key")
  done < <(curl -s "${CURL_AUTH[@]}" -H "Content-Type: application/json" \
    "$JIRA_SEARCH_URL" 2>/dev/null \
    | jq -r '.issues[].key' || true)

  if [[ ${#ISSUE_KEYS[@]} -eq 0 ]]; then
    echo "No llm-candidate issues found." >&2
    exit 0
  fi

  echo "Found ${#ISSUE_KEYS[@]} issue(s): ${ISSUE_KEYS[*]}" >&2

  # Discover-only mode: print issue keys to stdout and exit
  if [[ "$DISCOVER_ONLY" == true ]]; then
    for key in "${ISSUE_KEYS[@]}"; do
      echo "$key"
    done
    exit 0
  fi
fi

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
  # Phase 1 - Repo setup, branch creation, planning
  # -----------------------------------------------------------------------
  echo "" >&2
  echo "--- Phase 1: Planning for $ISSUE_KEY ---" >&2

  PHASE1_PROMPT="$(cat "${SCRIPT_DIR}/prompts/phase1.md")"
  PHASE1_PROMPT="${PHASE1_PROMPT//CONTEXT_FILE_PATH/$CONTEXT_FILE}"
  PHASE1_PROMPT="${PHASE1_PROMPT//ISSUE_KEY_VALUE/$ISSUE_KEY}"

  # Inject repos.json contents into the prompt
  REPO_MAPPING_JSON="$(cat "${SCRIPT_DIR}/repos.json")"
  PHASE1_PROMPT="${PHASE1_PROMPT//REPO_MAPPING_JSON/$REPO_MAPPING_JSON}"

  if ! claude -p --permission-mode bypassPermissions "$PHASE1_PROMPT"; then
    echo "Error: Phase 1 failed for $ISSUE_KEY. Skipping to next issue." >&2
    RESULTS["$ISSUE_KEY"]="FAILED (Phase 1)"
    continue
  fi

  if [[ ! -f "$CONTEXT_FILE" ]]; then
    echo "Error: Phase 1 did not produce context file for $ISSUE_KEY. Skipping." >&2
    RESULTS["$ISSUE_KEY"]="FAILED (Phase 1 - no context file)"
    continue
  fi

  REPO_PATH="$(jq -r '.repo_path' "$CONTEXT_FILE")"
  BRANCH_NAME="$(jq -r '.branch_name' "$CONTEXT_FILE")"

  if [[ -z "$REPO_PATH" || "$REPO_PATH" == "null" ]]; then
    echo "Error: repo_path missing from context file for $ISSUE_KEY. Skipping." >&2
    RESULTS["$ISSUE_KEY"]="FAILED (Phase 1 - no repo_path)"
    continue
  fi

  echo "Phase 1 complete. Repo: $REPO_PATH, Branch: $BRANCH_NAME" >&2

  # -----------------------------------------------------------------------
  # Phase 2 - Implementation via ralph.sh
  # -----------------------------------------------------------------------
  echo "" >&2
  echo "--- Phase 2: Implementation for $ISSUE_KEY ---" >&2

  RALPH_SRC="${SCRIPT_DIR}/ralph/ralph.sh"

  if [[ ! -f "$RALPH_SRC" ]]; then
    echo "Error: Cannot find ralph/ralph.sh. Skipping $ISSUE_KEY." >&2
    RESULTS["$ISSUE_KEY"]="FAILED (Phase 2 - ralph.sh not found)"
    continue
  fi

  # Copy ralph.sh to the repository where the changes
  # will take place.
  cp "$RALPH_SRC" "${REPO_PATH}/ralph.sh"
  chmod +x "${REPO_PATH}/ralph.sh"

  if [[ ! -f "${REPO_PATH}/prd.json" ]]; then
    echo "Error: prd.json not found in ${REPO_PATH}. Skipping $ISSUE_KEY." >&2
    RESULTS["$ISSUE_KEY"]="FAILED (Phase 2 - no prd.json)"
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
      RESULTS["$ISSUE_KEY"]="FAILED (Phase 2 - ralph.sh)"
      continue
    fi
  fi

  echo "Phase 2 complete." >&2

  # -----------------------------------------------------------------------
  # Phase 3 - Verify, commit, push, PR, Jira update, cleanup
  # -----------------------------------------------------------------------
  echo "" >&2
  echo "--- Phase 3: PR creation for $ISSUE_KEY ---" >&2

  # Self-pause before Phase 3 execution so the dashboard can gate on approval.
  # The dashboard will send SIGCONT to resume once the user approves.
  kill -STOP $$

  PHASE3_PROMPT="$(cat "${SCRIPT_DIR}/prompts/phase3.md")"
  PHASE3_PROMPT="${PHASE3_PROMPT//CONTEXT_FILE_PATH/$CONTEXT_FILE}"

  cd "$REPO_PATH"
  if ! claude -p --permission-mode bypassPermissions --add-dir="$REPO_PATH" "$PHASE3_PROMPT"; then
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
