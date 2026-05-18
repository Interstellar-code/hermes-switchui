---
title: MCP — connecting servers
description: Connect a running MCP server so your agent can use its tools and resources.
---

# MCP — connecting servers

Installing an MCP server adds it to the agent's configuration.

<iframe
  src="/api/docs-asset?path=diagrams/mcp-handshake-sequence.html"
  width="100%"
  height="900"
  loading="lazy"
  style="border: 0; border-radius: 8px;"
></iframe>

Connecting it starts the server process and makes its tools available to the agent during conversations.

> [SCREENSHOT: MCP detail drawer showing server name, status indicator, and toggle button]

## What you see

Each server in the MCP list shows a status indicator:

- **Connected** — the server process is running and the agent has established a session with it.
- **Disconnected / stopped** — the server is configured but not currently active.

Click a server row to open the detail drawer. The drawer shows the server's name, description, current status, and a connect/disconnect toggle.

## How to connect a server

1. Navigate to **MCP** in the sidebar.
2. Click the server you want to connect.
3. In the detail drawer, click the toggle to connect the server.
4. The status indicator updates to **Connected** when the handshake succeeds.

If the server requires credentials (API keys or tokens), those must be present in the environment before the server starts. See below.

## Providing credentials

MCP servers that call external APIs typically require an API key or token. The recommended approach is to add the key to the agent's environment file:

```
~/.hermes/.env
```

Add a line in the form:

```
MY_SERVICE_API_KEY=your-key-here
```

The server's config entry in `~/.hermes/config.yaml` references this variable with `${MY_SERVICE_API_KEY}`. Restart the agent after changing `.env` so the new value is loaded into the server's environment.

## Verifying the connection

After connecting a server, open the detail drawer and check:

- The status reads **Connected**.
- The log output (if shown) does not contain error messages.

You can also start a new chat session and ask the agent to list available tools — the connected server's tools should appear.

## Disconnecting a server

Click the toggle in the detail drawer to disconnect. The server process is stopped. The server remains in the config and can be reconnected at any time.

## Common issues

**Server status stays disconnected after toggling.** Check the log output in the detail drawer for error messages. Common causes: missing environment variable, wrong command path, or a network error reaching the external service.

**Credentials not picked up.** Confirm the variable is present in `~/.hermes/.env` and that the agent was restarted after the file was edited. The `.env` file is loaded at agent startup, not dynamically.

**Server disconnects immediately.** The server process may be crashing on startup. Review the server's own documentation for required arguments or dependencies.

## Related

- [Installing MCP servers](./installing.md)
- [MCP overview](../mcp.md)
- [API keys](../providers/api-keys.md) — managing keys for provider connections
