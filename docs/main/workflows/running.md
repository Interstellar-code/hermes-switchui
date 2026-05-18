---
title: Running a workflow
description: Trigger and monitor a workflow run from start to finish.
---

# Running a workflow

Running a workflow takes you through a four-step wizard that lets you review the plan, preview the node graph, set a schedule, and confirm before execution starts.

> [SCREENSHOT: Launch wizard modal open at Step 1 (Plan) showing workflow summary card and required inputs list]

## Step 1 — Plan

The first step shows a summary card with the workflow ID, name, and description. Below it you see two sections:

- **Inputs to provide** — When a workflow declares required or optional inputs, they are listed here, labelled `required` or `optional`. Most bundled workflows have no declared inputs, so this section is hidden.
- **Run context** — A free-text area where you can add an issue number, repository path, or any extra context you want to pass to the agent. This is optional.

The right side of Step 1 shows a read-only summary of the workflow's phases and any agent or skill hints declared in the node definitions.

Click **Next** to proceed.

## Step 2 — Route

Step 2 shows a visual DAG preview of the workflow — a horizontal layout of nodes connected by directed edges. Each node is colour-coded by type:

| Colour | Node type |
|--------|-----------|
| Green | `prompt` |
| Blue | `bash` / `script` |
| Purple | `command` / `subgraph` |
| Orange | `approval` |
| Red | `router` / `cancel` |
| Yellow | `loop` |

This step is read-only. Use it to understand the execution path before committing to a run.

Click **Next** to continue.

## Step 3 — Schedule

Step 3 lets you choose when the workflow runs:

- **Run immediately** — starts as soon as you confirm in Step 4.
- **Run at a specific time** — enter a date and time; the run is queued until that moment.
- **Cron schedule** — enter a cron expression (e.g. `0 9 * * 1-5`) to run on a recurring schedule.

You can also set the **Priority** (`normal` or elevated) and **Max runtime** in seconds (minimum 60, maximum 86400). The default max runtime is 3600 seconds (one hour).

## Step 4 — Confirm

The final step shows a confirmation grid summarising the workflow, your inputs, and the schedule. Review the details, then click **Submit as Workflow Run** to launch.

While the run is starting, the button shows a loading state. Once the run is created you are taken to the run detail panel automatically.

Press **Escape** at any point to close the wizard without starting a run.

## Monitoring the run

After launch the run detail panel opens alongside the workflow card. It shows live execution status, per-node progress, outputs, and any approval requests that need your attention. See [Reading workflow output](./output.md) for details.

## Common issues

**The wizard does not open** — Click the **Launch** button in the workflow editor panel after selecting a workflow card. The Launch button is disabled if no workflow is selected.

**Run does not appear after Step 4** — The workflow engine may not have started correctly. Check that the Hermes Agent is running and the workflow engine has been initialised (look for errors in the browser console or agent logs).

## Related

- [Workflows overview](./overview.md)
- [Editing a workflow](./editing.md)
- [Reading workflow output](./output.md)
