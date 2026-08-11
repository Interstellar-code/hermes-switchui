---
title: Preferences
description: The Settings screen — 28 sections, three save tiers, real search, and a browser over every gateway config field.
---

# Preferences

Settings in Hermes Switch UI live in two places, deliberately:

- **The Settings screen** at `/settings` — the full surface described on this page. Open it from the sidebar (gear icon).
- **The settings dialog** — the gear in the chat sidebar opens a compact dialog for quick access from chat: Model & Provider, Agent, Smart Routing, Voice, Display, Theme, Chat, Alerts, and Language. Its gateway-backed controls write through the same live path as the Settings screen, so changes take effect without restarting the gateway. Its footer links to the full screen ("All settings →").

![Settings dialog on the Model & Provider tab](/screenshots/settings.png)

> The screenshot above shows the settings **dialog**. There is currently no screenshot of the full `/settings` screen.
> [SCREENSHOT: /settings screen, sidebar tree on the left, section content and save bar on the right]

## Sections and deep links

The left sidebar groups 28 sections. The active section lives in the URL as `?section=<id>` — `/settings?section=safety` opens Safety directly, the back button moves between sections, and sections can be bookmarked or linked from anywhere in the app. A bare `/settings` opens **Workspace**; an unknown or stale section id falls back there rather than rendering an empty panel.

| Group | Sections |
|---|---|
| General | Workspace · Account · Appearance · Notifications |
| Models | Provider · Model Registry |
| Agent | Runtime · Execution · Gateway |
| Memory | Memory & Wiki |
| Skills | Skills |
| Workflows | Workflows |
| MCP | Servers · Registered · Hermes Plugin |
| System | Storage · Privacy · Safety · Telemetry · API Keys · Network · Performance · Updates |
| Shortcuts | Shortcuts |
| Advanced | All settings · Advanced · Raw config |
| Danger | Danger Zone |

The sidebar search matches setting **names, descriptions, and dotted key paths** — not just section titles. Searching "docker", "tirith", "retention", or "port" finds the actual settings and jumps to the section that owns them.

## How saving works — three tiers

Not everything on this page saves the same way, and the UI says which tier applies rather than pretending otherwise.

**1. Draft settings and the save bar.** Most controls edit a draft. Edits accumulate across sections — you can change something in Safety, browse to Appearance, and come back; the edit survives and the section shows a dirty dot in the sidebar. The save bar at the bottom shows the unsaved count and applies everything with **Save changes**, which writes the changed keys to the gateway (`PUT /api/config`, deep-merged into `~/.hermes/config.yaml`). A setting is marked saved **only when the gateway confirms it**: a failed save shows a visible error and leaves the affected rows dirty, and a partial success reports exactly how many keys saved and how many failed. The bar also offers **Discard all**, **Import**/**Export** (JSON — imported keys land as unsaved drafts, so you review and Save them), and **Refresh** (reload from disk; asks before discarding unsaved drafts). Leaving the page with unsaved changes triggers a browser warning.

**2. Self-saving cards, labelled "Saves immediately".** Some cards write the gateway (or the browser) the instant you interact with them and are not covered by the save bar: the theme picker, the provider and default-model pickers, API keys and OAuth, the Hindsight and Wiki cards in Memory & Wiki, Updates, and the Danger Zone actions. When you are viewing a section like this, the save bar's idle text says so ("This section saves its own changes") instead of claiming "Saved" for things it never touched.

**3. Raw config.** The Raw config section edits `~/.hermes/config.yaml` as a whole file, with its own Save, Discard, Upload, and Download — independent of the save bar's per-key drafts.

## Settings sections

### Workspace

Read-only: timezone and locale as detected from the browser. There is no per-workspace identity to configure in this build.

### Account

Read-only. Hermes Switch UI has no multi-user account system — sessions are local to the browser profile.

### Appearance

Visual theme picker only — five base palettes, applied and saved the instant you click (it never uses the save bar). See [Themes](./themes.md).

### Notifications

Read-only. There are no separate desktop/sound/email notification channels — alerts surface as inline toasts and in the approvals queue.

### Provider

Active provider and default model — these two save immediately via the models API. Shows the current model's capabilities (context window, tool use, vision, reasoning) and an **Open Providers →** link to the full `/settings/providers` screen. The fallback model (`fallback_model`) is a draft setting saved by the save bar. See [Built-in providers](./providers/built-in.md).

### Model Registry

Read-only summary of the model catalogue: total models and providers, the current main model, and the top three models by 30-day token usage. Full model management is at `/settings/providers`.

### Runtime

Agent runtime limits under `agent.*`: max turns, gateway timeout, API max retries, service tier, and tool-use enforcement (auto / required / none).

### Execution

Where and how the agent runs shell commands and code: terminal backend (Local or Docker — other backends stay in raw config), command timeout, persistent shell, code-execution mode, and an advanced Docker card (image, volumes, host-cwd mounting, network, CPU/memory/disk limits). Also shows the agent's resolved working directory read-only. See [Execution](./execution.md) and [Working directory](./working-directory.md).

### Gateway

Profile multiplexing (`gateway.multiplex_profiles`, restart required — a live-topology row shows what the running gateway is actually doing) and the API server's host and port, validated before you can save a typo. See [Gateway](./gateway.md).

### Memory & Wiki

Memory provider and limits under `memory.*` as draft settings, plus two self-saving cards: Hindsight credentials (environment variables, shown when the provider is Hindsight) and the Wiki source configuration.

### Skills

Summary of installed skills plus draft config: external skill directories, template variables, inline shell and its timeout. Full skill management is at `/skills` — see [Skills](./skills.md).

### Workflows

Read-only status. The native TypeScript workflow engine has been removed; all workflow execution is handled by the hermes-agent workflow-engine plugin, with definitions stored in the plugin's SQLite database. See [Workflows backend](./workflows-backend-toggle.md).

### Servers / Registered (MCP)

**Servers** is a read-only summary of mounted toolsets with a link to the MCP page. **Registered** summarises installed dashboard plugins with a Rescan action; install/enable/disable happens on the Plugins page. See [MCP](./mcp.md).

### Hermes Plugin

Live status of the Hermes plugin connection: active/stale/inactive heartbeat, compatibility banner, connection details (ports, active profile, enabled plugins), and the settings the plugin reports.

### Storage

A 30-day usage summary (sessions, tokens, API calls, estimated cost) and session-database pruning: auto-prune, retention days, and VACUUM after prune.

### Privacy

PII redaction, secret scrubbing in logs, and whether web tools may reach private/internal URLs (off by default).

### Safety

One page for everything that decides whether the agent can destroy something unattended: a combined-posture banner, approval mode, cron approval mode, destructive-slash and MCP-reload confirmations, auto-accept for shell hooks, the Tirith pre-execution scanner, and the permanent command allowlist with per-entry descriptions and one-click revoke. See [Safety](./safety.md).

### Telemetry

File logging under `logging.*`: minimum level (DEBUG/INFO/WARNING), rotation size, and backup count.

### API Keys

Environment credentials from `~/.hermes/.env` and OAuth connections — saves immediately. Each key shows an origin chip and warns when a config-file or credential-pool entry shadows it, rather than a bare set/missing boolean. See [API keys](./providers/api-keys.md).

### Network

Force IPv4 (skip AAAA lookups on broken IPv6 stacks) plus a live gateway-daemon status row.

### Performance

Read-only live snapshot of the hermes-agent gateway process (running/stopped, PID, and CPU/RSS when the gateway reports them).

### Updates

Update status for the workspace and agent, with an apply button per product — saves immediately (each update is confirmed before it runs).

### Shortcuts

Read-only reference of the global shortcuts wired up in the app (open search, quick open file, toggle sidebar, toggle chat panel, activity log, toggle terminal, and the `?` shortcuts modal). Not currently rebindable.

### All settings

A generated browser over **every** configuration field the gateway publishes — 555 fields from `GET /api/config/schema`, grouped by category, searchable, each row showing its dotted key path (the only reliable identifier, since schema descriptions are auto-generated). Rows a curated section already covers are marked rather than silently duplicated. It exists so nothing is reachable only by editing raw YAML; the curated sections above still cover the settings worth explaining properly. Edits here are ordinary drafts saved by the save bar.

### Advanced

Log level and a diagnostics button that fetches recent gateway log entries.

### Raw config

Direct editor for `~/.hermes/config.yaml` with its own Save, Discard, Upload, and Download — the whole-file tier described above.

### Danger Zone

Destructive operations behind confirmation dialogs: reset settings (clears `hermes.*` browser storage and restarts the gateway), restart the gateway, and clear-caches / delete-workspace actions that report plainly when the gateway does not support them.

## Where data lives

Gateway-backed settings are written live to `~/.hermes/config.yaml` through the gateway's config API and apply across all clients — with two flagged exceptions (profile multiplexing and the API server host/port) that the gateway only reads at process start, so those need a restart. The theme is browser-local (`localStorage` key `claude-theme`), as are the settings dialog's display preferences (chat display, loader style, and similar).

## Common issues

**A save failed.** That is the save bar working as designed: the error is shown and the rows stay dirty so nothing is silently lost. Check that the gateway is running (Performance or Network section shows live status), then Save again.

**A setting saved but nothing changed.** A few settings are read once at gateway startup — the Gateway section marks them "restart required" and shows the live state next to the saved one.

**I can't find a setting in any curated section.** Search for it by name or key path, or open **All settings** — every field the gateway publishes is editable there.

**Changes don't persist after reload.** For the theme and dialog display preferences, browser storage may be restricted — ensure `localStorage` is allowed for this origin. Gateway-backed settings do not depend on browser storage.

## Related

- [Themes](./themes.md) — theme picker detail
- [Execution](./execution.md) · [Gateway](./gateway.md) · [Safety](./safety.md) — the deep-dive section pages
- [Working directory](./working-directory.md)
- [Built-in providers](./providers/built-in.md)
- [API keys](./providers/api-keys.md)
