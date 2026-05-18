---
title: The composer
description: Learn how to use the message composer to write and send prompts.
---

# The composer

The composer is the text input area at the bottom of the chat screen. It is where you write prompts, attach files, trigger slash commands, and control model settings before sending a message.

> [SCREENSHOT: Composer bar showing text area, model picker, thinking-level button, attachment button, and send button]

## What you see

The composer bar contains:

- **Text area** — grows vertically as you type; supports plain text and multi-line input.
- **Model picker** — shows the currently active model. Click to switch models for the session.
- **Thinking level** — a toggle that cycles through `off`, `low`, `medium`, and `high` reasoning effort. On Claude 4.6 the default is `adaptive`.
- **Attachment button** — opens the file picker to attach images or documents.
- **Voice button** — records a voice message and transcribes it into the text area.
- **Send button** — submits the message. Disabled while a response is streaming; replaced by a **Stop** button you can click to abort.
- **Web search toggle** — enables web search augmentation when the gateway supports it.

## Sending a message

Type your prompt and press **Enter** to send. To insert a real newline without sending, press **Shift+Enter**.

On desktop you can also use **Cmd+Enter** (Mac) or **Ctrl+Enter** (Windows/Linux) to send without moving your hands from the keyboard.

## Switching models mid-session

Click the model name in the composer to open the model picker. Select a different model; the change takes effect on the next message. The chosen model is written to the gateway config so it persists across page reloads. Local models (Ollama) are tracked client-side only and are not written to the gateway.

To open the model selector with the keyboard, press **Cmd+Shift+M** (Mac) or **Ctrl+Shift+M** (Windows/Linux).

## Adjusting thinking level

Click the thinking-level icon to cycle through the available effort tiers. Higher levels give more thorough reasoning at the cost of longer response time. Set it to `off` to disable extended thinking entirely.

## Attaching files

Click the paperclip icon or drag a file onto the composer to attach it. See [Attaching files](./files.md) for supported types and size limits.

## Using slash commands

Type `/` at the start of a message to open the slash command menu. See [Slash commands](./slash-commands.md) for the full list.

## Aborting a response

While the model is generating, the Send button becomes a **Stop** button. Click it to abort the current stream. Partial output already in the thread remains visible.

## Common issues

**Enter sends when I want a newline** — Use Shift+Enter for newlines. There is no setting to swap Enter and Shift+Enter.

**Model picker shows no models** — The gateway may not be running, or no provider is configured. See [Connecting your AI provider](../getting-started/connecting-provider.md).

**Voice button is greyed out** — Browser microphone permission may have been denied. Check your browser site settings and reload.

## Related

- [Attaching files](./files.md)
- [Slash commands](./slash-commands.md)
- [Keyboard shortcuts](./shortcuts.md)
- [Sessions and history](./sessions.md)
