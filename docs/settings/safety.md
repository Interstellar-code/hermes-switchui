---
title: Safety
description: Command approvals, the permanent allowlist, and the Tirith pre-execution scanner — together, what actually stops a destructive command.
---

# Safety

> **Settings → System → Safety** is one page for everything that jointly decides whether the agent can destroy something unattended: the approval mode, a permanent allowlist that can bypass it entirely, and a scanner that can fail silently. Read them separately and each looks fine; read together, the combined posture can be very different from what any one setting implies.

> [SCREENSHOT: Settings → System → Safety, posture banner and command allowlist card]

## The combined-posture banner

The section leads with one computed sentence rather than three independent toggles, because a user who has never heard of `command_allowlist` should be able to read one line and know whether the current configuration is risky. It accounts for approval mode, the allowlist, and the scanner's fail-open setting together — for example, "Smart approval, but 3 commands bypass it entirely — including recursive delete and git force push."

## Command approval

`approvals.mode` has three values, defaulting to **smart**:

- **Manual** — every dangerous command needs your sign-off.
- **Smart** (default) — an auxiliary model screens commands and only prompts for ones it judges risky.
- **Off** — every prompt is skipped. This is the YOLO equivalent; the section's posture banner always reports it as critical.

`approvals.cron_mode` (default **deny**) governs what happens when a scheduled job hits a dangerous command with nobody present to approve it — **approve** means cron jobs can auto-run destructive commands unattended.

Two more confirmations default on: **destructive slash commands** (`/clear`, `/new`, `/reset`, `/undo` — anything that discards conversation state) and **MCP reloads** (`/reload-mcp`, which rebuilds the tool set and invalidates the prompt cache). **Auto-accept shell hooks** (`hooks_auto_accept`, default off) registers new shell-script hooks without a prompt — useful for headless/cron runs, but it means any hook a skill declares runs unreviewed.

## The permanent allowlist — the part that's easy to miss

`command_allowlist` is a flat array of dangerous-pattern names or raw command text/globs. Each entry, once added (typically by clicking "always approve" on a prompt), means the matching command **never gets classified as dangerous again** — the allowlist check runs *before* the danger classifier, not after it. An entry doesn't pre-approve a command the system has judged dangerous; it removes the command from consideration entirely, silently, for every future run.

This section lists every current entry with a plain-language description of what it actually permits — "Recursively deletes a directory tree (`rm -rf` and equivalents)," not just the raw pattern name — and a one-click **Revoke**. If you inherited a config with entries you don't recognize, this is where to see what they actually do before deciding whether to keep them.

## Pre-execution scanning (Tirith)

Tirith is a scanner that runs before commands execute, independent of the approval prompt. Two settings, both **on by default**:

- **Tirith scanner** — off means no pre-execution scanning runs at all; dangerous commands rely solely on the approval prompt and the allowlist above.
- **Fail open on scanner error** — on (the default) means a scanner outage or error is treated as **allow**, not block. In other words: if Tirith itself goes down, commands run as if nothing was scanned, silently. Turning this off makes an outage block risky commands instead of waving them through, at the cost of the scanner becoming a single point of failure for command execution.

The fail-open default is the detail most likely to surprise someone who assumes "the scanner is on" means "the scanner is enforcing." It means the scanner enforces *when it's reachable*.

## Common issues

**A command I expected to be blocked ran without a prompt.** Check the allowlist card first — an entry there means the command was never evaluated for danger. Revoke it if you don't recognize it or don't want the exemption.

**Approval mode is Manual but I keep seeing unattended runs.** Check `approvals.cron_mode` — if it's set to Approve, scheduled jobs bypass the interactive approval flow that Manual otherwise enforces for everything else.

**I don't know whether Tirith is actually protecting me right now.** The posture banner states this directly; a scanner outage with fail-open on is indistinguishable from no scanner at all, from the command's perspective.

## Related

- [Execution](./execution.md) — the sandbox these approvals gate
- [Profiles](./profiles.md) — per-profile config, including safety settings
