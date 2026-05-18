---
title: Reading workflow output
description: Understand the results, logs, and artefacts produced by a completed workflow run.
---

# Reading workflow output

The run detail panel shows everything that happened during a workflow run: which nodes executed, what they produced, how long each step took, and whether any errors or approvals occurred.

> [SCREENSHOT: Run detail panel showing a completed run with node rows, status badges, and expandable output sections]

## What you see

The run detail panel opens automatically after you start a run from the launch wizard. It is also accessible by selecting a past run from the run history list in the workflow editor.

The panel is divided into sections:

- **Run header** — Workflow name, run ID, overall status badge, start time, and elapsed duration.
- **Node rows** — One row per node in the workflow, listed in execution order.
- **Approval requests** — Highlighted rows for any nodes that are waiting for human approval.

## Node status badges

Each node row shows a status badge reflecting its current state:

| Badge | Meaning |
|-------|---------|
| `pending` | Node is waiting for upstream dependencies to complete |
| `running` | Node is actively executing |
| `success` | Node completed without error |
| `failed` | Node encountered an error; downstream nodes that depend on it are skipped |
| `skipped` | Node was not reached (e.g. the router chose a different branch) |
| `cancelled` | Run was cancelled before this node executed |

## Viewing node output

Click a node row to expand it. The expanded view shows:

- **Summary** — A short text summary of what the node produced. For `prompt` nodes this is the agent's response; for `bash` and `script` nodes it is the captured stdout.
- **Timing** — Start time, end time, and duration for that node.
- **Error detail** — If the node failed, the error message and stack trace (where available).

## Live streaming

While a run is in progress, the run detail panel updates in real time via a Server-Sent Events (SSE) stream at `/api/workflow-events`. Each event carries a `conversation_id` that matches the run, so updates from concurrent runs do not interfere with each other. The gateway emits a heartbeat every 25 seconds to keep the connection alive.

When a node completes, its row transitions to `success` or `failed` immediately. You do not need to reload the page.

## Approval nodes

When the workflow reaches an `approval` node, the run pauses. The node row is highlighted and shows a message prompt from the workflow definition. You must click **Approve** or **Reject** to continue.

- **Approve** — Execution resumes with the next downstream nodes.
- **Reject** — The `on_reject` branch executes (if configured), or the run is marked failed after the maximum rejection attempts.

## Overall run status

The run header badge reflects the aggregate outcome:

| Status | Meaning |
|--------|---------|
| `running` | One or more nodes are still executing |
| `success` | All nodes completed without error |
| `failed` | At least one node failed |
| `cancelled` | The run was cancelled by the user or a `cancel` node |

## Common issues

**Panel shows no output after a run completes** — Node outputs are written by the workflow engine after the Hermes Agent task completes. If the kanban task worker did not report a result, the summary field may be empty. Check the agent logs for errors from the dispatcher.

**SSE stream disconnects frequently** — A 25-second heartbeat keeps the connection alive. If your network or proxy has a shorter idle timeout, the stream will be cut. Reload the page to reconnect; completed node results are fetched from the database and display immediately.

**Approval request does not appear** — Ensure the run detail panel is open and connected to the SSE stream. If you navigated away, return to the Workflows page and reselect the run from the run history.

## Related

- [Running a workflow](./running.md)
- [Workflows overview](./overview.md)
- [Editing a workflow](./editing.md)
