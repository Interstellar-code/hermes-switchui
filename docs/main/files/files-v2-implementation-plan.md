---
title: Files v2 implementation plan
description: Design and implementation record for the Finder-style Files workspace.
---

# Files v2 — Implementation Plan

Design source: `docs/Design Assets/Hermes-Switchui/Files v2 (standalone).html`
Target: `src/screens/files/files-screen.tsx` (+ `file-tree.tsx`, `folder-listing.tsx`, `src/styles/matrix-files.css`)

## 1. What the design actually is

The `.html` is a **self-contained compiled React app** (2 MB): outer HTML is a bundler shell that gunzip-decompresses base64 assets at runtime. The real design lives in two decompressed modules:

- **app logic** (`Files v2 — application logic`) — the React component tree.
- **data + icons** (`Files v2 — data + icons`) — mock file tree, `KIND_*` maps, `IcoV2` mono SVG icon set.

It renders against **mock data** (`TREE_V2`, `FILE_INDEX`) — no real API. It reuses the **Matrix token system** (`--m-*` tokens, e.g. `--m-text-faint`, `--m-font-mono`) plus runtime-set `--accent` and `--rowpad`. That is the same token system our existing `matrix-files.css` already uses, so the design is built to drop onto our theme.

### Design layout
Three columns: **Explorer** (left tree) · **Preview** (center) · plus a floating **Tweaks** panel and a **Command palette** overlay.

### Design tokens
- Accents (4): green `#00ff41`, cyan `#5fcfff`, lime `#d6ff5f`, amber `#ff8a4f`. Runtime `--accent`.
- Kind colors: `html #ff8a4f`, `md #5fcfff`, `json/yaml #d6ff5f`, `code #00ff41`, `img #ff5fa2`, `pdf #ff5f6d`, `txt` faint.
- Fonts: EB Garamond (serif body), JetBrains Mono / Iowan Old Style.
- Density: `--rowpad` (default `7px`).

## 2. Current vs design

| Capability | Current (`files-screen.tsx`) | Design v2 |
|---|---|---|
| File tree | ✅ `FileTree`, expand/collapse, IGNORED_DIRS | ✅ same + keyboard nav + fuzzy |
| Search | ✅ substring filter (debounced) | ⬆ **fuzzy** matcher w/ score + **highlight ranges** |
| Sort | ❌ none | ➕ name / modified / type (sort menu) |
| Type filter | ❌ none | ➕ `all` + by-kind (only `all` wired in mock) |
| Breadcrumb | ✅ | ✅ |
| Preview tabs | ✅ preview / raw / metadata | ✅ same three |
| Markdown | ✅ render + static outline anchors | ⬆ outline + **scrollspy** active-heading |
| HTML | ✅ sandboxed iframe | ✅ (mock: static preview) |
| Image / code | ✅ image, CSS-class code highlight | ✅ |
| CRUD | ✅ new/rename/move/delete/upload/download + context menu | ✅ (mock: context menu only) |
| Save flow | ✅ diff-on-save modal, disk-change guard | — (mock has no save) |
| Icons | emoji glyphs (⤴ ＋ ↺ 🗑 ↗ ⧉ ✎) | ➕ **mono SVG icon set** (`IcoV2`, ~35 icons) |
| Kind color coding | ❌ | ➕ colored kind pills / icon tint |
| Command palette | ❌ | ➕ **Cmd/Ctrl+K** fuzzy file jump |
| Pinned files | ❌ | ➕ pin + "Quick access" panel |
| Recents | ❌ | ➕ recent-paths list in Quick access |
| Row keyboard nav | ❌ | ➕ ↑/↓/Enter/Esc |
| Tweaks panel | ❌ | ➕ accent picker, row density, label toggle, Quick-Access toggle |
| Quick Access panel | ❌ | ➕ `showQA`/`qaOpen` = Pinned + Recents collapsible groups (NOT a QA/annotation layer) |
| Workspace picker | ✅ first-run picker | — (not in mock) |

**Backend is unaffected** — `/api/files` (list/read/write/delete/rename/mkdir/upload/download) and `/api/workspace` already cover every real operation. This is a **UI/UX layer**, mostly additive.

## 3. Gaps

### 3a. Functionality gaps (design features we don't have)
Additive, no backend change:
1. Fuzzy matcher + highlight (`fuzzy()`, `<Highlight>`).
2. Command palette (Cmd/Ctrl+K).
3. Sort menu (name/modified/type) — `modifiedAt` already on `FileEntry`, so sort works.
4. Mono SVG icon set replacing emoji.
5. Kind color coding.
6. Row keyboard navigation.
7. Outline scrollspy.

### 3b. Data / persistence gaps (design assumes state backend doesn't provide)
- **Pinned / Recents**: design treats `pinned`/`recent` as file flags. Backend has none. Needs client persistence (localStorage keyed by workspace path) — lazy, no backend work. Recents can derive from selection history.
- **`kind`**: design ships per-node `kind`; ours derives client-side already (`getEntryKind`). Reuse — no gap.
- **Node `id`**: design keys dirs by `id`; ours keys by `path`. Use `path` — no gap.
- **Type filter by kind**: needs client-side kind derivation over the tree (we have it). Only `all` is wired in the mock; real kinds are our call.

### 3c. Personalization
- **Tweaks panel** (accent, density, labels, show-Quick-Access): Files-page-local personalization. Accent + density are pure CSS var writes (`--accent`, `--rowpad`) — cheap.

## 4. Decisions (locked)
1. **Theme scope** → **Matrix-flavored, as designed** (green `#00ff41`, `--m-*` tokens). No cross-theme adaptation.
2. **Quick Access panel** (`showQA`) → **ship**. Resolved: it's the Pinned + Recents sidebar groups, not a QA/annotation layer — folds into Phase 4, no extra work.
3. **Pinned/Recents persistence** → **localStorage**, per-workspace key. No backend.
4. **Tweaks panel** → **deferred to last phase** (Phase 6). Core (0–5) ships first.

## 5. Phased plan (reuse existing screen + API, layer design on top)

**Do NOT port the standalone app** — it's mock-data only. Keep our `FilePanel`, tree, CRUD, save/diff, workspace picker, `/api/files` wiring. Restyle + add affordances.

- **Phase 0 — tokens & icons.** Add `--accent` (default green) + kind-color map to `matrix-files.css`. Port `IcoV2` SVG icon set into a small `files-icons.tsx`; swap emoji glyph buttons for it. Kind-colored tree/pill tint. *Check: page renders unchanged in structure, new icons + colors visible.*
- **Phase 1 — search upgrade.** Add `fuzzy()` + `<Highlight>`; replace substring filter. Wire ↑/↓/Enter/Esc row keyboard nav. *Check: fuzzy match + highlight, keyboard selects rows.*
- **Phase 2 — sort + type filter.** Sort menu (name/modified/type) over existing tree; type filter from client kind derivation. *Check: each sort/filter reorders correctly.*
- **Phase 3 — command palette.** Cmd/Ctrl+K overlay, fuzzy over flat `FILE_INDEX`-equivalent (flatten our tree), Enter selects. *Check: palette opens, jumps to file.*
- **Phase 4 — Quick Access.** Pin toggle + Recents as collapsible sidebar groups (`.qa`); persist to localStorage per workspace. *Check: pin survives reload, recents populate on open.*
- **Phase 5 — outline scrollspy** for markdown preview (active heading on scroll).
- **Phase 6 — Tweaks panel.** Accent picker (4 accents → `--accent`), row density (`--rowpad`), label toggle, show/hide Quick Access. Files-local, persisted to localStorage. *Check: each control mutates the page live and survives reload.*

Each phase is independent and shippable. Reviewer/verifier pass after each. No new dependencies — everything is inline SVG, CSS vars, and existing React.

## 6. Status log

- **Phase 0 — DONE** (sonnet). New `src/screens/files/files-icons.tsx` (`SvgIco`, `IcoV2` 35 icons, `FIcon`, `KIND_LABEL`/`KIND_COLOR`, `kindColor` helper). Swapped all emoji action-buttons + context-menu glyphs for `<SvgIco>`. Colored `.files-preview-kind` pill by kind. Added `--accent: #00ff41` + `--rowpad: 7px` to `[data-screen='files']` in matrix-files.css. tsc clean on changed files.
  - Deferred → **Phase 1**: tree-**row** file-icon kind-tint (rows render in `file-tree.tsx`/`folder-listing.tsx`, use CSS-class icons — swap to kind-colored `FIcon` when Phase 1 rewrites rows for fuzzy highlight).
  - Cosmetic: save button keeps `💾` (icon set has no floppy); revisit if a fitting glyph is wanted.
- **Phase 1+2 — DONE** (fable). New `files-search.tsx` (`fuzzy`, `Highlight`). Fuzzy filter replaces substring in tree; folder + grid file names highlight matches (`<mark>`). Type filter (`typeFilter` state, kinds derived) + sort menu (name/modified/type) in tree header. Keyboard nav (↑/↓/Enter/Esc) over flattened visible tree rows. Grid file icons now kind-colored `FIcon`. `fileKindKey` helper added to files-icons. tsc clean on all files/screens; `files-screen.test.tsx` 2/2 pass.
  - Layout: **hybrid** confirmed by user — folders-only tree + folder-listing grid kept; both restyled. Files NOT moved into tree; grid pane NOT dropped.
  - Behavior change: grid default sort now name/asc (was modified/desc) — matches design default (`sort='name'`). Acceptable.
  - Note: type filter prunes grid only (tree stays folders-only for navigation).
- **Phase 3+4 — DONE** (opus). New `files-palette.tsx` (portal, ⌘K/Ctrl+K toggle, capture-phase handler so it wins over the global app palette on `/files`; fuzzy over flat file list name+path, ↑/↓/Enter, `<Highlight>`, kind color). Quick Access = Pinned + Recents collapsible groups (`.qa`) gated on no-query & typeFilter=all. Star pin toggle in FilePanel action bar. Recents captured via one central effect on `selectedEntry`. localStorage keys `files.pins.<ws>` / `files.recents.<ws>` (cap 8), SSR-guarded, imperative writes. Palette hand-rolled (existing app command-palette is nav-bound + light-themed — reuse would cost more than it saves). tsc clean, tests 2/2.
  - `showQA` currently local state default true — Phase 6 lifts it to the Tweaks toggle.
  - **Token note**: CSS accent token is `--f-accent` (line 14, from `--m-green-500`); Phase 0's `--accent` (line 19) is an ORPHAN (nothing reads it). `--rowpad` (line 20) is consumed. Phase 6 must write `--f-accent`/`--rowpad` on the `[data-screen=files]` element and reconcile the orphan.
- **Phase 5+6 — DONE** (sonnet + finished directly after a mid-run session-limit cutoff). New `files-tweaks.tsx` (FAB + `.tw-panel`: accent swatches, density seg, labels seg, quick-access seg). Wired in `files-screen.tsx`: `tweaksOpen` state, accent/density persisted via `files.tweaks` localStorage, applied as inline `--f-accent`/`--rowpad` on the `[data-screen=files]` shell root (inline wins over the scoped token), `data-labels` attr. Scrollspy added to `FilePanel`: `scrollerRef` + effect assigns slug ids to rendered `h2/h3` (so anchor jumps + spy both work regardless of the Markdown renderer) and marks the active outline link (`.is-active` + `aria-current`). Orphan `--accent` (css line 19) deleted. `.files-tree-row` padding now `var(--rowpad)` so density visibly changes row height. All Tweaks/scrollspy/context-menu CSS appended to matrix-files.css.
  - **Labels toggle** interpreted minimally: `data-labels='off'` hides the `.files-preview-kind` pill (kind shown by icon color only). Lean mapping — expand later if you want text labels on every action button.
  - Density affects the tree rows; grid rows keep their own padding (acceptable — tree is the primary list).
- **Extra (user request) — DONE**: context menu restyled from Tailwind (`primary-*`/`neutral-*`, light theme) to Matrix (`.files-ctx-menu` / `.files-ctx-item` / `.is-danger` using `--f-*` tokens). Was visually off-theme (light popover on the dark Matrix page); now matches.

## 7. Verification
- `pnpm vitest run src/screens/files/files-screen.test.tsx` → 2 pass / 0 fail (all phases).
- `pnpm exec tsc --noEmit` → no new errors in `src/screens/files/*` (pre-existing errors elsewhere unaffected).
- LSP `@/...` "cannot find module" diagnostics are path-alias config noise, not real (tsc resolves them).
- Not yet done: visual/browser QA pass, `pnpm build`. Recommended before release.

## 8. Fidelity polish + adjacent features (round 2, from reference-vs-delivered screenshots)

- **#5 Quick-jump bar** — DONE (fable). ⌘K trigger bar atop the files pane opens FilesPalette. `.files-quickjump`.
- **#6 Type filter → chips w/ counts** — DONE (fable). Replaced the `All types` select with a chip row (ALL + per-kind, counts from a single pass over the flat file list, kind-colored). Old two-select block removed.
- **#7 Sort → header icon menu** — DONE (fable). `SvgIco name="sort"` in the header opens a check-marked Name/Modified/Type popover. Header icon order aligned: new, upload, sort, refresh, collapse.
- **#8 Preview action bar** — DONE (fable). Kind badge + star + filled OPEN + ghost DOWNLOAD + ⋮ overflow (Edit source / Copy path / Delete).
- **#9 Outline card** — DONE (fable). "Outline" → "On this page" bordered card; scrollspy `.is-active` retained.
- **#10 Markdown headings** — DONE (fable). `.files-doc-shell.markdown-preview` h1–h4 now mono + `--f-accent`; body/code untinted.
- **#11 Meta + footer** — DONE (fable). Added KIND to meta, WORKSPACE path to footer. INDEXED omitted (no real index timestamp exists — not fabricated).
- **#12 Attach-to-chat** (chat file-explorer, separate from Files page) — DONE (fable). New "Attach to chat" context-menu item gated to txt/md/json/jpg/jpeg/png/pdf, mirrors the existing `onAttachImage` path → `composer.addFiles`. `getMimeType` extended for pdf/txt/md/json. Reference vs attach: text = saves a Read tool round-trip; images/pdf = genuinely additive (multimodal).
- **#13 File-explorer overlay** (approach B, opus) — DONE. `createPortal`-into-`[data-testid=sidebar-shell-v2]` overlays the file explorer exactly over the 320px sessions panel (sessions mounted underneath); removed the 3rd chat grid column (`[auto_1fr_auto]` → `[1fr_auto]`), reclaiming width. Close via toggle / Esc / new X button. Collapsed-rail state = graceful cramped fallback.

### Round-2 verification
- `pnpm vitest run` (files-screen + sidebar-shell-v2 + file-explorer-sidebar) → 6 pass / 0 fail.
- `pnpm exec tsc --noEmit` → 0 real errors in files-screen / chat-screen / file-explorer / sidebar-v2 (only pre-existing unused-var + `FormEvent` deprecation hints remain).
- Still pending before release: visual/browser QA, `pnpm build`.
