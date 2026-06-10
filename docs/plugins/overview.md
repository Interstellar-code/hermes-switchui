---
title: Plugins overview
description: The custom Hermes Agent plugins that ship as part of the Hermes Switch UI package.
---

# Plugins

Hermes Switch UI is the front-end. The intelligence runs in the **Hermes Agent** — a Python gateway on port `8642` that Switch UI talks to over REST and SSE. The agent is extensible through *plugins*: self-contained Python packages that add capabilities, background services, dashboards, and agent behaviors.

This section documents the four custom plugins that ship as part of the Hermes Switch UI package. They live on the agent side, but Switch UI bundles them and surfaces their features in the UI, so they are treated as first-party here.

> [SCREENSHOT: Switch UI with a feature from each plugin highlighted — Workflows page, A2A Fleet tab, MCP page, and a Matrix-themed chat]

## The four plugins

- **[A2A Fleet](./a2a-fleet.md)** — deploy repo-scoped executor peers that Hermes can delegate tasks to over the Agent-to-Agent protocol, and watch them work from the A2A Fleet page.
- **[Workflow Engine](./workflow-engine.md)** — the backend that runs multi-step, optionally cron-triggered workflows. It powers the Switch UI [Workflows](../main/workflows/overview.md) page.
- **[Lazy Load MCP](./lazy-load-mcp.md)** — defers loading MCP tool schemas until the model needs them, cutting per-turn token overhead when many [MCP](../settings/mcp.md) servers are configured.
- **[Matrix Coder](./matrix-coder.md)** — a specialist-coder layer that composes a focused coding persona into the agent's turns.

## How plugins relate to the rest of the app

Plugins are distinct from the two other extension mechanisms you will see in Switch UI:

- **[MCP servers](../settings/mcp.md)** connect the agent to external tool providers over the Model Context Protocol. Lazy Load MCP changes *how* those tools are exposed, but does not replace them.
- **[Skills](../settings/skills/what-are-skills.md)** are prompt-level instructions packaged for reuse. Plugins are code that runs inside the gateway process.

Because plugins ship with the agent, you do not install them from the UI the way you install an MCP server or a skill — they are present whenever the bundled Hermes Agent is running. What you control from Switch UI is their *features*: triggering a workflow, delegating to a fleet peer, and so on.

## Related

- [A2A Fleet](./a2a-fleet.md)
- [Workflow Engine](./workflow-engine.md)
- [Lazy Load MCP](./lazy-load-mcp.md)
- [Matrix Coder](./matrix-coder.md)
- [MCP](../settings/mcp.md) — managing Model Context Protocol servers
