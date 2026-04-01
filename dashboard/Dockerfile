# Stage 1: Build client and server
FROM node:22-bookworm AS build

RUN apt-get update && apt-get install -y build-essential python3 && rm -rf /var/lib/apt/lists/*

WORKDIR /app/dashboard

# Copy workspace package files for dependency install
COPY dashboard/package.json dashboard/package-lock.json ./
COPY dashboard/client/package.json ./client/
COPY dashboard/server/package.json ./server/

RUN npm ci

# Copy source code
COPY dashboard/shared/ ./shared/
COPY dashboard/client/ ./client/
COPY dashboard/server/ ./server/
COPY dashboard/tsconfig.json ./

# Build client and server
RUN npm run build

# Stage 2: Production runtime
FROM node:22-bookworm-slim

# Install runtime dependencies: git, bash, curl
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    bash \
    curl \
    jq \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install gh CLI
RUN curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg -o /usr/share/keyrings/githubcli-archive-keyring.gpg \
    && chmod go+r /usr/share/keyrings/githubcli-archive-keyring.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
    > /etc/apt/sources.list.d/github-cli.list \
    && apt-get update && apt-get install -y gh \
    && rm -rf /var/lib/apt/lists/*

# Install glab CLI (GitLab)
RUN GLAB_VERSION=$(curl -sL "https://gitlab.com/api/v4/projects/34675721/releases/permalink/latest" | grep -oP '"tag_name":\s*"\Kv[^"]+') \
    && ARCH=$(dpkg --print-architecture) \
    && if [ "$ARCH" = "amd64" ]; then GLAB_ARCH="amd64"; else GLAB_ARCH="arm64"; fi \
    && curl -fsSL "https://gitlab.com/gitlab-org/cli/-/releases/${GLAB_VERSION}/downloads/glab_${GLAB_VERSION#v}_linux_${GLAB_ARCH}.deb" -o /tmp/glab.deb \
    && dpkg -i /tmp/glab.deb \
    && rm /tmp/glab.deb

# Re-use the existing node user as the non-root runtime user, with a
# configurable UID/GID so files written to bind-mounted volumes keep the
# same ownership as the host user.
ARG HOST_UID=1000
ARG HOST_GID=1000
RUN groupmod -g "$HOST_GID" node \
    && usermod -u "$HOST_UID" -g "$HOST_GID" -l unshift -d /home/unshift -m node \
    && groupmod -n unshift node

WORKDIR /app

# Copy built artifacts from build stage (owned by unshift user)
COPY --from=build --chown=unshift:unshift /app/dashboard/server/dist ./dashboard/server/dist
COPY --from=build --chown=unshift:unshift /app/dashboard/client/dist ./dashboard/client/dist
COPY --from=build --chown=unshift:unshift /app/dashboard/node_modules ./dashboard/node_modules
COPY --from=build --chown=unshift:unshift /app/dashboard/shared ./dashboard/shared
COPY --from=build --chown=unshift:unshift /app/dashboard/package.json ./dashboard/package.json
COPY --from=build --chown=unshift:unshift /app/dashboard/server/package.json ./dashboard/server/package.json
COPY --from=build --chown=unshift:unshift /app/dashboard/client/package.json ./dashboard/client/package.json

# Copy CLI scripts (used by server to spawn automation workflows)
COPY --chown=unshift:unshift cli/ ./cli/

# Copy projects.yaml (used by CLI for project-to-repo mapping)
COPY --chown=unshift:unshift projects.yaml ./projects.yaml

# Pre-create data directory so the named volume inherits correct ownership
RUN mkdir -p /app/dashboard/server/data && chown unshift:unshift /app/dashboard/server/data

# Copy and set up entrypoint script
COPY --chown=unshift:unshift dashboard/entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

# Expose dashboard port
EXPOSE 3000

ENV NODE_ENV=production

WORKDIR /app/dashboard

USER unshift

ENTRYPOINT ["/app/entrypoint.sh"]
CMD ["npm", "start"]
