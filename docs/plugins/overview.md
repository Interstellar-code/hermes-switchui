---
title: Plugins overview
description: The custom Hermes Agent plugins that ship as part of the Hermes Switch UI package.
---

# Plugins

Hermes Switch UI is the front-end. The intelligence runs in the **Hermes Agent** — a Python gateway on port `8642` that Switch UI talks to over REST and SSE. The agent is extensible through *plugins*: self-contained Python packages that add capabilities, background services, dashboards, and agent behaviors.

This section documents the eight custom plugins that ship as part of the Hermes Switch UI package. They live on the agent side, but Switch UI bundles them and surfaces their features in the UI, so they are treated as first-party here.

> [SCREENSHOT: plugins-collage.png — Workflows, Boards, Self-Improve, and A2A Fleet surfaces]

## Collaboration and automation

These plugins power the core multi-agent and workflow surfaces in Switch UI:

- **[Kanban](./kanban.md)** — multi-agent collaboration boards with task CRUD, agent dispatch, board templates, and a live WebSocket event feed. Powers the Tasks, Boards, and Board Templates pages.
- **[Workflow Engine](./workflow-engine.md)** — YAML DAG workflow engine with branching, parallel nodes, bash nodes, approval gates, cron polling, and Kanban dispatch. Powers the Workflows page.
- **[A2A Fleet](./a2a-fleet.md)** — deploy and manage repo-scoped executor peers (Claude Code, OpenCode, Codex CLI, Antigravity) that Hermes delegates tasks to over the Agent-to-Agent protocol.

## Agent intelligence

These plugins shape how the agent thinks and behaves:

- **[Matrix Coder](./matrix-coder.md)** — specialist-coder layer with an eight-role deterministic IntentGate that routes coding tasks to the right expert role on every turn.
- **[Personas](./personas.md)** — canonical store of 20 persona templates; resolves a profile's `persona_ref` into a developer-tier overlay on each turn. Backs the profile wizard persona step.
- **[Self-Improve](./self-improve.md)** — Karpathy self-improvement engine: collects metrics, proposes SOUL.md and config diffs via LLM, evaluates against scenarios, and applies or reverts via git ratchet. Powers the Self-Improve page.

## Infrastructure

These plugins are lower-level and mostly invisible day-to-day:

- **[Lazy Load MCP](./lazy-load-mcp.md)** — defers loading MCP tool schemas until the model needs them, cutting per-turn token overhead when many MCP servers are configured.
- **[Hermes Switch UI](./hermes-switch-ui.md)** — backend awareness and bidirectional config sync between the gateway and the Switch UI frontend. Registers the UI at startup, handles heartbeats, and injects a one-time session nudge.

## How plugins relate to the rest of the app

Plugins are distinct from the two other extension mechanisms you will see in Switch UI:

- **[MCP servers](../settings/mcp.md)** connect the agent to external tool providers over the Model Context Protocol. Lazy Load MCP changes *how* those tools are exposed, but does not replace them.
- **[Skills](../settings/skills/what-are-skills.md)** are prompt-level instructions packaged for reuse. Plugins are code that runs inside the gateway process.

Because plugins ship with the agent, you do not install them from the UI the way you install an MCP server or a skill — they are present whenever the bundled Hermes Agent is running. What you control from Switch UI is their *features*: triggering a workflow, delegating to a fleet peer, managing boards, and so on.

## Related

- [A2A Fleet](./a2a-fleet.md)
- [Workflow Engine](./workflow-engine.md)
- [Kanban](./kanban.md)
- [Matrix Coder](./matrix-coder.md)
- [Personas](./personas.md)
- [Self-Improve](./self-improve.md)
- [Lazy Load MCP](./lazy-load-mcp.md)
- [Hermes Switch UI plugin](./hermes-switch-ui.md)
- [MCP](../settings/mcp.md) — managing Model Context Protocol servers
