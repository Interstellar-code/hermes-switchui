# Telegram bot not responding or topics not working

> Use this checklist when your Hermes Telegram bot is online but messages, topics, permissions, or deliveries are not behaving the way you expect.

## 1. Bot does not reply at all

Check these first:

- `TELEGRAM_BOT_TOKEN` is present and correct
- the Hermes gateway is running
- the gateway was restarted after `.env` or config changes
- you are included in `TELEGRAM_ALLOWED_USERS`

Good commands to run on the host:

```bash
hermes gateway status
hermes doctor
```

If needed, restart the gateway:

```bash
hermes gateway restart
```

## 2. Bot says you are unauthorized

This usually means `TELEGRAM_ALLOWED_USERS` is missing your numeric Telegram user ID.

Do not use your display name or @username there.
Use a numeric ID.

If you do not know your Telegram ID, message a helper bot such as `@userinfobot`.

## 3. Bot works in DM but ignores group messages

Most often this is caused by Telegram privacy mode.

By default, privacy mode is on, which means the bot only sees:

- slash commands
- replies to the bot
- limited service messages

To change that:

1. open **@BotFather**
2. run `/mybots`
3. select your bot
4. open **Bot Settings → Group Privacy → Turn off**

Then remove and re-add the bot to the group.
Telegram caches the privacy setting when the bot joins.

Alternative: make the bot a group admin.

## 4. `/sethome` seems to point to the wrong place

Run `/sethome` from the exact Telegram destination you want Hermes to use.

That means:

- in the DM if you want the DM as home
- in the group if you want the group as home
- inside the specific forum topic if you want that topic as home

If you run it in the wrong place, cron output and other deliveries may go somewhere unexpected.

## 5. Topic messages are mixing together

First decide which model you are using:

- **config-defined topics** via `dm_topics` / `group_topics`
- **user-driven topic mode** via `/topic`

Both can exist, but mixing them without a plan can confuse users.

Use config-defined topics when you want fixed workspaces.
Use `/topic` when you want ad-hoc user-created threads.

## 6. Topic skill binding is not doing what you expected

Hermes topic mapping currently applies:

- a `skill`
- an optional `channel_prompt`

It does **not** currently switch the topic to:

- a different Hermes profile
- a different model/provider

So if you mapped a topic expecting it to become a totally separate profile, that will not happen with topic config alone.

## 7. You want a topic handled by a separate profile such as Neo

That requires a different architecture.

The practical pattern today is:

- create a dedicated Telegram bot for the separate profile
- run that profile’s own gateway process
- add that bot to the relevant group or chat

That gives you true profile separation.

## 8. Group topic binding is not working

For group topics, verify:

- the bot is actually in the group
- the bot has enough visibility to read the topic
- the `chat_id` is correct
- the `thread_id` is correct

A common way to confirm `thread_id` is from Telegram Web or Desktop, where the topic URL usually ends with the thread number.

## 9. Webhook deployments are flaky

If you are using webhook mode, verify:

- `TELEGRAM_WEBHOOK_URL` is public and reachable
- the URL is HTTPS
- your reverse proxy routes requests correctly to Hermes
- firewall rules are not blocking inbound traffic

If you do not need webhook mode, long polling is simpler.

## 10. Voice works poorly or replies are weird files

This is usually not a Telegram problem.

Check Hermes voice dependencies:

- STT available for transcription
- `ffmpeg` installed if voice replies should become proper Telegram voice bubbles

## Quick recommendation

If you are just getting started:

1. get DM chat working first
2. run `/sethome`
3. add group support second
4. add topic routing only after the basic bot flow is stable

That sequence keeps troubleshooting much easier.
