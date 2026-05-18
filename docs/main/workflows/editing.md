---
title: Editing a workflow
description: Modify workflow steps, inputs, and conditions using the workflow editor.
---

# Editing a workflow

The workflow editor panel opens on the right side of the Workflows page when you select a workflow card. It shows the workflow's full definition and gives you tools to view, modify, duplicate, export, and delete workflows.

> [SCREENSHOT: Workflow editor panel showing Overview tab with metadata grid, and tab bar with DAG and YAML tabs]

## What you see

The editor panel has three tabs:

- **Overview** — Metadata, node breakdown, flags, and action buttons.
- **DAG** — Visual graph of the workflow's node-and-edge structure.
- **YAML** — The raw workflow definition as editable YAML (user workflows only).

## Overview tab

The Overview tab shows:

- **Checksum** — A content hash of the workflow definition (first 12 characters displayed). Changes whenever the YAML is saved.
- **Version** — Integer version counter, incremented on each save.
- **Source** — `bundled`, `user`, or `project`.
- **Path** — File path of the workflow definition on disk (for bundled workflows).
- **Node breakdown** — Count of each node type in the workflow.
- **Flags** — Whether the workflow contains loops (`has_loop`) or approval gates (`has_approval`).

## DAG tab

The DAG tab renders the same visual graph shown in the launch wizard Step 2. Hover over a node to see its ID. The graph is read-only in both bundled and user workflows — structural changes are made by editing the YAML.

## YAML tab

User workflows expose a YAML editor where you can directly modify the workflow definition. Bundled workflows show the YAML as read-only.

When you save a valid YAML change:

1. The definition is validated by the workflow engine schema.
2. If validation passes, the workflow is updated in the database.
3. The version counter increments and the checksum updates to reflect the new content.
4. The DAG and Overview tabs refresh.

If the YAML is invalid, an error message describes what failed validation and the save is rejected.

## Actions

The following action buttons appear in the Overview tab:

| Button | Available for | What it does |
|--------|--------------|-------------|
| **Launch** | All workflows | Opens the launch wizard to start a run |
| **Duplicate** | All workflows | Creates a copy as a new user workflow with ` Copy` appended to the name |
| **Export YAML** | All workflows | Downloads the workflow definition as a `.yaml` file |
| **Delete** | User workflows only | Permanently deletes the workflow after a confirmation prompt |

Bundled workflows cannot be deleted. The Delete button is disabled and shows a tooltip explaining this.

## Creating a workflow

Click **New workflow** in the library panel header. A creation form opens where you can give the workflow a name, description, and tags, then write or paste the YAML definition. After saving, the workflow appears in the grid under the `user` source filter.

To base a new workflow on an existing one, click **Duplicate** in the editor panel. The copy opens in the editor ready for you to rename and modify.

## Common issues

**YAML save fails with a validation error** — Check the error message for the specific field or node that failed. Common issues include missing required fields (`id`, `name`), invalid node types, or malformed edge references.

**Checksum did not change after saving** — If the YAML content was identical to the previous save (e.g. only whitespace changed), the checksum will remain the same. The version counter still increments.

**Duplicate picks an ID that already exists** — The duplicate action generates the next available ID by appending a counter suffix. If this fails, rename the ID manually in the YAML tab before saving.

## Related

- [Workflows overview](./overview.md)
- [Running a workflow](./running.md)
- [Reading workflow output](./output.md)
