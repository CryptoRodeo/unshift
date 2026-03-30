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

# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------

# Convert projects.yaml to JSON using python3+PyYAML or yq.
repos_to_json() {
  local yaml_file="$1"
  if command -v python3 &>/dev/null && python3 -c "import yaml" 2>/dev/null; then
    python3 -c "import yaml, json, sys; print(json.dumps(yaml.safe_load(open(sys.argv[1]))))" "$yaml_file"
  elif command -v yq &>/dev/null; then
    yq -o=json '.' "$yaml_file"
  else
    echo "Error: Need python3 with PyYAML or yq to parse projects.yaml." >&2
    return 1
  fi
}

# Resolve the repo entry for a given Jira issue key.
# Parses projects.yaml, fetches issue components/labels from Jira, and applies
# disambiguation rules: component → label → fallback.
# Outputs a single JSON object for the matched entry.
resolve_repo() {
  local issue_key="$1"
  local project_key="${issue_key%%-*}"

  # Fetch issue components and labels from Jira
  local issue_url
  if [[ "$JIRA_API_VERSION" == "2" ]]; then
    issue_url="${JIRA_BASE_URL}/rest/api/2/issue/${issue_key}?fields=components,labels"
  else
    issue_url="${JIRA_BASE_URL}/rest/api/3/issue/${issue_key}?fields=components,labels"
  fi

  local issue_json
  issue_json="$(curl -s "${CURL_AUTH[@]}" -H "Content-Type: application/json" "$issue_url")"

  local issue_components issue_labels
  issue_components="$(echo "$issue_json" | jq '[.fields.components[].name] // []')"
  issue_labels="$(echo "$issue_json" | jq '[.fields.labels[]] // []')"

  # Parse projects.yaml to JSON
  local repos_json
  repos_json="$(repos_to_json "${SCRIPT_DIR}/../projects.yaml")" || return 1

  # Find entries whose jira_projects contain the issue's project key
  local matching
  matching="$(echo "$repos_json" | jq --arg pk "$project_key" \
    '[.[] | select(.jira_projects | index($pk))]')"

  local match_count
  match_count="$(echo "$matching" | jq 'length')"

  if [[ "$match_count" -eq 0 ]]; then
    echo "Error: No repo entry found for project key $project_key (issue $issue_key)." >&2
    return 1
  fi

  if [[ "$match_count" -eq 1 ]]; then
    echo "$matching" | jq '.[0]'
    return 0
  fi

  # Disambiguate: match by component
  local by_component
  by_component="$(jq -n --argjson matching "$matching" --argjson components "$issue_components" \
    '[$matching[] | select(.component != null and (.component as $c | $components | index($c) != null))]')"

  if [[ "$(echo "$by_component" | jq 'length')" -eq 1 ]]; then
    echo "$by_component" | jq '.[0]'
    return 0
  fi

  # Disambiguate: match by label
  local by_label
  by_label="$(jq -n --argjson matching "$matching" --argjson labels "$issue_labels" \
    '[$matching[] | select((.labels // []) as $el | [$el[] | select(. as $l | $labels | index($l) != null)] | length > 0)]')"

  if [[ "$(echo "$by_label" | jq 'length')" -eq 1 ]]; then
    echo "$by_label" | jq '.[0]'
    return 0
  fi

  # Fallback: entry with null component and empty labels
  local fallback
  fallback="$(jq -n --argjson matching "$matching" \
    '[$matching[] | select((.component == null) and ((.labels // []) | length == 0))]')"

  if [[ "$(echo "$fallback" | jq 'length')" -eq 1 ]]; then
    echo "$fallback" | jq '.[0]'
    return 0
  fi

  echo "Error: Could not disambiguate repo for $issue_key. ${match_count} entries match project $project_key." >&2
  return 1
}

# Copy ralph.sh into the target repo. Exits on failure.
copy_ralph() {
  local repo_path="$1"
  local ralph_src="${SCRIPT_DIR}/ralph/ralph.sh"
  if [[ ! -f "$ralph_src" ]]; then
    echo "Error: Cannot find ralph/ralph.sh." >&2
    return 1
  fi
  cp "$ralph_src" "${repo_path}/ralph.sh"
  chmod +x "${repo_path}/ralph.sh"
}

# Print a run summary from the RESULTS associative array.
print_summary() {
  local label="$1"
  shift
  local keys=("$@")

  echo "" >&2
  echo "================================================================" >&2
  echo "=== unshift ${label} complete ===" >&2
  echo "================================================================" >&2
  echo "" >&2
  for key in "${keys[@]}"; do
    echo "  $key: ${RESULTS[$key]:-UNKNOWN}" >&2
  done
}

# ---------------------------------------------------------------------------
# Shared function: Phase 2 (ralph.sh) + Phase 3 (PR creation)
# Expects: ISSUE_KEY, REPO_PATH, CONTEXT_FILE, SCRIPT_DIR, RESULTS (assoc array)
# ---------------------------------------------------------------------------
run_phase2_and_phase3() {
  local issue_key="$1"
  local repo_path="$2"
  local context_file="$3"
  local entry_count="$4"

  echo "" >&2
  echo "--- Phase 2: Implementation for $issue_key ---" >&2

  if [[ "$entry_count" -eq 0 ]]; then
    echo "prd.json has no entries to implement. Skipping Phase 2." >&2
  else
    echo "Running ralph.sh with ${entry_count} iteration(s)..." >&2
    cd "$repo_path"
    if ! ./ralph.sh --auto "$entry_count"; then
      echo "Error: Phase 2 (ralph.sh) failed for $issue_key." >&2
      return 2
    fi
  fi

  echo "Phase 2 complete." >&2

  # Phase 3 - Verify, commit, push, PR, Jira update, cleanup
  echo "" >&2
  echo "--- Phase 3: PR creation for $issue_key ---" >&2

  # Self-pause before Phase 3 execution so the dashboard can gate on approval.
  # The dashboard will send SIGCONT to resume once the user approves.
  kill -STOP $$

  PHASE3_PROMPT="$(cat "${SCRIPT_DIR}/prompts/phase3.md")"
  PHASE3_PROMPT="${PHASE3_PROMPT//CONTEXT_FILE_PATH/$context_file}"

  cd "$repo_path"
  if ! claude -p --permission-mode bypassPermissions --add-dir="$repo_path" "$PHASE3_PROMPT"; then
    echo "Error: Phase 3 failed for $issue_key." >&2
    return 3
  fi

  echo "Issue $issue_key completed successfully." >&2
  return 0
}

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
  DEFAULT_BRANCH="$(jq -r '.default_branch // empty' "$CONTEXT_FILE")"

  if [[ -z "$REPO_PATH" || "$REPO_PATH" == "null" ]]; then
    echo "Error: repo_path missing from context file." >&2
    exit 1
  fi

  if [[ -z "$DEFAULT_BRANCH" ]]; then
    echo "Error: default_branch missing from context file." >&2
    exit 1
  fi

  # Ensure we're on the correct branch
  cd "$REPO_PATH"
  git checkout "$BRANCH_NAME"

  # Reset branch to the merge-base with the default branch,
  # undoing all Phase 2 implementation commits from the previous attempt.
  # prd.json and progress.txt are untracked worktree files, so they survive the reset.
  MERGE_BASE="$(git merge-base "$DEFAULT_BRANCH" HEAD)"
  if [[ -z "$MERGE_BASE" ]]; then
    echo "Error: Could not find merge-base between $DEFAULT_BRANCH and $BRANCH_NAME." >&2
    exit 1
  fi
  echo "Resetting branch to merge-base with $DEFAULT_BRANCH: ${MERGE_BASE:0:12}" >&2
  git reset --hard "$MERGE_BASE"

  # Reset prd.json entries to incomplete so Phase 2 re-implements everything
  if [[ -f "${REPO_PATH}/prd.json" ]]; then
    jq '[.[] | .completed = false]' "${REPO_PATH}/prd.json" > "${REPO_PATH}/prd.json.tmp"
    mv "${REPO_PATH}/prd.json.tmp" "${REPO_PATH}/prd.json"
  else
    echo "Error: prd.json not found in ${REPO_PATH}." >&2
    exit 1
  fi

  # Reset progress.txt for a fresh start
  > "${REPO_PATH}/progress.txt"

  # Re-copy ralph.sh from the script directory
  if ! copy_ralph "$REPO_PATH"; then
    exit 1
  fi

  # Count entries and run Phase 2 + Phase 3 via shared function
  ENTRY_COUNT="$(jq 'length' "${REPO_PATH}/prd.json")"
  rc=0
  run_phase2_and_phase3 "$ISSUE_KEY" "$REPO_PATH" "$CONTEXT_FILE" "$ENTRY_COUNT" || rc=$?
  if [[ $rc -eq 0 ]]; then
    RESULTS["$ISSUE_KEY"]="SUCCESS"
  elif [[ $rc -eq 2 ]]; then
    RESULTS["$ISSUE_KEY"]="FAILED (Phase 2 - ralph.sh)"
  else
    RESULTS["$ISSUE_KEY"]="FAILED (Phase 3)"
  fi

  # Summary for retry
  rm -f "$CONTEXT_FILE"
  print_summary "retry run" "$ISSUE_KEY"

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
  # Repo resolution (deterministic, done in bash)
  # -----------------------------------------------------------------------
  echo "" >&2
  echo "--- Resolving repo for $ISSUE_KEY ---" >&2

  MATCHED_REPO="$(resolve_repo "$ISSUE_KEY")" || {
    RESULTS["$ISSUE_KEY"]="FAILED (repo resolution)"
    continue
  }

  echo "Matched repo: $(echo "$MATCHED_REPO" | jq -r '.local_dir')" >&2

  # -----------------------------------------------------------------------
  # Phase 1 - Repo setup, branch creation, planning
  # -----------------------------------------------------------------------
  echo "" >&2
  echo "--- Phase 1: Planning for $ISSUE_KEY ---" >&2

  PHASE1_PROMPT="$(cat "${SCRIPT_DIR}/prompts/phase1.md")"
  PHASE1_PROMPT="${PHASE1_PROMPT//CONTEXT_FILE_PATH/$CONTEXT_FILE}"
  PHASE1_PROMPT="${PHASE1_PROMPT//ISSUE_KEY_VALUE/$ISSUE_KEY}"

  # Inject the resolved repo entry as JSON
  PHASE1_PROMPT="${PHASE1_PROMPT//RESOLVED_REPO_JSON/$MATCHED_REPO}"

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
  # Phase 2 + Phase 3 - Implementation and PR creation
  # -----------------------------------------------------------------------
  if ! copy_ralph "$REPO_PATH"; then
    RESULTS["$ISSUE_KEY"]="FAILED (Phase 2 - ralph.sh not found)"
    continue
  fi

  if [[ ! -f "${REPO_PATH}/prd.json" ]]; then
    echo "Error: prd.json not found in ${REPO_PATH}. Skipping $ISSUE_KEY." >&2
    RESULTS["$ISSUE_KEY"]="FAILED (Phase 2 - no prd.json)"
    continue
  fi

  INCOMPLETE_COUNT="$(jq '[.[] | select(.completed == false)] | length' "${REPO_PATH}/prd.json")"

  rc=0
  run_phase2_and_phase3 "$ISSUE_KEY" "$REPO_PATH" "$CONTEXT_FILE" "$INCOMPLETE_COUNT" || rc=$?
  if [[ $rc -eq 0 ]]; then
    RESULTS["$ISSUE_KEY"]="SUCCESS"
  elif [[ $rc -eq 2 ]]; then
    RESULTS["$ISSUE_KEY"]="FAILED (Phase 2 - ralph.sh)"
    continue
  else
    RESULTS["$ISSUE_KEY"]="FAILED (Phase 3)"
    continue
  fi

done

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
rm -f "$CONTEXT_FILE"

print_summary "run" "${ISSUE_KEYS[@]}"

# Exit with error if any issue failed
for key in "${ISSUE_KEYS[@]}"; do
  if [[ "${RESULTS[$key]:-}" != "SUCCESS" ]]; then
    exit 1
  fi
done
