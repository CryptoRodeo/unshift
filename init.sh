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
SKILL_DIR="${HOME}/.claude/skills/unshift"

RALPH_DIR="${SKILL_DIR}/ralph"
PROMPTS_DIR="${SKILL_DIR}/prompts"

echo "Installing /unshift skill..."

# Install the /unshift skill for Claude Code
mkdir -p "${SKILL_DIR}"
curl -fsSL -o "${SKILL_DIR}/SKILL.md" "${UNSHIFT_REPO}/skills/unshift/SKILL.md"
echo "Skill installed to ${SKILL_DIR}/SKILL.md"

# Install unshift.sh orchestrator
curl -fsSL -o "${SKILL_DIR}/unshift.sh" "${UNSHIFT_REPO}/unshift.sh"
chmod +x "${SKILL_DIR}/unshift.sh"
echo "Orchestrator installed to ${SKILL_DIR}/unshift.sh"

# Install ralph files
mkdir -p "${RALPH_DIR}"
curl -fsSL -o "${RALPH_DIR}/ralph.sh" "${UNSHIFT_REPO}/ralph/ralph.sh"
chmod +x "${RALPH_DIR}/ralph.sh"
echo "Ralph installed to ${RALPH_DIR}/ralph.sh"

# Install prompt templates
mkdir -p "${PROMPTS_DIR}"
curl -fsSL -o "${PROMPTS_DIR}/phase1.md" "${UNSHIFT_REPO}/prompts/phase1.md"
curl -fsSL -o "${PROMPTS_DIR}/phase3.md" "${UNSHIFT_REPO}/prompts/phase3.md"
echo "Prompt templates installed to ${PROMPTS_DIR}/"

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
echo "Done! Run ~/.claude/skills/unshift/unshift.sh to start, or use /unshift inside Claude Code."
