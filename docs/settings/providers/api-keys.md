---
title: API keys
description: Store and manage API keys for your connected AI providers.
---

# API keys

Cloud AI providers that use API key authentication require you to supply a key before you can send requests. A key can live in more than one place at once, and when it does, only one of them is the one the gateway actually uses — this page explains which, and how to tell.

> [SCREENSHOT: API Keys section in Settings showing an origin chip next to a configured key]

<iframe
  src="/api/docs-asset?path=diagrams/api-keys-flow.html"
  width="100%"
  height="900"
  loading="lazy"
  style="border: 0; border-radius: 8px;"
></iframe>

## Where a key can live

A single credential can exist in up to six places at once:

| Store | What it is |
|---|---|
| `~/.hermes/.env` | The default target for keys entered through Settings |
| `<profile>/.env` | A per-profile copy — see [Multi-profile precedence](#multi-profile-precedence) below |
| Inline `api_key` in `config.yaml` | A literal value written directly into the provider's config entry |
| Shell environment | Exported in the shell that started the gateway process, never written to a file |
| `~/.hermes/auth.json` | OAuth grants and the credential pool, for providers that authenticate that way |
| An external secret source | Bitwarden, 1Password, or a plugin-provided vault |

Having a key in more than one of these is not an error, but it means **only one of them is the one the gateway resolves** — see below.

## Which one wins — and the inversion

There are two different config shapes a provider entry can be written in, and they resolve credentials in **opposite order**. This is the single most surprising thing about how Hermes credentials work.

- **`providers: { <id>: {...} }`** (the shape the UI writes for a named or custom provider) resolves the **environment variable first** and only falls back to an inline `api_key` if the env var is unset.
- **Legacy `custom_providers: [...]` / inline `model:` blocks** resolve the **inline `api_key` first** and only fall back to the environment variable if there is no inline value.

Neither shape warns you when both are set. If a provider is written in the legacy shape and you rotate the key in `.env`, the gateway keeps authenticating with the stale inline copy in `config.yaml` — the edit you made had no effect, silently.

A **credential-pool** entry in `auth.json` outranks every file on disk, on either shape. An **OAuth grant** outranks a manually-set environment key on a provider that authenticates via OAuth.

## Multi-profile precedence

Under `gateway.multiplex_profiles` (see [Gateway settings](../gateway.md)), a per-profile `key_env` resolves **only** against that profile's own `.env` file — it never falls through to the shell environment, even if the gateway process itself was started with the variable exported. A key visible to the process is not necessarily visible to the profile.

A per-profile `.env` is also a **one-time copy**, made when the profile is created — not a live inheritance from the root `.env`. A credential added to the root `.env` after a profile already exists never reaches that profile. A profile can look fully configured (its root sibling has the key) and still have no working credential at all.

## The origin chip

Each key row in **Settings → API Keys** shows an origin chip instead of a plain "set/missing" indicator:

| Chip | Meaning |
|---|---|
| `.env` | Stored in the environment file the gateway reads |
| `shell` | Exported in the shell that started the gateway — not in any file |
| `inline` | A literal `api_key` in `config.yaml` |
| `oauth` | An OAuth grant in `auth.json` |
| `pool` | A credential-pool entry in `auth.json` |
| `vault` | Supplied by an external secret source |
| `unknown` | At least one credential store could not be read right now — **not the same as "not set."** The key may well be there; don't re-paste it on the strength of this alone. |

When a chip reads `.env → inline` (an arrow to a second origin), it means the `.env` copy is **shadowed** — a higher-precedence copy exists elsewhere and the gateway will use that one instead. Editing the row you're looking at will not change what the gateway actually sends until the shadowing copy is dealt with too.

`unknown` exists because the previous version of this page treated "the dashboard couldn't be reached" as "the key is missing" — which is the worst failure mode for a setup screen: it tells you to re-enter a key you already have, and that re-entry goes to a different, unreconciled write path. `unknown` is reported instead, explicitly, whenever a store couldn't be read.

## Entering a key

1. Open **Settings** from the sidebar.
2. Choose **API Keys** in the settings navigation (or **Provider**, then **Open Providers →**, for the same keys scoped to a specific provider).
3. Find the row for the key you want to set.
4. Click **Edit**, enter the value, and **Save**.

Saving tries to write through the Hermes dashboard first, which can reconcile every store a value might already live in. If the dashboard is unreachable, the write falls back to editing `.env` directly and reconciling any `config.yaml` copies of the *same* value it can find — but it cannot prune a stale `auth.json` credential-pool entry from that fallback path, and says so if it had to take it.

## Verifying a key

Each row has a **Verify** button that reveals the value and probes it against the actual provider — not just a config-shape check. A result of "could not reach the provider" is reported as genuinely unknown, not as invalid; the previous behavior of guessing at validity from a probe that couldn't complete led to working keys being deleted on a false negative.

## Removing a key

Rows with a value set show a **Delete** button, which removes the credential through the same reconciling write path saving uses. Deleting a key that is currently shadowed by a higher-precedence copy elsewhere will not change what the gateway resolves — the shadowing note on the row tells you when that's the case.

## Security note

Keys stored in `.env` files are plain text on disk. Every write this app performs sets the file to owner-only permissions (`chmod 600`) automatically; if you edit one by hand, do the same. Do not commit `.env` files to version control.

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

The gateway reads `.env` only at process startup — restart it after any key change for the new value to take effect. The UI prompts you when a restart is needed.

## Common issues

**Key shows an origin chip but requests still fail with 401.** The chip only tells you where the value the gateway resolves comes from, not whether the value itself is correct. Use **Verify** on the row to probe it against the real provider.

**A row shows `unknown`.** A credential store couldn't be read just now — this is not the same as the key being missing. Retry, or check whether the Hermes dashboard is reachable, before re-entering anything.

**Edited a key and nothing changed.** Check for a shadowing arrow on the chip (`.env → inline`, for example) — a higher-precedence copy elsewhere is still the one the gateway uses. See [Which one wins](#which-one-wins--and-the-inversion) above.

**Changes do not take effect after saving.** The gateway reads `.env` only at startup. Restart it after any key change.

**Key field is not visible.** Only providers that use the `api_key` auth type show key fields. OAuth and local providers do not appear in the API Keys section.

## Related

- [Built-in providers](./built-in.md) — which providers need keys
- [Connecting a custom endpoint](./custom-endpoint.md) — `CUSTOM_API_KEY` specifics
- [Gateway](../gateway.md) — profile multiplexing and what it does to credential resolution
- [MCP — connecting servers](../mcp/connecting.md) — credentials for MCP servers
