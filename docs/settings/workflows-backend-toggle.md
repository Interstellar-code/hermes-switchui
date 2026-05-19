# Workflows backend toggle

Switch UI ships two workflow engine backends. You can switch between them in **Settings → Workflows → Backend**.

## Backends

### native (default)

The TypeScript DAG engine embedded directly in the Switch UI server (`src/server/workflow-engine/`). Requires no external services beyond the Switch UI process itself.

- Workflow definitions stored in `~/.hermes/switchui/workflow-engine.db`
- Runs in-process alongside the Switch UI server
- Available even when hermes-agent is not running

### plugin

Proxies all workflow API calls to the Python workflow-engine plugin running inside the hermes-agent gateway (port 8642).

- Workflow definitions stored in a separate plugin SQLite DB
- Requires hermes-agent running with the `workflow-engine` plugin enabled
- Enables cron-triggered runs and Kanban dispatcher integration

## How to toggle

1. Open **Settings** (gear icon, top-right)
2. Select the **Workflows** tab
3. Under **Backend**, choose `native` or `plugin`
4. The setting takes effect immediately — no restart required

The choice is saved in `localStorage` and sent as a `?backend=` query parameter on all workflow API calls.

## Differences between backends

| Feature | native | plugin |
|---------|--------|--------|
| Requires hermes-agent | No | Yes |
| Cron-triggered runs | No | Yes |
| Kanban dispatcher | No | Yes |
| SSE event stream | Yes | Yes |
| Approval gates | Yes | Yes |
| YAML definition store | SQLite (switchui) | SQLite (plugin) |

Definitions are **not shared** between backends. If you switch backends, you will need to re-register your workflows in the target backend's store. The parity suite (`scripts/parity-suite.sh`) can verify that both backends produce identical results for the same workflows.

## Troubleshooting

**"Workflow not found" after switching backends**

The two backends maintain separate definition stores. Use the Workflows page to re-upload your YAML, or copy definitions via the API:

```bash
# Export from native
curl http://localhost:3000/api/workflows/definitions?backend=native > defs.json

# Re-register in plugin (for each definition)
curl -X POST http://localhost:3000/api/workflows/definitions?backend=plugin \
  -H 'Content-Type: application/json' \
  -d @defs.json
```

**Plugin backend returns 502**

The hermes-agent gateway is not reachable. Check that `hermes-agent` is running on port 8642 and the `workflow-engine` plugin is enabled:

```bash
hermes plugins list
hermes plugins enable workflow-engine
hermes dashboard restart
```

**Cron runs not firing on native backend**

The native backend does not include a cron poller. Switch to the plugin backend to use cron-triggered workflows.
