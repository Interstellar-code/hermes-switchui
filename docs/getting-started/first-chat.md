---
title: Your first chat
description: Start chatting with Hermes Switch UI in under a minute.
---

# Your first chat

> Open the app, pick a provider, and send your first message.

## Before you start

You need both processes running:

- **Hermes Switch UI** on `http://localhost:3000`
- **Hermes Agent** on `http://127.0.0.1:8642`

For local development, `pnpm dev` starts the app and auto-starts the agent sidecar if it isn't already running. If you used a different install method (Docker, Electron desktop, Unraid), follow that method's launch instructions — see [Install](install.md).

You also need an AI provider configured. If you haven't done that yet, follow [Connecting your AI provider](connecting-provider.md) first.

## Quick steps

1. Open `http://localhost:3000` in your browser.

   If the app prompts for a password, enter the value of HERMES_PASSWORD set in your environment.

2. Pick a theme (optional). The app ships with several themes; the default is fine for now.
3. Make sure an AI provider is configured. If chat doesn't respond when you send a message, see [Connecting your AI provider](connecting-provider.md).
4. Click into the composer at the bottom of the chat screen and type a message.
5. Press **Send**. You should see a streaming response and a new session appear in the sidebar.

> [SCREENSHOT: composer first prompt, matrix-dark theme]

## What you see

When you send a message:

- The response streams in token-by-token in the chat view.
- A new session is created automatically and shown in the sidebar on the left.
- A context-window indicator updates as the conversation grows, so you can see how much of the model's context budget you've used.
- A model switcher near the composer lets you change which model handles the next turn.

> [SCREENSHOT: streaming response, matrix-dark theme]

The session is saved locally. You can leave the page, come back later, click the session in the sidebar, and continue the conversation.

## Details

- **Session history** — All chats are listed in the left sidebar. Click any session to resume.
- **Model switcher** — Switching the model mid-conversation works; the agent will use the new model for the next turn.
- **Context indicator** — Shows tokens used out of the model's context window. When it gets close to full, start a fresh session or compress the conversation.
- **Streaming** — Responses stream over Server-Sent Events. If a stream stalls, the app surfaces a stalled state instead of hanging.

## Common issues

- **Nothing happens when you press Send** — Usually means no provider is configured or the agent is not reachable. See [Connecting your AI provider](connecting-provider.md) and [Agent won't connect](../troubleshooting/agent-connect.md).
- **"Agent unavailable" banner** — The app cannot reach the Hermes Agent on port `8642`. See [Agent won't connect](../troubleshooting/agent-connect.md).
- **The response stops mid-stream** — Usually a provider-side timeout or a transient network issue. Resend the message. If it keeps happening, check the agent logs in `~/.hermes/`.

## Related

- [Welcome](../welcome.md)
- [Connecting your AI provider](connecting-provider.md)
- [Agent won't connect](../troubleshooting/agent-connect.md)
