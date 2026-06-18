---
title: Self-Improve
description: Karpathy self-improvement engine that collects per-profile metrics, proposes SOUL.md and config diffs via a live LLM, evaluates them against scenarios, and applies or reverts changes through a git ratchet.
---

# Self-Improve

Self-Improve is a Hermes Agent plugin (internal name: `karpathy-self-improve`) that ships as part of the Hermes Switch UI package. It gives the active agent profile a structured path to improve itself: measure current behaviour, propose changes to its own persona and configuration, evaluate the proposals against a fixed scenario suite, and commit or revert based on whether the change is an improvement. Switch UI surfaces the plugin through the **Self-Improve** page.

> [SCREENSHOT: Self-Improve page showing the hero diff of a proposed SOUL.md change alongside the scenario checklist and eval score]

## How it works

The engine runs a full lifecycle on demand or on a schedule:

1. **Collect** — Gather per-profile metrics from recent conversation history: response quality signals, tool-use patterns, refusal rates, and latency.
2. **Propose** — Send the metrics to a live LLM call that produces a concrete diff: a change to the profile's `SOUL.md` persona file, a config key adjustment, or both.
3. **Evaluate** — Run the proposed change against a fixed set of scenarios and score the result. The score is read from `eval_runs` — it reflects the actual evaluation output, not a live estimate.
4. **Apply or revert** — If the score is an improvement, the change is committed via git ratchet and becomes the new baseline. If the score regresses or the proposal is rejected, the change is reverted and the profile is left unchanged.

The git ratchet ensures the profile can always be unwound to a prior known-good state. Every apply produces a commit; every revert undoes it cleanly.

## The `/self-improve` page

The page has three surfaces:

- **Hero diff** — a side-by-side or unified diff of the currently proposed `SOUL.md` or config change, so you can read exactly what the engine wants to change before approving.
- **Scenario checklist** — the fixed scenario suite the proposal is evaluated against, with pass/fail per scenario and the aggregate score in context.
- **Experiments feed** — a merged, chronological feed of all prior propose→evaluate→apply/revert cycles for the active profile.

You can approve or reject a proposal from the page. Rejected proposals are logged but not applied; the engine will generate a new proposal on the next cycle.

> [SCREENSHOT: Self-Improve experiments feed showing a timeline of past proposals with score deltas and apply/revert outcome badges]

## REST API

The plugin exposes **20 REST routes** at `/api/plugins/karpathy-self-improve/`, covering the full lifecycle: trigger a collection run, fetch the current proposal, approve or reject it, query eval run results, list experiment history, and get per-profile metric snapshots.

## CLI

The plugin also registers a `hermes karpathy` CLI command and a `/karpathy status` slash command for checking the current engine state without opening the UI.

## Enabling the plugin

```bash
hermes plugins enable karpathy-self-improve
hermes dashboard restart
```

Verify the routes are live:

```bash
curl http://localhost:8642/api/plugins/karpathy-self-improve/status
```

The Self-Improve page in Switch UI is gated on the gateway reporting the plugin as active. If the page is missing, confirm the plugin is enabled and the dashboard has been restarted.

## Related

- [Plugins overview](./overview.md)
- [Personas](./personas.md) — the persona store that SOUL.md changes feed into
- [Matrix Coder](./matrix-coder.md) — the specialist-coder layer that can be tuned by self-improve proposals
