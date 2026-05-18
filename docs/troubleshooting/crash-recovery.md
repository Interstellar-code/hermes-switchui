---
title: Recovering after a crash
description: Steps to restore your sessions and data after an unexpected application crash.
---

# Recovering after a crash

<iframe
  src="/api/docs-asset?path=diagrams/crash-recovery-flow.html"
  width="100%"
  height="900"
  loading="lazy"
  style="border: 0; border-radius: 8px;"
></iframe>

A crash of the UI process (the Node server or the browser tab) does not destroy your data. Chat history lives in the agent's database, and UI state is persisted to disk. This page explains where everything is and how to recover it.

## 1. Chat history is missing after a restart

**Cause — Sessions are stored in the agent, not the UI.** The UI is stateless with respect to message history. All messages are persisted in the agent's SQLite databases under `~/.hermes/`.

**Fix:** Restart the agent if it is not running, then reload the page. Sessions and their message history will reappear in the sidebar once the gateway responds.

If the agent itself crashed and left a corrupted database, look for backup files:

```
~/.hermes/sessions.db
~/.hermes/response_store.db
~/.hermes/state.db
~/.hermes/kanban.db
~/.hermes/kanban.db.bak.*   ← timestamped backups
```

The agent creates timestamped `.bak` files before migrations. Copy the most recent backup over the main file, then restart the agent.

## 2. Recovering UI session tokens

**Location:** `~/.hermes/workspace-sessions.json`

The UI keeps a list of active session tokens (browser login sessions, not chat sessions) in this file. It is written with `600` permissions (owner read/write only). If the UI server restarts cleanly, existing browser sessions remain valid and you will not be logged out.

If the file is corrupted or deleted, all browser sessions are invalidated. You will be prompted to log in again with your `HERMES_PASSWORD`. This is safe — no chat data is lost.

To force all sessions to expire (for example, after a security concern), delete the file:

```bash
rm ~/.hermes/workspace-sessions.json
```

The file is recreated automatically on the next authenticated request.

## 3. Gateway URL or dashboard URL overrides are lost

**Location:** `~/.hermes/workspace-overrides.json`

If you changed the gateway or dashboard URL through the UI, that change is stored in this file. After a crash, the file is read on startup and the override is restored automatically — no action needed.

If you need to reset the URLs to defaults, delete or empty the file:

```bash
rm ~/.hermes/workspace-overrides.json
```

On next startup the app falls back to `HERMES_API_URL` from `.env`, then to `http://127.0.0.1:8642` for the gateway and `http://127.0.0.1:9119` for the dashboard.

## 4. Theme and other UI preferences are lost

**Cause — `localStorage` was cleared.** Theme choice, recent searches, onboarding state, and tab preferences are stored in the browser's `localStorage` under the `claude-theme`, `hermes-recent-searches-v1`, and related keys.

**Fix:** These preferences are not critical. Select your theme again from **Settings → Appearance**. Other preferences reset to defaults and can be reconfigured.

## 5. When to delete and recreate a session

Delete a session (from the sidebar context menu) and start fresh when:
- The session's message history is corrupted and causes repeated errors.
- The session is stuck loading indefinitely and does not recover after agent restart and page reload.

Avoid deleting sessions just because they are slow to load — a slow load usually means the agent is starting up, not that the session is broken.

## 6. Full reset (last resort)

If nothing else works and you want to start from a completely clean state:

1. Stop the UI server and the agent.
2. Back up `~/.hermes/` to a safe location.
3. Delete or rename `~/.hermes/workspace-sessions.json` and `~/.hermes/workspace-overrides.json` to reset UI state.
4. If agent data is also corrupted, rename `~/.hermes/sessions.db` and `~/.hermes/kanban.db` to remove chat history, then restart the agent. The agent recreates the databases empty.
5. Restart the agent, then the UI server.

## Related

- [Agent won't connect](./agent-connect.md)
- [Sessions stuck or missing](./sessions.md)
- [Models not appearing](./models.md)
