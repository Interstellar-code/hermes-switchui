---
title: Connecting a custom OpenAI-compatible endpoint
description: Point Hermes Switch UI at any OpenAI-compatible API endpoint.
---

# Connecting a custom OpenAI-compatible endpoint

If you run a self-hosted model, an internal inference gateway, or use a smaller hosted provider that speaks the OpenAI Chat Completions API, you can connect it to Hermes Switch UI using the custom endpoint configuration.

> [SCREENSHOT: /settings/providers page with Custom provider option selected and Base URL field visible]

<iframe
  src="/api/docs-asset?path=diagrams/custom-endpoint-routing.html"
  width="100%"
  height="900"
  loading="lazy"
  style="border: 0; border-radius: 8px;"
></iframe>

## Overview

The custom endpoint uses the agent's named `manifest` provider entry. Unlike the named built-in providers, `manifest` is a generic slot that accepts any OpenAI-compatible base URL and a single API key environment variable.

The agent config and key are written to files on the host machine. The UI writes these values through the gateway API — you do not need to edit files manually when using the Settings UI.

## Configuring via the Settings UI

The provider settings live at **Settings → Provider** (the **Provider** section under **Models** in the settings sidebar), which opens the full providers and models screen.

1. Open **Settings** from the sidebar.
2. Choose **Provider** in the settings navigation (under the **Models** group).
3. Click **Open Providers →** to navigate to the `/settings/providers` screen, or navigate there directly from the sidebar.
4. On the **Models** tab, set the **Provider** field to **Custom** and enter your endpoint's **Base URL** (for example `http://127.0.0.1:38238/v1`).
5. Click **Save** to write the configuration to the agent.
6. Add your API key via the **API Keys** section (navigate to it in the settings sidebar). The key is stored as `CUSTOM_API_KEY` in `~/.hermes/.env`.

## Configuration file shape

When saved, the agent's `~/.hermes/config.yaml` contains:

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

And `~/.hermes/.env` contains:

```
CUSTOM_API_KEY=your-endpoint-api-key
```

## Important naming rules

- The provider entry name must be `manifest`. Do not rename it to `custom` — `custom` is a reserved name the agent refuses to load.
- The provider type must be `openai` regardless of which model family the endpoint serves, as long as it implements the OpenAI Chat Completions API shape.

## Endpoints that do not require a key

If your endpoint accepts unauthenticated requests, set `CUSTOM_API_KEY` to any non-empty placeholder value (for example `none`). The field must be present in `.env` for the agent to start without a warning.

## After saving

Restart the agent for the new config to take effect. Once the agent is running with the updated config, the model picker in the chat composer will query `/v1/models` on your endpoint and list the available models.

## Common issues

**"Provider not found" or no models listed.** Confirm the agent was restarted after saving. Also verify that the base URL is reachable from the host machine where the agent runs — this is the machine's network, not the browser's.

**401 errors when chatting.** Check that `CUSTOM_API_KEY` in `~/.hermes/.env` matches the key your endpoint expects. The file is loaded at agent startup; restart after editing.

**Models list is empty.** The endpoint must expose a `/v1/models` response. If it does not, the composer falls back to a free-text model entry field.

## Related

- [Built-in providers](./built-in.md) — pre-configured provider cards
- [API keys](./api-keys.md) — managing keys including `CUSTOM_API_KEY`
- [Connecting your AI provider](../../getting-started/connecting-provider.md) — first-run setup guide
