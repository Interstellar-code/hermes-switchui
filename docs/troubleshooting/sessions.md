---
title: Sessions stuck or missing
description: Resolve issues where chat sessions fail to load or appear to disappear.
---

# Sessions stuck or missing

## 1. A session disappears from the sidebar

**Cause A — Gateway not reachable.** Sessions are fetched from the hermes-agent gateway on page load. If the gateway is down when the page loads, the session list comes back empty.

**Fix:** Check that the agent is running (`pnpm dev` auto-starts it; for standalone installs, run `hermes-agent` manually). Reload the page once the agent is back. The session list will repopulate.

**Cause B — Wrong gateway URL.** If you changed the gateway URL in Settings after starting the app, the session fetch may be hitting a stale endpoint.

**Fix:** Go to **Settings → Agent** and verify the gateway URL matches the running agent. Click **Reconnect** to force a fresh probe.

**Cause C — Capability probe missed the sessions feature.** On startup, the app probes the agent for available features. If the probe fails or times out, sessions may be disabled for that run.

**Fix:** Open the developer tools console (`Cmd+Option+I` / `Ctrl+Shift+I`) and look for a `[gateway]` line. If `sessions` is in the `missing` list, restart the agent and reload the page.

## 2. A session is stuck on "Loading…"

**Cause — SSE stream not establishing.** Chat events arrive over a server-sent events stream. If the stream fails to open, the session appears to load indefinitely.

**Fix:**
1. Reload the page. Most transient SSE failures resolve on reconnect.
2. Check the agent is still running. A crashed agent will stall the stream.
3. If you are on a network that strips long-lived HTTP connections (corporate proxies, some VPNs), try a direct connection or enable chunked-transfer mode in the agent config.

## 3. Sessions exist in the agent but not in the UI

**Cause — Local session store mismatch.** The app maintains a small local session index in addition to the gateway sessions. If this gets out of sync (for example after a database reset on the agent side), the UI may show a stale or empty list.

**Fix:** Force a refresh of the session list by reloading the page with the cache cleared (`Cmd+Shift+R` / `Ctrl+Shift+F5`).

## 4. Renaming a session has no effect

**Cause — Sessions capability unavailable.** Rename is routed through the gateway sessions API. If that capability is missing, the rename silently does nothing.

**Fix:** Verify the agent supports the sessions API (look for `sessions` in the `core` list in the startup probe log). Update the agent if it does not.

## 5. Deleting a session fails or the session reappears

**Cause — Kanban database timestamp issue.** A known issue causes certain direct database writes to produce non-integer `created_at` values, which can break database queries and cause 503 errors on operations including delete.

**Symptom:** Delete appears to succeed in the UI but the session returns on next reload, or a toast shows a generic error.

**Fix:** Restart the hermes-agent process. If the problem persists across restarts, check the agent logs for database errors and consider restoring the kanban database from a backup under `~/.hermes/kanban.db.bak.*`.

## Related

- [Agent won't connect](./agent-connect.md)
- [Crash recovery](./crash-recovery.md)
