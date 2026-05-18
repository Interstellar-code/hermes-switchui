---
title: About /docs
description: What the /docs page is and how to contribute to it.
---

# About /docs

The **/docs** page is the built-in documentation viewer for Hermes Switch UI. It renders
Markdown files that live inside the `docs/` folder of the repository and serves them as
a navigable knowledge base — no external hosting required.

## What you'll find here

Docs are organized into sections that mirror the app's primary navigation:

- **Getting Started** — installation, first chat, connecting a provider, and picking a theme.
- **Main** — one page per app section: Dashboard, Chat, Files, Terminal, Jobs, Tasks, Boards, Workflows, Conductor, Operations, and Matrix3D.
- **Knowledge** — Memory.
- **Settings** — Themes, sidebar layout, preferences, providers, profiles, Skills, and MCP.
- **Tips** — Power-user shortcuts, composer tricks, and search.
- **Troubleshooting** — Common problems and how to fix them.

## How docs are built

Each `.md` file in `docs/` maps to a slug in `docs/docs-manifest.yaml`. The manifest controls
which files appear in the sidebar and in what order. Files not listed in the manifest are
ignored by the viewer.

The renderer supports GitHub-flavoured Markdown, Mermaid diagrams, syntax-highlighted code
blocks, and relative `.md` links that resolve automatically to in-app `/docs/` routes.

## Contributing or editing docs

To add a new page or edit an existing one, see
[Authoring docs](../getting-started/authoring-docs.md).
That guide covers the manifest format, frontmatter fields, link conventions, and screenshot
placeholders.
