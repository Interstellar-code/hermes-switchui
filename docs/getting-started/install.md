---
title: Install
description: How to install and launch Hermes Switch UI.
---

# Install

> Hermes Switch UI runs as two paired processes: the web app on port `3000` and the **Hermes Agent** gateway on port `8642`. Most install methods set both up for you.

Pick the method that matches how you plan to use the app:

| Method | Best for | What you get |
|--------|----------|--------------|
| **Docker** | Most users | Pre-built images, both processes managed by Docker, survives reboots |
| **Electron desktop** | Single-user laptops | Native app, auto-updater, no terminal required after install |
| **Development (`pnpm dev`)** | Contributors, debugging | Source checkout, hot reload, you control everything |
| **Production node build** | Self-hosted server, remote deploy | Standalone Node server, no Docker |

> [SCREENSHOT: docker compose up output, terminal]

## Prerequisites

Common to every method:

- An **AI provider key** (one or more): OpenAI, Anthropic, OpenRouter, Google, or a reachable local server like Ollama or LM Studio. Without at least one provider configured, chat will not work — see [Connecting your AI provider](connecting-provider.md).
- Free TCP ports: `3000` (UI) and `8642` (agent).

Method-specific prerequisites are listed under each section.

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

- **Node.js** 20 or newer
- **pnpm** (`npm install -g pnpm` if you do not have it)
- **Hermes Agent** installed locally

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
4. Start the dev server:
   ```bash
   pnpm dev
   ```
   This launches the Vite dev server on port `3000` and **auto-starts the Hermes Agent sidecar** on port `8642`.
5. Open <http://localhost:3000>.

The dev server hot-reloads UI changes. Restart only if you change server-side code or env vars.

**Running the UI and agent in separate terminals** (useful when debugging the agent):
```bash
pnpm start:all
```
This runs `hermes gateway run` and `pnpm dev` together using `concurrently`.

---

## Production node build

For self-hosted deployments without Docker (a bare VM, Unraid Node.js plugin, etc.).

**You need:** Node.js 20+, pnpm, and Hermes Agent running separately.

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
2. Open <http://localhost:8642/api/healthz> in the browser and see a JSON response — that confirms the agent is reachable.
3. Send a test chat — see [Your first chat](first-chat.md).

If chat fails or the app shows an "Agent unavailable" banner, jump to [Agent won't connect](../troubleshooting/agent-connect.md).

## Related

- [Your first chat](first-chat.md)
- [Connecting your AI provider](connecting-provider.md)
- [Agent won't connect](../troubleshooting/agent-connect.md)
