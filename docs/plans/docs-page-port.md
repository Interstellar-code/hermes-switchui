# Docs Page Port — hermes-switchui

**Source:** `/Volumes/Ext-nvme/Development/nextjs-boilerplate` (custom remark/rehype pipeline)
**Target:** hermes-switchui (TanStack Start)
**Effort:** ~3-4 hours focused
**Status:** Draft

---

## Goal

Render existing `/docs/*.md` content as a browsable doc site at `/docs/*` with sidebar tree nav, TOC, scroll progress, prev/next pagination, syntax-highlighted code (Shiki), and mermaid diagrams.

## Non-Goals

- Search index (boilerplate has it built but unwired; skip for v1)
- i18n translations
- Versioned docs
- Auth gate (design supports flipping later via `auth-middleware.ts`)
- Content migration (reuse `/docs/` folder as-is)

## Acceptance Criteria

- [ ] `/docs` route lists root markdown files + folders
- [ ] `/docs/<slug>` route renders single doc with full markdown features
- [ ] Nested paths work: `/docs/plans/matrix3d-page` renders `docs/plans/matrix3d-page.md`
- [ ] Sidebar shows tree of `/docs/` with active page highlighted
- [ ] TOC shows H2/H3 with active-section tracking on scroll
- [ ] Code blocks syntax-highlighted via Shiki (already installed)
- [ ] Mermaid blocks (` ```mermaid `) render as SVG diagrams client-side
- [ ] Prev/next pagination links at bottom of each doc
- [ ] Scroll progress bar at top of doc area
- [ ] Sidebar nav entry "Docs" added to `primary-nav-v2.tsx`
- [ ] Build passes: `pnpm build`
- [ ] No new TS errors in modified files
- [ ] Works on dark + light Matrix themes

---

## Phase 1 — Deps + Content Loader + Render Pipeline

**Verifiable independently:** unit test loads + renders a sample markdown to HTML server-side.

### Steps

1. Add deps:
   ```bash
   pnpm add gray-matter remark-parse remark-rehype rehype-pretty-code rehype-slug rehype-autolink-headings rehype-stringify mermaid unified
   ```
   (`remark-gfm` + `shiki` already present.)

2. Create `src/server/docs-content.ts` — port from `nextjs-boilerplate/src/libs/DocsContent.ts`:
   - `scanDocsTree(rootDir: string): DocsTree` — fs recursive scan
   - `loadDocPage(slug: string): { frontmatter, content }` — gray-matter parse
   - `getAdjacentPages(slug): { prev, next }` — for pagination
   - Sort order: frontmatter `order` field → fallback alphabetic
   - Server-only via TanStack `createServerFn` or module marker

3. Create `src/server/docs-render.ts` — unified pipeline:
   ```ts
   unified()
     .use(remarkParse)
     .use(remarkGfm)
     .use(remarkRehype, { allowDangerousHtml: true })
     .use(rehypeSlug)
     .use(rehypeAutolinkHeadings)
     .use(rehypePrettyCode, { theme: 'github-dark' })  // Shiki under hood
     .use(rehypeMermaid)  // custom: tag mermaid blocks for client render
     .use(rehypeStringify, { allowDangerousHtml: true })
   ```
   Port the `rehypeMermaid` custom plugin from boilerplate.

4. Vitest: `src/server/docs-content.test.ts`, `src/server/docs-render.test.ts` — load sample, assert HTML output shape.

### Files
- `src/server/docs-content.ts` (new)
- `src/server/docs-render.ts` (new)
- `src/server/docs-content.test.ts` (new)
- `src/server/docs-render.test.ts` (new)
- `package.json` (deps)

---

## Phase 2 — Route + Minimal Page

**Verifiable independently:** visit `/docs` and `/docs/troubleshooting` in dev, see rendered HTML (no styling yet).

### Steps

1. Create `src/routes/docs/index.tsx`:
   - Server loader calls `scanDocsTree()`
   - Lists root pages + first-level folders as link cards

2. Create `src/routes/docs/$.tsx` (catch-all):
   - Server loader calls `loadDocPage(params._splat)` + `getAdjacentPages`
   - Returns `{ frontmatter, html, prev, next, tree }`
   - 404 via `throw notFound()` from `@tanstack/react-router` if file missing
   - Renders frontmatter title + raw HTML via `dangerouslySetInnerHTML` (sanitized server-side)

3. Route `head` export sets `<title>` from frontmatter

### Files
- `src/routes/docs/index.tsx` (new)
- `src/routes/docs/$.tsx` (new)

---

## Phase 3 — UI Components

**Verifiable independently:** sidebar/TOC/pagination/mermaid/progress all work; visual parity with boilerplate.

### Steps

Port 7 components from `nextjs-boilerplate/src/components/docs/`. All are mostly client-side React; only renderer needs server pre-render swap:

1. `src/components/docs/docs-renderer.tsx`
   - Boilerplate: async RSC. Here: dumb client component receiving pre-rendered HTML string from route loader.

2. `src/components/docs/docs-sidebar.tsx`
   - Tree nav from `DocsTree`; collapsible folders; active route highlight via `useRouterState`.

3. `src/components/docs/docs-toc.tsx`
   - Parse H2/H3 from rendered DOM; IntersectionObserver active-heading tracking.

4. `src/components/docs/docs-pagination.tsx`
   - Prev/next links from loader data.

5. `src/components/docs/docs-scroll-progress.tsx`
   - Sticky bar; window scroll listener with `requestAnimationFrame` throttle.

6. `src/components/docs/docs-mermaid.tsx`
   - Mount `mermaid.init` on `<pre class="mermaid">` blocks after render. Dynamic-import `mermaid` to avoid SSR bloat.

7. `src/components/docs/docs-highlight.tsx`
   - Optional: copy-to-clipboard button on code blocks. (Boilerplate may use Prism; we'll rely on Shiki via rehype-pretty-code at server-render time so this becomes pure UX polish.)

8. Layout wrapper at `src/routes/docs/route.tsx` (if using TanStack layout routes) or compose in each route:
   ```
   ┌─────────────────────────────────────────────┐
   │ ScrollProgress                              │
   ├──────────┬─────────────────────┬────────────┤
   │ Sidebar  │ Renderer            │ TOC        │
   │          │ (frontmatter + HTML)│            │
   │          │ Pagination          │            │
   └──────────┴─────────────────────┴────────────┘
   ```

### Files
- `src/components/docs/*.tsx` (7 new files)
- `src/routes/docs/route.tsx` (new, layout)

---

## Phase 4 — Sidebar Nav + Theme Polish

**Verifiable independently:** `Docs` entry visible in left nav; styling matches Matrix theme.

### Steps

1. Add Docs entry to `src/screens/chat/components/sidebar/v2/primary-nav-v2.tsx`:
   - Icon: existing book/file-text icon from lucide
   - Position: near Tasks/Boards section or under Workflows — author judgment
   - Active state: pathname starts with `/docs`

2. Theme tokens:
   - Reuse `var(--theme-*)` from existing themes
   - Code block background, link colors, sidebar item hover — Matrix green accent on `claude-nous` + `matrix` themes
   - Light theme fallback colors

3. CSS for prose (`src/styles/docs-prose.css`):
   - Headings, lists, blockquotes, tables, code blocks
   - Mermaid container sizing
   - Active TOC item highlight
   - Anchor link icons on hover (from `rehype-autolink-headings`)

4. Smoke test: visit several docs in different themes; toggle theme mid-page.

### Files
- `src/screens/chat/components/sidebar/v2/primary-nav-v2.tsx` (edit)
- `src/styles/docs-prose.css` (new)

---

## Risks + Mitigations

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| TanStack Start server-fn can't read fs at request time | Low | Verified — Vite SSR has node fs in server context. Confirm in Phase 1. |
| Shiki bundle size bloat | Med | Server-render only; load fixed theme; no client Shiki. |
| Mermaid client init flicker | Low | Dynamic import; loading skeleton on mermaid containers. |
| `dangerouslySetInnerHTML` XSS | Low | Content trusted (repo-owned md files); sanitize anyway via rehype defaults. |
| Frontmatter schema drift | Low | TypeScript type + zod schema validation in loader; tolerant defaults. |
| Existing `docs/` content has bad/inconsistent frontmatter | Med | Tolerant defaults; fall back to filename for title; skip order if missing. |
| Catch-all route conflicts with existing routes | Low | `/docs/$` is scoped; verify no current `/docs/*` route. |

## Verification

After each phase:

```bash
pnpm test  # phase 1
pnpm dev   # phase 2-4, visit /docs and /docs/<slug>
pnpm build # phase 4 — production parity
pnpm lint  # all phases
```

Manual smoke:
- [ ] `/docs` shows tree
- [ ] `/docs/troubleshooting` renders
- [ ] `/docs/plans/matrix3d-page` renders (nested path)
- [ ] Sidebar shows tree, click navigates
- [ ] TOC highlights active heading on scroll
- [ ] Mermaid block renders diagram (e.g. add test block in a doc)
- [ ] Code block has Shiki colors
- [ ] Prev/next links work
- [ ] Theme toggle preserves docs styling

## Out of Scope (future)

- Full-text search across docs
- i18n
- Edit-on-GitHub link
- Generated API reference
- Auth gate (route is public; flip via `beforeLoad` middleware later)

## Open Questions

1. Public or admin-only? **Default: public**, easy to gate later.
2. Should `docs/plans/`, `docs/Design Assets/`, `docs/screenshots/` be excluded? **Default: include all `.md` files**, exclude images.
3. Sidebar position — separate top-level entry vs under existing menu? **Default: top-level**, near settings.
