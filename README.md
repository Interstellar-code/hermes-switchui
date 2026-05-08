<div align="center">

<img src="./public/claude-avatar.webp" alt="Switch UI" width="80" style="border-radius: 16px" />

# Switch UI

**Matrix-aesthetic interface for Hermes Agent.**

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D22.0.0-brightgreen.svg)](https://nodejs.org/)
[![Theme](https://img.shields.io/badge/theme-matrix-00ff41.svg)](#-switch-ui-specifics)

> An opinionated, Matrix-styled UI for [Hermes Agent](https://github.com/NousResearch/hermes-agent). Diverged from `outsourc-e/hermes-workspace` for design direction. Backend integration stays in lockstep with upstream — UI is our own.

![Switch UI](./docs/screenshots/splash.png)

</div>

---

## 🟢 Fork & credits

**Switch UI is a fork of [outsourc-e/hermes-workspace](https://github.com/outsourc-e/hermes-workspace).** We diverged for design direction — Matrix aesthetic as the canonical theme, Switch-specific composer/sidebar/meta flows, opinionated UX choices that we don't intend to upstream.

- **Upstream:** [`outsourc-e/hermes-workspace`](https://github.com/outsourc-e/hermes-workspace) — original Hermes Workspace
- **This fork:** [`Interstellar-code/hermes-switchui`](https://github.com/Interstellar-code/hermes-switchui) — Switch UI

**Sync strategy:** we cherry-pick upstream backend/infra fixes when relevant. We do **not** rebase or merge from upstream `main` — UI changes don't flow back, and we avoid pulling upstream UI changes that conflict with the Switch UI direction. Full credit to outsourc-e and the Hermes Workspace community for the original work this is built on.

---

## ✨ What's different from upstream

| Area | Switch UI | Upstream |
|---|---|---|
| **Theme** | Matrix (default), Claude Nous, Claude Official, Claude Classic, Claude Slate | Hermes / Nous / Bronze / Slate / Mono |
| **Sessions sidebar** | Unified feed across chat / cron / api / task sources, day-grouped, live source filter chips, persisted collapse | Single chat-only list |
| **Composer** | Matrix-themed popovers (workspace, model, profile, thinking-level), green-glow focus border, transparent outer wrapper | Standard wrapper with backdrop blur |
| **Meta bar** | Live tok/s, model, ctx %, tool count, profile, session ID — wired to gateway + derived locally | Different layout |
| **Provider config** | `manifest` provider entry (not `custom`) for Switch-specific endpoints | Standard custom provider |
| **Typography** | Matrix design system tokens (`.m-mono`, `.m-label`, `.m-chip`, `.m-timestamp`) — JetBrains Mono throughout | Mixed sans / mono per surface |
| **Cherry-pick policy** | Backend/infra only from upstream | — |

---

## ⚠️ Issues, screenshots & roadmap

- **Issues:** filed on this repo's [issues tab](https://github.com/Interstellar-code/hermes-switchui/issues) — temporary while the project finds its footing.
- **Screenshots:** the images under `docs/screenshots/` are inherited from upstream and don't yet show the Matrix UI. New Switch UI screenshots are queued.
- **Roadmap:** Switch UI's own roadmap is in flux; the section below lists what's working today.

---

## 🚀 Quick Start

Three paths — pick the one that matches you:

| Path | Best for | Time |
|---|---|---|
| **🐳 [Docker Compose](#-docker-quickstart)** | Self-hosters, home labs | ~2 min |
| **🌐 One-line install** | Local dev on macOS/Linux | ~3 min |
| **🔌 Attach to existing `hermes-agent`** | You already run Hermes Agent | ~1 min |

### One-line install

```bash
curl -fsSL https://raw.githubusercontent.com/Interstellar-code/hermes-switchui/main/install.sh | bash
```

Installs `hermes-agent` via Nous's official installer, clones this repo, sets up `.env`, installs dependencies. Then:

```bash
hermes gateway run                 # terminal 1
cd ~/hermes-switchui && pnpm dev   # terminal 2
```

Open http://localhost:3000.

---

### Already running `hermes-agent`? Attach Switch UI to it

If you already have `hermes-agent` running on `http://<host>:8642`, point Switch UI at it:

```bash
git clone https://github.com/Interstellar-code/hermes-switchui.git
cd hermes-switchui
pnpm install
cp .env.example .env

echo 'HERMES_API_URL=http://127.0.0.1:8642'    >> .env
echo 'HERMES_DASHBOARD_URL=http://127.0.0.1:9119' >> .env

# If your gateway was started with API_SERVER_KEY (auth enabled), set the same value:
# echo 'HERMES_API_TOKEN=***' >> .env

pnpm dev                           # http://localhost:3000 (override with PORT=4000 pnpm dev)
```

Requirements on the agent side:

- Gateway bound to a reachable address (typically `API_SERVER_HOST=0.0.0.0` + the port exposed)
- `API_SERVER_ENABLED=true` in `~/.hermes/.env`
- `hermes dashboard` running (default `http://127.0.0.1:9119`) for sessions, skills, jobs, config APIs
- If `API_SERVER_KEY` is set, pass the same value via `HERMES_API_TOKEN`

Verify before opening Switch UI:

- `curl http://127.0.0.1:8642/health` — gateway ok
- `curl http://127.0.0.1:9119/api/status` — dashboard metadata

#### Running on a remote host (Tailscale / VPN / LAN)

If Switch UI lives on one machine and you access it from another, point `HERMES_API_URL` at the **reachable** backend address, not `127.0.0.1`:

```bash
echo 'HERMES_API_URL=http://100.x.y.z:8642' >> .env
echo 'HERMES_DASHBOARD_URL=http://100.x.y.z:9119' >> .env

# Tell the gateway to listen on all interfaces so peers can reach it:
echo 'API_SERVER_HOST=0.0.0.0' >> ~/.hermes/.env
```

Restart the gateway, dashboard, and Switch UI. Both `HERMES_API_URL` and `HERMES_DASHBOARD_URL` must be reachable URLs — setting only one leaves the other probing `127.0.0.1` and failing.

You can also update both URLs from `Settings → Connection` without restarting. Values persist to `~/.hermes/workspace-overrides.json` and gateway capabilities are reprobed on save.

---

### Manual install

Switch UI works with any OpenAI-compatible backend. If your backend also exposes Hermes Agent gateway APIs, enhanced features (sessions, memory, skills, jobs) unlock automatically.

#### Prerequisites

- **Node.js 22+** — [nodejs.org](https://nodejs.org/)
- **An OpenAI-compatible backend** — local, self-hosted, or remote
- **Optional:** Python 3.11+ if you want to run a Hermes Agent gateway locally

#### Step 1: Start your backend

Switch UI talks to any backend that supports:

- `POST /v1/chat/completions`
- `GET /v1/models` recommended

Example Hermes Agent setup (from scratch):

```bash
curl -fsSL https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.sh | bash
hermes setup
hermes gateway run
```

If you're using another OpenAI-compatible server, just note its base URL.

#### Step 2: Install & run Switch UI

```bash
git clone https://github.com/Interstellar-code/hermes-switchui.git
cd hermes-switchui
pnpm install
cp .env.example .env
printf '\nHERMES_API_URL=http://127.0.0.1:8642\n' >> .env
pnpm dev                           # http://localhost:3000
```

> **Verify:** open `http://localhost:3000` and complete onboarding. Connect the backend, verify chat works. If your gateway exposes Hermes Agent APIs, advanced features appear automatically.

#### Environment variables

```env
# OpenAI-compatible backend URL
HERMES_API_URL=http://127.0.0.1:8642

# Optional: provider keys the Hermes Agent gateway can read at runtime.
# ANTHROPIC_API_KEY=***
# OPENAI_API_KEY=sk-...
# OPENROUTER_API_KEY=sk-or-v1-...
# GOOGLE_API_KEY=AIza...
# (Ollama / LM Studio / local servers don't need a key)

# Optional: password-protect the web UI
# HERMES_PASSWORD=your_password
```

---

## 🧠 Local models (Ollama, Atomic Chat, LM Studio, vLLM)

Switch UI supports two modes with local models:

### Portable mode (easiest)

Point at your local server — no Hermes Agent gateway needed.

```bash
# Atomic Chat
HERMES_API_URL=http://127.0.0.1:1337/v1 pnpm dev

# Ollama
OLLAMA_ORIGINS=* ollama serve
HERMES_API_URL=http://127.0.0.1:11434 pnpm dev
```

Chat works immediately. Sessions, memory, and skills show "Not Available" — that's expected in portable mode.

### Enhanced mode (full features)

Route through the Hermes Agent gateway for sessions, memory, skills, jobs, and tools.

Two explicit `~/.hermes/config.yaml` examples:

**Atomic Chat**

```yaml
provider: atomic-chat
model: your-model-name
custom_providers:
  - name: atomic-chat
    base_url: http://127.0.0.1:1337/v1
    api_key: atomic-chat
    api_mode: chat_completions
```

**Ollama**

```yaml
provider: ollama
model: qwen3:32b
custom_providers:
  - name: ollama
    base_url: http://127.0.0.1:11434/v1
    api_key: ollama
    api_mode: chat_completions
```

You can adapt the same shape for other OpenAI-compatible local runners. Atomic Chat and Ollama are the two built-in local paths documented in the Switch UI.

**Enable the API server in `~/.hermes/.env`:**

```env
API_SERVER_ENABLED=true
```

**Start the gateway, dashboard, and Switch UI:**

```bash
hermes gateway run         # core APIs on :8642
hermes dashboard           # dashboard APIs on :9119
HERMES_API_URL=http://127.0.0.1:8642 \
HERMES_DASHBOARD_URL=http://127.0.0.1:9119 \
pnpm dev
```

For authenticated gateways, also set `HERMES_API_TOKEN` to the same value as `API_SERVER_KEY`.

> Works with any OpenAI-compatible server — Atomic Chat, Ollama, LM Studio, vLLM, llama.cpp, LocalAI, etc. Just change the `base_url` and `model` in the config above.

---

## 🐳 Docker Quickstart

```bash
git clone https://github.com/Interstellar-code/hermes-switchui.git
cd hermes-switchui
cp .env.example .env
```

Edit `.env` and add at least one LLM provider key:

```env
# ANTHROPIC_API_KEY=***
# OPENAI_API_KEY=sk-...
# OPENROUTER_API_KEY=sk-or-v1-...
# GOOGLE_API_KEY=AIza...
```

Using Ollama, LM Studio, or another local server? No key needed — point `hermes-agent` at your local endpoint via the onboarding flow.

```bash
docker compose up
```

Open `http://localhost:3000` and complete onboarding.

> **Note:** The default `docker-compose.yml` was inherited from upstream and may still reference `ghcr.io/outsourc-e/hermes-workspace:latest`. Until the Switch UI image is published, the simplest path is to pull this repo and run `docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build` so the Switch UI is built locally on top of the canonical `nousresearch/hermes-agent:latest` agent image.

---

## 📱 Install as App

Switch UI is a **PWA** — install for the full native experience.

- **Desktop (Chrome / Edge):** click the install icon (⊕) in the address bar at `http://localhost:3000`.
- **iOS Safari:** Share → "Add to Home Screen".
- **Android Chrome:** ⋮ menu → "Add to Home screen".

---

## 📡 Mobile access via Tailscale

Access Switch UI from anywhere on your devices:

1. Install Tailscale on the host and your mobile device — same account on both.
2. `tailscale ip -4` on the host gives you `100.x.x.x`.
3. Open `http://100.x.x.x:3000` on your phone.
4. "Add to Home Screen" for the full app experience.

> Tailscale traffic stays end-to-end encrypted across any network.

---

## 🎨 Switch UI specifics

### Themes

Five themes: **Matrix** (default, dark), Claude Nous, Claude Official, Claude Classic, Claude Slate. Applied via `data-theme` on `<html>`. Stored in `localStorage` under `claude-theme`.

### Matrix design system

Tokens live in `src/styles.css` under `[data-theme='matrix']`. Reusable utility classes:

| Class | Use for |
|---|---|
| `.m-mono` | Mono body, paths, inline code, source data |
| `.m-label` | Uppercase tracked caps for headers, sender prefixes, source chips |
| `.m-chip` | Filter pill labels |
| `.m-timestamp` | Mono, tabular-nums, muted — timestamps and metric tails |
| `.m-body` | Chat message body |
| `.m-glow-text` | Green-glow accent text |

Reference mockups in `docs/plans/Hermes-Switchui-Design-Mockups/`.

### Manifest provider

Switch UI uses a named `manifest` provider entry (not `custom` — `custom` is reserved by the gateway and `_get_named_custom_provider` returns `None` for it):

```yaml
model:
  default: auto
  provider: manifest
providers:
  manifest:
    type: openai
    base_url: http://your-endpoint/v1
    key_env: CUSTOM_API_KEY
```

API key stored in `~/.hermes/.env` as `CUSTOM_API_KEY`.

### Unified sessions sidebar

Single feed merging chat, cron, api, and task sources, day-grouped (Pinned / Today / Yesterday / Earlier), with source filter chips, state segments, free-text search, and persisted collapse state.

---

## 🔒 Security & deployment env vars

### Built-in safeguards

- Auth middleware on every API route
- CSP headers via meta tags
- Path-traversal prevention on file/memory routes
- Rate limiting on endpoints
- Fail-closed startup guard: refuses to bind non-loopback without `HERMES_PASSWORD`
- Session cookies: `HttpOnly` + `SameSite=Strict` + `Secure` (in production)
- Optional password protection for the web UI

### Env vars for remote / Docker deployments

- `HERMES_PASSWORD` — required whenever `HOST ≠ 127.0.0.1` (legacy `CLAUDE_PASSWORD` still honored)
- `COOKIE_SECURE=1` — force `Secure` cookie flag when terminating HTTPS at a proxy
- `COOKIE_SECURE=0` — disable `Secure` flag for plain-HTTP LAN deployments
- `TRUST_PROXY=1` — trust `x-forwarded-for` / `x-real-ip` (only behind a sanitizing reverse proxy)
- `HERMES_DASHBOARD_TOKEN` — explicit bearer for dashboard API
- `HERMES_API_TOKEN` — bearer for the Hermes Agent gateway when started with `API_SERVER_KEY`
- `HERMES_ALLOW_INSECURE_REMOTE=1` — bypass the fail-closed guard (not recommended)

See `.env.example` for the full list.

---

## 🔧 Troubleshooting

### "Switch UI loads but chat doesn't work"

Switch UI auto-detects the gateway's capabilities on startup. Look in your terminal for:

```
[gateway] http://127.0.0.1:8642 available: health, models; missing: sessions, skills, memory, config, jobs
```

**Fix:** upgrade to the latest stock `hermes-agent`:

```bash
cd ~/hermes-agent && git pull && uv pip install -e .
hermes gateway run
```

### "Connection refused" or hangs on load

Gateway isn't running:

```bash
hermes gateway run
```

First time? Run `hermes setup` first to pick a provider and model.

### Ollama: chat returns empty / model shows "Offline"

`~/.hermes/config.yaml` needs the `custom_providers` section and `API_SERVER_ENABLED=true` in `~/.hermes/.env`. See [Local Models](#-local-models-ollama-atomic-chat-lm-studio-vllm) above.

Ensure Ollama runs with CORS enabled and use `http://127.0.0.1:11434/v1` (not `localhost`):

```bash
OLLAMA_ORIGINS=* ollama serve
```

Verify: `curl http://localhost:8642/health`.

---

## 🤝 Contributing

This fork is small and opinionated. PRs are welcome, but coordinate before non-trivial changes:

- **Bug fixes:** open a PR directly
- **New features / UI changes:** open an issue first to discuss
- **Backend / infra fixes that benefit upstream too:** consider sending the upstream PR to [`outsourc-e/hermes-workspace`](https://github.com/outsourc-e/hermes-workspace) — we'll cherry-pick once it lands
- **Security issues:** see [SECURITY.md](SECURITY.md)

---

## 📄 License

MIT — see [LICENSE](LICENSE). Inherited from upstream `outsourc-e/hermes-workspace`.

---

<div align="center">
  <sub>Switch UI — a Matrix-styled fork of <a href="https://github.com/outsourc-e/hermes-workspace">outsourc-e/hermes-workspace</a></sub>
</div>
