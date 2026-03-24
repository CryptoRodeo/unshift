#!/usr/bin/env bash
set -euo pipefail

# If we are NOT running from a file, write ourselves to a temp file and re-run
if [[ "${BASH_SOURCE[0]-}" == "bash" || ! -f "${BASH_SOURCE[0]-}" ]]; then
  TMP="$(mktemp /tmp/unshift_init.XXXXXX.sh)"
  cat >"$TMP"
  chmod +x "$TMP"
  trap 'rm -f "$TMP"' EXIT
  exec bash "$TMP"
fi

# Install or update Claude Code settings.json with CLI permissions
SETTINGS_FILE="${HOME}/.claude/settings.json"
REQUIRED_PERMS=("Bash(gh *)" "Bash(glab *)" "Bash(acli *)")

echo "Configuring Claude Code settings..."

if [[ -f "${SETTINGS_FILE}" ]]; then
  # Merge permissions into existing settings
  if command -v jq &>/dev/null; then
    # Add required permissions
    for perm in "${REQUIRED_PERMS[@]}"; do
      if ! jq -e --arg p "$perm" '.permissions.allow // [] | index($p) != null' "${SETTINGS_FILE}" &>/dev/null; then
        tmp="$(jq --arg p "$perm" '.permissions.allow = ((.permissions.allow // []) + [$p] | unique)' "${SETTINGS_FILE}")"
        echo "$tmp" >"${SETTINGS_FILE}"
      fi
    done
    echo "Claude Code settings updated at ${SETTINGS_FILE}"
  else
    echo "jq not found -- skipping settings.json merge. Please add these permissions manually:"
    printf '  %s\n' "${REQUIRED_PERMS[@]}"
  fi
else
  mkdir -p "${HOME}/.claude"
  cat >"${SETTINGS_FILE}" <<'SETTINGS'
{
  "permissions": {
    "allow": [
      "Bash(gh *)",
      "Bash(glab *)",
      "Bash(acli *)"
    ]
  }
}
SETTINGS
  echo "Claude Code settings created at ${SETTINGS_FILE}"
fi

# Authenticate acli with Jira if credentials are available
if command -v acli &>/dev/null; then
  if [[ -n "${JIRA_BASE_URL:-}" && -n "${JIRA_API_TOKEN:-}" ]]; then
    JIRA_SITE="$(echo "${JIRA_BASE_URL}" | sed 's|https\?://||')"
    echo "Authenticating acli with Jira (${JIRA_SITE})..."
    if [[ -n "${JIRA_USER_EMAIL:-}" ]]; then
      # Basic auth (Jira Cloud)
      echo "${JIRA_API_TOKEN}" | acli jira auth login \
        --site "${JIRA_SITE}" \
        --email "${JIRA_USER_EMAIL}" \
        --token -
    else
      # Bearer auth (Data Center PATs)
      echo "${JIRA_API_TOKEN}" | acli jira auth login \
        --site "${JIRA_SITE}" \
        --token -
    fi
    echo "acli authenticated with Jira."
  else
    echo "Warning: JIRA_BASE_URL or JIRA_API_TOKEN is not set. Skipping acli auth."
  fi
else
  echo "Warning: acli not found. Install it to enable Jira CLI integration."
fi

echo ""
echo "Done! Run ./cli/unshift.sh from the unshift repo directory to start."
