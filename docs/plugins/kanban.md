---
title: Kanban
description: Multi-agent collaboration boards with task CRUD, agent dispatch, board templates, and a live WebSocket event feed — powering the Switch UI Tasks and Boards pages.
---

# Kanban

Kanban is a Hermes Agent plugin that ships as part of the Hermes Switch UI package. It provides multi-agent collaboration boards: structured collections of tasks that agents and humans can create, update, claim, and dispatch to one another. Switch UI surfaces the plugin through the **Tasks**, **Boards**, and **Board Templates** pages.

> [SCREENSHOT: Boards page showing a multi-column kanban board with task cards, assignee badges, and a dispatch button]

## What it does

The plugin manages tasks as first-class objects with a full lifecycle: create, read, update, delete, bulk-update, comment, attach files, link to other tasks, dispatch to an agent profile, decompose into subtasks, specify details, reassign, and reclaim. Beyond individual task operations, the plugin tracks board-level state, runs worker executions, exposes orchestration config, and produces stats and diagnostics.

The plugin exposes **35+ REST routes** at `/api/plugins/kanban/` and a `/events` WebSocket for live board updates.

## Board Templates

Board Templates (added in issue #135) let you define reusable board configurations as YAML and instantiate them on demand. The Templates API adds 7 routes to the plugin:

- List available templates
- Get a single template definition
- Create or update a template
- Delete a template
- Instantiate a template into a live board
- Save an existing board as a template
- List template categories

Templates support per-task `scheduled_at` fields for deferred-start control: a task created from a template can have its start held until a specified time rather than becoming immediately actionable.

> [SCREENSHOT: Board Templates page showing the template gallery with YAML editor and category filter]

## Agent dispatch

Any task can be dispatched to a named agent profile. The plugin routes the task description and context to the profile, which picks it up as a work item. The Kanban worker runner executes the task and streams status back to the board. This is also how the Workflow Engine's `hermes_task` nodes land on the board when the plugin backend is active.

## What you see in Switch UI

**Tasks** (`/tasks`) is a flat list view of all tasks across boards with filtering by status, assignee, and tag.

**Boards** (`/boards`) is the kanban column view. Each column maps to a task status. Drag-and-drop reordering, inline editing, and the live WebSocket feed keep the board in sync across sessions without polling.

**Board Templates** (`/board-templates`) lets you browse, edit, and instantiate the template library.

> [SCREENSHOT: Tasks page list view with status filter chips and a task detail panel open on the right]

## Enabling the plugin

The plugin is enabled by default when the Hermes Agent gateway is running. Confirm the routes are live:

```bash
curl http://localhost:8642/api/plugins/kanban/tasks
```

The Tasks and Boards pages in Switch UI are gated on the gateway reporting the `jobs` capability at startup. If the pages are missing from the sidebar, confirm the gateway version supports the Kanban plugin and that the dashboard process has been restarted after the plugin was first installed.

## Related

- [Tasks](../main/tasks.md)
- [Boards](../main/boards.md)
- [Board Templates](../main/board-templates.md)
- [Workflow Engine](./workflow-engine.md) — routes `hermes_task` nodes to the Kanban dispatcher
- [A2A Fleet](./a2a-fleet.md) — fleet peers can receive tasks via the dispatcher
