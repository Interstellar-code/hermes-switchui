---
title: Memory
description: View and manage the persistent memory your AI agent draws on across sessions.
---

# Memory

The Memory page gives you a browser for everything your Hermes agents remember between conversations. It is not a conversation interface — it is a direct view of the files the agents read and write on disk.

> [SCREENSHOT: Memory page with Agent Memory tab active]

## What you see

The page has two tabs:

- **Agent Memory** — per-agent markdown files stored under `~/.hermes/profiles/<agent-id>/memory/`. Each built-in agent (Hermes Switch, Neo, Trinity, Morpheus) has its own memory space you can inspect and edit.
- **Wiki** — a shared knowledge base of markdown pages stored under `~/.hermes/` (rooted at `MEMORY.md`, `memory/`, and `memories/`). Any page in the wiki is readable by all agents.

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
