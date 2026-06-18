---
title: Hermes Switch UI plugin
description: Gateway-side plugin that gives the Hermes Agent backend awareness of the Switch UI frontend and enables bidirectional config sync between the two.
---

# Hermes Switch UI plugin

The Hermes Switch UI plugin (`hermes-switch-ui`, v0.1.0) is a Hermes Agent gateway plugin that makes the backend aware of the Switch UI frontend. It is part of the Hermes Switch UI package and is always present when the bundled gateway is running. Its role is narrow: nudge the agent on the first call of each session so it knows a UI is connected, and provide a small set of endpoints that Switch UI uses to register itself, push settings, and report heartbeats.

> [SCREENSHOT: Switch UI connection status indicator in the settings panel showing "Connected" with the plugin version and compatible range]

## What it does

The plugin has two sides:

**Agent awareness** — a `pre_llm_call` hook fires on the first LLM call of each session and injects a brief nudge informing the agent that it is talking to a Switch UI client. This happens once per session and does not repeat on subsequent turns.

**Config sync** — Switch UI registers itself with the gateway on startup and sends settings changes through the plugin's REST routes. The gateway stores connection state at `~/.hermes/switchui/state.json`.

## The two agent tools

| Tool | What it does |
|---|---|
| `switchui_info` | Returns metadata about the connected Switch UI instance: version, capabilities, and compatible range |
| `switchui_status` | Returns the current connection state: whether a Switch UI client is registered and its last heartbeat time |

## REST API

The plugin exposes **5 REST routes** at `/api/plugins/hermes-switch-ui/`:

| Route | Purpose |
|---|---|
| `GET /api/plugins/hermes-switch-ui/connection` | Current connection state |
| `POST /api/plugins/hermes-switch-ui/register` | Switch UI registers itself at startup |
| `GET /api/plugins/hermes-switch-ui/settings` | Fetch settings the gateway has stored for the UI |
| `POST /api/plugins/hermes-switch-ui/status` | Push a status update from the UI to the gateway |
| `POST /api/plugins/hermes-switch-ui/heartbeat` | Periodic keep-alive from Switch UI |

## Compatibility range

The plugin declares `compatible_switchui: ">=1.0.0,<3.0.0"`. If you run a Switch UI version outside this range, the plugin will report a compatibility warning in the connection endpoint response. The UI surfaces this as a banner in Settings.

## State

All connection and registration state is persisted to `~/.hermes/switchui/state.json`. This file is created automatically on first registration and is safe to delete if you want to reset the connection state.

## No configuration required

The plugin requires no explicit configuration. It is enabled automatically when the bundled gateway is running, and Switch UI registers with it on startup. There is no `hermes plugins enable` step for this plugin.

## Related

- [Plugins overview](./overview.md)
- [Settings](../settings/overview.md) — the UI side of config sync
- [Hermes Agent](../main/hermes-agent.md) — the gateway the plugin lives in
