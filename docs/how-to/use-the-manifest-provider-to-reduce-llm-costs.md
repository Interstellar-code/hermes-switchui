---
title: Use the Manifest provider to reduce LLM costs
description: Route Hermes through a cheaper OpenAI-compatible endpoint by configuring the named manifest provider.
---

# Use the Manifest provider to reduce LLM costs

> Point Hermes at a lower-cost OpenAI-compatible endpoint so you can keep using the same UI while changing where tokens are billed.

<iframe
  src="/api/docs-asset?path=diagrams/manifest-cost-reduction-flow.html"
  width="100%"
  height="900"
  loading="lazy"
  style="border: 0; border-radius: 8px;"
></iframe>

Hermes Switch UI does not call model providers directly. The Hermes Agent does. That means one of the simplest ways to reduce cost is to keep the UI exactly as it is and change the agent's provider routing underneath it.

A practical pattern is to use Hermes's named `manifest` provider entry and point it at a cheaper OpenAI-compatible backend — for example a self-hosted gateway, a lower-cost hosted inference endpoint, or your own internal routing layer.

## When this helps

Use this approach when you want to:

- keep using Hermes Switch UI without changing your workflow
- swap an expensive default provider for a cheaper endpoint
- route different models through one stable OpenAI-compatible base URL
- centralize billing, rate limits, or provider failover behind your own gateway

This does **not** reduce cost by itself. The savings come from what sits behind the manifest endpoint. The manifest provider is the plumbing that lets Hermes use that cheaper route cleanly.

## How it works

The agent reads its provider configuration from `~/.hermes/config.yaml` and its secrets from `~/.hermes/.env`. If you define a provider entry named `manifest`, Hermes Switch UI will surface it like any other provider.

At runtime the flow is:

1. You send a message from Hermes Switch UI.
2. Hermes Switch UI forwards it to Hermes Agent.
3. Hermes Agent sees that the active provider is `manifest`.
4. Hermes Agent sends the request to the OpenAI-compatible endpoint you configured.
5. That endpoint decides which model to run and what it costs.

## Step 1 — add a manifest provider entry

Open `~/.hermes/config.yaml` and add a named provider entry called `manifest`:

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

A few details matter here:

- The provider entry name should be `manifest`.
- The provider `type` should be `openai`.
- `base_url` should point at an endpoint that speaks the OpenAI Chat Completions API.
- `key_env` tells Hermes which environment variable contains the credential.

> Do **not** use `custom` as the provider name or the provider type here. Hermes treats that name specially and may reject it.

## Step 2 — add the API key

Open `~/.hermes/.env` and add the key that matches `key_env`:

```env
CUSTOM_API_KEY=your-endpoint-api-key
```

If your endpoint does not require a key, follow the requirements of that gateway. In most cases you should still use a dedicated variable so the config stays portable.

## Step 3 — restart Hermes Agent

Restart the Hermes Agent so it reloads `config.yaml` and `.env`.

After restart, open Hermes Switch UI and go to **Settings → Provider**. You should see the `manifest` provider in the list.

## Step 4 — select the manifest provider

Choose **manifest** as the active provider, then send a short test prompt from chat.

If the response streams normally, Hermes is now routing through your lower-cost endpoint.

## How this reduces cost in practice

Once `manifest` is active, cost control moves to the endpoint behind it. Common patterns include:

### Route to a cheaper hosted model

Point `base_url` at an OpenAI-compatible provider with lower per-token pricing than your previous default.

### Route to a local model server

If you run an OpenAI-compatible local server, you can point `manifest` at it and avoid per-request API charges entirely. You may still pay in hardware, power, or latency, but not per-token cloud cost.

### Use your own gateway for smart routing

If you already run an internal model gateway, `manifest` can point at that gateway and let it decide when to use a premium model versus a cheaper one.

For example:

- simple chats → small inexpensive model
- coding or long-context tasks → stronger model
- fallback traffic → secondary provider

That lets you keep a single UI entry while optimizing cost centrally.

## What stays the same

Changing to `manifest` does **not** change the Hermes Switch UI workflow:

- your chats still happen in the same app
- sessions still stay in Hermes
- tools still run through Hermes Agent
- the provider switch only affects where the model request goes

That separation is why this is a good cost-control lever. You do not need to retrain users on a new interface.

## How to verify it is working

Check these things:

1. **Provider appears in the UI** — open **Settings → Provider** and confirm `manifest` is listed.
2. **Chat succeeds** — send a short prompt and confirm the response streams.
3. **The old provider is no longer selected** — make sure Hermes did not fall back to another provider.
4. **Your endpoint logs traffic** — if you control the target endpoint, confirm requests are arriving there.

## Common mistakes

### The provider does not appear

Usually one of these is wrong:

- `~/.hermes/config.yaml` was not saved correctly
- the agent was not restarted
- the provider block is malformed YAML
- the provider name or type is wrong

Compare your config to the example above exactly.

### The provider appears but requests fail

Usually one of these is wrong:

- `base_url` is not OpenAI-compatible
- the endpoint is down or unreachable
- the key in `~/.hermes/.env` is missing or invalid
- the endpoint expects a different path shape than `/v1`

### Cost did not actually go down

The manifest provider is only a router. If the endpoint behind it still calls an expensive model, your bill will not change. Review the actual pricing and routing logic of the backend you pointed it to.

## Recommended rollout

A safe rollout looks like this:

1. configure `manifest`
2. test it with a small prompt
3. compare output quality and latency against your current provider
4. switch a few workflows first
5. move your default traffic only after you are happy with cost and quality

## Related

- [Connecting your AI provider](../getting-started/connecting-provider.md)
- [Custom OpenAI-compatible endpoint](../settings/providers/custom-endpoint.md)
- [Built-in providers](../settings/providers/built-in.md)
