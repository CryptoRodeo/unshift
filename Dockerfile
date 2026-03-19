# Pinned tool versions - update these when upgrading
# GLAB_VERSION=1.89.0  CLAUDE_CODE_VERSION=2.1.76

FROM node:20-bookworm-slim

# Install system packages
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    jq \
    curl \
    ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Create a non-root user for security
RUN useradd -m -s /bin/bash unshift

# Install GitHub CLI (gh)
RUN curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
    | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg \
  && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
    > /etc/apt/sources.list.d/github-cli.list \
  && apt-get update && apt-get install -y --no-install-recommends gh \
  && rm -rf /var/lib/apt/lists/*

# Install GitLab CLI (glab)
RUN GLAB_VERSION=1.89.0 \
  && ARCH=$(dpkg --print-architecture) \
  && curl -fsSL "https://gitlab.com/gitlab-org/cli/-/releases/v${GLAB_VERSION}/downloads/glab_${GLAB_VERSION}_linux_${ARCH}.deb" -o /tmp/glab.deb \
  && dpkg -i /tmp/glab.deb \
  && rm /tmp/glab.deb

# Install Atlassian CLI (acli)
# NOTE: Verify the download URL is current at https://developer.atlassian.com/cloud/acli/guides/install-acli/
RUN ARCH=$(dpkg --print-architecture) \
  && curl -fsSL "https://acli.atlassian.com/linux/latest/acli_linux_${ARCH}/acli" -o /usr/local/bin/acli \
  && chmod +x /usr/local/bin/acli

# Install Claude Code globally
RUN npm install -g @anthropic-ai/claude-code@2.1.76

WORKDIR /opt/unshift

# Install dashboard dependencies (before project scripts for better layer caching)
COPY dashboard/package.json dashboard/package-lock.json* dashboard/
COPY dashboard/client/package.json dashboard/client/
COPY dashboard/server/package.json dashboard/server/
RUN cd dashboard && npm install
COPY dashboard/ dashboard/

# Copy project files into the image
COPY init.sh unshift.sh repos.json ./
COPY prompts/ prompts/
COPY ralph/ ralph/

# Fix ownership so the non-root user can write to node_modules (Vite cache)
RUN chown -R unshift:unshift /opt/unshift

# Switch to non-root user
USER unshift

# Allow git to work with bind-mounted repos owned by the host user
RUN git config --global --add safe.directory '*'

# Pre-configure Claude Code settings (base permissions only; acli auth is configured at runtime)
RUN bash ./init.sh

# Copy entrypoint script
COPY entrypoint.sh ./
USER root
RUN chmod +x entrypoint.sh
USER unshift

EXPOSE 3000 5173

# Re-run init.sh at startup so acli auth picks up runtime env vars, then start the dashboard
ENTRYPOINT ["./entrypoint.sh"]
CMD ["npm", "run", "dev", "--prefix", "dashboard"]
