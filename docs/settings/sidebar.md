---
title: Sidebar layout
description: Reorder, hide, or pin sidebar items to match your workflow.
---

# Sidebar layout

The sidebar is the primary navigation rail on the left side of the app. It can be expanded to show labels or collapsed to a narrow icon-only rail.

> [SCREENSHOT: Sidebar expanded showing Main section with nav items and group labels]

## What you see

The sidebar contains two elements at the top: a **collapse/expand toggle** button and a **New session** button (when a chat session is active). Below those, navigation items are grouped under labelled sections.

### Navigation groups

When the sidebar is expanded, items are organised under these group labels:

**Main**

- Dashboard
- Chat
- Files
- Terminal
- Jobs
- Tasks (with optional sub-items for individual boards when expanded)
- Workflows
- Conductor
- Operations

**Knowledge**

- Memory
- Skills
- MCP
- Profiles

**Settings / Help**

- Settings
- Help / Docs

Some items may not appear if the required gateway capability is not available at startup. For example, Tasks requires the Kanban plugin, and MCP requires the agent's MCP endpoint.

## Collapsed mode

Click the collapse toggle (chevron icon at the top of the sidebar) to collapse the rail. In collapsed mode only icons are shown — group labels and item text are hidden. Hover over an icon to see a tooltip with the item label. Click any icon to navigate.

The collapsed state is persisted across reloads.

## Active states

The current page's item is highlighted with the accent colour. Items with live counts (for example, Tasks showing the number of open boards) display a numeric badge that is visible in both expanded and collapsed modes.

## Where data lives

The sidebar's collapsed state is stored in `localStorage`. Navigation state is driven by the URL via TanStack Router — navigating away from a route automatically updates the active item.

## Common issues

**An item I expect to see is missing.** Some items are gated on gateway capabilities that are probed at startup. If the gateway is not running or a required plugin is not installed, the corresponding item may be hidden. Check the gateway connection status on the Dashboard.

**Sidebar is stuck in collapsed mode.** Clear `localStorage` and reload, or click the collapse toggle at the top of the sidebar.

## Related

- [Themes](./themes.md) — change the visual appearance
- [Preferences](./preferences.md) — other interface settings
