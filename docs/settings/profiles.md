---
title: Profiles
description: Create and manage agent profiles with the 9-step wizard — persona, model, skills, toolsets, and more.
---

# Profiles

The Profiles page lets you browse, create, and edit agent profiles. Each profile is a named configuration that controls the agent's identity, system prompt, model, enabled tools, MCP servers, and memory settings.

> [SCREENSHOT: Profiles page showing a grid of profile cards with name, glyph, and action buttons]

## What you see

Navigate to **Profiles** in the sidebar. The page shows a paginated grid of profile cards, with a view toggle to switch to a table (list) layout instead. Each card displays the profile name, an avatar glyph, role label, and tag badges. Action buttons on each card let you activate, edit, clone, or delete the profile. Table view carries the same actions plus **Rename** — the grid cards have no Rename button.

A card or row can also show a small **not served** or **unknown** badge next to its status. That's the live gateway's reachability, not this workspace's — see [Live-gateway reachability](#live-gateway-reachability) under Activating a profile. It only appears when something is actionable, so a typical single-gateway setup never shows it.

## Filtering and shareable links

Search, tier, status, model, and tag filters — plus the current page — live in the URL (`?q=`, `?tier=`, `?status=`, `?model=`, `?tag=`, `?page=`), not in local component state only. Copying the address bar or bookmarking a filtered view reproduces the same list for anyone who opens it, and defaults are never written to the URL, so a plain `/profiles` with nothing applied stays exactly that.

The wizard has its own deep link: `?edit=<profile-name>&step=<1-9>` opens straight into edit mode for that profile at the given step. An unrecognised or out-of-range step number clamps to the nearest valid step instead of failing.

View mode (grid vs. table) and page size are **not** part of the URL — they're per-browser preferences stored locally, so sharing a link never changes what view the recipient sees.

## Creating a profile

Click **New Agent** to open the creation wizard. The wizard walks through 9 steps in order:

| Step | Label | What you configure |
|------|-------|--------------------|
| 1 | Identity | Name, glyph, role label, optional longer description, and tags |
| 2 | Persona | Pick a curated persona — its system prompt is snapshotted into the profile. Selecting a persona pre-fills later steps. |
| 3 | Model | Model name, provider, max turns, and reasoning effort |
| 4 | Skills | Additional shared skill directories beyond the profile's own `skills/` folder |
| 5 | MCP | MCP server entries (name, command, args, env) |
| 6 | Toolsets | Which built-in toolsets to enable — uses a subtractive model (all enabled by default; deselect to disable) |
| 7 | Memory | Enable or disable long-term memory and choose a provider from the full catalog (Matrix Memory and Holographic run locally with no setup; Hindsight, Mem0, OpenViking, RetainDB, Supermemory, Honcho, and ByteRover each need a key, service, sign-in, or CLI) |
| 8 | Config | Preview of the YAML config that will be written. In edit mode this is a before/after diff against the profile's currently saved config, not just a flat preview. |
| 9 | Review | Final summary before creation, including a Toolsets block that calls out any destructive toolset (terminal, file, code execution, computer use, browser) still enabled |

Click **Next** to advance. Validation runs on each step; errors are shown inline and block advancement until resolved.

## Editing a profile

Click **Edit** on any profile card or table row to open the wizard in edit mode. The wizard pre-seeds all fields from the profile's current saved configuration. The same 9 steps apply; only the name field is immutable. Renaming is a separate action available only in **table view** — switch the view toggle to table to reach it.

## Profile details

Click a profile card (outside its action buttons) to open its detail drawer. The drawer has three tabs — **Overview** (identity, model/provider, derived status, skill/session counts, on-disk path), **Config** (read-only `config.yaml` with secrets masked), and **Files** (`SOUL.md` and the memory files the agent has written). From the drawer you can activate, edit, clone, export, or delete the profile without going back to the grid.

## Activating a profile

Each profile card, table row, and the detail drawer has an **Activate** action for any profile that isn't already active. Activating writes `~/.hermes/active_profile` and returns `needsGatewayRestart: true` — the gateway does not hot-reload its config, so a banner appears at the top of the page. Its button reads **Restart gateway** when the gateway is currently up, or **Start gateway** when it looks stopped; either way the banner polls afterward and reports success or a timeout, and always offers a `hermes gateway restart` command you can copy and run by hand.

The **Use default profile** header button is the reverse shortcut: it re-activates the synthetic `default` profile in one click (disabled when `default` is already active) and raises the same restart banner.

### Live-gateway reachability — Selected vs. Serving

Two separate facts get conflated if you only look at the "in use" status dot: **Selected** is this workspace's own opinion — which profile `~/.hermes/active_profile` names, shown by the dot. **Serving** is what the live gateway process is actually doing right now, independent of that pointer. Activating a profile changes Selected immediately; it does not, by itself, guarantee the running gateway is Serving it. A card or row shows a small badge next to its status whenever those two facts might disagree:

- **not served** — one of two situations, distinguished by hovering the badge: on a **multiplexing** gateway, this profile isn't in the list the gateway reports serving, so activating it will not make chats work until the gateway's own config is updated to include it; on a **single** (non-multiplexed) gateway, the running process is serving a *different* profile than the one this workspace has Selected — restarting the gateway (or reconciling which profile it's already running) is what closes the gap, not re-clicking Activate.
- **unknown** — the reachability probe itself failed (the dashboard was unreachable, or a single-mode gateway didn't report which profile it's serving), so this can't be confirmed either way; treat it the same as "not served" until it clears.

The badge is quiet by design — it appears only when Selected and Serving might not agree, never as a status shown for every profile, and it never appears for the profile the live gateway confirms it's actually serving.

## Persona pre-fill

Step 2 shows a searchable, filterable library of curated personas organised by category. Selecting a persona:

- Snapshots the persona's system prompt into the profile's system prompt field.
- Pre-fills the glyph and role label if they are still empty.
- Seeds MCP server suggestions (best-effort, only when no servers have been added yet).
- Seeds the Toolsets step using a **subtractive model**: the persona's `suggested_toolsets` list declares which toolsets the agent needs; all other configurable toolsets are pre-marked as disabled. You can adjust this in step 6.

The system prompt is fully editable after pre-fill — the persona is a starting point, not a lock.

## Cloning a profile

Click **Clone** on a profile card to open a small dialog prompting for the new profile's name (pre-filled as `<source>-copy`, editable, checked for uniqueness). Confirming creates the copy and opens it directly in the wizard's edit mode so you can adjust it before saving.

A clone inherits the source's authored assets — `config.yaml` (with `agent_ui` normalized so the clone isn't marked as a factory-shipped agent), `SOUL.md`, and the `skills/` directory — but deliberately **not** its run history or credentials: `sessions/`, `memories/`, `memory/`, and `.env` are never copied. The clone starts with a clean history and needs its own API key if the source had one stored.

## Exporting and importing profiles

**Export**, in the detail drawer's action bar, downloads a profile as a `<name>.hermes-profile.json` bundle: `config.yaml` (secrets masked), `SOUL.md`, `MEMORY.md`, `IDENTITY.md`, and the `skills/` directory. The action bar states this up front, before you click — masking is best-effort pattern matching, so treat the file as *masked*, not guaranteed secret-free. Your `.env` file and session history are never included.

**Import**, a header button on the Profiles page, accepts a `.hermes-profile.json` file and creates a new profile from it. If the bundle's name collides with an existing profile, a prompt lets you choose a different name and resubmit rather than failing outright.

## Recently Deleted

Deleting a profile is recoverable, not permanent. **Delete** moves the profile's directory into `~/.hermes/trash/<name>-<timestamp>` rather than removing it from disk. A **Recently Deleted** view (reachable from the Profiles page) lists everything currently in the trash — name, deletion time, and size — with per-entry **Restore** (moves it back to `~/.hermes/profiles/<name>`, failing if a profile with that name already exists again) and **Delete permanently** (irreversible) actions.

## Default profile on a fresh install

A fresh install now bootstraps `~/.hermes/active_profile` to the `hermes-switch` builtin agent rather than the synthetic `default`. Set `HERMES_DEFAULT_PROFILE` to a different builtin id before first run to adopt something else instead.

## Seeded profiles and the working directory

Profile configs do not inherit from the root `config.yaml` — each is a fully independent file, and the gateway never merges them. Left alone, that means a newly created profile has no `terminal:` block at all and the agent falls back to running in `$HOME` the moment you switch to it, even if the root config has an absolute `terminal.cwd` set. To close part of that gap, **the first time a builtin profile is seeded**, its `config.yaml` copies the root's `terminal:` block verbatim, if one exists. This is a one-time snapshot taken only at seed time, not real inheritance — a later change to the root's `terminal:` block does not propagate to a profile that already exists, and a profile created before this behavior shipped, or a profile with no root `terminal:` block to copy at the time it was seeded, still starts out with none. See [Working directory](./working-directory.md) for the full mechanism and how to set it per profile.

## Where data lives

Profiles are plain directories under `~/.hermes/profiles/<name>/` (each holding its own `config.yaml`, `SOUL.md`, `skills/`, `sessions/`, etc.), read directly from the local filesystem — the workspace server reads them itself, and creating, editing, cloning, exporting, and deleting a profile never calls the gateway. They are not stored in the browser. Changes made through the wizard are written straight to those files on submission.

The one exception is the [live-gateway reachability](#live-gateway-reachability) badge, which does ask the gateway's dashboard what it's actually serving — that's the whole point of it, and it fails closed to "unknown" rather than guessing when the dashboard doesn't answer.

## Common issues

**Profiles page is blank or shows an error.** The workspace reads `~/.hermes/profiles/` directly, so this usually means the directory is missing or unreadable rather than a gateway problem — check the workspace server logs.

**A profile switch doesn't seem to take effect.** Activating a profile needs a gateway restart to pick up the new config — use the restart banner that appears after activating (it offers Restart or Start depending on whether the gateway currently looks up or down), or restart the gateway manually and reload the page.

**A card or row shows "not served" or "unknown".** See [Live-gateway reachability](#live-gateway-reachability) above — this means the multiplexed gateway isn't currently serving that profile, or its topology probe failed, independent of whether you've clicked Activate.

**Persona library is empty.** The persona seeder must have been run on the agent side. Check the gateway logs.

## Related

- [Skills](./skills.md) — skills the agent can invoke
- [MCP](./mcp.md) — external tool servers
- [Plugins — Personas](../plugins/personas.md) — the personas plugin that powers the library
- [Working directory](./working-directory.md) — what a profile's `terminal:` block controls, and what happens when it's missing
- [Gateway](./gateway.md) — multiplexing, and what "Serving" means when it's on
- [API keys](./providers/api-keys.md) — per-profile credential scoping under multiplexing
