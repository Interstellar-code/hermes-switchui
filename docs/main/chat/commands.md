---
title: Commands
description: Create and manage custom slash commands — reusable prompt templates triggered by a /keyword in the composer.
---

# Commands

The Commands page lets you define custom slash commands. Each command maps a `/keyword` to a stored prompt template. When you type the keyword in the composer, the template is expanded and sent to the model as a regular message.

> [SCREENSHOT: Commands page showing the command list with name, slash trigger, description, enabled toggle, and an open editor drawer]

## What you see

Navigate to **Commands** in the sidebar. The page shows a searchable list of your saved commands. Each row shows the command's initials badge, name, `/slash` trigger, description, enabled state, and last-updated timestamp. A filter bar lets you show all, enabled-only, or disabled-only commands.

## Creating a command

Click **New Command** (or the **+** button) to open the editor drawer. Fill in:

- **Name** — a human-readable label for the command.
- **Slash** — the trigger keyword, normalised to lowercase with a leading `/` (for example, `summarise` becomes `/summarise`). Must be unique.
- **Description** — a short summary shown in the slash command menu in the composer.
- **Prompt** — the template text sent to the model when the command is triggered. The text can include `{{input}}` to forward anything you type after the slash keyword.
- **Enabled** — toggle to include or exclude the command from the composer menu without deleting it.

Click **Save** to persist the command.

## Editing and deleting

Click any command row to open it in the editor drawer. Change any field and save. To delete, use the delete button in the drawer; deletion is permanent.

## Using commands in chat

Defined and enabled commands appear in the slash command menu alongside built-in commands. Type `/` in the composer to open the menu, continue typing to filter, and select your command. The stored prompt replaces the slash text before the message is sent. Built-in commands (like `/stop`, `/title`, `/reasoning`) always take priority over custom commands with the same trigger.

## Common issues

**My command does not appear in the composer menu.** Make sure the command is set to **Enabled**. Disabled commands are saved but not shown in the menu.

**Slash trigger is already taken.** Each slash keyword must be unique. If a built-in command uses the same trigger, the built-in always wins.

## Related

- [Slash commands](./slash-commands.md) — built-in slash commands and how they work
- [The composer](./composer.md) — the message input bar
