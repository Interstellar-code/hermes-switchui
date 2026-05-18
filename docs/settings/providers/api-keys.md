---
title: API keys
description: Store and manage API keys for your connected AI providers.
---

# API keys

Cloud AI providers that use API key authentication require you to supply a key before you can send requests. Hermes Switch UI stores keys in a plain-text environment file on the agent's host machine.

> [SCREENSHOT: API Keys section in Settings showing masked key fields for configured providers]

## Where keys are stored

All API keys are stored in:

```
~/.hermes/.env
```

This file is read by the agent at startup. Keys are written as environment variable assignments:

```
ANTHROPIC_API_KEY=sk-ant-...
OPENROUTER_API_KEY=sk-or-...
CUSTOM_API_KEY=your-key-here
```

The UI reads masked versions of configured keys through the gateway API — it shows `••••` for keys that are set, and an empty field for keys that are not.

## Security note

Keys in `~/.hermes/.env` are stored as plain text. Restrict file permissions so that only your user account can read it:

```bash
chmod 600 ~/.hermes/.env
```

Do not commit this file to version control.

## Provider key reference

| Provider | Variable name | Notes |
|---|---|---|
| Anthropic | `ANTHROPIC_API_KEY` | Obtain from console.anthropic.com |
| OpenRouter | `OPENROUTER_API_KEY` | Obtain from openrouter.ai |
| Z.AI / GLM | `GLM_API_KEY` | Obtain from the Z.AI portal |
| Kimi | `KIMI_API_KEY` | Obtain from platform.moonshot.cn |
| MiniMax | `MINIMAX_API_KEY` | Obtain from minimaxi.com |
| Xiaomi MiMo | `XIAOMI_API_KEY` | Obtain from the Xiaomi AI platform |
| Custom endpoint | `CUSTOM_API_KEY` | Set to the key your endpoint expects |

Ollama, Atomic Chat, Nous Portal, and OpenAI Codex do not use this key mechanism — Ollama and Atomic Chat are local and keyless; Nous Portal and OpenAI Codex authenticate via OAuth.

## Entering a key via the Settings dialog

1. Open **Settings** from the sidebar.
2. Choose **Model and Provider** in the settings navigation.
3. Scroll to the **API Keys** section.
4. Find the row for the provider you want to configure.
5. Click the field to edit it and enter your key.
6. Press **Enter** or click away. The key is saved to `~/.hermes/.env` via the gateway API.

The gateway must be restarted after a key is saved for the change to take effect in the agent's running process. The UI will prompt you if a restart is needed.

## Rotating a key

To replace an existing key, click the masked field in the API Keys section and enter the new value. Save as above, then restart the agent.

## Removing a key

Key removal is not currently available from the UI. To remove a key, open `~/.hermes/.env` in a text editor, delete the relevant line, save the file, and restart the agent.

## Common issues

**Key shows as configured but requests fail with 401.** The key value may be incorrect or expired. Re-enter the key in the Settings dialog and restart the agent.

**Changes do not take effect after saving.** The agent reads `.env` only at startup. Restart the agent after any key change.

**Key field is not visible.** Only providers that use the `api_key` auth type show key fields. OAuth and local providers do not appear in the API Keys section.

## Related

- [Built-in providers](./built-in.md) — which providers need keys
- [Connecting a custom endpoint](./custom-endpoint.md) — `CUSTOM_API_KEY` specifics
- [MCP — connecting servers](../mcp/connecting.md) — credentials for MCP servers
