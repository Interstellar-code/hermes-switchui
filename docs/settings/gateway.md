---
title: Gateway
description: Profile multiplexing and the OpenAI-compatible API server the workspace talks to.
---

# Gateway

> **Settings → Agent → Gateway** controls the gateway's own topology — whether one process serves several profiles, and the host/port its HTTP API listens on.

> [SCREENSHOT: Settings → Agent → Gateway section, Profile multiplexing and API server cards]

## Profile multiplexing

`gateway.multiplex_profiles` (off by default) is the flag the entire [Profiles](./profiles.md) feature depends on when you want more than one profile reachable from a single running gateway.

- **Off** (default) — each profile needs its own gateway process. Only the profile that process was launched with is ever consulted; every other profile's settings, including `terminal.cwd`, simply don't apply to that process.
- **On** — one gateway process serves multiple profiles at once, each addressed by a URL prefix (`/p/<profile>/`).

This setting is read once when the gateway process starts. Toggling it here and saving does not change the running gateway's behavior — it changes what the *next* restart will do. The section shows a **live topology** row, read from the running gateway independently of this setting, so a mismatch between "what's saved" and "what's actually running" is visible instead of silently wrong.

**The multiplexing trap that isn't obvious:** turning this on doesn't make every profile's own settings suddenly apply. `TERMINAL_CWD` — and by extension, where each profile's agent actually runs — is a process-wide environment value the gateway sets once at startup, from whichever profile *launched* it. Every other profile served under that multiplexed gateway has its own `terminal.cwd` silently ignored; commands run wherever the launch profile says, not wherever the profile you're actually talking to says. The same trap applies to credentials: a per-profile `key_env` resolves only against that profile's own `.env` file under multiplexing, never against the shell environment the gateway process was started with. See [Working directory](./working-directory.md) and [API keys](./providers/api-keys.md) for what each of those means in practice.

## API server

`platforms.api_server.host` and `platforms.api_server.port` control the interface and port the gateway's HTTP API listens on — this is the same API Switch UI talks to at `HERMES_API_URL` (default `http://127.0.0.1:8642`).

- **Host** — `127.0.0.1` (default) accepts local connections only; `0.0.0.0` accepts connections from any interface. A typo here (a stray protocol prefix, an embedded port, whitespace) usually fails silently as a connection refused/timeout rather than a clear error, so the section validates the format before you save.
- **Port** — must be `1`–`65535`. Anything under `1024` is a privileged port that typically requires root to bind, and the section flags that rather than letting the save fail with no explanation later.

Changing either value here doesn't move the running gateway — like multiplexing, this is read once at process start. If you change it, update `HERMES_API_URL` in the workspace's own `.env` to match, or the workspace will keep trying to reach the old address.

## Common issues

**Toggled multiplexing but nothing changed.** Expected — restart the gateway. The live-topology row tells you what the running process is actually doing right now.

**A profile's terminal settings don't apply even though multiplexing is on.** Only the launch profile's `terminal.cwd`/`terminal.backend` are honored under multiplexing. See [Working directory](./working-directory.md#multiplexing-ignores-per-profile-settings-entirely).

**Changed the API port and the workspace can't reach the gateway anymore.** Update `HERMES_API_URL` in the workspace's `.env` to the new host/port and restart the workspace as well as the gateway.

## Related

- [Profiles](./profiles.md) — the feature multiplexing exists to serve
- [Working directory](./working-directory.md) — what multiplexing does to per-profile `terminal.cwd`
- [API keys](./providers/api-keys.md) — what multiplexing does to per-profile credential resolution
- [Agent won't connect](../troubleshooting/agent-connect.md) — host/port/token mismatches
