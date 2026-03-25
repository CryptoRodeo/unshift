#!/usr/bin/env bash
set -euo pipefail

# Configure git user identity from environment variables
if [[ -n "${GIT_USER_NAME:-}" ]]; then
  git config --global user.name "$GIT_USER_NAME"
fi

if [[ -n "${GIT_USER_EMAIL:-}" ]]; then
  git config --global user.email "$GIT_USER_EMAIL"
fi

# Mark workspace directories as safe for git
git config --global --add safe.directory '*'

# Set GOOGLE_APPLICATION_CREDENTIALS if the ADC file is mounted
if [[ -f "$HOME/.config/gcloud/application_default_credentials.json" ]]; then
  export GOOGLE_APPLICATION_CREDENTIALS="$HOME/.config/gcloud/application_default_credentials.json"
fi

exec "$@"
