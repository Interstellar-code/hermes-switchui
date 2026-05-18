---
title: Matrix3D
description: Explore your agent's activity as an immersive 3D office environment.
---

# Matrix3D

> Visualise your Hermes agents as pixel-art characters in a 3D office scene, with a live runtime log console beneath.

## What you see

The page has a full-height layout with two zones stacked vertically. The upper zone is the **3D canvas viewport**. The lower zone holds the **agent roster rail** on the left and the **runtime log console** on the right. Clicking an agent card in the roster opens a collapsible **side panel** on the far right with agent details.

> [SCREENSHOT: Matrix3D page, 3D office viewport and agent roster, matrix-dark theme]

## Major regions

### 3D canvas zone (`Matrix3DCanvas`)

A React Three Fiber (`@react-three/fiber`) canvas renders the 3D office using `@react-three/drei` helpers (`Float`, `Html`, `OrbitControls`, `RoundedBox`). The scene contains four desks labelled Ops, Intel, Forge, and Watch, each with a floating capsule avatar. Matrix rain bars drift in the background. Fog and green lighting complete the aesthetic.

Navigation controls shown in the bottom status bar: **drag** to orbit, **scroll** to zoom, **space + drag** to pan, **double-click** to focus. An `OrbitControls` component from Drei handles mouse and touch input.

A title bar overlay reads **Matrix3D Office**. The bottom bar shows live counts: working · idle · error.

### Agent roster rail

A horizontal scrolling row of `Matrix3DAgentCard` components, one per agent. Each card shows:

- A tier badge (T1 for the primary agent)
- A bubble label (model name if available, else last activity)
- A pixel-art sprite (`Matrix3DSprite`) whose shape varies by agent name (Hermes, Neo, Trinity, Morpheus archetypes)
- Agent name, role, and meta summary (sessions, task count, live session indicator)
- A status dot and label (working / idle / error) with a glow when active

The roster label adapts: **Active agents** when sourced from live gateway data, **Workspace roster** when sourced from local profiles, or **Agent roster** as a fallback. Clicking a card selects it and opens the side panel.

### Runtime log console (`Matrix3DConsole`)

Below the roster, a Matrix-rain-background console shows interleaved agent and gateway log lines. Tab filters: **ALL**, **AGENTS**, **GATEWAY**, and one tab per agent that has matching log entries. A **NOISE** toggle hides or shows high-frequency low-signal lines. A **Live / Sync / Offline** indicator in the top-right reflects the polling state. Logs refresh every 5 seconds via `getLogs()`.

### Agent side panel

Slides in from the right when a card is selected. Shows:

- Avatar with pulse dot, agent name, provider badge, role, and model name
- Stats: Sessions, Tasks, Tier
- **Current Task** field
- **Recent Activity** — last 5 log entries matched to this agent
- **Profile Details** table: Source, Status, Roster status, Active session flag

Close the panel with the × button or by selecting a different agent.

## Common workflows

- To explore the 3D scene: drag to orbit, scroll to zoom, space-drag to pan.
- To inspect an agent: click its card in the roster rail. The side panel opens with sessions, tasks, and recent log lines.
- To filter the log console: click **AGENTS**, **GATEWAY**, or an agent-specific tab. Toggle **NOISE** to hide repetitive lines.
- To dismiss the side panel: click × in the panel header.

## Where data comes from

Agent presence data comes from `useMatrix3DOfficeData()`, which merges live Hermes gateway agent data (when available) with local workspace roster profiles. Log data is fetched from `getLogs({ lines: 120, file: 'agent' })` and `getLogs({ lines: 120, file: 'gateway' })` via `/api/logs`, polled every 5 seconds with TanStack Query. The 3D canvas agents are a fixed set of four placeholder desks; the roster cards and log console reflect real live data.

## Common issues

- **Roster shows "No Hermes profiles or live sessions"** — the workspace has not returned any agent profiles yet. Ensure the Hermes gateway is running on port 8642 and at least one profile is configured.
- **Console shows "Offline"** — both the agent and gateway log queries are failing. Check gateway connectivity on the [Dashboard](./dashboard.md) page. The console will show placeholder data rather than crashing.
- **3D viewport is blank or shows a loading spinner** — the `Matrix3DCanvas` is lazy-loaded. On a slow connection it may take a moment. If it stays blank, check the browser console for WebGL errors; the page requires WebGL support.

## Related

- [Operations](./operations.md) — flat agent monitor with dispatch controls
- [Dashboard](./dashboard.md) — gateway health and connection status
