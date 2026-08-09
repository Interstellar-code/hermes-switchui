---
title: Execution
description: Terminal backend and code-execution settings — where and how the agent runs shell commands and scripts.
---

# Execution

> **Settings → Agent → Execution** controls the sandbox the agent's shell commands and `execute_code` calls run inside — everything except *which directory* they start in, which lives on its own page because it deserves one.

> [SCREENSHOT: Settings → Agent → Execution section, Backend and Code execution cards]

## Working directory (read-only here)

This section shows the resolved working directory and its source, but you can't edit it here — the composer's working-directory chip and the onboarding Workspace step already own that write, with a preview step this section doesn't duplicate. Building a second editor here would drift from that resolver's actual logic over time. See [Working directory](./working-directory.md) for the full mechanism, including the warnings this card surfaces (home-directory fallback, missing `terminal:` block, multiplexing).

## Terminal backend

Only **Local** and **Docker** are pickable here. The gateway also supports `singularity`, `modal`, `daytona`, and `ssh`, but this app can't validate or usefully describe any of those, and a picker that mis-describes a backend it can't test is worse than no picker — those stay in the raw config editor.

- **Local** (default) — commands run as the gateway's own OS process, with full access to whatever `terminal.cwd` resolves to (see [Working directory](./working-directory.md)).
- **Docker** — commands run inside a container (`nikolaik/python-nodejs:python3.11-nodejs20` by default). With host-cwd mounting off (the default), the container's filesystem is isolated from your host entirely — no project files, no user code, unless you add explicit volumes.

**Command timeout** caps how long a single terminal command may run (default 180 seconds, up to an hour).

**Persistent shell** is a real toggle only on non-local backends. On `local`, it's a no-op: the config key it appears to control (`terminal.persistent_shell`) bridges to an environment variable that is read only as the *default for SSH connections*. The local backend reads a completely different variable that no config key sets, so toggling this switch while the backend is local changes nothing observable. `cd` still "sticks" across commands on the local backend — that's a separate mechanism (the agent's last known directory is tracked and reused), not the persistent-shell setting.

## Code execution

`code_execution.mode` has exactly two values:

- **Project** (default) — `execute_code` runs in the session's resolved working directory (the same one described in [Working directory](./working-directory.md)), using the active virtualenv/conda environment when one is usable. Relative paths and project dependencies resolve the way you'd expect from a normal script run in that folder.
- **Strict** — scripts run isolated in a fresh temp directory with the gateway's own Python interpreter. Nothing about the project is visible — no relative paths, no project virtualenv — which buys reproducibility at the cost of losing project context. It is not a security sandbox: tool whitelisting and environment scrubbing apply identically in both modes.

If the working-directory card above shows the home-directory fallback and this is set to Project, `execute_code` output lands in your home folder along with everything else the terminal tools write.

## Advanced Docker settings

Visible only when the backend is Docker. These map directly to gateway config keys and are not independently validated beyond basic type checks:

| Setting | Config key | Default |
|---|---|---|
| Docker image | `terminal.docker_image` | `nikolaik/python-nodejs:python3.11-nodejs20` |
| Mount host cwd to `/workspace` | `terminal.docker_mount_cwd_to_workspace` | off |
| Docker volumes | `terminal.docker_volumes` | none |
| Network access | `terminal.docker_network` | on |
| CPU limit | `terminal.container_cpu` | 1 core |
| Memory limit | `terminal.container_memory` | 5120 MB |
| Disk limit | `terminal.container_disk` | 51200 MB |

**Mount host cwd to `/workspace`** is off by default for a reason stated in the gateway's own config: passing host directories into a sandbox weakens the isolation the sandbox exists to provide. Turning it on means the agent's filesystem view *is* your host directory (bind-mounted at `/workspace`), so anything it writes lands directly on your machine — the isolation is gone by design at that point, not partially weakened.

Everything else about the terminal block — `modal_mode`, `singularity_image`, `docker_env`, `docker_extra_args`, `home_mode`, and the non-local backends entirely — is raw-YAML-editor territory; this section deliberately doesn't surface a control it can't validate.

## Common issues

**Toggling persistent shell did nothing.** Expected on the local backend — see above. It only takes effect on SSH.

**Docker backend has no access to my files.** Expected with the default settings — host-cwd mounting is off, so the container filesystem is isolated. Either add an explicit volume, or turn on host-cwd mounting and accept the isolation trade-off.

**Switched to Docker and now the agent can't find anything.** A `terminal.cwd` that was set for the local backend (an absolute host path) gets silently discarded and replaced with `/root` when the backend is a container type — it doesn't carry over. See [Working directory](./working-directory.md).

## Related

- [Working directory](./working-directory.md) — the resolver this section reads from
- [Gateway](./gateway.md) — profile multiplexing and the API server
- [Safety](./safety.md) — approvals and the pre-execution scanner that gate what commands actually run
