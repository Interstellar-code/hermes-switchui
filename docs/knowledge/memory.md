---
title: Memory
description: View and manage the persistent memory your AI agent draws on across sessions.
---

# Memory

The Memory page gives you a browser for everything your Hermes agents remember between conversations. It is not a conversation interface — it is a direct view of the files the agents read and write on disk.

<iframe
  src="/api/docs-asset?path=diagrams/memory-tabs-architecture.html"
  width="100%"
  height="900"
  loading="lazy"
  style="border: 0; border-radius: 8px;"
></iframe>

> [SCREENSHOT: Memory page with Agent Memory tab active]

## What you see

The page has five tabs:

- **Agent Memory** — per-agent markdown files stored under `~/.hermes/profiles/<agent-id>/memory/`. Each built-in agent (Hermes Switch, Neo, Trinity, Morpheus) has its own memory space you can inspect and edit.
- **Wiki** — a shared knowledge base of markdown pages stored under `~/.hermes/` (rooted at `MEMORY.md`, `memory/`, and `memories/`). Any page in the wiki is readable by all agents.
- **Graph** — a visual adjacency graph of the knowledge base. Nodes are wiki pages and agent memory entries; edges show references between them.
- **Chat** — a retrieval-augmented chat that lets you ask questions grounded in the wiki corpus.
- **Settings** — wiki source configuration, graph rebuild, and cache controls.

The active tab persists in `localStorage` between visits so you land on the same tab you left.

## Agent Memory tab

The left pane lists agents. Selecting an agent shows its memory files in a file list on the right. Selecting a file displays its content.

**Editing a file:** Click the content area or the "Edit" button. The file opens in a plain-text editor. Click "Save" to write the changes to disk. The agent will see the updated content on its next turn.

**Adding a file:** Click "Add First File" (when the list is empty) or the "+" button. Enter a filename and content, then save.

**Deleting a file:** Select the file in the list, then click the delete icon. A confirmation dialog appears before the file is removed. Deletion is permanent.

**Double-clicking a file** opens a detail drawer with file metadata and a full-screen editor.

## Wiki tab

The Wiki tab shows a filterable list of all markdown pages in the shared knowledge base. Select a page to read it rendered as HTML. Click "Edit" to switch to the raw markdown editor. You can also create new pages (enter a relative path such as `engineering/react-patterns.md`) and delete existing ones.

Use the search box at the top of the list to filter pages by title or path.

## Graph tab

The Graph tab renders the wiki as an SVG adjacency graph. Hover a node to see its full title, type, and connection count. Click a node to focus it and see its neighbors in a side panel. Use the legend to isolate or mute categories. Toggle between **1-hop**, **2-hop**, and **all** to control how much of the graph is shown around the selected node.

If the gateway has not exposed `/api/knowledge/graph` yet, the tab falls back to a flat node and edge list.

## Chat tab

The Chat tab gives you a chat that answers questions using your wiki as grounding. When you send a message, the app searches the wiki for the top five matching pages (`/api/knowledge/search`), trims each page to 4 kB, caps the total context at 32 kB, and streams the response from the gateway.

Cited pages appear under each assistant message so you can click through to the source. If the gateway is offline, the send button shows a clear "Backend offline" error rather than failing silently.

## Settings tab

The Settings tab covers four operational concerns for the knowledge base:

1. **Wiki source** — switch between a local filesystem wiki and a GitHub-backed wiki. Settings are read and written through `/api/knowledge/config`.
2. **Knowledge graph rebuild** — force a rebuild of the graph index by calling `/api/knowledge/graph?action=rebuild`.
3. **Cache controls** — clear cached knowledge entries through `/api/knowledge/sync?action=clear`.
4. **Provider config** — a notice that per-agent memory providers are managed inside each agent's Profile wizard (step 6), not here.

## Where the data lives

| Store | Path |
|---|---|
| Agent memory files | `~/.hermes/profiles/<agent-id>/memory/*.md` |
| Shared wiki pages | `~/.hermes/MEMORY.md`, `~/.hermes/memory/`, `~/.hermes/memories/` |

Changes you make in the UI are written directly to these paths. You can also edit the files with any text editor and reload the page to see the updates.

## Common issues

**"No memory files yet" for an agent** — The agent has not written anything yet, or the profile directory does not exist. Use "Add First File" to create the first file manually.

**Changes not reflected in chat** — Memory files are read at the start of each turn. If an agent is mid-conversation, your changes will take effect on the next message, not retroactively.

**Wiki page shows a blank preview** — The file exists but is empty. Click "Edit" to add content.

## Related

- [Agent connect troubleshooting](../troubleshooting/agent-connect.md)
- [Crash recovery](../troubleshooting/crash-recovery.md)
