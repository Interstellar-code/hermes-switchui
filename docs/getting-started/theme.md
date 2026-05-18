---
title: Picking a theme
description: Choose and apply a visual theme to personalise Hermes Switch UI.
---

# Picking a theme

Hermes Switch UI ships with ten themes — five base palettes, each in a dark and a light variant. You can switch at any time without restarting.

> [SCREENSHOT: Theme picker open in Settings]

## Available themes

| Name | Dark variant | Light variant | Character |
|---|---|---|---|
| Nous | `claude-nous` | `claude-nous-light` | Deep teal background, cream accent |
| Hermes | `claude-official` | `claude-official-light` | Navy and indigo flagship |
| Bronze | `claude-classic` | `claude-classic-light` | Bronze accents on dark charcoal |
| Slate | `claude-slate` | `claude-slate-light` | Cool blue developer palette |
| Matrix | `matrix` | `matrix-light` | Black glass terminal with phosphor green |

The default theme is **Nous** (dark).

## Changing the theme

1. Open **Settings** (gear icon in the sidebar, or press `Cmd+,` / `Ctrl+,`).
2. Select the **Appearance** section.
3. Click any theme tile to apply it immediately. The page updates without a reload.

You can also switch themes mid-session. Any conversation in progress is not affected.

> [SCREENSHOT: Appearance section showing theme tiles]

## How persistence works

Your choice is stored in `localStorage` under the key `claude-theme`. It persists in the browser across sessions on the same device. If you clear site data or open the app in a different browser profile, the theme resets to Nous dark.

The theme is applied before the first render via an inline script in the page `<head>`, so there is no flash of the wrong theme on load.

## Related

- [Themes reference](../settings/themes.md) — full list of CSS variables, how to customise colours, and how to build your own theme
