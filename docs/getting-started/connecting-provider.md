---
title: Connecting your AI provider
description: Link an AI provider so Hermes Switch UI can send and receive messages.
---

# Connecting your AI provider

> Pick where chat completions come from — a local runtime, a hosted provider, or your own OpenAI-compatible endpoint.

<iframe
  src="/api/docs-asset?path=diagrams/provider-routing.html"
  width="100%"
  height="860"
  loading="lazy"
  style="border: 0; border-radius: 8px;"
></iframe>

Hermes Switch UI itself doesn't talk to AI providers directly. It routes chat through the Hermes Agent on port `8642`, and the agent does the actual provider calls. Connecting a provider means configuring the agent and, when needed, dropping an API key into the agent's environment.

## Where settings live

In the app, open **Settings → Provider**. This screen lists every provider the agent knows about and lets you select an active one.

> [SCREENSHOT: provider settings screen, matrix-dark theme]

## Three paths

You can connect a provider in three ways. Pick the one that matches what you have.

### 1. Local provider (no key needed)

If you're running a local model server like **Ollama**, the app ships with a built-in card for it. Make sure the local runtime is running (`ollama serve`, for example), then open **Settings → Provider** and select it. The app discovers locally available models automatically.

Other local runtimes that expose an OpenAI-compatible API can be configured as a custom endpoint (see path 3).

### 2. Hosted provider (Anthropic, OpenAI, OpenRouter, Google, etc.)

The agent ships with cards for several hosted providers. To use one:

1. Get an API key from the provider.
2. Add it to the agent's environment file at `~/.hermes/.env`. Use the variable name the provider expects:

   ```env
   ANTHROPIC_API_KEY=sk-ant-...
   OPENAI_API_KEY=sk-...
   OPENROUTER_API_KEY=sk-or-v1-...
   GOOGLE_API_KEY=AIza...
   ```

3. Restart the Hermes Agent so it picks up the new key.
4. Open **Settings → Provider** in the app and select the provider.

Only add the keys for providers you actually use. The agent doesn't require all of them.

### 3. Custom OpenAI-compatible endpoint

For any third-party endpoint that speaks the OpenAI Chat Completions API (self-hosted models, internal gateways, smaller hosted providers), use the agent's named `manifest` provider entry. The agent config lives at `~/.hermes/config.yaml`. The shape looks like this:

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

Then add the matching key to `~/.hermes/.env`:

```env
CUSTOM_API_KEY=your-endpoint-api-key
```

> [SCREENSHOT: api key field, matrix-dark theme]

Restart the agent. The app's provider list will show the custom entry, and you can select it like any other.

> **Note:** The provider type is `openai`, and the entry name is `manifest`. Do not use `custom` as the type or the entry key — it's a reserved name the agent treats specially and will refuse to load. This guidance also applies to the [Custom OpenAI-compatible endpoint](../settings/providers/custom-endpoint.md) doc; use the same naming.

## How to test the connection

The simplest test is to send a chat message:

1. Open the app.
2. Make sure your provider is selected in **Settings → Provider**.
3. Go to the chat screen and send a short message.

If the response streams in, the provider is connected. If you see an error, no response, or an "Agent unavailable" banner, see [Agent won't connect](../troubleshooting/agent-connect.md).

You can also check connection status directly in the app's status panel — the gateway probe reports which capabilities (chat completions, models, sessions, etc.) it found on startup.

## Switching providers

You can switch providers any time from **Settings → Provider**. The change takes effect on the next message. Existing sessions stay in place; the new provider just handles future turns.

## Details

- **Keys live with the agent, not the UI.** Put API keys in `~/.hermes/.env`, not in the app's `.env`. The app's `.env` is only for app-level settings like port, password, and gateway URL.
- **Restart the agent after key changes.** The agent reads keys at startup.
- **Multiple providers can coexist.** Add multiple keys at the same time and switch between them in **Settings → Provider**.
- **Provider availability is detected at startup.** The app asks the agent which providers are configured and shows only those.

## Related

- [Your first chat](first-chat.md)
- [Agent won't connect](../troubleshooting/agent-connect.md)
- [FAQ](../faq.md)
