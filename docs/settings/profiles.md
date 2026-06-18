---
title: Profiles
description: Create and manage agent profiles with the 9-step wizard — persona, model, skills, toolsets, and more.
---

# Profiles

The Profiles page lets you browse, create, and edit agent profiles. Each profile is a named configuration that controls the agent's identity, system prompt, model, enabled tools, MCP servers, and memory settings.

> [SCREENSHOT: Profiles page showing a grid of profile cards with name, glyph, and action buttons]

## What you see

Navigate to **Profiles** in the sidebar. The page shows a paginated grid of profile cards. Each card displays the profile name, an avatar glyph, role label, and tag badges. Action buttons on each card let you activate, edit, clone, or delete the profile.

## Creating a profile

Click **New Agent** to open the creation wizard. The wizard walks through 9 steps in order:

| Step | Label | What you configure |
|------|-------|--------------------|
| 1 | Identity | Name, glyph, role label, and tags |
| 2 | Persona | Pick a curated persona — its system prompt is snapshotted into the profile. Selecting a persona pre-fills later steps. |
| 3 | Model | Model name, provider, max turns, and reasoning effort |
| 4 | Skills | Additional shared skill directories beyond the profile's own `skills/` folder |
| 5 | MCP | MCP server entries (name, command, args, env) |
| 6 | Toolsets | Which built-in toolsets to enable — uses a subtractive model (all enabled by default; deselect to disable) |
| 7 | Memory | Enable or disable long-term memory and choose a provider (Hindsight or OpenViking) |
| 8 | Config | Read-only preview of the YAML config that will be written |
| 9 | Review | Final summary before creation |

Click **Next** to advance. Validation runs on each step; errors are shown inline and block advancement until resolved.

## Editing a profile

Click **Edit** on any profile card to open the wizard in edit mode. The wizard pre-seeds all fields from the profile's current saved configuration. The same 9 steps apply; only the name field is immutable (rename via the inline rename control on the card instead).

## Persona pre-fill

Step 2 shows a searchable, filterable library of curated personas organised by category. Selecting a persona:

- Snapshots the persona's system prompt into the profile's system prompt field.
- Pre-fills the glyph and role label if they are still empty.
- Seeds MCP server suggestions (best-effort, only when no servers have been added yet).
- Seeds the Toolsets step using a **subtractive model**: the persona's `suggested_toolsets` list declares which toolsets the agent needs; all other configurable toolsets are pre-marked as disabled. You can adjust this in step 6.

The system prompt is fully editable after pre-fill — the persona is a starting point, not a lock.

## Cloning a profile

Click **Clone** on a profile card to create a copy with an auto-generated name. The clone opens directly in edit mode so you can rename and adjust it before saving.

## Where data lives

Profiles are stored by the Hermes Agent and fetched from the gateway at page load. They are not stored in the browser. Changes made through the wizard are written back to the gateway immediately on submission.

## Common issues

**Profiles page is blank or shows an error.** The gateway must be running and the profiles endpoint must be available. Check the connection indicator on the Dashboard.

**A profile does not appear after creation.** If the gateway requires a restart to pick up new profile files, restart it and reload the page.

**Persona library is empty.** The persona seeder must have been run on the agent side. Check the gateway logs.

## Related

- [Skills](./skills.md) — skills the agent can invoke
- [MCP](./mcp.md) — external tool servers
- [Plugins — Personas](../plugins/personas.md) — the personas plugin that powers the library
