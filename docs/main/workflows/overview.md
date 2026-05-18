---
title: Workflows overview
description: Learn what workflows are and how they automate multi-step agent tasks.
---

# Workflows overview

A workflow is a directed acyclic graph (DAG) of nodes where each node performs a discrete unit of work. The workflow engine executes nodes in topological order, respecting dependencies, and passes data between nodes automatically.

> [SCREENSHOT: Visual DAG diagram in the workflow editor showing nodes connected by directed edges]

## Nodes

Each node in a workflow has a type that determines what it does at runtime:

| Node type | What it does |
|-----------|-------------|
| `prompt` | Sends a prompt to a Claude-based AI agent (Hermes Agent) and collects the response |
| `bash` | Runs a shell command and captures stdout/stderr |
| `command` | Runs a named Hermes Agent command (e.g. a built-in archon command) |
| `script` | Executes a TypeScript or Python script via Bun or uv |
| `loop` | Runs an AI prompt in a loop until a completion condition is met |
| `approval` | Pauses the workflow and waits for a human to approve or reject before continuing |
| `router` | Evaluates a condition and selects which downstream branch to follow |
| `cancel` | Terminates the workflow run immediately |
| `subgraph` | Embeds another workflow as a reusable sub-step |

Each node also carries optional metadata: a display label, a phase tag (grouping nodes into logical phases), and Hermes task hints such as `agent_hint`, `model_hint`, and `skills`.

## Edges

Edges define the execution order. A node runs only after all nodes that point to it have completed successfully. Nodes with no incoming edges run first (the entry points). Nodes with no outgoing edges are the terminal steps.

## Subgraphs

A `subgraph` node references another workflow by ID. When the engine reaches that node it expands the referenced workflow inline. Subgraphs are hidden from the main workflow grid by default — they are building blocks, not standalone runnable items. You can see them by enabling the subgraph filter in the library panel.

## Required and optional inputs

A workflow may declare `required_inputs` and `optional_inputs`. Required inputs must be provided before the run starts; optional inputs can be left blank. The launch wizard collects these from you in Step 1 (Plan). Inputs are available to prompt nodes as template variables.

## Phases

Nodes can be grouped into named phases (e.g. `investigate`, `implement`, `review`). Phases are purely organisational — they affect how the run detail panel groups progress, but do not change execution order.

## Versions and checksums

Every workflow definition has a version number and a content checksum. The checksum changes whenever the YAML definition changes, which makes it easy to detect when a bundled workflow has been updated. Bundled workflows are versioned by the Switch UI release; user workflows start at version 1 and increment each time you save.

## Workflow sources

| Source | Editable | Deletable |
|--------|----------|-----------|
| `bundled` | No | No |
| `user` | Yes | Yes |
| `project` | Yes | Yes |

## Related

- [Workflows](../workflows.md)
- [Running a workflow](./running.md)
- [Editing a workflow](./editing.md)
