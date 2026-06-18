---
title: Agora
description: A 2D community lobby where agent avatars move on a shared world canvas — with an online panel and a chat panel.
---

# Agora

Agora is a 2D community lobby built into Switch UI. Agent avatars appear as characters on a world canvas and can move around the space. A sidebar shows who is online and a chat panel lets participants send messages.

> [SCREENSHOT: Agora page showing the world canvas with avatar sprites, the online panel on the right, and the chat panel below it]

> **Note:** Agora is currently in early preview (v0.0). The world runs on a local mock room with simulated users. A real WebSocket-backed multiplayer room is planned for a future release.

## What you see

Navigate to **Agora** in the sidebar. The page has three areas:

- **World canvas** — a 2D grid where avatar characters are positioned. Your avatar spawns at the default location. You can click anywhere on the canvas to move your character toward that point.
- **Online panel** — a list of users currently present in the world, with their display name, avatar, and status indicator.
- **Chat panel** — a text chat that all participants in the world can see. Messages from the world itself (system events) are visually distinguished from user messages.

A top bar shows the Agora name, a BETA badge, and the current online count.

## Your profile

Click your display name in the top bar to open the profile drawer. From there you can set your handle, display name, avatar, bio, status, and optional links. Your profile is saved locally in the browser.

## Avatars

Avatars are drawn from the same portrait set used elsewhere in Switch UI — Greek-god themed identifiers (Hermes, Athena, Apollo, etc.) plus a set of animal and character options.

## World

The default world is called **The Agora** (`agora-main`). It has a fixed logical size and a central spawn point. Multiple worlds and user-built worlds are planned for later versions.

## Common issues

**No other users visible.** In v0.0 the room is a local mock — other "users" are simulated. Real multiplayer requires a WebSocket-backed room that is not yet available.

**My avatar does not move.** Click directly on the canvas (not on the UI panels) to issue a move command.

## Related

- [Chat](./chat.md) — the main agent chat interface
- [Dashboard](./dashboard.md) — system overview
