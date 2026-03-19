#!/usr/bin/env bash
# Re-run init.sh at container startup so that runtime env vars
# (JIRA_API_TOKEN, JIRA_USER_EMAIL, JIRA_BASE_URL) are available
# for authenticating acli with Jira.
bash ./init.sh

exec "$@"
