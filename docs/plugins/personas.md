---
title: Personas
description: Canonical store of 20 persona templates with three agent tools and a pre_llm_call hook that resolves a profile's persona reference into a developer-tier overlay on every turn.
---

# Personas

Personas is a Hermes Agent plugin that ships as part of the Hermes Switch UI package. It maintains the canonical library of persona templates and resolves them into the active conversation on each turn. The plugin is the backing store for the **persona step** in the Switch UI profile wizard.

> [SCREENSHOT: Profile wizard persona step showing the persona template gallery with a selected persona's preview and a "Promote to profile" button]

## What it does

The plugin ships **20 persona templates** as Markdown files in a `library/` directory. Each template describes a role, a set of behavioural constraints, and a tone. When a profile has a `persona_ref` set in its agent config, the plugin's `pre_llm_call` hook resolves that reference on every turn and injects the persona text as a **developer-tier overlay** — a layer that sits above user messages in context priority. When `persona_ref` is unset, the hook is dormant and no injection occurs.

This is the same injection tier used by Matrix Coder (#140 hardening): persona content is always framed as developer-level context, never as a user message, so it cannot be overridden by in-conversation instructions.

## The three agent tools

| Tool | What it does |
|---|---|
| `persona_list` | Returns the names and summaries of all 20 library personas |
| `persona_get` | Fetches the full Markdown content of a named persona |
| `persona_apply` | Sets the active profile's `persona_ref` to a named persona, replacing any prior value |

These tools are available to the agent during conversation, so you can ask Hermes to switch your active persona by name.

## REST API

The plugin exposes **3 REST routes** at `/api/plugins/personas/`:

- `GET /api/plugins/personas/` — list all personas (names and summaries)
- `GET /api/plugins/personas/{name}` — get a single persona's full content
- `POST /api/plugins/personas/{name}/promote` — promote a persona into the active profile's config

The profile wizard calls the promote route when you confirm a persona selection in the wizard's persona step.

## What you see in Switch UI

The Personas plugin surfaces in two places:

**Profile wizard** — the persona step fetches the library via the list route and renders a gallery. Selecting a persona previews its content; confirming writes `persona_ref` to the profile config via the promote route. The wizard pre-fills the selection from the profile's existing `persona_ref` if one is already set.

**Chat** — no dedicated UI. The active persona is injected silently on each turn. If you want to know which persona is active, ask Hermes or use `persona_list` via the agent tool interface.

> [SCREENSHOT: Chat composer with no persona indicator — persona injection is silent; active persona is visible in profile settings]

## Enabling the plugin

The Personas plugin is enabled by default. It has no separate enable step. Confirm the library is accessible:

```bash
curl http://localhost:8642/api/plugins/personas/
```

## Related

- [Plugins overview](./overview.md)
- [Self-Improve](./self-improve.md) — proposes changes to SOUL.md that can update a profile's persona
- [Matrix Coder](./matrix-coder.md) — uses the same developer-tier injection mechanism
- [Profile wizard](../settings/profiles.md) — the UI that uses this plugin's persona step
