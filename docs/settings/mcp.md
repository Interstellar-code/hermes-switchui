---
title: MCP
description: Connect and manage Model Context Protocol servers from the MCP page.
---

# MCP

Model Context Protocol (MCP) is a standard that lets an AI agent connect to external servers that provide tools, resources, and prompts. The MCP page in Hermes Switch UI shows which servers are installed and lets you manage their connection state.

<iframe
  src="/api/docs-asset?path=diagrams/mcp-server-lifecycle.html"
  width="100%"
  height="900"
  loading="lazy"
  style="border: 0; border-radius: 8px;"
></iframe>

> [SCREENSHOT: MCP page showing a list of server entries with status indicators]

## What you see

Navigate to **MCP** in the sidebar under the Knowledge group. The page lists all MCP servers known to the agent. Each server entry shows:

- The server name.
- A status indicator — **connected** (green) or disconnected/stopped.
- Metadata such as the server type and description.

If the gateway does not expose an MCP endpoint, the page shows a backend-unavailable state. MCP support is gated on the `mcp` capability reported by the gateway at startup.

## Server list

The list is populated from the agent's configuration. Servers defined in the agent config appear here automatically. Servers installed from the MCP Hub also appear after installation.

Click a server row to open the **detail drawer**.

## Detail drawer

The detail drawer shows:

- Server name and description.
- Current connection status.
- A **toggle** to connect or disconnect the server.
- Log output for the selected server (when available).

## Hub

The MCP page includes access to an MCP Hub where you can search for and install servers from external sources. See [Installing MCP servers](./mcp/installing.md) for the step-by-step process.

## Capability gating

The MCP page and its features require the gateway to report `mcp` or `mcpFallback` capability. A `mcpFallback` state means the agent does not yet expose full MCP runtime endpoints but the dashboard config exposes an `mcp_servers` map. In that state some actions may be limited.

## Related

- [Installing MCP servers](./mcp/installing.md)
- [Connecting MCP servers](./mcp/connecting.md)
- [Skills](./skills.md) — a different extension mechanism built into the agent
