---
title: Board templates
description: Reusable parameterized board blueprints — create, instantiate, and save boards as templates with variable substitution and dependency graphs.
---

# Board templates

Board templates are reusable blueprints for creating Kanban boards. A template defines a set of tasks, their dependencies, optional recurrence, and named variables that are filled in at instantiation time. This lets you create repeatable workflows — weekly reports, sprint setups, release checklists — without rebuilding the board from scratch each time.

![Board Templates page in Matrix dark theme, listing templates with name, task count, variables, schedule, and actions](/screenshots/board-templates.png)

## What you see

Navigate to **Board Templates** in the sidebar. The page shows your saved templates in either **Grid** or **List** view (toggle in the top-right corner). Each entry shows the template name, slug, task count, and description. From the list you can instantiate, edit, or delete any template.

## Creating a template

Click **New Template** to open the creation wizard. The wizard has 5 steps:

| Step | Label | What you configure |
|------|-------|--------------------|
| 1 | Basics | Template name (auto-generates a slug), description, and accent colour |
| 2 | Variables | Named parameters that callers supply at instantiation — each variable has a key, prompt label, description, required flag, and optional default value |
| 3 | Tasks | The tasks that make up the template — title, status, priority, assignee, body, `max_runtime_seconds`, `goal_max_turns`, and an optional `scheduled_at` deferred-dispatch time |
| 4 | Dependencies | Directed links between task keys that form the execution order; the wizard enforces a cycle-guard (DFS) and blocks you from creating circular dependencies |
| 5 | Review | A YAML preview of the full template and a pre-flight checklist of validation results |

Click **Next** to advance. The Review step shows any blocking issues before you can save.

## Variable interpolation

Variables defined in step 2 can be referenced anywhere in a task's title, body, assignee, or `scheduled_at` field using `{{variable_key}}` syntax. At instantiation time the caller is prompted to supply a value for each required variable; optional variables use their default if left blank.

Example: a task title of `Review {{project_name}} pull requests` becomes `Review Hermes pull requests` when instantiated with `project_name=Hermes`.

## Task timing fields

Each task in step 3 has two optional advanced fields:

- **`max_runtime_seconds`** — hard time limit for the task's agent run.
- **`goal_max_turns`** — maximum agent turns when the task runs in goal mode.
- **`scheduled_at`** — deferred dispatch start time. Accepts a relative offset (`+2h`, `+30m`, `+1d`, `+1w`), an absolute date/time, or a `{{variable}}` placeholder so callers can supply the start time at instantiation. Leave blank to dispatch the task as soon as it is ready.

## Recurrence

In step 4 you can enable recurrence on the template. A cron expression and timezone control when the board auto-instantiates. Example expressions: `0 9 * * 1` (every Monday at 9 am), `*/30 * * * *` (every 30 minutes).

## Instantiating a template

Click **Instantiate** on any template card to create a real board from the template. A dialog collects values for any required variables and lets you choose a target board (or auto-create one). On confirm the tasks are created on the board with all variable placeholders resolved.

## Saving an existing board as a template

From a board view, use the **Save as template** action. This calls `useSwitchBoard` under the hood and opens the creation wizard pre-seeded with the board's existing tasks and metadata so you can parameterise them before saving.

## Common issues

**Board Templates page shows "API not available".** The connected Hermes Agent does not expose the board templates API. Update the agent to a version that includes the kanban plugin with template support.

**Cycle detected error in step 4.** The dependency graph you defined contains a circular path. Remove the link that completes the cycle — the wizard highlights which link would introduce it.

**YAML size warning in step 5.** Templates over 64 KB may be rejected by the backend. Reduce task body length or split into multiple templates.

## Related

- [Boards](./boards.md) — the board view where instantiated tasks live
- [Tasks](./tasks.md) — individual task management
- [Plugins — Kanban](../plugins/kanban.md) — the plugin that powers boards and templates
