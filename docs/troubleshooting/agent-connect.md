---
title: Agent won't connect
description: Steps to take when Hermes Switch UI cannot reach the hermes-agent gateway.
---

# Agent won't connect

> When the app shows "Agent unavailable", sessions won't load, or chat doesn't respond, walk this checklist top to bottom.

<iframe
  src="/api/docs-asset?path=diagrams/agent-connect-diagnostic.html"
  width="100%"
  height="900"
  loading="lazy"
  style="border: 0; border-radius: 8px;"
></iframe>

The app talks to the Hermes Agent gateway over HTTP. If chat is broken, in almost every case one of five things is wrong. Check them in this order.

## 1. The agent process isn't running

The agent runs on port `8642` by default.

**Check:** Open `http://127.0.0.1:8642/health` in a new browser tab. A healthy agent returns a small JSON payload. A connection refused error means the process isn't running.

**Fix:**

- For local development, `pnpm dev` auto-starts the agent if it isn't already running. Restart `pnpm dev`.
- To start the agent on its own, run `hermes gateway run` in a terminal. The agent also requires `API_SERVER_ENABLED=true` in `~/.hermes/.env` for its HTTP API on port `8642` to be active.
- If you installed the app another way (production build, Electron), restart the app so it can re-launch the agent.

## 2. The gateway URL is wrong

The app reads `HERMES_API_URL` to find the agent. The default is `http://127.0.0.1:8642`.

**Check:** Look in your `.env` (in the app's repo root) for `HERMES_API_URL`. If it's set, make sure it points at a reachable host and port.

**Fix:** Either unset `HERMES_API_URL` to fall back to the default, or set it to the correct URL and restart the app. For LAN or Tailscale deployments, the agent must also be bound to that interface — it listens on loopback by default. On the agent side, set `API_SERVER_HOST=0.0.0.0` in `~/.hermes/.env` so the agent itself listens on the non-loopback interface.

## 3. The agent requires a token and the app isn't sending one

If the agent has `API_SERVER_KEY` set (common for Docker or `0.0.0.0` deployments), every request needs to send a matching bearer token.

**Check:** Look for `API_SERVER_KEY` in `~/.hermes/.env`. If it's set, the app needs `HERMES_API_TOKEN` set to the same value in its `.env`.

**Fix:** Copy the value:

```env
# in hermes-switchui/.env
HERMES_API_TOKEN=<same-secret-as-API_SERVER_KEY>
```

Restart the app.

## 4. The agent is up but no provider is configured

If chat connects but every message fails or returns nothing, the agent itself is fine — there's just no working provider behind it.

**Fix:** Follow [Connecting your AI provider](../getting-started/connecting-provider.md).

## 5. The app refuses to start on a non-loopback host

When you set `HOST=0.0.0.0` to expose the app on a LAN or remote host, the app refuses to start unless `HERMES_PASSWORD` is also set. This is a safety guard — the app exposes terminals, file write, and agent control, so it won't run on a public-ish interface without a password.

**Fix:** Either keep `HOST=127.0.0.1` (default) or set both `HOST=0.0.0.0` and a strong `HERMES_PASSWORD`. See `.env.example` for the full set of related security flags.

> [SCREENSHOT: agent unavailable error state]

## Reading the capability probe

On startup, the app probes the agent and logs which capabilities it found:

```
[gateway] gateway=http://127.0.0.1:8642 dashboard=http://127.0.0.1:9119 mode=... core=[...] enhanced=[...] missing=[...]
```

- `core` — basic gateway endpoints (health, chat completions, models, streaming).
- `enhanced` — optional features (sessions, skills, config, jobs, MCP, conductor, kanban).
- `missing` — capabilities not detected. Some are optional and safe to ignore; missing core entries point at a real problem.
- `mode=zero-fork (full feature set)` — all core and enhanced capabilities detected. `mode=enhanced-fork (partial features)` — some optional capabilities missing. `mode=portable (UI-only, no agent)` — basic chat works but extended APIs don't. `mode=disconnected (no agent reachable)` — nothing is reachable.

The status panel in the app surfaces this same info and offers a **Reconnect** action that forces a fresh probe.

> [SCREENSHOT: settings → agent status panel]

## Where to find logs

- **App (development)** — In the terminal where you ran `pnpm dev`.
- **Hermes Agent** — Under `~/.hermes/` (look for log files there; the agent also prints to whatever terminal started it).
- **App (Electron / production)** — The console of the launching process; for Electron, also the developer tools console.
- **Docker** — `docker logs <container-name>`

## If you're still stuck

- Try a forced re-probe from the connection status panel.
- Restart both processes — agent first, then the app.
- Make sure `~/.hermes/.env` and the app's `.env` aren't disagreeing about tokens or URLs.
- Check that nothing else is bound to port `8642` (or whichever port you set).

## Related

- [Connecting your AI provider](../getting-started/connecting-provider.md)
- [FAQ](../faq.md)
