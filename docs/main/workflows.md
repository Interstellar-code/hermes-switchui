---
title: Workflows
description: Run and manage multi-step automated workflows from the Workflows page.
---

# Workflows

Workflows let you run structured, multi-step sequences of AI agent tasks without manually guiding each step. You define a graph of nodes — prompts, scripts, shell commands, approval gates, and sub-workflows — and the engine executes them in order, passing outputs from one node as inputs to the next.

> [SCREENSHOT: Workflows page showing the grid of workflow cards with a sidebar filter panel]

## What you see

The Workflows page (`/workflows`) has three main areas:

**Library panel (left)** — A filterable list of available workflows. Workflows come from two sources:

- **Bundled** — workflows that ship with Switch UI. They are read-only and always available.
- **User** — workflows you have created or imported. These can be edited and deleted.

You can filter by source (bundled / user), by tags, or by workflow kind. Subgraph-type workflows are hidden from the grid by default.

**Workflow grid (centre)** — Cards for each workflow showing the name, description, node count, last-used time, and tag chips. Clicking a card opens the workflow editor panel on the right.

**Editor / detail panel (right)** — Shows the selected workflow's details, a visual DAG preview, and action buttons including Launch, Duplicate, Export YAML, and Delete. See [Editing a workflow](./workflows/editing.md).

## Bundled workflows

Switch UI ships with a set of ready-to-use workflows for common software development tasks. These include, among others:

- `archon-assist` — General assistance and one-off tasks
- `archon-feature-development` — End-to-end feature development
- `archon-fix-github-issue` — Investigate and fix a GitHub issue
- `archon-create-pr` — Create a pull request from current changes
- `archon-comprehensive-pr-review` — Full review of a pull request
- `archon-implement-review-fixes` — Apply reviewer feedback
- `archon-idea-to-pr` — Take an idea all the way to a merged PR
- `archon-investigate-issue` — Deep investigation of an issue
- `archon-validate` — Validate code or a plan against requirements
- `archon-resolve-merge-conflicts` — Resolve merge conflicts automatically

The full list is defined in the bundled workflow registry and may grow with updates.

## Running a workflow

Click a workflow card to select it, then click **Launch** in the editor panel. A four-step wizard guides you through reviewing the plan, previewing the node graph, setting the schedule, and confirming before starting. See [Running a workflow](./workflows/running.md) for the full walkthrough.

## Creating a workflow

Click **New workflow** in the library panel header. A creation wizard opens where you describe the workflow you want (Coming soon: AI-assisted generation from a description). You can also create a workflow by duplicating an existing one and editing the YAML. See [Editing a workflow](./workflows/editing.md).

## Monitoring runs

After launching a workflow, the run detail panel shows live execution status, per-node outputs, and any errors or approval requests. See [Reading workflow output](./workflows/output.md).

## Related

- [Workflows overview](./workflows/overview.md)
- [Running a workflow](./workflows/running.md)
- [Editing a workflow](./workflows/editing.md)
- [Reading workflow output](./workflows/output.md)
