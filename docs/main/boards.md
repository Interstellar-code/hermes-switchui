---
title: Boards
description: Organise tasks visually on Kanban-style boards within Hermes Switch UI.
---

# Boards

> Create and manage named Kanban boards that partition your agent's tasks into separate workspaces.

<iframe
  src="/api/docs-asset?path=diagrams/boards-architecture.html"
  width="100%"
  height="900"
  loading="lazy"
  style="border: 0; border-radius: 8px;"
></iframe>

**Feature gate:** Boards requires the Hermes Agent Dashboard Kanban plugin — the same gate as Tasks. Start the Hermes dashboard on port 9119 with the Kanban plugin enabled. While the gateway probes, a skeleton placeholder replaces the board list.

## What you see

A top bar shows the breadcrumb **Workspace / Tasks / Boards** with three stats pills: total boards, active boards, and total tasks across all boards. A **New Board** button sits at the right. Below it, a toolbar holds a text search input and three filter tabs — **All**, **Active**, and **Archived** — each with a count badge. The main area lists boards as cards in a responsive grid.

> [SCREENSHOT: Boards page, grid of board cards, matrix-dark theme]

## Major regions

### Board card

Each card shows the board name, description, a color swatch, and per-column task counts (Backlog, Todo, Running, Blocked, Done). Clicking a card opens the `BoardDrawer`. A board marked as the active (current) board is visually distinguished.

### Board drawer

A slide-in panel with two tabs:

- **Overview** — name, description, color picker, per-column task breakdown, and two action buttons: **Switch to board** (makes this board the active one) and **Delete**.
- **Edit** — inline editing of name, description, and color. Submit with **Save**.

The **Switch to board** action calls `fetchSwitchBoard()` which sets the active board on the Hermes backend, causing the Tasks page to display that board's cards.

### New board dialog

A modal form (triggered by **New Board**) with fields for name, description, and color. Submitting calls `fetchCreateBoard()`.

## Common workflows

- To create a board: click **New Board**, fill in the form, and submit.
- To switch to a board: click its card to open the drawer, then click **Switch to board**. The Tasks page will now show tasks belonging to that board.
- To rename or recolor a board: open its drawer and click the **Edit** tab.
- To archive a board: open the drawer, switch to Overview, and click **Delete** (soft-archive). Archived boards appear under the **Archived** filter tab.
- To search boards: type in the search input; the list filters live.

## Where data comes from

Board data is fetched via `fetchBoards()` which calls `/api/hermes-kanban/boards` (proxied to the Hermes dashboard Kanban plugin). The response includes a `BoardMeta` per board with task counts already bucketed by column status. Creating, updating, and deleting boards use `POST`, `PATCH`, and `DELETE` on the same base path. TanStack Query manages caching under the key `['hermes-kanban', 'boards']`.

## Common issues

- **"Backend Unavailable" on load** — the Hermes dashboard Kanban plugin is not running. Run `hermes dashboard` on port 9119.
- **Board task counts are stale** — the board list is not live-polled; reload the page or navigate away and back to refresh counts.
- **Switch to board has no effect on the Tasks page** — ensure you are on the same Hermes dashboard instance. If you have multiple worktrees or dev instances, each has its own isolated database (see the dev workflow DB isolation notes in CLAUDE.md).

## Related

- [Tasks](./tasks.md) — the Kanban board that displays tasks for the active board
- [Jobs](./jobs.md) — scheduled cron jobs
