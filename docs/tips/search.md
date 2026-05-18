---
title: Search
description: Search across sessions, files, and memory using the global search feature.
---

# Search

The global search modal lets you find chat sessions, files, agents, skills, and quick actions from a single input.

> [SCREENSHOT: Search modal open with results]

## Opening search

Press `Cmd+K` (macOS) or `Ctrl+K` (Windows / Linux) from anywhere in the app. The same shortcut closes the modal.

## What is searchable

Results are grouped into scopes. Use the tab bar at the top of the modal to filter by scope:

| Scope | What it searches |
|---|---|
| All | Everything below, combined |
| Chats | Chat session titles and previews |
| Files | Files visible in the file explorer |
| Agents | Built-in agents (Hermes Switch, Neo, Trinity, Morpheus) |
| Skills | Installed and available skills |
| Actions | Quick actions (New Chat, Settings, Memory, Files, MCP, Usage) |

Type to filter within the active scope. Results update as you type with a short debounce.

## Navigating results

- Use `Arrow Up` / `Arrow Down` to move between results.
- Press `Enter` to open the selected result.
- Press `Escape` to close the modal without navigating.

## Quick actions

When the query is empty, the modal shows a row of quick actions — shortcuts to common destinations like New Chat, Settings, Memory, and Files. These are always available regardless of scope.

## Recent searches

The modal remembers your last six searches in `localStorage`. They appear below the input when the query is empty. Click a recent search to restore it, or clear the list with the "Clear" link.

## Related

- [Keyboard reference](./shortcuts.md)
- [Composer tricks](./composer-tricks.md)
