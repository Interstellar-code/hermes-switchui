---
title: Themes
description: Switch between the built-in light and dark themes to suit your environment.
---

# Themes

Hermes Switch UI ships with ten themes organised as five base palettes, each available in a dark and a light variant. You can switch at any time without restarting the app.

> [SCREENSHOT: Theme picker grid showing all ten swatches, Nous selected]

## What you see

Open **Settings** from the sidebar, then choose **Appearance** in the settings navigation (under the **General** group, or jump straight to `/settings?section=appearance`). The section contains a single card:

- **Theme** — a segmented picker listing the five base palettes. Selecting a palette applies it immediately; the card is labelled **Saves immediately** because it never uses the page's save bar. Changes are local to the browser.

Earlier builds also showed Density, Fonts, and Matrix Rain controls here. None of them was wired to anything — they persisted values no code read — so they were removed rather than left as switches that silently did nothing.

> **Note:** The picker shows only the five base (dark) palettes. Light variants of each palette exist in code but are not exposed in this picker.

## Available themes

The picker exposes five base palettes. Ten theme IDs exist in code (each palette has a dark and a light variant), but only the five base entries are selectable from the Appearance section.

| Picker label | Character |
|---|---|
| Nous | Deep teal background, cream accent |
| Matrix | Black glass terminal field with phosphor green signal glow |
| Hermes | Navy and indigo flagship theme |
| Bronze | Bronze accents on dark charcoal |
| Slate | Cool slate dark |

## How to switch themes

1. Open **Settings** (gear icon in the sidebar).
2. Select **Appearance** in the left navigation (under **General**).
3. In the **Theme** card, click any palette option. The new theme applies immediately across the entire interface.

No save button is needed. The change takes effect as soon as you click.

## Where data lives

The active theme ID is stored in the browser's `localStorage` under the key `claude-theme`. The `data-theme` attribute on the root `<html>` element is updated on every switch; this is what the CSS variable cascade reads. If `localStorage` is cleared the app falls back to the **Nous** dark theme.

## Common issues

**Theme reverts after reload.** Your browser may be set to clear site data on close. Allow `localStorage` for this origin in your browser's privacy settings.

## Related

- [Picking a theme](../getting-started/theme.md) — first-run guidance
- [Preferences](./preferences.md) — other display settings
