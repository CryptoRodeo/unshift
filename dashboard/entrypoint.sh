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

# Configure custom CA certificates for self-hosted git instances
if [[ -f /app/custom-ca.crt ]]; then
  export GIT_SSL_CAINFO=/app/custom-ca.crt
  export NODE_EXTRA_CA_CERTS=/app/custom-ca.crt
fi

# Configure git credential helpers for token-based HTTPS auth
if [[ -n "${GH_TOKEN:-}" ]]; then
  git config --global url."https://${GH_TOKEN}@github.com/".insteadOf "git@github.com:"
  git config --global url."https://${GH_TOKEN}@github.com/".insteadOf "https://github.com/"
fi

if [[ -n "${GITLAB_TOKEN:-}" ]]; then
  git config --global url."https://oauth2:${GITLAB_TOKEN}@${GITLAB_HOST:-gitlab.com}/".insteadOf "https://${GITLAB_HOST:-gitlab.com}/"
fi

# Set GOOGLE_APPLICATION_CREDENTIALS if the ADC file is mounted
if [[ -f "$HOME/.config/gcloud/application_default_credentials.json" ]]; then
  export GOOGLE_APPLICATION_CREDENTIALS="$HOME/.config/gcloud/application_default_credentials.json"
fi

exec "$@"
