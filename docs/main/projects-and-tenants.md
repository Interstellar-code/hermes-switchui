---
title: Projects, tenants, and boards
description: How the three kanban grouping primitives — boards, projects, and tenants — relate to each other, and which ones have a Switch UI surface.
---

# Projects, tenants, and boards

> Boards are a workstream. Projects are a codebase. Tenants are a customer. Pick the layer that matches the question you're asking.

Hermes Agent's kanban has three different grouping primitives. The Tasks and Boards pages in Switch UI show the **board** layer. The **project** layer has a read-only Switch UI surface — the [Projects page](#the-switchui-projects-page-v2) — for browsing registered projects; creating, editing, and archiving projects is still CLI-only. The **tenant** layer is an agent-side concept that is set as a flag on each task.

## Where this feature came from

Projects and the kanban↔project wiring were added to Hermes Agent upstream in PR [#49037](https://github.com/NousResearch/hermes-agent/pull/49037) (NousResearch/bb/projects-paradigm, merged 2026-06-25) by Brooklyn Nicholson. The change ships the per-profile `projects.db` store, the `hermes project …` CLI, the gateway RPCs that surface the project tree, and the kanban-side hook that links tasks to projects for deterministic worktree placement. The upstream Switch UI also has a projects sidebar — see `feat(desktop): render backend-authoritative projects sidebar`, `feat(desktop): add project and coding stores`, and `feat(desktop): wire projects into the chat shell + profile rail` in the same PR chain. That UI work is what this Switch UI build is missing.

## The three layers at a glance

| Primitive   | What it is                                                                                         | Switch UI surface                                           | CLI                                       |
| ----------- | -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | ----------------------------------------- |
| **Board**   | A durable workstream with its own SQLite database, workspaces directory, and dispatcher scope.     | Tasks page, Boards page                                     | `hermes kanban …`                         |
| **Project** | A human-named, multi-folder workspace anchored to a primary repository.                            | [Projects page](#the-switchui-projects-page-v2) (read-only) | `hermes project …`                        |
| **Tenant**  | A string label on a task, propagated to workers as `$HERMES_TENANT` for per-customer data scoping. | None                                                        | `--tenant` flag on `hermes kanban create` |

Boards are the **hard** isolation layer. The dispatcher sets `HERMES_KANBAN_BOARD` in every worker's environment, so a worker on one board physically cannot see tasks on another. Projects and tenants are **soft** labels — they only enforce isolation if your worker is configured to honour them (via workspace path, memory key prefix, and so on).

## When to use which

Reach for a **board** when you need to keep two unrelated streams of work physically separate. Each board has its own database, so a flaky test in one board cannot poison another board's worker pool. Use boards for:

- Different repositories that ship on different release cadences.
- Different teams or clients whose work must never appear together.
- Isolating experimental workflows from production automation.

Reach for a **project** when you need to say "this task lives in _that_ codebase, anchors here on disk, and the worker's branch should be predictable." Projects give you:

- **Deterministic worktrees.** A task linked to a project creates its worktree under the project's primary repository with a named branch like `auto/issue-174-mapBoardStatus` instead of a random `wt/t_abc123` slug.
- **Multi-folder scope.** A project can list several folders (frontend repo, backend repo, docs), and tasks that touch any of them roll up under the same project.
- **Session grouping.** A chat session whose working directory is under any of the project's folders auto-tags as belonging to that project.

Reach for a **tenant** when one set of agent profiles serves multiple customers and you need their data to stay separate. A tenant tag does not move files; it sets `$HERMES_TENANT` in the worker's environment so the worker (not the kernel) is responsible for keeping customer data isolated by workspace path and memory key prefix. Most single-user, single-customer setups do not need tenants.

## A practical decision rule

When you are about to create a board, ask:

1. **Is this a different codebase or repo that needs its own worktree slot and its own branch convention?** Yes → create a board, bind a project to it, and let the project anchor the worktrees.
2. **Is this a different customer or account that one specialist profile will serve, keeping data separate by prefix?** Yes → stay on the same board, but tag each task with `--tenant customer-name`.
3. **Is this just a temporary workstream for a sprint, a release, or a one-off campaign?** Yes → create a board with no project bound. Use the board for the duration of the work, then archive it.

If you are not sure, default to creating a board. Boards are cheap to create and archive, and they give you the strongest isolation.

## The SwitchUI Projects page (v2)

The Projects page (`/projects`) lists every registered project as a card (or table row in list view). Each card shows:

- **Tasks** — total `task_count` with an `{open_task_count} open` sublabel.
- **Folders** — `folder_count` (falls back to the length of the folders array for stale payloads).
- **Bound board** — a chip with the linked board's name and color when the project has one bound (`hermes project bind-board`); otherwise the raw `board_slug` is shown as plain text, or nothing if neither is set.
- **Last active** — a relative-time string ("5 min ago", "3 days ago") derived from `last_activity_at`.
- **Status pill** — `active` / `idle` / `archived`, driven by the project's `is_active` flag (falls back to whether the project is the workspace's current active project).

Opening a card slides out a drawer with three tabs: **Overview** (metadata), **Folders** (the full folder list), and **Activity**. The Activity tab shows the 10 most recent kanban tasks for the project (task creation/status events only — chat sessions are filtered out), each row with its title, status pill, and relative time, backed by `GET /api/plugins/projects/{id}/activity`. It's read-only; a "View all in Tasks page" link is provided but does not yet deep-link to a project-filtered view.

## Managing projects from the CLI

The project store is per-profile — each Hermes profile has its own list. The CLI surface is `hermes project …`:

```bash
# Create a project anchored to a real codebase
hermes project create "Hermes SwitchUI" /Users/rohits/Development/hermes-switchui \
  --primary /Users/rohits/Development/hermes-switchui

# Bind the project to a board so kanban tasks get deterministic worktrees
hermes kanban boards create switchui-coding-loop --name "SwitchUI Coding Loop"
hermes project bind-board "Hermes SwitchUI" switchui-coding-loop

# Inspect a project
hermes project show "Hermes SwitchUI"
hermes project list

# Add a second folder (e.g. a shared docs repo) to the same project
hermes project add-folder "Hermes SwitchUI" /Users/rohits/hermes/docs

# Archive when the project is no longer active
hermes project archive "Hermes SwitchUI"
```

The `bind-board` step is what makes projects and boards cooperate. Without it, a project is just a label for session grouping; with it, the dispatcher routes kanban tasks for that project into the bound board and the worker uses the project's primary folder for its worktree.

## Managing tenants from the CLI

Tenants are a per-task label, not a per-profile store. Add them when you create a task:

```bash
hermes kanban create "monthly report" \
  --assignee researcher \
  --tenant business-a \
  --workspace dir:~/tenants/business-a/data/
```

The worker sees `$HERMES_TENANT=business-a` in its environment and is responsible for writing to the right workspace and prefixing memory keys. The board, the dispatcher, and the profile definitions stay shared; only the per-task data is scoped.

Filter by tenant in the CLI and (where exposed) in dashboards:

```bash
hermes kanban list --tenant business-a
hermes kanban watch --tenant business-a
```

The kanban DB has an `idx_tasks_tenant` index for fast tenant-filtered listings, so the filter is cheap even on large boards.

## How the three layers fit together

A single task can carry all three labels at once. A useful way to think about the combined shape:

- **Project** answers "which codebase?" — a worker for this task should make its worktree under this project's primary repo.
- **Board** answers "which workstream?" — the dispatcher sweeps this board every minute, and the task lives in this board's database.
- **Tenant** answers "which customer?" — the worker should write to a tenant-scoped workspace and use a tenant-prefixed memory key.

A typical multi-project setup looks like this:

```
Board: switchui-coding-loop
  bound project: hermes-switchui
  intake: GitHub issues from hermes-switchui repo
  worker: develop → worktree under switchui primary repo, branch auto/<issue-id>

Board: hermes-agent-coding-loop
  bound project: hermes-agent
  intake: GitHub issues from hermes-agent repo
  worker: develop → worktree under hermes-agent primary repo, branch auto/<issue-id>
```

If you also serve a small number of customers on top of either codebase, you can tag individual tasks with `--tenant customer-name` without splitting into more boards. The dispatcher and worker pool stay shared; only the per-task data scope changes.

## Common issues

- **Project shows up but board doesn't.** `hermes project bind-board` runs after board creation. The CLI returns the board slug on success; if the bind silently no-ops, check that the board exists with `hermes kanban boards list`.
- **Worker uses the wrong worktree location.** The board's `default_workdir` overrides the project's primary path if both are set. Confirm with `hermes kanban boards show <slug>` and clear the override if the project should win.
- **Tenant filter returns nothing.** The filter is exact-match on the `tenant` column. Confirm the task has a tenant set with `hermes kanban show <task-id>` — empty string and `null` both look the same to the filter.

## Related

- [Tasks](./tasks.md) — the Switch UI board view for the active board's tasks
- [Boards](./boards.md) — manage the list of boards
- [Board templates](./board-templates.md) — reusable blueprints for boards with variables and recurrence
- [Kanban plugin](../plugins/kanban.md) — the Hermes Agent plugin that powers all of the above
