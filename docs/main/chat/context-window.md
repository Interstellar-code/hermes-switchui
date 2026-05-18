---
title: Context window indicator
description: See how much of the model's context window your conversation is using.
---

# Context window indicator

Every language model has a fixed context window — the total number of tokens it can hold in a single conversation. As your session grows, the conversation approaches that limit. The context window indicator lets you see at a glance how full the current session is.

> [SCREENSHOT: Context bar in the chat header showing a filled arc ring with a percentage label]

## What you see

A ring or arc indicator appears in the chat header area. It fills progressively as the conversation grows. The percentage shown is the share of the model's context window consumed by the current session's messages and tool outputs.

The indicator is session-scoped: switching to a different session resets the display to reflect that session's usage.

## How the value is calculated

The percentage is read from the Hermes Agent via the SSE stream that carries chat events. Each streaming response from the gateway includes a context-usage update. The Switch UI stores this in the `useContextUsageStore` Zustand store and displays it in real time. The store is keyed to the active session — updates from a different session are discarded, preventing stale readings when multiple sessions are open.

## Alert thresholds

The UI monitors usage and raises a one-time alert per threshold per calendar day:

| Threshold | Meaning |
|-----------|---------|
| 35% | Approaching the point where the Hermes Agent may auto-compact (~40%) |
| 75% | Context is getting full; consider starting a new session |
| 90% | Context is nearly exhausted; responses may degrade |

When a threshold is crossed, an alert is shown. Each threshold fires at most once per day (tracked in `sessionStorage`). If the agent compacts the context the indicator resets to reflect the post-compaction token count, and the compaction count is incremented.

## Compaction

The Hermes Agent may automatically compact the conversation when context usage approaches its internal limit (around 40–80k tokens on a 200k window, depending on configuration). When compaction occurs, the indicator drops to reflect the reduced token count. The number of compactions is tracked in the store and can be read by other components.

## Common issues

**Indicator stays at 0%** — Context usage data comes from the gateway SSE stream. If the agent is not connected or the capability is not exposed, the indicator remains at 0. Check that the agent is running and the session is active.

**Percentage jumps back down mid-conversation** — The agent performed an automatic compaction. This is expected and means the conversation history was summarised to free up context space.

**Alert fires every time I open the app** — The alert state is stored in `sessionStorage`, which clears when you close the browser tab. Re-opening the tab resets the per-day guard for that session.

## Related

- [Sessions and history](./sessions.md)
- [The composer](./composer.md)
