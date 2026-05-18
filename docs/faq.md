---
title: FAQ
description: Answers to frequently asked questions about Hermes Switch UI.
---

# FAQ

> Short answers to common questions. For step-by-step guides, follow the links at the end of each answer.

## What is Hermes Switch UI?

Hermes Switch UI is a browser-based front-end for the Hermes Agent — a local AI assistant runtime. The app runs on your machine (port `3000` by default) and talks to the Hermes Agent gateway (port `8642`). You use it to chat with AI providers, manage sessions, browse files, run terminals, and work with the agent's tasks, workflows, skills, MCP servers, and memory.

## Do I need an internet connection?

That depends on the provider you choose:

- **Local providers** (for example, Ollama running on your own machine) work fully offline once the models are downloaded.
- **Hosted providers** (Anthropic, OpenAI, OpenRouter, Google, custom OpenAI-compatible endpoints) need an internet connection to reach the provider's API.

The app itself runs locally — only the AI calls go out.

## Where is my data stored?

Most of it lives under `~/.hermes/`:

- `~/.hermes/.env` — API keys for hosted providers and the agent's API server settings.
- `~/.hermes/config.yaml` — Agent configuration, including provider entries.
- `~/.hermes/workspace-sessions.json` — Encrypted-at-rest session tokens for the app's password-protected login (only used when `HERMES_PASSWORD` is set).
- `~/.hermes/workspace-overrides.json` — UI-set runtime overrides for the gateway/dashboard URL.
- Agent session and memory data — Stored by the agent under `~/.hermes/`.

App-side `.env` (in the app's install directory) holds app-level settings like port, gateway URL, and password.

## Can I use multiple AI providers?

Yes. Add keys for as many providers as you want to `~/.hermes/.env`, then switch between them in **Settings → Model & Provider**. The change takes effect on the next message. See [Connecting your AI provider](getting-started/connecting-provider.md).

## Can I run this on a remote server?

Yes, with one safety requirement. By default the app binds to `127.0.0.1` (loopback only). If you set `HOST=0.0.0.0` to expose it on a LAN, Tailscale, or behind a reverse proxy, you must also set `HERMES_PASSWORD` to a strong secret. The app refuses to start on a non-loopback host without a password.

For deployments behind a trusted reverse proxy, also set `TRUST_PROXY=1` so client IP classification uses the forwarded headers. For plain-HTTP LAN deployments, set `COOKIE_SECURE=0` so login cookies aren't dropped by the browser.

See `.env.example` for the full list of security-related flags.

## How do I switch themes?

Open **Settings → Themes** and pick one. The app ships with several built-in themes covering different palettes and dark/light variants. Your choice is saved in the browser's `localStorage` under the key `claude-theme`, so it persists across reloads.

## What's the difference between Hermes Switch UI and Hermes Agent?

- **Hermes Switch UI** is the user interface — the web app you open in a browser. It does not talk to AI providers directly.
- **Hermes Agent** is the backend runtime — a Python process that handles AI providers, sessions, tools, skills, MCP, and storage. It exposes an HTTP gateway on port `8642`.

They are separate processes. The app needs the agent running to do anything useful.

## Where do I report bugs?

Open an issue against the repository at `Interstellar-code/hermes-switchui` on GitHub. Include the app version, your platform, the steps you took, and any relevant log output from `pnpm dev` or `~/.hermes/`.

## Is this free?

Yes. The app is released under the MIT License. You can read the full license text in `LICENSE` at the root of the repository. Provider-side costs (for hosted AI providers like Anthropic, OpenAI, etc.) are billed separately by those providers under their own terms.

## How do I update the app?

If you installed via the source repo, pull the latest commits and run `pnpm install` followed by `pnpm dev` (development) or `pnpm build && pnpm start` (production). The Electron build also ships with an auto-update path via `electron-updater`; when an update is available it surfaces in the app and applies on next restart.

## What browsers are supported?

Hermes Switch UI works in modern Chromium-based browsers (Chrome, Edge, Arc, Brave), Firefox, and Safari. Mobile browsers are usable but not optimized.

## Can I run the agent and the UI on different machines?

Yes. Set `HERMES_API_URL` on the UI machine to the agent's address, e.g. `http://agent-host.local:8642`. The agent must listen on the right interface (`API_SERVER_HOST=0.0.0.0`) and you should set an auth token (`API_SERVER_KEY` on the agent, `HERMES_API_TOKEN` on the UI) since the connection crosses machines. Also set `HERMES_PASSWORD` on the UI if it's reachable from outside loopback.

## Related

- [Welcome](welcome.md)
- [Your first chat](getting-started/first-chat.md)
- [Connecting your AI provider](getting-started/connecting-provider.md)
- [Agent won't connect](troubleshooting/agent-connect.md)
