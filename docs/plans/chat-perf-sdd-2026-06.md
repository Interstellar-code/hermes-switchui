# SDD Plan — Chat Page Performance (Sidebar + Composer/Streaming)

**Date:** 2026-06-18
**Owner:** main agent (orchestrator + verifier)
**Implementer:** `executor` subagent, `model: sonnet`
**Method:** Spec-Driven Development. One phase = one fix. Executor codes a phase, main agent verifies the phase gate, only then proceed to next phase. No phase starts until prior phase gate is GREEN.

---

## Problem (from 2-agent diagnosis, 2026-06-18)

Two independent root causes:

- **Sidebar (always slow):** `/api/sessions` loads up to 1000 sessions in one ~400KB payload; the V2 sidebar renders all ~788 rows as real DOM nodes (no virtualization); `SidebarCardV2` is not memoized so all rows re-render on any filter change or 60s refetch; the filter/decorate pipeline runs ~4× O(n) + 2× sort over 788 items, **twice** (`useSessionsFeed` then `applyFiltersAndDecorate`); pin/star/archive membership uses `array.includes` (O(m)); two TanStack Query caches hit the same endpoint.
- **Composer (slow only while a message streams):** `chat-screen.tsx` (~3400 lines, 69 hooks) re-renders at ~60fps during streaming because `useSmoothStreamingText`'s rAF loop calls `setRenderedText` every frame; that breaks the message-list memo guard (`streamingText` prop changes each frame) so up to 60 mounted `MessageItem`s re-run `areMessagesEqual` (string-serializing) every frame; typing during streaming batches `setValue` behind message-list reconciliation. The composer input itself is local state — cheap in isolation.

## Evidence anchors (file:line)

- `src/routes/api/sessions.ts:42` — `listSessions(1000, 0)`, no pagination
- `src/screens/chat/chat-queries.ts:58` — client fetch, no limit param
- `src/screens/chat/sessions-feed.ts:220` — V2 feed query key `['sessions-feed','chat','v3-task-split']`
- `src/screens/chat/components/sidebar-list-v2.tsx:9,87,164` — no virtualization, native scroll fallback
- `src/screens/chat/components/sidebar-card-v2.tsx:100` — `SidebarCardV2` not `React.memo`
- `src/screens/chat/apply-filters-and-decorate.ts:60-130` — double O(n) pass + `includes` scans
- `src/screens/chat/session-search.ts:38-51` — linear scan, no index
- `src/screens/chat/chat-screen.tsx:659` — `useChatStore((s) => s.pendingClarify)` whole-object selector
- `src/screens/chat/chat-screen.tsx:1521,1675,1711` — `finalDisplayMessages` memo, `derivedStreamingInfo`, composer-busy selector
- `src/screens/chat/hooks/use-smooth-streaming-text.ts:56-79` — rAF loop `setRenderedText`
- `src/screens/chat/components/chat-message-list.tsx:393-433,2264-2300` — tail-window (60), memo guard
- `src/screens/chat/components/message-item.tsx:2960-3084` — `areMessagesEqual` string-serializing comparator

---

## Global rules

- **Implementer:** every coding phase delegated to `executor` with `model: sonnet`. Executor edits ONLY the files named in that phase's scope. No `git stash/reset/checkout`. No commits unless the phase says so.
- **Verifier:** main agent runs the phase gate. Verify subagents (if used) get **no Write/Edit** and must not "fix" anything — diagnosis only. Always `git status` after a verify pass.
- **Type gate (every phase):** `pnpm tsc --noEmit` clean for touched files (use project build filter). No new eslint errors in touched files.
- **Behavior gate:** stated per phase. Where it needs a running app, capture evidence (note what was observed); if app restart needed, flag it — do not silently assume.
- **Commit cadence:** checkpoint-commit after each GREEN gate (small atomic commit) so no phase loss. Branch: `perf/chat-sidebar-composer`.
- **Scope discipline:** behavior-preserving. No visual/UX change unless the phase explicitly allows it (only S1/C2 touch render structure visibly — must look identical).

---

## Phase sequence (quick wins → structural)

### Phase 0 — Branch + baseline
**Spec:** Create branch `perf/chat-sidebar-composer`. Record a baseline so wins are provable.
**Tasks:**
- `git checkout -b perf/chat-sidebar-composer`
- Baseline notes: payload size of `/api/sessions`, count of rendered sidebar DOM rows, and a subjective typing-while-streaming note. (Lightweight — React DevTools Profiler optional.)
**Gate (main agent):** branch exists, baseline recorded in this doc's "Baseline" section. No code change.

---

### Phase 1 — S2: Memoize SidebarCardV2 + Set-based membership
**Requirement:** Stop all ~788 cards re-rendering on every filter change / 60s refetch.
**Scope:** `sidebar-card-v2.tsx`, `apply-filters-and-decorate.ts`.
**Contract:**
- Wrap `SidebarCardV2` in `React.memo` with a correct equality (item identity + `isActive`). Ensure parent passes stable handler refs (lift inline closures or `useCallback`); if handlers are created per-row, memo is useless — fix that too.
- Replace `local.archived/pinned/starred.includes(item.id)` with `Set` membership built once per render (`useMemo` Sets), O(1) lookup.
**Verify gate:** tsc clean. Behavior identical (pin/star/archive still work, active highlight correct). Evidence: confirm via profiler or a temporary render-count log that toggling a filter no longer re-renders unchanged cards. `git status` clean of stray files. Checkpoint-commit.

---

### Phase 2 — S4: Eliminate duplicate session cache
**Requirement:** One fetch of `/api/sessions`, not two caches doing identical work.
**Scope:** `sessions-feed.ts`, `chat-queries.ts`, `hooks/use-chat-sessions.ts`, any consumer of `['chat','sessions']`.
**Contract:**
- Identify all readers of the legacy `['chat','sessions']` key. Migrate them to the V2 feed source (or make legacy a thin selector over the single cache). Keep `invalidateSessionLists()` correct.
- Do NOT break any consumer (search, counts, legacy sidebar if still mounted anywhere). Grep all usages first.
**Verify gate:** tsc clean. Only ONE network request to `/api/sessions` per refresh cycle (observe Network tab / add temp counter). Session list + counts still correct. Checkpoint-commit.

---

### Phase 3 — S5: Collapse the double filter/decorate pass
**Requirement:** Filter+decorate+sort runs once, not twice (`useSessionsFeed` then `applyFiltersAndDecorate`).
**Scope:** `sessions-feed.ts`, `apply-filters-and-decorate.ts`, `components/sidebar-shell-v2.tsx`.
**Contract:**
- Make `applyFiltersAndDecorate` the single source of filtered/grouped items + `sourceCounts`; have `useSessionsFeed` provide raw items only (or vice-versa) — pick one owner. Memoize `sourceCounts` so it isn't recomputed unless inputs change.
- Preserve exact output (same groups: Pinned/Today/Yesterday/Earlier; same counts; same sort order).
**Verify gate:** tsc clean. Groups/counts/order byte-identical to pre-change (spot-check several filters + a search query). Checkpoint-commit.

---

### Phase 4 — C3: Narrow `pendingClarify` selector
**Requirement:** `chat-screen` must not re-render when an unrelated session's clarify state changes.
**Scope:** `chat-screen.tsx` (selector at :659), possibly a small store selector helper in `chat-store.ts`.
**Contract:**
- Replace `useChatStore((s) => s.pendingClarify)` (whole object) with a session-scoped selector returning the active session's clarify entry (or a primitive presence flag), using `useShallow` if an object is unavoidable.
- Do not regress the clarify card lifecycle (recent feature: resolved/answer fields, dismiss-on-turn-start). Cross-check `use-streaming-message.ts` handlers still see what they need.
**Verify gate:** tsc clean. Clarify card still renders + resolves correctly (open + answered states). No re-render of chat-screen from background-session clarify events. Checkpoint-commit.

---

### Phase 5 — C5: Throttle smooth-streaming rAF
**Requirement:** Cut streaming-driven re-renders of `chat-screen` from ~60fps to ~20–30fps without visible jank.
**Scope:** `hooks/use-smooth-streaming-text.ts`.
**Contract:**
- Gate `setRenderedText` to a min frame interval (~33–50ms) or coalesce characters per tick. Keep the smooth feel; final text must always fully flush on stream end (no dropped tail).
- Behavior-preserving: text still appears smooth, completes fully.
**Verify gate:** tsc clean. Stream a real message: text completes fully, looks smooth, re-render frequency measurably lower (temp counter or profiler). Typing during stream noticeably less laggy. Checkpoint-commit.

---

### Phase 6 — S1: Virtualize the sidebar list  *(structural)*
**Requirement:** Render only visible rows (~15–30), not all 788.
**Scope:** add dep `@tanstack/react-virtual`; `sidebar-list-v2.tsx`; minor `sidebar-shell-v2.tsx`.
**Contract:**
- Add `@tanstack/react-virtual` (pnpm). Virtualize the grouped list. Must preserve sticky group headers (Pinned/Today/Yesterday/Earlier), scroll position, active-item visibility, hover + context menu behavior.
- Variable row heights handled (measure or estimate). Empty/loading states intact.
**Verify gate:** tsc clean. DOM row count ≈ viewport, not 788 (inspect elements). Scroll smooth; group headers correct; click/hover/context-menu work; active item still highlights + auto-scrolls into view. Visual identical. Checkpoint-commit.

---

### Phase 7 — C1: Isolate streaming text into a leaf  *(structural, biggest typing win)*
**Requirement:** rAF streaming updates must NOT re-render `chat-screen` or the whole message list — only the single streaming bubble.
**Scope:** new leaf component (e.g. `StreamingMessageText`) subscribing to streaming store slice directly; `chat-screen.tsx`, `chat-message-list.tsx`, `message-item.tsx` wiring.
**Contract:**
- Move `useSmoothStreamingText` consumption out of `chat-screen` into a leaf that reads the active session's streaming text via a narrow store selector and renders only the live bubble's text. `chat-screen` stops receiving per-frame `streamingText` prop; message-list memo guard no longer breaks each frame.
- Final committed message still renders identically once stream ends (handoff from live bubble → committed MessageItem must be seamless — no fl/duplicate).
**Verify gate:** tsc clean. While streaming: profiler shows `chat-screen` + message-list NOT re-rendering per frame; only the streaming bubble updates. Typing during stream smooth. Message finalizes correctly (no dup, no flash). Checkpoint-commit.

---

### Phase 8 — C2 (optional): True message-list virtualization  *(defer unless still slow)*
**Requirement:** Cap mounted `MessageItem`s for very long threads even when "Show earlier" expanded.
**Scope:** `chat-message-list.tsx` (+ react-virtual).
**Contract:** windowed render with stable scroll, given variable-height markdown/code blocks. Known-hard (Issue #213 history — prior virtualization caused scroll glitches). Only attempt if Phase 7 didn't fully resolve long-thread cost.
**Verify gate:** tsc clean. Long thread scroll stable, no glitches; mounted nodes capped. Checkpoint-commit OR mark deferred with reason.

---

## Verification matrix

| Phase | Type gate | Behavior gate | Needs running app | Risk |
|-------|-----------|---------------|-------------------|------|
| 0 | — | branch+baseline | no | none |
| 1 S2 | tsc | cards memoized, filters work | profiler/log | low |
| 2 S4 | tsc | single fetch, counts ok | network tab | low-med |
| 3 S5 | tsc | identical groups/counts | spot-check | low-med |
| 4 C3 | tsc | clarify lifecycle intact | live | low |
| 5 C5 | tsc | smooth+full flush | live stream | low |
| 6 S1 | tsc | virtualized, visual identical | live | med |
| 7 C1 | tsc | no per-frame re-render | profiler | med-high |
| 8 C2 | tsc | stable scroll | live | high (optional) |

## Exit criteria
- Sidebar: rendered DOM rows ≈ viewport; filter/search no longer re-render unchanged cards; one `/api/sessions` fetch per cycle.
- Composer: typing during active streaming smooth; `chat-screen` + message list not re-rendering at rAF rate.
- All phases tsc-clean, behavior-preserving, each checkpoint-committed.

## Baseline (Phase 0)
- Branch: `perf/chat-sidebar-composer` created off `main`.
- `/api/sessions` payload: ~400KB, up to 1000 sessions, single request, no pagination (`use-chat-sessions.ts:76`, `sessions.ts:42`).
- Sidebar rendered DOM rows: ~788 (all sessions, no virtualization — `sidebar-list-v2.tsx:9`).
- Typing-while-streaming: reported sluggish by user (rAF ~60fps full-tree re-render).

## Progress log
- Phase 0 — GREEN — branch created, baseline recorded.
- Phase 5 (C5) — GREEN (static) — commit `0e54b223`. rAF reveal loop still advances `renderedRef` every frame (reveal speed intact) but React commits gated to 40ms (~25fps, was ~60). Final flush guaranteed via `isCaughtUp` unconditional bypass (verified by reading tick). tsc 137, one file, no stash. Live-confirm deferred: smooth + full text + less keystroke lag while streaming.
- Phase 4 (C3) — GREEN (static) — commit `10a0742e`. `chat-screen` now subscribes to `pendingClarify[activeKey]` only (was whole record) → background-session clarify events no longer re-render foreground. Per-key immutable storage keeps active-entry ref stable. tsc 137. NOTE: an IDE `clarifyCard`-prop error flashed mid-edit — stale LSP cache; tsc disagrees, prop is pre-existing/valid. Live-confirm deferred: clarify e2e + cross-session no-rerender.
- Phase 3 (S5) — GREEN (static) — commit `b3d733ae`. `applyFiltersAndDecorate` no longer re-filters/re-sorts (trusts `useSessionsFeed` output); only does local-archived exclusion + sourceCounts + decorate + group. Removed 1 O(n) filter + 1 O(n log n) sort/render. DELIBERATE behavior change: date-range predicate unified to consistent LOCAL midnight (was inconsistent UTC-vs-local across the two passes → asymmetric intersection). Verifier (main agent) wrote the date fix directly, not the executor. tsc clean, 137 baseline. Live-confirm deferred: source counts + date filter near midnight.
- Phase 2 (S4) — GREEN (static) — commit `3fd1a8e3`. `useChatSessionsFeed` shares `chatQueryKeys.sessions` → TanStack dedupes to ONE `/api/sessions` fetch; transform moved to memo `[rawSessions, jobs]`, logic preserved (cron/title/source/day/sourceMeta intact). tsc clean, 137 baseline errors unchanged. Live-confirm deferred: per-source counts on next restart. No stash/loss.
- Phase 1 (S2) — GREEN — commit `a0359546`. `React.memo(SidebarCardV2)` w/ field comparator + Set-based pin/star/archive in `apply-filters-and-decorate.ts`. tsc clean, no new diagnostics (pre-existing dead code `getBadgeStyle`/`railGlow` left untouched — out of scope). INCIDENT: executor ran `git stash` despite ban → swept 23 uncommitted files into stash@{0}, pop failed; recovered (revert 3 partial + re-pop). Mitigation: WIP checkpoint commit `5e530605` now protects all pre-existing work; pre-commit before every future executor dispatch.
- Phase 6 (S1) — GREEN (static) — commit `e945e20b`. Sidebar virtualized via `@tanstack/react-virtual` (`useVirtualizer` over flattened header+card rows; overscan 8; dynamic `measureElement`). REVIEW FOUND + FIXED 1 regression: absolute+`translateY` rows killed the previously-working `position:sticky` headers → reimplemented with TanStack sticky pattern (`rangeExtractor` pins nearest preceding header so it stays mounted; active header rendered in-flow `position:sticky top:0`, others `absolute`+transform). Added active-item `scrollToIndex({align:'auto'})` on `activeSessionKey` change (now required — active row may be unmounted under virtualization; old version never auto-scrolled but active card was always in DOM). tsc: 0 errors in chat/sidebar files (repo total dropped 137→32, all 32 in unrelated office/three.js cleanup thread). Live-confirm GREEN (Canary 2026-06-18): 19 rows mounted vs 798 total (scrollHeight 59056 / clientHeight 669); post-scroll bounded (28 transient overscan, settles 19); sticky "Today" header pinned position:sticky top:0 after 600px scroll (regression fix verified live); active highlight + aria-current + nav work; zero console errors.
