---
title: The setup wizard
description: Four required steps to a working agent, then everything else — and why the order is not negotiable.
---

# The setup wizard

> Connect, Provider, Workspace, First chat. In that order, and nothing optional unlocks until the last one actually succeeds.

> [SCREENSHOT: Setup wizard rail showing the four required steps and the locked Extras step]

## Why four steps instead of twelve

Earlier versions of this wizard had twelve steps across two branches, and offered profiles, memory, kanban, and project setup before a single chat message had ever gone through. That let someone finish every step of setup and still not have a working agent — with no signal anywhere that anything was actually broken.

The rule this version follows is the same one the official Hermes quickstart states outright:

> If Hermes cannot complete a normal chat, do not add more features yet.

So the wizard is now **four required steps**, run in a fixed order, followed by an **Extras** step that only becomes available once the fourth step actually succeeds (or you explicitly choose to move on without it — see below).

## The four steps

### 1. Connect

Three things have to work independently before a single message can be answered: your browser to Switch UI, Switch UI to the gateway, and the gateway to your AI provider. This step checks each of the first two boundaries and tells you specifically which one is broken, rather than one generic "can't connect" message. It never blocks progress — a gateway that's down still has to be fixable from the next step, and the real check is step 4.

### 2. Provider

Choose a provider, supply whatever it needs (an API key, a base URL, or nothing at all for OAuth/local providers), and save. Saving triggers a live verification call — not just "the config looks valid," but an actual round trip to confirm the credential works. See [Connecting your AI provider](connecting-provider.md) for the mechanics of each provider type.

### 3. Workspace

The one question nothing else in the app asks: where does the agent actually run? Left alone, the agent's shell commands and file writes land in your home directory — that's the honest default, not a bug, but it surprises almost everyone who hits it without being told. This step shows you the resolved directory and lets you change it, with a before/after preview before anything is written. Skipping it is a legitimate choice; not being told the consequence is what this step exists to fix. Full mechanism: [Working directory](../settings/working-directory.md).

### 4. First chat — the gate

Send one real message and get a real reply. This is the only step that actually proves the whole chain — provider, credential, gateway, and stream — works end to end. Everything after this step configures things (skills, MCP servers, memory, scheduled jobs) that only ever run *inside* a completed chat turn, so configuring them before one has succeeded configures something that has never been shown to run.

## The skip exists, but it names what breaks

If the first chat fails, or you just want to move past this step, there's a **Skip this check** control. It does not read "some features may not work" — it names the actual, specific consequences of the failure you just had, for example:

- If no provider is active: the very next message you send will error before it reaches a model.
- If a provider is configured but rejected the credential: every chat, tool call, and background job will fail the same way until the credential is fixed.
- Regardless of cause: tool calls, terminal commands, and file edits all run inside a completion, so none of them execute either. Memory writes happen during a turn, so nothing gets remembered. Skills, MCP servers, and scheduled jobs are all invoked mid-turn, so configuring them now configures something that never runs.

You have to read that list and press a second, differently-labelled button to actually skip — the intent is that skipping is possible but never accidental, and never uninformed.

## What unlocks after the gate

Once step 4 passes (or you skip it with the warning acknowledged), an **Extras** step appears with optional cards: agent profiles, memory setup, plugins, and theme. None of it is required to use the workspace — each card states what it buys you, and you can leave the wizard at any point once you're past the gate.

If you're revisiting the wizard from Settings on an already-working install (a "relaunch," rather than a first run), the gate doesn't re-block you — you already have a working agent, and being made to re-prove that on every visit would make the wizard useless as a settings surface. First runs and resumed installs are the two situations where the gate actually protects someone, and those are the ones it enforces.

## Common issues

**I can't reach the Extras step.** The gate needs step 4 to either pass or be explicitly skipped. Check step 4 for the specific failure reason.

**The wizard skipped straight to summary.** You're most likely reopening it from Settings on a workspace that already has a working provider — that's the relaunch mode, and it starts you at a status view rather than re-running Connect/Provider from scratch.

**A saved link to a step I don't recognize (`review`, `verify`, `system-check`) still works but looks different.** Those step names were retired when the wizard was rebuilt; a link to one of them now opens its closest replacement (`review`/`verify` → Provider, `system-check` → Connect) instead of failing.

## Related

- [Install](install.md) — getting the processes running before the wizard can do anything
- [Connecting your AI provider](connecting-provider.md) — provider-specific setup detail
- [Working directory](../settings/working-directory.md) — the full mechanism behind step 3
- [Your first chat](first-chat.md) — what a successful completion looks like day to day
