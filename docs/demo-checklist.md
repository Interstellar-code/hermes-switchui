# Demo Checklist — hermes-switchui v2.3.14

Use this before any live demo (internal or client-facing). Each check is a single
pass/fail step. All 5 must pass before the demo starts.

## 1. Gateway Health & Session Start

Confirm the Hermes gateway is running and can accept a new chat message.

```bash
# Check gateway process
launchctl list | grep hermes

# Send a test message via the API
curl -s -X POST http://127.0.0.1:8000/api/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "ping"}'
```

Expected: HTTP 200 with a session_id in the response body.
Fail if: connection refused, timeout, or no session_id returned.

---

## 2. App Build & Serve

Confirm the UI compiles without errors and serves on the expected port.

```bash
cd /Volumes/Ext-nvme/Development/hermes-switchui
pnpm build 2>&1 | tail -5
```

Expected: Build exits 0 with no uncaught errors, warnings are acceptable.
Fail if: TypeScript errors, Vite bundle failures, or unresolved imports.

---

## 3. Core Routes Load

Verify the primary screens render without blank/error states. Open each in a
browser at http://localhost:3000/ROUTE:

- `/chat` — chat composer visible, message input not disabled
- `/jobs` — cron job list renders; existing jobs appear
- `/dashboard` — widgets load without spinner hang
- `/terminal` — terminal pane attached to a running shell session
- `/settings` — settings page loads; connection status shows "Connected" if the
  gateway is up, or a clear offline message if not

Expected: all 5 routes produce a rendered page with interactive content.
Fail if: any route shows a white screen, infinite spinner, or JS console error.

---

## 4. Gateway ↔ UI Chat Round-Trip

Send a message through the UI and verify the response appears in the chat
thread.

1. Navigate to `/chat`
2. Type a short message (e.g. "What time is it?") and press Enter
3. Wait for the assistant reply to appear

Expected: the message sends, a loading indicator appears, and a response
arrives within 10 seconds. The response text is visible in the chat feed.
Fail if: the message never sends, the loading indicator hangs indefinitely, or
an error toast appears instead of a reply.

---

## 5. Matrix3D Office Scene (Bonus Visual Check)

Open the 3D office and confirm the agent characters are rendered and animating.

1. Navigate to `/matrix3d`
2. Wait for the Three.js scene to load (5-10 seconds)

Expected: the 3D office environment appears with agent models in their
rooms/leisure zones. Camera controls (orbit/pan) are responsive. The scene does
not freeze or drop to a slideshow frame rate (>= 15 fps on a typical MacBook).
Fail if: the canvas is black, agents are missing, or framerate is unusable.

---

## Quick Go/No-Go

| Check | Status |
|---|---|
| 1. Gateway Health | |
| 2. Build | |
| 3. Core Routes | |
| 4. Chat Round-Trip | |
| 5. Matrix3D Scene | |
| **Result** | |

All 5 must pass. If any fails, fix and re-run before proceeding with the demo.
