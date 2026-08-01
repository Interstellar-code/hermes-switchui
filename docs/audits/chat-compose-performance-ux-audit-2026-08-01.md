# Chat Compose Performance & UX Audit

Date: 2026-08-01
Route: `/chat/45f55c53-6252-426a-b368-936b5391dab6`
Mode: OMX specialist audit followed by the bounded implementation described below

## Verdict

The large session collection is a real navigation cost, but SQLite row count is not the root problem. The indexed database queries are fast; SwitchUI repeatedly fetches, serializes, parses, and derives UI state from the complete session collection.

Sending has a separate, higher-impact scaling problem: the gateway restores the selected session's active conversation before each run, while SwitchUI also polls the session transcript every 1.5 seconds to synthesize live tool events.

## Measured evidence

| Probe | Result |
| --- | --- |
| SwitchUI `GET /api/sessions` | 1,623 sessions, 1.21 MB; observed 0.27–3.14 s warm/cold variation |
| SwitchUI target `GET /api/history?limit=150` | 150 messages, 762 KB; observed 0.05–0.09 s |
| Profile database | 2,631 sessions, 116,257 messages, 1.9 GB |
| Target session | 1,118 persisted rows; 333 active rows, about 630 KB active payload |
| Direct indexed SQLite tail lookup | under 10 ms in local probes |
| Desktop session list | already virtualized with overscan 8 |

The SwitchUI response includes local/portable sessions in addition to the dashboard-visible session page, explaining why the browser-visible count differs from the raw profile database and upstream dashboard counts.

## Ranked causes and improvements

### P0 — Stop fetching every session for routine navigation

**Evidence**

- `src/routes/api/sessions.ts:24-31,53-87` walks every 1,000-row upstream page when pagination is omitted.
- `src/screens/chat/chat-queries.ts:60-65` always calls the unpaged endpoint.
- `src/screens/chat/hooks/use-chat-sessions.ts:81-122` filters, merges, sorts, and scans the complete result.
- `src/screens/chat/sessions-feed.ts:279-346` performs another full decoration/bucketing pass.

**Smallest safe improvement**

1. Load the newest 100–200 sessions initially.
2. Ensure the active session is included by ID even when it is outside that page.
3. Use the existing upstream session search for sidebar search.
4. Add “Load earlier” rather than silently changing existing counts/filter semantics.
5. Stop invalidating the full list after every completed response; optimistically update the active row and let a slower background refresh reconcile it.

This should be done before further React micro-optimizations.

### P0 — Remove full-transcript polling during an active send

**Evidence**

- `src/routes/api/send-stream.ts:928-1024` starts with a transcript snapshot and polls the entire transcript every 1.5 seconds because no delta endpoint is used.
- The target has 333 active messages and about 630 KB of active stored payload, much of it tool data.

**Smallest safe improvement**

Use a bounded tail or, preferably, a `sinceMessageId`/run-events endpoint. Once native `tool.*` SSE is reliable, delete this fallback. Until then, do not repeatedly transfer the full transcript merely to discover new tool cards.

### P0/P1 — Bound or compact model conversation replay

**Evidence**

- `~/.hermes/hermes-agent/gateway/platforms/api_server.py:2967-2982` restores history before `_run_agent`.
- `~/.hermes/hermes-agent/hermes_state.py:4891-4939` loads all active conversation rows without a limit.

**Improvement**

Feed the model a compacted summary plus a bounded recent window, and omit obsolete large tool-result bodies unless required. This needs correctness tests for tool-call/result adjacency and conversation continuity; it is not a blind truncation change.

### P1 — Consolidate session query policy and derivation

**Evidence**

- `src/components/workspace-shell.tsx:187-191` subscribes through `useChatSessions`.
- `src/screens/chat/chat-screen.tsx:241-269` subscribes again and also builds the session feed.
- `src/screens/chat/sessions-feed.ts:250-255` uses the same query key with different stale/poll settings.

**Improvement**

Keep one shared query policy and one derived session view model. Reuse indexed lookups for the active session rather than repeating full sorts/scans in each consumer.

### P1 — Remove redundant history recovery polling

**Evidence**

- `src/screens/chat/hooks/use-chat-history.ts:393-409` forces a mount refetch and also polls at the interval supplied by `ChatScreen`.
- `src/screens/chat/hooks/use-history-polling.ts:92-128` unconditionally schedules another refetch after two seconds, plus a recovery loop when waiting.

**Improvement**

Keep SSE authoritative while healthy. Perform one recovery poll only after disconnect/inactivity or when a run is known to be pending. Do not refetch the same cached history unconditionally two seconds after navigation.

### P1 — Make interactions feel immediate

1. Add a visible pending state to the clicked session card (`Opening…`, `aria-busy`) while retaining the current content until cached/new history is ready. The link already preloads on intent at `src/screens/chat/components/sidebar/v2/sidebar-card-v2.tsx:348-358`.
2. On `/chat/new`, insert the provisional user message before awaiting session creation. Existing-session sends already append optimistically at `src/screens/chat/hooks/use-send-message-state.ts:396-421`; the new-chat path waits at `src/screens/chat/hooks/use-composer-send.ts:203-249`.
3. Keep the composer editable/visibly queued where safe and distinguish “sending”, “waiting for model”, and “reconnecting” states.

### P2 — Fix mobile-only list scaling

`src/components/mobile-sessions-panel.tsx:110-146` maps every session. Reuse the existing virtualized desktop list or restrict mobile to recent/search/load-more results. Also add dialog semantics, focus containment, and focus restoration.

### P2 — Reduce large-history client work

The message UI collapses the head after 80 entries (`src/screens/chat/components/chat-message-list.tsx:331-370`), but still derives maps over the complete fetched history. Start with a 40–60 message tail and load earlier messages on demand; defer global search/tool maps until those features are used.

## Do not optimize first

- **Desktop DOM virtualization:** already present at `src/screens/chat/components/sidebar/v2/sidebar-list-v2.tsx:164-171`.
- **SQLite indexes or VACUUM:** current session/history queries use indexes and are fast. The 1.9 GB database/FTS footprint deserves a separate maintenance audit, backup, and retention policy, not an unproven production vacuum.
- **Command palette:** it sorts the list to select five recent sessions, but this is minor beside the network payload and repeated transcript work.
- **More dependencies:** existing TanStack Query, router, and virtualizer primitives are sufficient.

## Recommended delivery order

1. Stop full session-list invalidation on send completion; align query stale/poll policy.
2. Change initial session retrieval to active + recent page, with server search/load-more.
3. Bound or replace the 1.5-second full-transcript tool poller.
4. Remove duplicate history polling and add navigation pending feedback.
5. Make `/chat/new` immediately optimistic.
6. Add safe gateway conversation compaction/windowing.
7. Address mobile virtualization and large-history lazy derivation.

## Implemented in this pass

- Initial session retrieval is bounded to the 200 newest sessions, while a direct route fetch keeps older deep-linked sessions available.
- Sidebar searches query the existing server search endpoint, so older sessions remain discoverable without loading the entire collection.
- Completion no longer forces a complete session-list reload; the active row is updated optimistically and moved to the top immediately.
- Session safety polling runs every 120 seconds instead of every 30–60 seconds.
- Idle navigation no longer schedules a redundant delayed history reload.
- Live-tool recovery polling reads the newest 100-message tail rather than the complete transcript.
- Session clicks show an accessible `Opening…` state until the route becomes active.

## Acceptance metrics

- Initial/revalidation session payload: below 250 KB for the normal recent page.
- Warm session navigation: content response/pending feedback within 200 ms; uncached target under 500 ms excluding model work.
- Send click to optimistic user bubble: under 50 ms.
- No complete-session-list request caused solely by assistant completion.
- No full-transcript polling while SSE is healthy.
- At most one history request on ordinary session navigation; recovery requests only when a run/disconnect warrants them.
- No visible input typing delay while a response streams.
