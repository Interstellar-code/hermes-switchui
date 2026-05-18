---
title: Profiles
description: Create and switch between named agent profiles with different settings.
---

# Profiles

The Profiles page lets you browse and manage saved agent personas. Each profile stores a named configuration that the agent can adopt when starting a conversation.

> [SCREENSHOT: Profiles page showing a grid of profile cards]

## What you see

Navigate to **Profiles** in the sidebar under the Knowledge group. The page shows a grid of profile cards. Each card displays the profile name, an avatar or glyph, and a short description or badge strip indicating the profile's characteristics.

Clicking a card opens a detail drawer on the right side of the screen. The drawer shows the full profile metadata and any associated configuration.

## Profile cards

Each card includes:

- **Name** — the profile's display name.
- **Avatar / glyph** — a visual identifier for the profile.
- **Badges** — labels indicating the profile's type or capabilities (for example, a trust level or origin tag).

## Detail drawer

The detail drawer shows expanded profile information. From the drawer you can:

- View the profile's full description.
- See what capabilities or constraints the profile applies.
- Select the profile for use in a new chat session (if the gateway supports profile-switching).

## Where data lives

Profiles are stored on the agent side and fetched from the gateway at page load. They are not stored in the browser. If the gateway is not reachable, the page shows a backend-unavailable state.

## Common issues

**Profiles page is blank or shows an error.** The gateway must be running and the profiles endpoint must be available. Check the connection status on the Dashboard.

**A profile I created does not appear.** Profiles created directly in the agent config may require a gateway restart before they appear in the UI.

## Related

- [Skills](./skills.md) — skills the agent can invoke
- [MCP](./mcp.md) — external tool servers
