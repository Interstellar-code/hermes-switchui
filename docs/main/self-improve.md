---
title: Self-Improve
description: Propose, review, apply, and verify incremental edits to an agent profile's instructions using the Karpathy self-improvement plugin.
---

# Self-Improve

The Self-Improve page is the UI for the Karpathy self-improvement plugin. It lets an agent propose small edits to its own SOUL.md system prompt or config, evaluate those edits against test scenarios, and apply or revert them — all through a supervised workflow.

> [SCREENSHOT: Self-Improve page showing profile cards with baseline charts, an Experiments feed, and a scenario checklist]

## What you see

Navigate to **Self-Improve** in the sidebar. The page has three main sections:

- **Profile cards** — one card per profile that has logged metrics. Each card shows session count, cost, token usage, and a sparkline of cost history alongside a baseline score chart.
- **Experiments feed** — the history of proposed changes for the selected profile, each showing its lifecycle state and diff.
- **Scenario checklist** — the set of evaluation scenarios used to score experiments.

A health strip at the top shows the plugin version and database status.

## Selecting a profile

Use the profile scope selector at the top of the page to choose which profile to work with. All experiments, baselines, and scenarios are scoped to the selected profile.

## Proposing an experiment

Click **Propose** in the Experiments section. This triggers the plugin to run a live LLM pass that analyses the profile's recent session metrics and produces a diff — a small edit to the profile's system prompt or config that it predicts will improve performance. The proposal appears as a new experiment card in state **Proposed**.

## Experiment lifecycle

Each experiment moves through a linear state machine shown by a lifecycle stepper on its card:

| State | Meaning |
|-------|---------|
| **Proposed** | The diff has been generated and is waiting for review |
| **Approved** | You have accepted the proposal — the plugin will apply it |
| **Applied** | The edit has been written to the profile config (the `live` state) |
| **Verified** | The applied change has been evaluated against scenarios and scored |
| **Reverted** | The applied change was rolled back (appears after Applied) |
| **Rejected** | The proposal was declined at the Proposed step |

You approve or reject experiments directly on the experiment card. A reverted or rejected experiment stays in the feed for audit purposes.

## Experiment cards

Each card shows:

- The proposed diff (SOUL.md or config section)
- The lifecycle stepper with timestamps at each completed step
- Approve / Reject buttons (when in Proposed state)
- The evaluation score and scenario results (when Verified)

## Baseline chart

The baseline chart tracks score snapshots over time for the selected profile. Each time an experiment is verified, a new baseline point is recorded. The chart gives a quick visual of whether the profile is improving.

## Scenarios

Scenarios are short test cases that the plugin runs against the profile to evaluate a proposed change. Each scenario has a name, an input prompt, and expected behaviour criteria.

You can add custom scenarios via the scenario checklist panel. Scenarios are per-profile. A holdout flag marks scenarios that are reserved for final verification and not used during the proposal phase.

## Score source

Live scores shown on profile cards come from `eval_runs` recorded by the plugin — not from a `live_score` field on the experiment object. The displayed score reflects the most recent completed evaluation run.

## Common issues

**"DB missing" in the health strip.** The plugin's SQLite database has not been initialised. Restart the Hermes Agent to trigger plugin startup, or check the agent logs for initialisation errors.

**Propose button is disabled.** A profile must be selected. If the profile has no recent session data, the plugin may produce a low-quality proposal but will still run.

**No profile cards appear.** Metrics are only recorded when sessions are tagged with a profile. Start at least one conversation with a profile active to generate the first metrics snapshot.

## Related

- [Profiles](../settings/profiles.md) — managing agent profiles
- [Plugins — Self-Improve](../plugins/self-improve.md) — plugin internals and configuration
