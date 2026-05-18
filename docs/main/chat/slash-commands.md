---
title: Slash commands
description: Use slash commands in the composer to trigger quick actions and skills.
---

# Slash commands

Slash commands are shortcuts you type directly in the composer. They let you perform common actions — starting a new session, changing settings, clearing the screen — without leaving the keyboard.

> [SCREENSHOT: Slash command menu open in the composer showing a list of available commands with descriptions]

## Using slash commands

Type `/` at the very beginning of a message. A command menu appears above the composer listing all available commands and a short description of each. Continue typing to filter the list. Use the arrow keys to move between entries and press Enter to select one, or click a command directly.

The menu dismisses if you press Escape or delete the `/` character. If the selected command opens a dialog or panel, the composer text is cleared automatically.

## Available commands

| Command | What it does |
|---------|-------------|
| `/new` | Start a new chat session. Navigates to a fresh session without closing the current one. |
| `/clear` | Clear the visible message history in the current session and start fresh. |
| `/model` | Open the model selector to view or change the active model. |
| `/skin` | Open the appearance settings to change the display theme. |
| `/save` | Save the current conversation. |
| `/skills` | Browse and manage installed skills. |
| `/plugins` | List installed plugins and their status. |
| `/mcp` | Open the MCP server management panel. |
| `/help` | Show available commands. |

## How slash commands are handled

Commands that navigate or open panels (`/new`, `/model`, `/skin`, `/mcp`) are handled client-side by the chat screen before the message is sent to the agent. The text never reaches the gateway.

Commands that are not matched client-side are passed through as plain text to the model, so you can still type `/something-custom` and have the model respond to it as a regular message.

## Common issues

**The menu does not appear when I type `/`** — Make sure the `/` is the very first character in the composer. Leading spaces prevent the menu from opening.

**A command opens the wrong panel** — `/model` and `/skin` dispatch custom browser events that the settings panel listens for. If the panel does not respond, try reloading the page.

**I want to send a literal `/` message** — Type your slash text as normal and wait for the menu to appear, then press Escape to dismiss it, then continue typing and send. Alternatively, start the message with any non-slash character and add the `/` later.

## Related

- [The composer](./composer.md)
- [Keyboard shortcuts](./shortcuts.md)
