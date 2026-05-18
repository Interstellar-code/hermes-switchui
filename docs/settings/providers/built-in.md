---
title: Built-in providers
description: Learn which AI providers come pre-configured in Hermes Switch UI.
---

# Built-in providers

Hermes Switch UI ships with a set of provider cards pre-configured in the Settings dialog. Each card represents an AI backend you can connect to. Some require no credentials; others need an API key or OAuth login.

> [SCREENSHOT: Provider grid in Settings showing cards for Ollama, Anthropic, OpenRouter, and others]

## Provider list

### Local providers — no API key required

| Provider | Sample models | Notes |
|---|---|---|
| **Ollama** | llama3.1:70b, qwen3:32b, deepseek-r1:32b | Runs locally. Requires Ollama to be installed and running on the host. The card shows a live status indicator when Ollama is detected. |
| **Atomic Chat** | llama-3.2-3b, qwen2.5-7b, gemma-3-4b | Local inference server. No external network calls. |

### Cloud providers — OAuth login

| Provider | Sample models | Notes |
|---|---|---|
| **Nous Portal** | xiaomi/mimo-v2-pro, claude-3-llama-3.1-405b | Authenticates via browser OAuth flow. |
| **OpenAI Codex** | gpt-5.4, gpt-5.3-codex, gpt-4o | Authenticates via browser OAuth flow. |

### Cloud providers — API key required

| Provider | Env variable | Sample models |
|---|---|---|
| **Anthropic** | `ANTHROPIC_API_KEY` | claude-sonnet-4-6, claude-opus-4-6, claude-haiku-3-5 |
| **OpenRouter** | `OPENROUTER_API_KEY` | auto, deepseek/deepseek-r1, google/gemini-2.5-pro |
| **Z.AI / GLM** | `GLM_API_KEY` | glm-4-plus, glm-4-air |
| **Kimi** | `KIMI_API_KEY` | kimi-latest, moonshot-v1-128k |
| **MiniMax** | `MINIMAX_API_KEY` | MiniMax-M2.7, MiniMax-M2.7-Lightning |
| **Xiaomi MiMo** | `XIAOMI_API_KEY` | mimo-v2-pro, mimo-v2-omni, mimo-v2-flash |

### Custom endpoint

| Provider | Notes |
|---|---|
| **Custom** | Any OpenAI-compatible endpoint. Uses `CUSTOM_API_KEY`. See [Connecting a custom endpoint](./custom-endpoint.md). |

## How to select a provider

1. Open **Settings** from the sidebar.
2. Choose **Model and Provider** in the settings navigation.
3. Click the provider card you want to use.
4. If the provider requires an API key, a key entry field appears. Enter your key. See [API keys](./api-keys.md) for details.
5. If the provider uses OAuth, clicking the card initiates the browser login flow.

The active provider's card is highlighted. The model list in the chat composer updates to show models available from the selected provider.

## Provider status

Local providers (Ollama, Atomic Chat) show a live status dot when the local discovery probe detects them running. Cloud API-key providers show a checkmark when a key is configured. OAuth providers remain neutral until you complete the login flow.

## Related

- [API keys](./api-keys.md) — entering and managing provider keys
- [Connecting a custom endpoint](./custom-endpoint.md) — using any OpenAI-compatible API
- [Switching models](./switching-models.md) — changing models within a session
