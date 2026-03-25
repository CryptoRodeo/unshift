# workspace/

This directory is where unshift clones and operates on repositories during runs.

When using Docker, the compose file bind-mounts this directory into the container
at `/app/workspace/`. Repos cloned during runs persist here across container restarts
and are accessible from the host.

This directory is git-ignored (except for this README). Its contents are created at runtime.
