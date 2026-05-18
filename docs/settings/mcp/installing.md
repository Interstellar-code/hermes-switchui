---
title: MCP — installing servers
description: Install Model Context Protocol servers to give your agent access to external tools.
---

# MCP — installing servers

MCP servers provide tools, resources, and prompts that your agent can call during a conversation. Installing a server makes it available to the agent; connecting it (a separate step) activates it for use.

> [SCREENSHOT: MCP page with Hub tab open showing available server entries]

## Prerequisites

- The Hermes Agent gateway must be running.
- The gateway must report `mcp` or `mcpFallback` capability. If the MCP page shows a backend-unavailable state, your agent version may not support MCP, or the required endpoint is not reachable.

## Installing from the MCP Hub

1. Navigate to **MCP** in the sidebar.
2. Open the **Hub** view (if a separate tab or button is shown).
3. Search for a server by name or category.
4. Click a server entry to see its description, required configuration, and trust level.
5. Click **Install**. A confirmation dialog shows the server's identifier and any required environment variables or arguments.
6. Confirm the installation. The server is added to the agent's MCP server configuration.

After installation the server appears in the main server list. It is not connected automatically — see [Connecting MCP servers](./connecting.md).

## Installing manually

If a server is not in the Hub, you can add it directly to the agent's configuration file.

The agent's MCP server list is stored in `~/.hermes/config.yaml` under an `mcp_servers` key. A typical entry looks like:

```yaml
mcp_servers:
  my-server:
    command: npx
    args:
      - -y
      - my-mcp-package
    env:
      MY_API_KEY: "${MY_API_KEY}"
```

After editing the config file, restart the agent. The server will appear in the MCP page on the next load.

## Where server config lives

All MCP server definitions live in the agent configuration on the host machine at `~/.hermes/config.yaml`. The UI reads this file via the gateway API — it does not store MCP config in the browser.

## Common issues

**Hub shows no results.** The Hub search depends on the gateway being able to reach external sources. Confirm the gateway has network access and is running a version that supports hub search.

**Server does not appear after manual config edit.** Restart the agent after editing `~/.hermes/config.yaml`. The gateway caches the config at startup.

## Related

- [Connecting MCP servers](./connecting.md)
- [MCP overview](../mcp.md)
