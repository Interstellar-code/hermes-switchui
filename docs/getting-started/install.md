---
title: Install
description: How to install and launch Hermes Switch UI.
---

# Install

> Hermes Switch UI talks to **two** Hermes Agent backends:
>
> | Process | Port | Powers |
> |---|---|---|
> | `hermes gateway run` | `8642` | Chat (portable mode) |
> | `hermes dashboard` | `9119` | Sessions, skills, memory, kanban, jobs, MCP, config |
>
> Plus the web app itself on port `3000`. **The dashboard is not optional for the full experience** — without it, chat works but sessions/skills/memory/kanban/MCP show errors, and the UI displays a "Limited mode — Hermes dashboard not connected" banner. Docker and the one-line installer set everything up; for manual/dev installs you start the dashboard yourself (see below).

<iframe
  src="/api/docs-asset?path=diagrams/install-paths.html"
  width="100%"
  height="820"
  loading="lazy"
  style="border: 0; border-radius: 8px;"
></iframe>

Pick the method that matches how you plan to use the app:

| Method | Best for | What you get |
|--------|----------|--------------|
| **One-line installer** | macOS / Linux, quickest native setup | Installs the agent + clones + configures `.env`; one command to launch |
| **Docker** | Most users | Pre-built images, all processes managed by Docker, survives reboots |
| **Electron desktop** | Single-user laptops | Native app, auto-updater, no terminal required after install |
| **Development (`pnpm dev`)** | Contributors, debugging | Source checkout, hot reload, you control everything |
| **Production node build** | Self-hosted server, remote deploy | Standalone Node server, no Docker |

> [SCREENSHOT: docker compose up output, terminal]

## Prerequisites

Common to every method:

- An **AI provider key** (one or more): OpenAI, Anthropic, OpenRouter, Google, or a reachable local server like Ollama or LM Studio. Without at least one provider configured, chat will not work — see [Connecting your AI provider](connecting-provider.md). You can also set the provider and key from the **in-browser onboarding wizard** on first launch — no need to hand-edit config.
- Free TCP ports: `3000` (UI), `8642` (gateway), and `9119` (dashboard).

Method-specific prerequisites are listed under each section.

---

## One-line installer (macOS / Linux)

The quickest native setup. Installs the Hermes Agent (Interstellar fork), clones Switch UI, writes `.env`, enables the agent's HTTP API, and installs dependencies — all idempotent (safe to re-run).

**You need:** Node.js 22+, `git`, `curl`, and `pnpm` (the script installs `pnpm` via corepack if missing).

```bash
curl -fsSL https://raw.githubusercontent.com/Interstellar-code/hermes-switchui/main/install.sh | bash
```

When it finishes:

```bash
cd ~/hermes-switchui
pnpm start:all          # starts the gateway + dashboard + UI together
```

`pnpm start:all` also starts the **dashboard** (needed for sessions/skills/memory/kanban/MCP).

```bash
hermes dashboard --no-open --skip-build
```

Open <http://localhost:3000>. The first-run **onboarding wizard** walks you through picking a provider and entering your API key.

> The installer checks both backends at the end and warns loudly if the dashboard (`:9119`) isn't running.

---

## Docker (recommended)

The fastest way to a working install. Pulls pre-built images, no compilation.

**You need:** Docker and Docker Compose.

1. Clone the repo (or download `docker-compose.yml` and `.env.example`):
   ```bash
   git clone https://github.com/Interstellar-code/hermes-switchui.git
   cd hermes-switchui
   ```
2. Create your env file from the template:
   ```bash
   cp .env.example .env
   ```
3. Open `.env` and add at least one provider key, for example:
   ```bash
   ANTHROPIC_API_KEY=sk-ant-...
   ```
4. Start both services:
   ```bash
   docker compose up
   ```
5. Open <http://localhost:3000>.

Data persists in the `claude-data` named volume (config, sessions, skills, memory). It survives container recreation.

**Logs:** `docker compose logs hermes-agent` or `docker compose logs hermes-switchui`.

**Build from source instead of pulling images:**
```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up
```

---

## Electron desktop

Best for a single-user laptop. Ships as a packaged `.dmg` (macOS) or `.exe` (Windows) with both processes bundled.

**You need:** the packaged installer from the project's releases page.

1. Download the latest installer for your OS.
2. Install it like any other app.
3. Launch — the app starts the agent and UI for you and opens a window.

If a newer version is published, the desktop app prompts you to update on next launch (powered by `electron-updater`).

**Building the desktop app yourself** (requires a dev checkout — see next section):
```bash
pnpm electron:build:mac    # builds .dmg
pnpm electron:build:win    # builds .exe
```
The output lands in the `dist/` folder.

> [SCREENSHOT: electron app first launch, macOS]

---

## Development (`pnpm dev`)

For contributors or anyone who wants to run from source with hot reload.

**You need:**

- **Node.js** 22 or newer
- **pnpm** (`npm install -g pnpm` if you do not have it)
- **Hermes Agent** installed locally (via the [one-line installer](#one-line-installer-macos--linux) or its own installer)

Steps:

1. Clone the repo:
   ```bash
   git clone https://github.com/Interstellar-code/hermes-switchui.git
   cd hermes-switchui
   ```
2. Install dependencies:
   ```bash
   pnpm install
   ```
3. Set up your env file:
   ```bash
   cp .env.example .env
   ```
   You only need to fill values if you want non-default behavior (binding to LAN, setting a password, etc.). For local development, the defaults work.
4. Start the gateway + dashboard + UI together:
   ```bash
   pnpm start:all
   ```
   This runs `hermes gateway run` (port `8642`) and `pnpm dev` (Vite on port `3000`) together via `concurrently`. A port preflight check runs first and fails fast if `8642` or `3000` is already in use.

   > **Note:** `pnpm dev` alone runs *only* the Vite UI — it does **not** start the agent or dashboard. Use `pnpm start:all` to launch all three, or run the services separately.
5. Start the **dashboard** (sessions/skills/memory/kanban/MCP) in another terminal:
   ```bash
   hermes dashboard --no-open --skip-build
   ```
6. Open <http://localhost:3000>.

The dev server hot-reloads UI changes. Restart only if you change server-side code, env vars, or dependency versions (`vite` / `@tanstack/*` cannot hot-swap — restart `start:all`).

### Config lives in `.env`

Gateway/dashboard URLs resolve from environment variables (`HERMES_API_URL`, `HERMES_DASHBOARD_URL`) → built-in loopback defaults (`127.0.0.1:8642` / `:9119`). The one-line installer writes `HERMES_API_URL` into the project `.env` for you. Changing the workspace URLs from **Settings → Connection** persists to `.env` and survives restarts — there is no separate override file.

### Enabling the agent's HTTP API

The UI reaches the gateway over its HTTP API, which is opt-in. Add to `~/.hermes/.env`:
```bash
API_SERVER_ENABLED=true
```
The one-line installer sets this for you. If the gateway was already running, restart it (`hermes gateway restart`) so the flag takes effect.

### react-grab (dev overlay)

The dev server loads the `react-grab` inspection overlay automatically. Opt out with `VITE_REACT_GRAB=0` in `.env`. Production builds strip it.

---

## Run as a background service (always-on)

Instead of keeping `pnpm start:all` in the foreground, install the gateway as a native OS service:

```bash
hermes gateway install     # Linux: systemd · macOS: launchd
hermes gateway start
```

The **dashboard** has no native service installer — run it persistently with `nohup hermes dashboard --no-open --skip-build &` (macOS) or a `systemd --user` unit (Linux). On WSL (no systemd by default), `pnpm start:all` starts it in the foreground with the gateway and UI.

---

## Production node build

For self-hosted deployments without Docker (a bare VM, Unraid Node.js plugin, etc.).

**You need:** Node.js 22+, pnpm, and Hermes Agent running separately (gateway on `8642` and, for full features, the dashboard on `9119`).

1. Clone and install (as above).
2. Build:
   ```bash
   pnpm build
   ```
   Output goes to `.output/`.
3. Start the production server:
   ```bash
   pnpm start
   ```
4. Make sure the Hermes Agent is running and reachable at `HERMES_API_URL` (default `http://127.0.0.1:8642`). Start it with `hermes gateway run`.

For remote access, see [Remote or LAN deployment](#remote-or-lan-deployment) below.

---

## Remote or LAN deployment

By default both processes bind to loopback only. To expose them on your LAN, Tailscale, or the public internet, set these env vars **and** set a password — running unprotected on `0.0.0.0` is unsafe.

In the workspace `.env`:
```bash
HOST=0.0.0.0
PORT=3000
HERMES_PASSWORD=<set a strong password>
HERMES_API_TOKEN=<must match agent's API_SERVER_KEY>
HERMES_API_URL=http://<agent-host-or-ip>:8642
```

In the agent's `~/.hermes/.env`:
```bash
API_SERVER_HOST=0.0.0.0
API_SERVER_KEY=<must match HERMES_API_TOKEN above>
```

For details on tokens and reverse-proxy setups, see [Agent won't connect](../troubleshooting/agent-connect.md).

---

## Verify your install

Whichever method you used, you should be able to:

1. Open <http://localhost:3000> (or your remote URL) and see the Hermes Switch UI home screen.
2. Open <http://localhost:8642/health> in the browser and see a JSON response — that confirms the **gateway** is reachable.
3. Confirm the **dashboard** is up at <http://localhost:9119> — if it isn't, the UI shows a "Limited mode — Hermes dashboard not connected" banner and sessions/skills/memory/kanban/MCP won't work. Start it with `hermes dashboard --no-open --skip-build`.
4. Send a test chat — see [Your first chat](first-chat.md).

If chat fails or the app shows an "Agent unavailable" banner, jump to [Agent won't connect](../troubleshooting/agent-connect.md). If the **MCP** or **Files** pages look empty on a brand-new install, they self-resolve once the dashboard is running and (for Files) once you pick a workspace folder in the first-run picker.

## Related

- [Your first chat](first-chat.md)
- [Connecting your AI provider](connecting-provider.md)
- [Agent won't connect](../troubleshooting/agent-connect.md)
