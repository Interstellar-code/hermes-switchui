---
title: Sessions and history
description: Understand how chat sessions are created, stored, and resumed.
---

# Sessions and history

Every conversation you start is stored as a session. Sessions persist across page reloads and browser restarts because the Hermes Agent keeps the history server-side. You can have as many sessions as you like and switch between them freely.

<iframe
  src="/api/docs-asset?path=diagrams/session-lifecycle.html"
  width="100%"
  height="880"
  loading="lazy"
  style="border: 0; border-radius: 8px;"
></iframe>

> [SCREENSHOT: Sessions sidebar showing day groups "Today", "Yesterday", and "Earlier" with session cards]

## What you see

The left sidebar lists all your sessions grouped by recency:

- **Today** — sessions started or active today.
- **Yesterday** — sessions from the previous calendar day.
- **Earlier** — everything older.

Each group header shows a count badge and can be collapsed by clicking it. The collapsed state is remembered across page loads.

At the top of the sidebar is a search bar. Type to filter sessions by title, tool names, or message content. Clear the field to return to the full list.

## Starting a new session

Click the **+** button at the bottom of the sidebar, or type `/new` in the composer and press Enter. You can also navigate directly to `/chat/new` — the app creates a fresh session and redirects you to it.

New sessions are unnamed until the first exchange completes, at which point the agent auto-generates a title from the conversation.

## Switching sessions

Click any session card to open it. The current session is highlighted. Navigation does not interrupt an in-progress generation in another session — each session streams independently.

## Renaming a session

Right-click a session card (or click the three-dot menu) and choose **Rename**. Type the new title and press Enter or click Save. Renaming is available only for chat sessions, not for task or job entries in the feed.

## Pinning and starring

The context menu also exposes **Pin** and **Star** actions. Pinned sessions appear at the top of the sidebar above the day groups. Starred sessions are visually marked with a star badge — useful for work you want to find quickly.

## Deleting a session

Right-click a session card and choose **Delete**. Confirm the dialog. If you delete the currently active session the app navigates to a new session automatically. Delete is only available for chat sessions.

## Where session data is stored

Sessions are stored by the Hermes Agent in its local database. The Switch UI reads them via the gateway's sessions API. If you restart the agent your sessions remain intact. If you wipe the agent's data directory the history is permanently lost.

## Common issues

**Sessions list is empty after restart** — The agent may not be running. Check that the hermes-agent process is up (see [Agent won't connect](../troubleshooting/agent-connect.md)).

**Rename or delete not available** — Those actions only appear for `chat` source entries. Task, cron, and API entries from the unified feed cannot be renamed or deleted from the UI.

**Session search returns no results** — The search is client-side and works on the currently loaded list. If a very old session is not in the list, it may not have been fetched yet — scroll down to load more.

## Related

- [The composer](./composer.md)
- [Keyboard shortcuts](./shortcuts.md)
