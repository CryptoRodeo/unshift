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

UNSHIFT_REPO="https://raw.githubusercontent.com/CryptoRodeo/unshift/refs/heads/main"
SKILL_DIR="${HOME}/.claude/skills"

echo "Installing /unshift skill..."

# Install the /unshift skill for Claude Code
mkdir -p "${SKILL_DIR}"
curl -fsSL -o "${SKILL_DIR}/unshift.md" "${UNSHIFT_REPO}/skills/unshift.md"
echo "Skill installed to ${SKILL_DIR}/unshift.md"

# Install or update Claude Code settings.json with CLI permissions
SETTINGS_FILE="${HOME}/.claude/settings.json"
REQUIRED_PERMS=("Bash(jira *)" "Bash(gh *)" "Bash(glab *)")

echo "Configuring Claude Code settings..."

if [[ -f "${SETTINGS_FILE}" ]]; then
  # Merge permissions into existing settings
  if command -v jq &>/dev/null; then
    for perm in "${REQUIRED_PERMS[@]}"; do
      if ! jq -e --arg p "$perm" '.permissions.allow // [] | index($p) != null' "${SETTINGS_FILE}" &>/dev/null; then
        tmp="$(jq --arg p "$perm" '.permissions.allow = ((.permissions.allow // []) + [$p] | unique)' "${SETTINGS_FILE}")"
        echo "$tmp" > "${SETTINGS_FILE}"
      fi
    done
    echo "Claude Code settings updated at ${SETTINGS_FILE}"
  else
    echo "jq not found -- skipping settings.json merge. Please add these permissions manually:"
    printf '  %s\n' "${REQUIRED_PERMS[@]}"
  fi
else
  mkdir -p "${HOME}/.claude"
  cat > "${SETTINGS_FILE}" <<'SETTINGS'
{
  "permissions": {
    "allow": [
      "Bash(jira *)",
      "Bash(gh *)",
      "Bash(glab *)"
    ]
  }
}
SETTINGS
  echo "Claude Code settings created at ${SETTINGS_FILE}"
fi

echo ""
echo "Done! Open Claude Code in any repo and run /unshift to get started."
echo "Ralph files (ralph.sh, prd.json, progress.txt) will be set up automatically when the skill runs."
