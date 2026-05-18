---
title: Composer tricks
description: Power-user tips for getting the most out of the message composer.
---

# Composer tricks

The message composer supports more than plain text entry. This page covers the features that are easy to miss.

## Sending and line breaks

By default, `Enter` sends the message and `Shift+Enter` inserts a newline. You can flip this in **Settings → Chat**:

- **Send mode** (default): `Enter` sends, `Shift+Enter` inserts a newline.
- **Newline mode**: `Enter` inserts a newline, `Cmd+Enter` / `Ctrl+Enter` sends.

## Attaching files

You can attach files to any message in three ways:

1. **Drag and drop** — drag one or more files from your file manager onto the composer area. A drop target appears when a draggable file enters the window. Only image files and text files are accepted; other types are silently dropped.
2. **Paste** — copy an image or text file to your clipboard and paste with `Cmd+V` / `Ctrl+V`. Images are compressed before upload; files larger than 50 MB are rejected with a warning.
3. **File picker** — click the attachment button in the composer toolbar.

Accepted types:
- Images (JPEG, PNG, GIF, WebP, and others)
- Text files (plain text, source code, markdown, etc.)

Images over 1 MB after compression produce a warning toast and are not attached.

## Slash commands

Type `/` in an empty composer to open the slash command menu. Continue typing to filter. Use `Arrow Up` / `Arrow Down` to navigate and `Enter` or `Tab` to select. Press `Escape` to dismiss without selecting.

Available built-in slash commands:

| Command | What it does |
|---|---|
| `/new` | Start a new session |
| `/clear` | Clear the screen and start fresh |
| `/model` | Show or change the current model |
| `/save` | Save the current conversation |
| `/skills` | Browse and manage skills |
| `/plugins` | List installed plugins |
| `/mcp` | Manage MCP servers |
| `/skin` | Change the display theme |
| `/help` | Show available commands |

## Model selector

Press `Cmd+Shift+M` / `Ctrl+Shift+M` at any time while the composer is focused to open the model picker without reaching for the toolbar.

## Related

- [Keyboard reference](./shortcuts.md)
- [Search](./search.md)
