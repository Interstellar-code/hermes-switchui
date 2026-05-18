---
title: Welcome
description: An introduction to Hermes Switch UI and what you can do with it.
---

# Welcome

> A browser-based shell for the Hermes Agent runtime — chat, sessions, files, terminals, and more, all running on your own machine.

> **New here?** Start with [Your first chat](getting-started/first-chat.md) — it gets you sending prompts in five minutes.

## What is Hermes Switch UI

Hermes Switch UI is the front-end for the Hermes Agent — a local AI assistant runtime. The app runs in your browser at `http://localhost:3000` (by default) and talks to the Hermes Agent gateway on port `8642`. From here on this guide refers to it as "the app".

Two paired processes work together:

- **Hermes Switch UI** — the web app you interact with. Default port: `3000`.
- **Hermes Agent** — the backend that handles AI providers, sessions, tools, and storage. Default port: `8642`.

You configure your AI provider once and the app routes chats, tool calls, and streaming responses through the agent.

> [SCREENSHOT: hermes switch ui home page, matrix-dark theme]

## What you can do

### Core

- **Chat** — Conversations with your chosen AI provider, with streaming responses, sessions, and a context-window indicator.
- **Sessions** — Browse past chats and resume them.
- **Files** — Read, write, and browse files the agent has access to.
- **Terminal** — Open a real PTY terminal inside the app.
- **Dashboard** — Health, jobs, and connection status.

### Extended

- **Boards** — Kanban board for agent task queues (when the agent's kanban plugin is installed).
- **Workflows** — Multi-step agent flows defined as graphs.
- **Conductor** — A higher-level mission-control surface for multi-agent runs (when the dashboard exposes it).
- **Operations** — Live operational view of agent activity.
- **Matrix3D** — A 3D office visualization of running agents.
- **Profiles** — Saved agent personas.
- **Skills** — Browse and edit skills the agent can invoke.
- **MCP** — Manage Model Context Protocol servers the agent connects to.
- **Memory** — View and edit the agent's persistent memory files.
- **Jobs** — Background job queue status.
- **Tasks** — Agent task tracking.
- **Agora** — Community hub for sharing skills and presets.

Pages that depend on optional gateway or dashboard endpoints (Conductor, Tasks, MCP, etc.) detect missing capabilities at startup and degrade gracefully instead of erroring.

## How it's structured

The sidebar on the left holds the page navigation. The main area in the center is the active page. Connection status and other ambient info show in the header or status panel where relevant.

The app probes the Hermes Agent on startup to figure out which features are available, then enables or hides pages accordingly. You can re-probe at any time from the connection status panel.

## Related

- [FAQ](faq.md)
- [Agent won't connect](troubleshooting/agent-connect.md)
