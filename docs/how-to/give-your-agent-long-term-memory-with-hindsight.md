---
title: Give your agent long-term memory with Hindsight
description: Connect a Hermes agent to the Hindsight memory backend so it can retain and retrieve knowledge across sessions.
---

# Give your agent long-term memory with Hindsight

> Add a real long-term memory backend so your Hermes agent can remember useful facts across conversations instead of relying only on the current session.

<iframe
  src="/api/docs-asset?path=diagrams/hindsight-long-term-memory-flow.html"
  width="100%"
  height="900"
  loading="lazy"
  style="border: 0; border-radius: 8px;"
></iframe>

Hermes agents can work without persistent memory, but they become much more useful when they can retain preferences, environment facts, and durable project knowledge between sessions.

One way to do that is to use **Hindsight** as the memory backend.

## What Hindsight gives you

With Hindsight enabled, the agent can store and retrieve durable facts across sessions. In practice, that means the agent can remember things like:

- your preferred tone and workflow
- stable project conventions
- environment details that matter later
- long-lived setup facts you do not want to repeat in every chat

This is different from chat history. Session history helps with recalling what happened in a prior conversation. Long-term memory helps the agent carry forward durable knowledge from many conversations.

## Before you start

This guide assumes:

- Hermes Agent is already installed and running
- Hermes Switch UI can already connect to the agent
- you want to configure memory for a specific agent profile

In Hermes Switch UI, the memory configuration notice appears on the **Memory** page, but the actual provider setup lives in the agent profile configuration, not in the Memory page itself.

## Where memory is configured

Hermes stores memory provider settings in the agent configuration. In the docs UI, the relevant note is on the [Memory](../knowledge/memory.md) page:

- the **Memory** page lets you inspect and edit memory files
- per-agent memory provider configuration is managed in the agent's **Profile** wizard

So there are two parts:

1. enable Hindsight as the backend in the agent configuration
2. use the UI to inspect the memory the agent accumulates

## Step 1 — choose the profile you want to upgrade

If you run multiple Hermes profiles, decide which one should get long-term memory first.

Examples:

- your main daily assistant profile
- a coding-focused profile
- a research-focused profile

Keeping memory profile-specific is often cleaner than giving every agent the same store immediately.

## Step 2 — configure Hindsight as the memory backend

Open the profile configuration for the agent you want to upgrade and set its memory provider to Hindsight.

The exact values depend on how your Hermes installation exposes memory settings, but the goal is the same:

- persistent memory enabled
- user profile memory enabled if you want preference retention
- provider set to `hindsight`

If you are editing configuration directly, look for the `memory` section in the relevant Hermes config and make sure it points at Hindsight.

A typical target state looks like this conceptually:

```yaml
memory:
  memory_enabled: true
  user_profile_enabled: true
  provider: hindsight
```

If your setup uses profile-specific config, apply the change to that profile rather than assuming the global default is enough.

## Step 3 — make sure Hindsight is available in your environment

After you point Hermes at Hindsight, the backend itself must be available to the agent at runtime.

In practice that means:

- the Hindsight integration is installed and enabled in your Hermes environment
- any required credentials or storage configuration for Hindsight are present
- Hermes can start without memory-provider errors

If Hindsight is missing or misconfigured, the agent may fall back to no memory or log startup errors.

## Step 4 — restart the agent

Restart the Hermes Agent after changing the memory provider.

This ensures the profile reloads the memory backend configuration cleanly.

## Step 5 — verify from Hermes Switch UI

Open Hermes Switch UI and check two things.

### A. The agent still responds normally

Send a regular chat prompt. The agent should respond as usual.

### B. The Memory page reflects ongoing memory use

Open **Memory** and inspect the agent's memory area. Depending on your setup, you should start to see persistent memory artifacts accumulate as the agent stores durable facts.

Remember: the Memory page is mainly an inspection and editing surface. It is not the place where you switch the provider on.

## How to test that long-term memory is working

A simple test flow:

1. tell the agent a durable preference such as your preferred response style
2. explicitly say it should remember that preference
3. start a fresh session later
4. ask the agent something that should reflect that preference

If Hindsight is working, the new session should be able to recover that stored preference without you re-teaching it.

Good test facts are:

- preferred tone
- preferred coding language or framework
- stable project path
- recurring communication preference

Avoid testing with temporary details that should not be remembered.

## What to store in long-term memory

Good candidates:

- user preferences
- stable environment facts
- project conventions that will still matter later
- durable corrections to how the agent should behave

Bad candidates:

- temporary task progress
- one-off bugfix outcomes
- stale issue numbers or PR numbers
- anything that will stop being useful in a few days

Long-term memory is most valuable when it reduces repeated steering.

## How Hindsight fits with the Memory page

It helps to separate three ideas:

### Session history

What happened in a past conversation.

### Long-term memory

Durable facts the agent should keep using later.

### Knowledge files in the Memory UI

Editable files and knowledge surfaces you can inspect directly in Hermes Switch UI.

These overlap, but they are not the same system.

## Common mistakes

### I edited memory files but the agent still does not remember things

Editing files in the Memory UI does not automatically prove that a long-term backend is configured. Check that the profile actually uses Hindsight.

### The agent remembers things in one session but not another

That often means you are using multiple profiles and only one has Hindsight enabled.

### The agent forgets after restart

That usually means the memory backend was not configured persistently, or Hindsight itself is not storing successfully.

### I expected chat transcript recall, not durable memory

Use session history for conversation recall. Use Hindsight for stable cross-session memory.

## Recommended rollout

Start small:

1. enable Hindsight on one profile
2. test with two or three durable preferences
3. confirm the behavior survives a new session
4. expand to other profiles only after the pattern is working

## Related

- [Memory](../knowledge/memory.md)
- [Profiles](../settings/profiles.md)
- [FAQ](../faq.md)
