---
title: Workflow Engine
description: Backend plugin that runs YAML-defined DAG workflows inside the Hermes Agent gateway, powering the Switch UI Workflows page.
---

# Workflow Engine

The Workflow Engine is a Hermes Agent (Python gateway) plugin that ships as part of the Hermes Switch UI package. It is the backend that powers the Switch UI Workflows page when you set the backend toggle to **plugin**. The plugin exposes a REST API and five agent tools that let you define, trigger, monitor, approve, and cancel multi-step workflows — all running server-side inside the gateway process.

> [SCREENSHOT: Switch UI Workflows page with the backend set to "plugin", showing a running DAG workflow with phase progress]

## What a workflow is

At the engine level, a workflow is a YAML file that describes a directed acyclic graph (DAG) of nodes. Each node is a discrete unit of work — a shell command, a Python or TypeScript script, a prompt sent to an AI agent, a Hermes Agent command, a human approval gate, or an embedded subgraph referencing another workflow. Edges between nodes declare dependencies: a node only executes after every node pointing to it has completed.

A minimal workflow skeleton looks like this:

```yaml
name: my-workflow
description: What this workflow does and when to use it.
provider: claude
model: sonnet

nodes:
  - id: first-step
    phase: Discover
    bash: |
      echo "hello from step one"

  - id: second-step
    phase: Build
    depends_on: [first-step]
    hermes_task:
      agent_hint: neo
      model_hint: claude-sonnet-4
      skills: [coding]
    prompt: |
      Read the output of the previous step and summarise it.
```

The `provider`, `model`, and `hermes_task` fields let you route individual nodes to different models or specialised agents. Nodes that share no dependencies run in parallel automatically.

## Bundled workflows

The plugin ships more than twenty ready-to-use workflow definitions under its `defaults/` directory. These cover common engineering tasks such as fixing a GitHub issue, creating a PR from a plan, running a comprehensive code review, scaffolding a PRD through a guided conversation, and refactoring a codebase safely. Bundled workflows are read-only — you can run and copy them, but you cannot edit or delete them from Switch UI.

When a bundled workflow's YAML changes in a new release, its checksum updates and Switch UI highlights the change so you know an update is available.

## Cron-triggered runs

Workflows can include a `cron` field containing a standard five-field cron expression. When the plugin's background daemon is running, it polls for due cron schedules and launches runs automatically:

```yaml
name: nightly-digest
cron: "0 2 * * *"
nodes:
  - id: build-digest
    bash: ./scripts/build-digest.sh
```

The daemon is a separate process from the gateway request loop. You start it with:

```bash
hermes workflow daemon --interval 60
```

The `--interval` value (in seconds) controls how often the daemon wakes to check for due cron jobs, pending Kanban tasks, and scheduled ticks. The daemon handles `SIGINT` and `SIGTERM` for clean shutdown; in production you should supervise it with systemd, launchd, or a similar process manager.

## Where workflows are defined

When the plugin backend is active, workflow definitions are stored in a SQLite database managed by the plugin — separate from the native backend's store. You can register a new workflow by uploading its YAML through the Switch UI Workflows page or via the plugin REST API. The `allowed_roots` config key controls which filesystem paths are trusted as workflow file sources:

```yaml
workflow:
  allowed_roots: ["~", "${HERMES_HOME}"]
  run_rate_per_session: 5
  approve_any: false
```

`run_rate_per_session` limits how many runs a single session can start to prevent runaway automation. `approve_any` controls whether any user may approve an `approval`-type node or only the session owner.

## How it relates to the Switch UI Workflows page

This plugin is the only workflow engine Switch UI uses. Every workflow API call is proxied through to it running inside the hermes-agent gateway, so the gateway must be reachable for the Workflows page to work.

Switch UI once shipped a second, native TypeScript engine embedded in its own server, selectable from a backend toggle in Settings. Both the native engine and the toggle have been removed — the engine factory now always returns the plugin client, and the Workflows settings section is read-only. See [Workflows backend toggle](../settings/workflows-backend-toggle.md) if you are migrating from a version that still had the native store.

Alongside the features shared with the old native engine — SSE event streaming, approval gates, parallel node execution, phase grouping — the plugin adds cron-triggered runs and Kanban dispatcher integration, routing `hermes_task` nodes to named agents via the Kanban system.

## Enabling the plugin

The plugin must be enabled in the Hermes Agent gateway before Switch UI can use it:

```bash
hermes plugins enable workflow-engine
hermes dashboard restart
```

After restarting, verify the routes are live:

```bash
curl http://localhost:8642/api/plugins/workflow-engine/definitions
```

Then open **Settings → Workflows → Backend** in Switch UI and select **plugin**.

> [SCREENSHOT: Settings → Workflows → Backend toggle showing "plugin" selected with a green connected indicator]

## Related

- [Workflows overview](../main/workflows/overview.md)
- [Workflows backend toggle](../settings/workflows-backend-toggle.md)
- [Running a workflow](../main/workflows/running.md)
- [Editing a workflow](../main/workflows/editing.md)
