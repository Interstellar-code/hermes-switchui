---
title: Authoring docs
description: How docs are organized, where files live, and how to add or edit them.
---

# Authoring docs

> The /docs page renders markdown files from the `docs/` folder. This page explains where docs live, how to add new ones, and the conventions to follow.

<iframe
  src="/api/docs-asset?path=diagrams/docs-authoring-pipeline.html"
  width="100%"
  height="900"
  loading="lazy"
  style="border: 0; border-radius: 8px;"
></iframe>

## How it works

All docs live in `docs/` as plain markdown files. A central manifest — `docs/docs-manifest.yaml` — controls what appears in the sidebar and in what order. Files that are not in the manifest are ignored by the renderer; they stay on disk but never appear in the doc site.

When you write a link to another doc using a relative `.md` path, the renderer rewrites it to an in-app route automatically. Similarly, image references are rewritten through an auth-gated asset endpoint so they load correctly regardless of how the app is deployed. Mermaid diagrams render client-side.

## Adding a new doc

There are three steps: create the file, register it in the manifest, and reload.

### 1. Create the markdown file

Place the file under `docs/`. Use kebab-case filenames. Group related docs into subfolders — `getting-started/`, `chat/`, `pages/`, and so on.

Every doc should start with frontmatter followed by a top-level heading and a lead sentence:

```markdown
---
title: Display title shown in the sidebar
description: One-line summary used as the page subtitle.
---

# Display title

> Lead sentence — what problem this doc solves.

## Section
...
```

The frontmatter `title` is overridden by the manifest's `title:` field if both are set, so you only need one of the two.

### 2. Add it to the manifest

Open `docs/docs-manifest.yaml` and insert your doc in the position you want it to appear in the sidebar. Order in the array is the order in the sidebar.

```yaml
pages:
  ...
  - slug: my-section/my-new-doc
    title: My new doc
  ...
```

The slug is the path relative to `docs/` without the `.md` extension. A slug of `getting-started/install` maps to `docs/getting-started/install.md`.

### 3. Reload

The dev server picks up manifest changes without a restart. Refresh `/docs` in your browser and your doc appears in the sidebar.

## Voice and style

Plain language. Active voice. Second person — "You can..." rather than "Users can...".

Keep paragraphs short: two to four sentences. Each paragraph should make one point. If you find yourself writing a long explanatory block, break it into a subsection with a `###` heading.

Use **bold** for UI labels that match what users see on screen: **Settings → Model & Provider**, **Save changes**. Use `code` formatting for file paths, environment variable names, shell commands, and code identifiers. No emojis. No marketing language.

Do not write what you cannot verify. If you are unsure how something works, read the source first or leave a `> [TODO: verify this]` note rather than guessing.

## Linking between docs

Use standard relative markdown links that point at the `.md` file:

```markdown
See [Your first chat](first-chat.md).
See [Agent won't connect](../troubleshooting/agent-connect.md).
```

The renderer rewrites these to in-app routes automatically so navigation stays within the single-page app without a full page reload. Do not write `/docs/...` URLs by hand — they will break if slugs change and they bypass the rewrite pipeline.

Anchors work too:

```markdown
[FAQ entry](../faq.md#what-browsers-are-supported)
```

## Images

Put images under `docs/images/` for site-wide assets, or `docs/<section>/images/` for section-specific ones. Reference them with standard markdown image syntax:

```markdown
![Alt text describing the screenshot](/images/composer-empty-state.png)
```

The leading `/` means docs-root-relative. You can also use a path relative to the current file:

```markdown
![Alt text](images/composer-empty-state.png)
```

Both forms are rewritten through the asset endpoint and require authentication, so images load correctly in remote deployments.

Supported formats: `.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`, `.svg`. Video files are also supported: `.mp4`, `.webm`.

### Screenshots not yet captured

For a screenshot you plan to add later, use a placeholder blockquote:

```markdown
> [SCREENSHOT: chat composer at rest, matrix-dark theme]
```

This renders as a visible callout. When you capture the image, replace the line with a normal image reference. Keep a running list of pending screenshots in `docs/_screenshot-index.md` — that file is internal (not in the manifest) and never appears in the rendered site.

## Diagrams (mermaid)

Use a fenced code block with the `mermaid` language tag:

````markdown
```mermaid
graph LR
  A[User] --> B[Hermes Switch UI]
  B --> C[Hermes Agent]
  C --> D[AI provider]
```
````

The renderer converts these to SVG client-side. Mermaid is well-suited to workflow diagrams, architecture overviews, and sequence diagrams. Keep diagrams focused — one concept per diagram.

### HTML diagrams (architecture)

For richer diagrams — system architecture, infra topology, cloud diagrams — you can embed a standalone HTML file. The Hermes Agent's `architecture-diagram` skill generates dark-themed SVG diagrams as HTML files which you can drop into docs.

Workflow:

1. Ask your agent to generate a diagram using the `architecture-diagram` skill — describe what you want shown (services, layers, connections).
2. Save the resulting `.html` file under `docs/<section>/diagrams/<name>.html` (create a `diagrams/` folder per section).
3. Embed it in your doc via iframe:

   ```markdown
   <iframe
     src="/api/docs-asset?path=<section>/diagrams/<name>.html"
     width="100%"
     height="600"
     loading="lazy"
     style="border: 0; border-radius: 8px;"
   ></iframe>
   ```

The doc renderer serves these HTML files with strict Content-Security-Policy headers (no scripts allowed), so they are safe to embed even from untrusted sources. Only static SVG/CSS content is supported.

Use this when:
- Mermaid is too limited (you need precise positioning, custom shapes, brand styling)
- You want a one-page architecture poster
- You have a complex topology that benefits from visual hierarchy

Stick with mermaid for:
- Simple flowcharts and sequence diagrams
- Diagrams that change frequently (mermaid is easier to edit)

## Code blocks

Use fenced code blocks with a language hint for syntax highlighting:

````markdown
```bash
pnpm dev
```
````

Common languages: `bash`, `ts`, `tsx`, `js`, `yaml`, `json`, `python`, `markdown`. Any Shiki-supported language works.

## Numbering and table of contents

The sidebar auto-numbers entries hierarchically (1., 2.1, etc.) based on manifest order. You do not need to write numbers yourself.

The right-hand "On this page" TOC is generated from your `##` and `###` headings. Do not skip heading levels — jumping from `##` to `####` produces a broken TOC hierarchy.

## What not to add

Keep the doc site focused on things that help users understand and use the product. Leave out:

- Internal architectural notes — those belong in design docs or RFCs.
- API reference dumps generated from code — auto-generate those separately if needed.
- Project history or changelog entries — there is a separate changelog process.

## Removing or renaming a doc

To remove a doc, delete its entry from `docs-manifest.yaml`. The `.md` file can stay on disk if you want to keep it for internal reference — it will not render.

To rename a slug, update the manifest entry and then grep the `docs/` folder for the old slug to update any inbound links from other docs.

## Internal helper files

Files with a `_` prefix — for example `_screenshot-index.md` or `_shared-terms.md` — are internal references for doc authors. They are never added to the manifest and never appear in the rendered site.

## Related

- [Welcome](../welcome.md)
- [Your first chat](first-chat.md)
- [Connecting your AI provider](connecting-provider.md)
