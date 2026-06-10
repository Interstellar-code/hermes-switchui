---
title: Lazy Load MCP
description: Defer MCP tool schema loading until the model actually needs them, cutting per-turn token overhead by up to 64% when many MCP servers are configured.
---

# Lazy Load MCP

When you configure many MCP servers, Hermes Agent injects the full parameter schema for every registered tool into every API request — before the model types a single word. A typical deployment with ten MCP servers (~300 tools) can burn around 68,000 tokens per turn on tool schemas alone. On providers with smaller context windows (Cerebras, Groq), that overhead can prevent requests from fitting at all.

The Lazy Load MCP plugin solves this by replacing each MCP tool's full schema with a lightweight stub (~80 tokens: name, a short description, and an internal marker). The model sees stubs for all MCP tools and calls a built-in meta-tool — `load_mcp_tools` — to promote specific tools to their full schemas when it decides it needs them. Promoted tools remain full for the rest of the session.

Lazy Load MCP is a Hermes Agent plugin shipped as part of the Hermes Switch UI package. It changes **how** MCP tools are exposed to the model; the [MCP settings page](../settings/mcp.md) still manages which servers are configured.

> [SCREENSHOT: Token usage comparison — eager mode vs lazy mode in the session sidebar]

## How it works

On every API request, the plugin intercepts the tool list before it reaches the model:

- Tools from built-in Hermes capabilities are passed through unchanged.
- MCP tools are replaced with stubs, except for any tools you have already promoted in the current session.

When the model wants to call an MCP tool it hasn't seen fully yet, it calls `load_mcp_tools` with a list of tool names. On the **next turn**, those tools appear with their full parameter schemas and the model proceeds normally. If the model accidentally calls a stub directly without promoting it first, the plugin intercepts the call, promotes that tool automatically, and asks the model to retry — so you never see a schema-validation error.

Promoted tools are **per-session**. Starting a new session (or issuing `/reset`) resets the promotion state, and stubs are restored.

## Discovery modes

The plugin supports two discovery modes, set via `mcp.discovery_mode` in your `config.yaml`:

**Tool mode** (default) — one stub per MCP tool. The model calls `load_mcp_tools(tool_names: [...])` to promote individual tools by name. Good for targeted workflows where you know roughly which tools you need.

**Server mode** — one stub per MCP *server* (~800–1,500 tokens total for a ten-server deployment, versus ~24,000 in tool mode). The model calls `load_mcp_server(server_names: [...])` to expand a server and see its per-tool stubs, then promotes specific tools from there. Use this when you have many servers but only reach a subset per session.

**Both mode** — registers both meta-tools so the model can navigate at either granularity.

## Token savings at a glance

| Mode | Approximate tokens / turn (300 tools) |
|---|---|
| Eager (no plugin) | ~68,000 |
| Lazy — tool mode | ~24,000 |
| Lazy — server mode | ~800–1,500 |

These are estimates; actual numbers depend on your tokenizer and the length of tool descriptions.

## Enabling the plugin

1. Enable the plugin from the Hermes gateway CLI:

   ```bash
   hermes plugins enable mcp_lazy
   ```

2. Add the following to your `~/.hermes/config.yaml`:

   ```yaml
   mcp:
     lazy_loading: true
     discovery_mode: tool   # or: server, both
   ```

3. Restart the gateway:

   ```bash
   hermes gateway restart
   ```

Once enabled, you should see `load_mcp_tools` appear in the model's tool list at the start of each session.

## Per-server overrides

You can exempt individual servers from lazy loading — useful for a small, always-needed server you never want to promote manually:

```yaml
mcp_servers:
  gmail:
    lazy: false        # always load full schemas for this server
    command: npx
    args: [-y, '@gmail/mcp-server']
  trek:
    command: npx
    args: [-y, '@trek/mcp-server']   # inherits master lazy_loading setting
```

## Disabling

Set `lazy_loading: false` in `config.yaml` and restart the gateway. The plugin remains loaded but passes all tools through unchanged. To remove the plugin entirely (including its background instrumentation):

```bash
hermes plugins disable mcp_lazy
```

## Troubleshooting

**The model is promoting tools it never ends up calling.** This is normal during exploration-heavy turns. The promotion stays for the session, so subsequent calls to the same tool are free. If a model promotes aggressively every turn, consider switching to `server` mode to reduce the number of visible stubs.

**I see `[mcp_lazy] Tool ... was a stub — full schema promoted. Reissue the call on the next turn` in the response.** This means the model tried to call a stub directly. The plugin promoted the tool automatically; just continue the conversation and the model will retry on the next turn.

**Checking promotion activity in logs:**

```bash
grep -E "load_mcp_tools|load_mcp_server|mcp_lazy" \
     ~/.hermes/profiles/<profile>/logs/agent.log | tail -20
```

## Related

- [Plugins overview](./overview.md)
- [A2A Fleet](./a2a-fleet.md)
- [Workflow Engine](./workflow-engine.md)
- [Matrix Coder](./matrix-coder.md)
- [MCP](../settings/mcp.md)
