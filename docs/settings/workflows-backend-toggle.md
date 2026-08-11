---
title: Workflows backend
description: The workflow engine is plugin-only — the native TypeScript engine and its backend toggle have been removed.
---

# Workflows backend

Earlier builds shipped two workflow engine backends (a native TypeScript DAG engine and the Hermes plugin engine) with a toggle in Settings. **The native engine has been removed, and with it the toggle.** All workflow execution is now handled by the Python workflow-engine plugin running inside the hermes-agent gateway (port 8642).

**Settings → Workflows → Workflows** (`/settings?section=workflows`) is now a read-only status section confirming the active engine and where definitions are stored. There is nothing to toggle.

## Where workflow definitions live

The plugin's SQLite database is the single source of truth. The bundled YAML files in `src/features/workflows/defaults/` are **factory seeds only** — they are written to the database once on first install and ignored on every subsequent run. Editing those YAML files does not change existing workflows; changes only take effect on a fresh plugin install.

See `docs/plans/workflow-db-single-source-of-truth.md` for the full design.

## Requirements

Workflows require the hermes-agent gateway to be running with the `workflow-engine` plugin enabled:

```bash
hermes plugins list
hermes plugins enable workflow-engine
hermes dashboard restart
```

## Migrating from the native backend

If you previously used the native backend, its definitions lived in a separate store (`~/.hermes/switchui/workflow-engine.db`) that the plugin does not read. Re-register those workflows in the plugin: re-upload the YAML on the Workflows page, or POST each definition to the workflows API.

## Troubleshooting

**Workflow API returns 502**

The hermes-agent gateway is not reachable. Check that `hermes-agent` is running on port 8642 and the `workflow-engine` plugin is enabled (commands above).

**A workflow I had before an update is missing**

It was probably registered in the removed native backend's store. Re-register it with the plugin — see the migration note above.

## Related

- [Preferences](./preferences.md) — the Settings screen, including the Workflows section
