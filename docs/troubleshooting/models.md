---
title: Models not appearing
description: Fix configuration issues that prevent AI models from showing up in the model picker.
---

# Models not appearing

<iframe
  src="/api/docs-asset?path=diagrams/models-source-architecture.html"
  width="100%"
  height="900"
  loading="lazy"
  style="border: 0; border-radius: 8px;"
></iframe>

## 1. The model picker is empty

**Cause — No provider configured.** The model list is read from `~/.hermes/config.yaml`. If no `providers` block exists, or the block has no entries, the picker has nothing to show.

**Fix:**
1. Open **Settings → Model & Provider**.
2. Follow the provider setup flow to add at least one provider. For a custom OpenAI-compatible endpoint, enter the base URL and API key. The app writes the provider to `config.yaml` automatically.
3. Reload the chat page. The picker should now list the models for that provider.

See [Connecting your AI provider](../getting-started/connecting-provider.md) for a full walkthrough.

## 2. "No models available" after adding a provider

**Cause A — API key missing or wrong.** The app stores the API key in `~/.hermes/.env` as `CUSTOM_API_KEY`. If the key is missing or has been rotated, the agent cannot fetch the model list.

**Fix:** Go to **Settings → Model & Provider** and re-enter the API key. Save, then restart the agent.

**Cause B — The provider's `/v1/models` endpoint is unreachable.** The models API tries the running gateway first, then falls back to reading `config.yaml` directly. If neither source returns models, the picker stays empty.

**Fix:**
1. Check that the agent is running and reachable (see [Agent won't connect](./agent-connect.md)).
2. Confirm the base URL is correct and that the endpoint responds to `GET /v1/models`. You can test this with `curl <base_url>/v1/models`.
3. If the endpoint does not implement `/v1/models`, add models manually to `config.yaml` under `custom_providers`.

**Cause C — Gateway capability probe failed.** On startup the app probes the gateway and caches the result. If the probe runs before the agent is ready, it may cache a failed state.

**Fix:** Open **Settings → Agent**, click **Reconnect** to force a fresh probe, then reload the page.

## 3. The wrong model is selected by default

**Cause — `model.default` in `config.yaml` is stale.** The default model is read from the `model.default` field and placed first in the picker list. If that model ID no longer exists in the provider's list, it still appears first but sends requests to a model that may not be valid.

**Fix:** Open `~/.hermes/config.yaml` in a text editor and update `model.default` to a valid model ID from your provider. Alternatively, use the model picker in the composer to select a new default and save it from Settings.

## 4. Locally running models (Ollama) do not appear

**Cause — Auto-discovery not triggered.** The app auto-discovers local Ollama models by querying `http://localhost:11434/v1/models`. Discovery runs on each `/api/models` request but only when the Ollama server is reachable.

**Fix:**
1. Start Ollama (`ollama serve`).
2. Reload the model picker. Discovered models are merged into the list and the provider entry is added to `config.yaml` automatically.

## 5. Models appear but sending a message fails immediately

**Cause — Provider configured but not connected.** A provider entry in `config.yaml` proves configuration, not connectivity. The actual API call happens at send time.

**Fix:** Check the error message in the chat response. Common causes:
- Invalid API key → re-enter the key in Settings.
- Wrong base URL → verify the endpoint accepts chat completions at `<base_url>/v1/chat/completions`.
- Provider requires a specific model ID format → check the provider's documentation and update `config.yaml`.

## Related

- [Agent won't connect](./agent-connect.md)
- [Crash recovery](./crash-recovery.md)
- [Connecting your AI provider](../getting-started/connecting-provider.md)
