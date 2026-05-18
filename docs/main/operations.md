---
title: Operations
description: Monitor system health, resource usage, and operational metrics for your agent.
---

# Operations

> Monitor individual agent status, dispatch tasks to specific agents, and view recent agent outputs — all from one screen.

## What you see

The page has a three-column layout: a left **Team Rail**, a centre **Focus Panel**, and a right **Dispatch Panel**. A full-width **Outputs Strip** spans the bottom. A top bar provides global controls and a page title. If the screen fails to load, the route shows an inline error with a **Reload Page** button.

> [SCREENSHOT: Operations page, three-column layout, matrix-dark theme]

## Major regions

### Operations top bar (`OperationsTopBar`)

A header strip with the Operations title and any global controls (filter state, connection indicators).

### Team rail (`TeamRail`)

The left sidebar lists all agents known to the workspace. It uses `useOperationsAgents()` to fetch the agent list and filters it by the selected `teamFilter` value: **all**, **live**, **idle**, or **blocked / error**. `TeamHeader` shows the total agent count. `TeamFilters` renders the filter pills. Each agent appears as an `AgentCard`; clicking one sets it as the focused agent and populates the Focus Panel. A **New Agent** modal (`NewAgentModal`) is accessible from the rail header.

### Focus panel (`FocusPanel`)

The centre column shows detail for the currently focused agent. It auto-selects the first agent if none is focused. Sub-components:

- **`FocusHero`** — agent name, status badge, and primary identity fields.
- **`FocusMission`** — the agent's current mission or active task description.
- **`FocusActivity`** — a recent activity feed for the agent.
- **`FocusTools`** — tools the agent has invoked recently.
- **`FocusRecentOutputs`** — last few outputs produced by the agent.

While data is loading it shows "Loading agent…". If the gateway is offline it shows "Gateway offline · no live agents".

### Dispatch panel (`DispatchPanel`)

The right sidebar lets you compose and send a task directly to an agent or group of agents. It contains:

- **`DispatchHeader`** — panel title and context.
- **`DispatchModes`** — routing mode selector (single agent, broadcast, etc.).
- **`DispatchComposer`** — a text input for the task prompt.
- **`DispatchMeta`** — metadata fields (priority, context, etc.).
- **`RoutingPreview`** — a preview of which agents will receive the dispatch.
- Footer buttons: **save draft** and **dispatch** (sends the composed task).

### Outputs strip (`OutputsStrip`)

A horizontal strip at the bottom of the page showing recent outputs from all agents, with filter controls (`OutputsFilters`, `OutputsHeader`) and individual `OutputCard` components.

## Common workflows

- To inspect an agent: click its card in the Team Rail. The Focus Panel loads its mission, activity, tools, and recent outputs.
- To filter the agent list: click a pill in `TeamFilters` — **live**, **idle**, or **blocked/error**.
- To dispatch a task: type a prompt in the Dispatch Composer, choose a routing mode, review the `RoutingPreview`, and click **dispatch**.
- To register a new agent: click **New Agent** in the Team Rail header and fill in the modal.

## Where data comes from

Agent data is fetched via `useOperationsAgents()` and `useOperationsAgent(id)` from the workspace operations API (routes under `/api/operations`). UI selection state (focused agent, team filter, modal open) is stored in `useOperationsUIStore` (Zustand). The screen does not require a specific gateway capability flag — it loads unconditionally, but agent data will be empty if the gateway is offline.

## Common issues

- **"Gateway offline · no live agents"** in the Focus Panel — the Hermes gateway is not reachable on port 8642. Check the connection status on the [Dashboard](./dashboard.md) page.
- **Dispatch button has no visible confirmation** — the dispatch action posts to the backend; check the browser network tab for the response if you are unsure whether it was sent.
- **Failed to Load Operations error page** — an unhandled error occurred during route initialization. Click **Reload Page**; if the error recurs, check the browser console for the specific exception.

## Related

- [Conductor](./conductor.md) — higher-level mission orchestration across multiple agents
- [Dashboard](./dashboard.md) — gateway health and connection status
- [Tasks](./tasks.md) — task board fed by agent work
