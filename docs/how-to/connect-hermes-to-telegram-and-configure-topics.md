---
title: Connect Hermes to Telegram and configure topics
description: Connect Hermes to Telegram, control who can talk to it, and split conversations across Telegram topics.
---

# Connect Hermes to Telegram and configure topics

> Connect your Hermes agent to Telegram, lock down who can talk to it, choose where replies get delivered, and optionally split work into separate Telegram topics.

<iframe
  src="/api/docs-asset?path=diagrams/telegram-channel-and-topics-flow.html"
  width="100%"
  height="980"
  loading="lazy"
  style="border: 0; border-radius: 8px;"
></iframe>

Hermes can run inside Telegram as a full messaging gateway, which means you can chat with it from your phone, receive scheduled job output in Telegram, and keep separate workstreams isolated in different topics.

This guide covers two related things:

1. connecting Hermes to Telegram at all
2. configuring **topics** so different conversations stay separate

## What you need before you start

- a working Hermes installation
- access to the machine running the Hermes gateway
- a Telegram account
- permission to create a bot with **@BotFather**

If you have not configured Hermes yet, do that first.

## Step 1: Create a Telegram bot with BotFather

Open Telegram and message [@BotFather](https://t.me/BotFather).

Run:

```text
/newbot
```

BotFather will ask for:

- a display name
- a bot username ending in `bot`

When it finishes, it gives you a bot token that looks like this:

```text
123456789:ABCdefGHIjklMNOpqrSTUvwxYZ
```

Treat that token like a password.

Optional but recommended BotFather commands:

- `/setdescription`
- `/setabouttext`
- `/setuserpic`
- `/setcommands`

A simple command menu is enough to start:

```text
help - Show help information
new - Start a new conversation
sethome - Set this chat as the home channel
topic - Configure topic mode
```

## Step 2: Add the Telegram credentials to Hermes

Hermes reads platform secrets from `~/.hermes/.env`.

Add your bot token there:

```bash
TELEGRAM_BOT_TOKEN=123456789:ABCdefGHIjklMNOpqrSTUvwxYZ
```

You should also restrict who is allowed to use the bot.

The Hermes Telegram docs explicitly recommend setting `TELEGRAM_ALLOWED_USERS`.
Use your Telegram numeric user ID, not your display name.

```bash
TELEGRAM_ALLOWED_USERS=123456789
```

If multiple people should be allowed, use the format documented by your Hermes install. If you are unsure of your own numeric Telegram ID, message a helper bot such as `@userinfobot` and use the number it returns.

## Step 3: Start or reconfigure the Hermes gateway

The easiest path is the built-in gateway setup flow:

```bash
hermes gateway setup
```

Then start the gateway:

```bash
hermes gateway start
```

Useful checks:

```bash
hermes gateway status
hermes doctor
```

If you changed `.env` or gateway-related config, restart the gateway so Telegram picks up the new settings.

## Step 4: Test the bot in a direct message

Open your bot in Telegram and send a message.

If the bot replies, the basic connection is working.

If it does not reply:

- verify `TELEGRAM_BOT_TOKEN`
- verify `TELEGRAM_ALLOWED_USERS`
- check Hermes gateway logs
- confirm the gateway is actually running

## Step 5: Choose where Telegram deliveries should go

Hermes can send results back to a Telegram destination, especially for scheduled jobs and background workflows.

To make the current Telegram chat the default destination, run this inside Telegram:

```text
/sethome
```

That marks the current chat as the home channel for that Hermes profile.

This matters because:

- cron jobs can deliver back to the origin or home channel
- alerts and autonomous outputs need a known destination
- the same Hermes profile can be reachable from more than one platform

If you want a **specific forum topic** or Telegram thread to be the target, run `/sethome` from inside that thread.

## Step 6: Decide which topic model you want

Hermes supports two different ways to split Telegram conversations into isolated contexts.

### Option A: Operator-defined topics in config

Use this when you want a fixed set of known workspaces such as:

- Ops
- Research
- Sales
- Personal

This is the **config-driven** model.

The Hermes docs describe two related config families:

- `dm_topics` for private-chat topics
- `group_topics` for Telegram forum topics in groups

Use this model when you want the operator to control the structure.

Typical advantages:

- stable topic names
- optional skill binding per topic
- predictable workspace layout
- clean separation between long-lived projects

### Example: DM topics in `config.yaml`

A DM topic can be mapped to a skill and optionally a `channel_prompt`.
When Hermes starts, topics missing a `thread_id` can be created automatically and the returned `thread_id` is written back into config.

```yaml
telegram:
  dm_topics:
    - name: Ops
      icon_color: 7322096
      skill: kanban-orchestrator
      channel_prompt: "You are operating in the Ops workspace. Focus on execution and blockers."
    - name: Research
      icon_color: 9367192
      skill: blogwatcher
      channel_prompt: "You are operating in the Research workspace. Focus on synthesis and source-backed answers."
```

Useful fields you will commonly see here:

- `name`
- `icon_color`
- `thread_id`
- `skill`
- `channel_prompt`

### Example: Group forum topics in `config.yaml`

For Telegram groups and supergroups, the same pattern applies through `group_topics`.
In that case you usually bind Hermes to an existing group topic by `thread_id`.

```yaml
telegram:
  group_topics:
    - chat_id: -1001234567890
      thread_id: 16
      name: Neo lane
      skill: neo-personality
      channel_prompt: "This topic is for Neo-style technical execution inside the shared group."
    - chat_id: -1001234567890
      thread_id: 22
      name: Planning
      skill: writing-plans
      channel_prompt: "Keep discussion scoped to implementation plans and task breakdowns."
```

## Important limitation: topics map to skills, not profiles

This is the part that often trips people up.

Today, Hermes topic mapping can apply:

- a `skill`
- an optional `channel_prompt`

But it does **not** directly route a Telegram topic to:

- a different Hermes profile
- a different model/provider

So if you want a topic to behave like `neo`, the lightweight approach is to bind that topic to a `neo`-style skill or personality skill.
If you want a topic handled by a truly separate Hermes profile, the practical solution today is to run a **separate Telegram bot for that profile**.

### Option B: User-driven `/topic` mode

Use this when you want users to create parallel threads on demand directly in Telegram.

This is the **ad-hoc** model.

In Hermes, this is enabled by running:

```text
/topic
```

inside the bot DM.

Once enabled, the DM behaves more like a lobby and users create work inside topics rather than in the root message stream.

Typical advantages:

- no need to predefine a topic list
- users can create threads as needed
- each topic gets its own session binding automatically
- `/new` inside one topic resets only that one topic's conversation

## How config-driven DM topics work

According to the Hermes Telegram docs, private chat topics can now exist directly inside a 1-on-1 DM with the bot.

The important behavior is:

1. Hermes creates the topic if needed
2. Telegram assigns a `thread_id`
3. Hermes writes that `thread_id` back into config
4. each topic gets its own isolated session key

That makes config-driven DM topics a good fit for a small set of durable workspaces.

## How group forum topics work

Group topics are different from DM topics.

For Telegram forum groups:

- the group admin usually creates the topics in Telegram itself
- Hermes binds to those topics using `thread_id`
- each topic already has native Telegram thread isolation

If you need to find a `thread_id`, the Hermes docs note that in Telegram Web or Desktop the topic URL usually ends with the thread number.

## How `/topic` mode differs from config-driven topics

The Hermes docs make this distinction clearly:

- `extra.dm_topics` is operator-defined and fixed in config
- `/topic` is user-driven and dynamic

A simple way to think about it:

- use **config-defined topics** for permanent workspaces
- use **`/topic` mode** for ad-hoc parallel sessions

You can document both for users, but it is better to choose one main pattern for each bot so the behavior feels consistent.

## Group chat privacy mode matters

If you want Hermes to work in a Telegram group, Telegram privacy mode becomes important.

With privacy mode on, the bot only sees a limited subset of messages.
With privacy mode off, the bot can see all group messages.

To disable privacy mode:

1. message **@BotFather**
2. run `/mybots`
3. select your bot
4. open **Bot Settings → Group Privacy → Turn off**

Important: after changing privacy mode, you must usually **remove and re-add the bot** to the group, because Telegram caches the privacy state.

An alternative is to make the bot a group admin.

## Polling vs webhook mode

By default, Hermes uses **long polling** for Telegram.

That is usually the easiest option when:

- you run Hermes locally
- your server is always on
- you do not need public inbound HTTPS

Webhook mode is better when:

- you deploy to a cloud host that sleeps when idle
- you want Telegram to push updates to Hermes
- you already have a public HTTPS endpoint

For webhook mode, the Hermes docs call out `TELEGRAM_WEBHOOK_URL` as the key setting.

## Example operator workflow

A practical rollout looks like this:

1. create the bot in BotFather
2. put `TELEGRAM_BOT_TOKEN` into `~/.hermes/.env`
3. set `TELEGRAM_ALLOWED_USERS`
4. run `hermes gateway setup`
5. start the gateway
6. DM the bot and confirm it responds
7. run `/sethome` in the Telegram destination you care about
8. choose either:
   - config-defined topics for stable workspaces, or
   - `/topic` mode for user-created threads

## Troubleshooting

### Bot does not respond at all

Check:

- `TELEGRAM_BOT_TOKEN`
- gateway status
- Hermes logs
- whether the gateway was restarted after config changes

### Bot says you are unauthorized

Check `TELEGRAM_ALLOWED_USERS` and confirm you used the right numeric Telegram user ID.

### Bot ignores group messages

Most often:

- privacy mode is still on, or
- the bot was not re-added after privacy mode changed, or
- mention requirements are blocking ordinary messages

### Topics are confusing or inconsistent

Usually this means the bot is mixing two different models:

- config-defined topics
- user-created `/topic` sessions

That can work, but it should be intentional.

## Recommendation

If you are setting this up for a team, start with **config-defined topics** because they are easier to explain and keep stable.

If you are setting this up mainly for yourself and want lightweight parallel chats, use **`/topic` mode**.

Both are valid. The right choice depends on whether you want operator control or user-created flexibility.
