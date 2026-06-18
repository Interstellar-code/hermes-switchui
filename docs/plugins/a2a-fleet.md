---
title: A2A Fleet
description: Deploy and manage repo-scoped AI executor peers that Hermes can delegate tasks to over the Agent-to-Agent protocol.
---

# A2A Fleet

A2A Fleet is a Hermes Agent plugin that ships as part of the Hermes Switch UI package. The gateway provides the backend; Switch UI surfaces it through the A2A Fleet page. The plugin lets your Hermes agent act as an orchestrator over a set of executor peers — real CLI agents (Claude Code, OpenCode, Codex, or Google Antigravity) each pinned to a specific repository — and delegates tasks to them over the Agent-to-Agent (A2A) protocol.

The practical effect: you can ask your Hermes agent to make changes in a repo, and it dispatches the work to an executor running inside that repo rather than attempting it itself.

> [SCREENSHOT: A2A Fleet page showing a list of peer entries with their status, repo path, and mode labels]

## How it works

Each executor peer is a small HTTP server that the plugin drops into a target repository's `.hermes/` directory. When Hermes sends a task to a peer, the peer spawns the corresponding CLI agent in that repo, forwards the message, and returns the reply. The session persists: the same `context_id` always resumes the same CLI session, so context accumulates across turns exactly as it would in a normal conversation.

The plugin has two sides:

- **Inbound server** — Hermes itself becomes a discoverable A2A peer. Other agents can send messages to it, and those messages are dispatched into Hermes' own conversation loop.
- **Outbound tool (`fleet_send`)** — Hermes gains a tool to call any named peer by repo path and get a reply back, with optional multi-turn threading via a `context_id`.

## The four executor modes

| Mode | CLI | Default port |
|---|---|---|
| `claude_code` | `claude` | 9300 |
| `opencode` | `opencode` | 9310 |
| `codex` | `codex` | 9320 |
| `agy` | `agy` | 9330 |

Each mode occupies its own port band (ten ports wide). When you deploy a receiver into a repo, the plugin picks the first free port in that band, or reuses the existing port if the repo already has a receiver — making re-deploys idempotent.

The CLI binary must be on `PATH` and authenticated before you deploy. A receiver will report healthy even if the CLI is missing or unauthed, but every task turn will error. Smoke-test a new peer with a simple task before relying on it.

Google Antigravity (`agy`) requires a one-time interactive sign-in to macOS Keychain and has no `--model` flag.

## Handshake

Before any real task, Hermes sends a single handshake message to a new peer. The peer responds with its role, its working directory, its active harness inventory (skills, MCP servers, CLAUDE.md), and whether it is ready. Only after a successful handshake does Hermes begin delegating work.

## Session continuity

The `context_id` is the thread identifier. Sending the same `context_id` in subsequent turns resumes the same CLI session — context accumulates. Sending a fresh `context_id` starts a new independent thread. If the underlying CLI session is lost (e.g. process restart), the receiver re-mints a new session id automatically.

## Security

Receivers bind to loopback only by default. A random bearer token is auto-provisioned at deploy time and injected into the child process — the peer rejects requests without it. The receiver's working directory is pinned to the canonical repo path given at deploy time; inbound messages cannot redirect it.

## What you see in Switch UI

> [SCREENSHOT: A2A Fleet page detail showing peer status, last-turn excerpt, and context_id threading]

The A2A Fleet page lists every known peer across all profiles. The dashboard reads `fleet.yaml` from the home profile and from every `profiles/*/fleet.yaml` beneath it, deduped by repo path. One malformed file does not blank the feed — parsing is lenient.

For each peer you can see:

- The repo path it is bound to.
- The executor mode (e.g. `claude_code`, `opencode`).
- The peer's current health status.
- A conversation feed showing recent Hermes ↔ executor exchanges, grouped by `context_id`.

The conversation feed is read-only in the UI. You interact with the fleet by talking to Hermes in the normal chat; Hermes decides when to call `fleet_send` and surfaces the results back to you.

## Dashboard endpoints

The plugin exposes three read-only REST endpoints for the Switch UI fleet dashboard:

| Endpoint | What it returns |
|---|---|
| `GET /api/plugins/a2a_fleet/conversations` | All recorded Hermes ↔ executor conversation threads |
| `GET /api/plugins/a2a_fleet/conversations/{id}` | A single conversation thread by `context_id` |
| `GET /api/plugins/a2a_fleet/peers` | All known peers with their mode, port, repo path, and health status |

These endpoints are read-only. Sending tasks always goes through Hermes and the `fleet_send` tool, not through the dashboard API directly.

## Enabling the plugin

The inbound A2A server requires `fastapi` and `uvicorn`. Install the optional dependency group:

```bash
pip install "hermes-agent[web]"
```

If those packages are missing, the plugin still loads and `fleet_send` (outbound) still works, but the inbound server stays idle.

To allow inbound messages to be dispatched into Hermes' own conversation loop (not just echo mode), also set this in the active profile config:

```yaml
platforms:
  a2a_fleet:
    enabled: true
```

The A2A Fleet page in Switch UI is gated on the gateway reporting the `jobs` capability at startup. If the page is missing from the sidebar, confirm the gateway version supports it and that the plugin is enabled.

## Related

- [MCP](../settings/mcp.md) — a different extension mechanism for connecting external tool servers
- [Workflows](../main/workflows.md) — the workflow engine for scheduling and automating agent tasks
- [Jobs](../main/jobs.md) — view and manage background jobs the agent is running
- [Tasks](../main/tasks.md) — the task board for work items managed by the agent
