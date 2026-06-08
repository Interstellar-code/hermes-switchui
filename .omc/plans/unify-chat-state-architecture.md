# Plan: Unify hermes-switchui Chat/Session State Architecture

**Status:** `pending approval` — debate-first. Do NOT implement until explicitly approved.
**Mode:** RALPLAN-DR consensus, deliberate. **Revision: v2** (post Architect + Critic; Critic rejected v1, all 8 blocking items addressed below).
**Date:** 2026-06-08
**Owner decisions locked:** (1) Pure-client busy-policy, documented; (2) Unify run lifecycle; (3) Persist portable via Hermes.

> **v1 → v2 changes (what the adversarial review forced):**
> 1. **Authority inverted.** v1 made the `hasUnansweredLatestUserTurn` history predicate the recovery authority. That violates the documented fence at `chat-screen-utils.ts:159-165` ("history shape … must not feed this value, otherwise interrupted sessions can self-lock and queue every future message") and is false-positive for tool-only turns (`chat-screen-utils.ts:136-144`). v2: **`isRecoverablePersistedRun` (process-liveness, `run-store.ts:196-216`) is the recovery authority; the predicate is a CLEAR-ONLY hint** — it may force a terminal/clear transition, never set or sustain busy/streaming.
> 2. **Risk tiers split.** The two user-facing bugs (phantom thinking, drain stall) are fixable on the *existing* liveness store without the Layer-3/4 rewrite. v2 splits into **Track 1 (reliability, ship now)**, **Track 2 (sustainability, separate justification)**, **Track 3 (portable persistence, gated)**.
> 3. Layer 2 relabelled from "projection of Hermes truth" to "process-liveness store (independent concern, recovery authority)" — it is the only cross-process recovery source and must never be deleted as a redundant cache.
> 4. A3 "one transcript truth" downgraded from asserted-present to **conditional** on a Phase-0 probe + possibly an unbuilt hermes-agent endpoint.
> 5. Pre-mortem strengthened with F1 (tool-only), F2 (self-lock), F3 (multi-run); cross-restart gap (#8) resolved explicitly.

---

## IMPLEMENTATION PROGRESS (live — updated 2026-06-08)

Branch: `feat/track1-chat-state-reliability`. Locked decisions: Q1 queue→sessionStorage(tab-scoped); Q2 portable persistence = header fix (no endpoint); Q3 interrupted = button-only resend; Q4 = Track 1 first.

| Item | Status | Evidence |
|---|---|---|
| **Track 3 — portable persistence** | ✅ DONE | Commit `192abff3`. STEP-0 proved gateway already persists; bug was header mismatch. `openai-compat-api.ts` now sends `X-Hermes-Session-Id` (via `HERMES_SESSION_ID_HEADER`). Typecheck clean. **Pending: runtime GUI proof** (portable chat → reload → transcript present). |
| **Phase 1.0 — verification (no code)** | ✅ DONE | active-run endpoint returns only recoverable runs (complete/error filtered server-side); F1 tool-only false-positive confirmed (`chat-screen-utils.ts:136-144`); fence confirmed (`isChatRuntimeBusy:159-182`). |
| **Phase 1.1 — SSE-desync drain stall fix** | ✅ DONE + REVIEWED | Commit `6b3bf9ea`. New `useDrainWatchdog` hook (escape hatch): arms only when busy+queued; on `DRAIN_WATCHDOG_IDLE_MS`=5s SSE silence polls active-run; recoverable→no-op (R5 honored), not-recoverable→`reconcileStuckBusyState` (reuses `streamFinish()`+`clearStreamingSession()`+`activeSendRef=null`); never dequeues (no double-send). Fence-clean (zero history→busy coupling). 21 tests green. Reviewer verdict: PASS. `clearStreamingSession` deletes the streamingState map entry (`chat-store.ts:1408`) → `isRealtimeStreaming` (derived, `use-realtime-chat-history.ts:545`) clears transitively, so reconcile covers ALL 6 `isComposerLoading` signals. |
| **Phase 1.2 — liveness recovery + interrupted affordance** | ✅ DONE | Commit `cea955b1`. `useActiveRunCheck` rewritten snapshot-first: liveness = authority, predicate = clear-only. F1 guard via new `latestTurnIsToolOnly` helper. Empty-history guard for portable. "Run may have continued server-side — resend?" banner (button-only, Q3). Feature flag `localStorage.switchui:recovery-reconcile-v1=0` reverts to legacy. **Fence-clean:** predicate path never calls `setSessionWaiting` (line 134 `setSessionWaiting` is only reachable from the `isRecoverableActiveRun` branch). 10 recovery + 5 F1 + 2 store = 17 new tests, all 38 Phase 1 tests green. |
| **Track 2 — storage consolidation** | ⬜ NOT STARTED | Deferred until Track 1 ships + debated separately (Q4). |

**Phase 1.1 deferred follow-ups (fold into Phase 1.2's shared reconciliation, do NOT block):**
- Watchdog latches off after one "recoverable" probe (`reconciledOrLive`) → if a run reads live then later drops its completion in the same armed window, it won't re-probe (falls back to 120s waiting TTL). Fix: don't latch on live; re-probe at `IDLE_MS` cadence (throttle via `lastProbeAt`). Requires updating the "recoverable→no-op" test's `toHaveBeenCalledTimes(1)` assertion.
- `lastEventAt` is GLOBAL not per-session → a second concurrently-streaming session masks silence on the stalled one. F3 multi-run is documented out-of-scope; note only.

---

## 0. Corrected premise (grounding overrode the briefing)

Two of the "5 stores" in the original mental model were stale. Verified against live code:

| Briefing claim | Verified reality | Citation |
|---|---|---|
| `.runtime/local-sessions.json` holds portable conversations | **Phantom.** `openai-compat-api.ts` is stateless — no file I/O. Portable conversations persist **nowhere**; lost on reload. | `openai-compat-api.ts:260-310` |
| localStorage holds queue + waiting + recovery | localStorage holds **only** the FIFO queue. Waiting/streaming/recovery live in **sessionStorage** (tab-scoped). | `chat-store.ts:209,244,293,345` |
| `switchui.db` is a chat store | `switchui.db` is **only** `user_commands` (slash commands). Orthogonal. | `commands-store.ts:71` |
| Backend gated on sessions/tasks/jobs | Gated on single `enhancedChat` boolean. | `gateway-capabilities.ts:1010,547` |

**Confirmed true:** native `queue`/`busy_input_mode`/`interrupt`/`steer`/`restart_interrupted` have **zero REST surface** — JSON-RPC gateway only.

### Real store inventory (corrected)

Fragmentation is **UI-side run/recovery state**, scattered across 4 disconnected sites, none consulting Hermes for authoritative status:

1. **Zustand `chat-store.ts`** (in-memory): `realtimeMessages`, `streamingState`, `waitingSessionKeys`, `waitingSessionMeta`, `messageQueue`, `messageQueueActivity`, `sendStreamRunIds` — `chat-store.ts:105-165`
2. **sessionStorage** (3 keys, tab-scoped): `claude_streaming_<sk>` (60s), `claude_recovery_msg_<sk>` (5min), `claude_waiting_<sk>` (120s) — `chat-store.ts:209,244,293`
3. **localStorage** (1 key, cross-tab): `switchui:message-queue:<sk>` — `chat-store.ts:345`
4. **run-store JSON** (server-side, SwitchUI-owned): `~/.hermes/webui-mvp/runs/<sk>/<runId>.json`, process-start-gated recoverability — `run-store.ts:37,38,196-216`

`state.db` (Hermes-owned transcript) and `switchui.db` (slash commands) are **out of scope**.

> **Architect note (accepted):** these 4 sites are *orthogonal concerns* (queue ≠ waiting ≠ streaming buffer ≠ cross-process snapshot), not 4 copies of one truth. Consolidation must preserve that orthogonality, not collapse correctly-decoupled state. This is why Track 2 (consolidation) is justified on *maintenance cost*, not on a false "4 copies of one value" claim.

### The core mismatch

SwitchUI **guesses** busy/recovery from local snapshots; Hermes **knows** the transcript truth, but SwitchUI never asks it. Recovery (`use-active-run-check.ts:83-89`) consults only run-store JSON freshness vs `RUN_STORE_PROCESS_STARTED_AT` — never Hermes history. The fix is NOT to invert that into history-as-authority (the fence forbids it), but to make the liveness snapshot authoritative *within SwitchUI* and use Hermes history only to *clear* phantom state.

---

## 1. Requirements Summary

Make recovery reliable (kill phantom thinking + SSE-desync drain stall) using the **existing process-liveness snapshot as authority**; consolidate the 4 UI state sites to one authority + one adapter for *maintainability* (separate track); give portable mode Hermes-backed persistence (gated). Transport stays REST+SSE. Busy-input policy stays client-side, documented.

---

## 2. Target Architecture

Four layers, one owner each. **Layer 2 is the recovery authority — not a cache of Hermes.**

```
┌─ Layer 1: TRANSCRIPT TRUTH (Hermes-owned) ──────────────────┐
│ state.db — sessions/messages/FTS. Read via getMessages.     │
│ Portable writes land here ONLY if Track 3 lands (gated).    │
│ Role in recovery: CLEAR-ONLY hint source, never authority.  │
└─────────────────────────────────────────────────────────────┘
┌─ Layer 2: PROCESS-LIVENESS STORE (SwitchUI, AUTHORITY) ─────┐
│ run-store JSON. The ONLY cross-process record of "is a run  │
│ in flight for this UI process." isRecoverablePersistedRun() │
│ (run-store.ts:196-216) is the recovery decision. REST-Hermes │
│ cannot report this (A1) → genuinely independent concern.    │
│ NOT a projection. Must never be deleted as redundant.       │
└─────────────────────────────────────────────────────────────┘
┌─ Layer 3: CLIENT RUN STATE MACHINE (Track 2) ───────────────┐
│ One Zustand slice. idle→queued→sending→streaming→           │
│   (complete|error|interrupted). ONE selectRunPhase replaces │
│ the 4-source isComposerLoading. Busy is SET only by SSE     │
│ events + liveness snapshot — NEVER by history shape.        │
└─────────────────────────────────────────────────────────────┘
┌─ Layer 4: CLIENT PERSISTENCE ADAPTER (Track 2) ─────────────┐
│ runPersistence: dumb I/O only (key→value+TTL), zero policy. │
│ One key namespace, one TTL table. Replaces 4 ad-hoc sites.  │
└─────────────────────────────────────────────────────────────┘
```

### 2.1 Recovery algorithm — liveness-authoritative, predicate clear-only

**Rule (the fence, honored):** `hasUnansweredLatestUserTurn` may force a state OFF (clear phantom thinking) or to a non-busy terminal (`interrupted`). It may **never** set or sustain `streaming`/busy. Busy is owned by SSE events + the liveness snapshot only.

```
on mount(sessionKey):
  snapshot = GET /api/sessions/:sk/active-run    # endpoint returns ONLY recoverable runs
                                                  # (run-store.ts:201 filters complete/error)
  if snapshot present:                            # AUTHORITY: process-liveness says a run is live
      runPhase = streaming; resumeWaiting(snapshot.runId)
      return

  # No recoverable run. Liveness authority says "nothing live."
  clearWaiting()                                  # kill any phantom thinking unconditionally
  history = cached getMessages(sessionKey)        # may be empty for portable (Track 3 gap, documented)

  # CLEAR-ONLY predicate use + F1 guard + cross-restart catch (#8):
  if hasUnansweredLatestUserTurn(history)
       AND not latestTurnIsToolOnly(history)      # F1 guard: tool-only completion ≠ unanswered
       AND history is non-empty:                  # portable-empty guard
      runPhase = interrupted                       # offer "resend?", NEVER auto-streaming
  else:
      runPhase = complete                          # idle/done
```

Why this is correct where v1 was not:
- **Snapshot-first**, not answered-first → never re-arms busy from a false-positive predicate.
- A run aged out of the recoverable window (or completed server-side, filtered by `run-store.ts:201`) yields "no snapshot" → terminal, not phantom streaming.
- The predicate can only *downgrade* to `interrupted`/`complete` — the fence's self-lock scenario (F2) is structurally impossible because the predicate has no path to `streaming`/busy.

### 2.2 Cross-restart gap (#8, resolved)

After a **SwitchUI server restart**, every prior run fails `isRecoverablePersistedRun` (`lastActivityAt < RUN_STORE_PROCESS_STARTED_AT`, `run-store.ts:205`) — even if Hermes is still streaming that turn. A1 forbids asking Hermes "is this run live," so we cannot recover busy state across restart. Resolution: such a run hits the `snapshot absent` branch → if the predicate says unanswered AND not tool-only → `interrupted` ("Run may have continued server-side — resend?"). We **never** auto-resume `streaming` across restart (would need the forbidden Hermes endpoint). This is an accepted, documented limitation, surfaced honestly to the user instead of as a phantom bubble.

### 2.3 SSE-desync drain stall fix (Track 1, the known prod blocker)

Today drain triggers on `isComposerLoading` falling edge (`chat-screen.tsx:2694` `if (isComposerLoading) return`). A missed SSE completion → `isComposerLoading` never falls → drain stalls.

Fix (no history-as-authority): on an idle gap of **N=5s** with no SSE event during an active run, poll `GET active-run`. If the run is no longer recoverable (server marked it complete/error → filtered out, or it aged past the window), force terminal phase → drain proceeds. The server-side SSE handler already updates run-store as the run completes, so a *client-side* SSE drop is caught by re-reading the *server* liveness snapshot. Heartbeat reuses the existing retry budget (`ACTIVE_RUN_CHECK_RETRY_MS=1500`, `MAX_ATTEMPTS=3`, `use-active-run-check.ts:28-29`).

### 2.4 Portable persistence (Track 3) — Phase-0 gated

`openaiChat` passes `X-Claude-Session-Id` + `X-Hermes-Session-Key` (`openai-compat-api.ts:280-286`) but persists nothing client-side. **Open question (Phase 0.1):** does the gateway's `/v1/chat/completions` write to `state.db` when those headers name a real session? If yes → Track 3 is nearly free. If no → needs a Hermes REST persistence endpoint (`POST /api/sessions/:id/messages`) — a *persistence* change (not busy-policy, so A1 holds), but a **cross-repo hermes-agent dependency** and a **second transcript write-path**. Until it lands, portable transcripts persist nowhere and `getMessages` returns empty for portable sessions (handled by the empty-history guard in §2.1).

---

## 3. RALPLAN-DR Summary

### Principles
1. **One owner per concern.** Authoritative home per concern; orthogonal concerns stay decoupled (queue ≠ waiting ≠ snapshot).
2. **Liveness is server-snapshot truth; history is a hint, never an authority.** (The fence.)
3. **Reconcile, don't accumulate.** Derive on mount/heartbeat from the liveness snapshot; never trust a lone SSE completion event.
4. **No silent approximations.** A lost/uncertain run surfaces as `interrupted` ("resend?"), never a phantom thinking bubble. The predicate's known false-positives (F1) are guarded, not ignored.
5. **Incremental + reversible + risk-tiered.** Reliability fixes (Track 1) ship independently of sustainability refactor (Track 2). Each phase reverts alone.

### Decision Drivers (top 3)
1. **Reliability** — phantom thinking + drain stall (Track 1; the actual user pain).
2. **Sustainability** — 4 sites → 1 authority + 1 adapter (Track 2; maintenance cost, not bug urgency).
3. **Bounded blast radius** — REST+SSE stays; no Hermes busy REST; portable persistence gated.

### Viable Options
- **Track 1 = effectively Option C (minimal hardening) done right.** Fixes both user-facing bugs on the existing liveness store. Ship first.
- **Track 2 = Option A (unify run lifecycle).** Justified on maintainability after Track 1 removes bug urgency. The honest A-vs-C adjudication (per Architect/Critic): **the bugs do NOT require the rewrite; the rewrite is sustainability work.** Owner picked A2 depth, so Track 2 proceeds — but on its real merits.
- **Option B (full UI-as-projection) rejected.** Needs REST run-status Hermes lacks (A1); highest risk. *Invalidation:* the endpoints it requires are exactly what A1 forbids.

---

## 4. Implementation — Three Tracks

> All gated behind explicit execution approval. Each phase independently revertible.

### TRACK 1 — Reliability — ✅ SHIPPED on `feat/track1-chat-state-reliability` (2026-06-08)

**Status: complete.** Both user-facing bugs (phantom thinking, drain stall) fixed on the existing liveness store. Commits: `6b3bf9ea` (1.1), `cea955b1` (1.2). Feature flag `localStorage.switchui:recovery-reconcile-v1=0` reverts to legacy behaviour without deploy.

**Phase 1.0 — Verification (no code)** ✅
- Confirmed `GET active-run` returns only recoverable runs (`run-store.ts:201`) and never surfaces `complete`/`error` to the client.
- Confirmed `latestTurnIsToolOnly` derives cleanly from `ChatMessage` shape (`chat-screen-utils.ts:117-148`).

**Phase 1.1 — Drain hotfix (§2.3)** ✅
- Added `useDrainWatchdog` heartbeat (5s idle) → polls `active-run` → forces terminal + drain when run no longer recoverable.
- **Acceptance:** kill the SSE mid-stream (drop completion event) → queue still drains within N+retry budget; all 7 watchdog tests pass; FIFO order preserved.

**Phase 1.2 — Liveness-authoritative recovery (§2.1, §2.2)** ✅
- Rewrote `useActiveRunCheck` mount logic to snapshot-first; predicate clear-only with F1 + empty-history guards.
- Added `interrupted` affordance ("Run may have continued server-side — resend?") replacing phantom thinking; button-only resend (Q3).
- Behind feature flag `localStorage.switchui:recovery-reconcile-v1` (default ON; set to `0` to disable).
- **Acceptance:** all 10 useActiveRunCheck tests pass (snapshot-first, interrupted, F1 tool-only guard, answered+stale, portable empty history, feature flag OFF, recoverable clears interrupted).

**Phase 1.1 — Drain hotfix (§2.3)**
- Add heartbeat (N=5s idle) → poll `active-run` → force terminal + drain when run no longer recoverable.
- Replace the `isComposerLoading` falling-edge drain trigger with terminal-state drain.
- **Acceptance:** kill the SSE mid-stream (drop completion event) → queue still drains within N+retry budget; all 17 queue tests pass; FIFO order preserved (count→BANANA→CHERRY).

**Phase 1.2 — Liveness-authoritative recovery (§2.1, §2.2)**
- Rewrite `use-active-run-check.ts` mount logic to snapshot-first; predicate clear-only with F1 + empty-history guards.
- Add `interrupted` affordance ("Run lost — resend?") replacing phantom thinking; add cross-restart messaging. **Button-only resend (Q3 decided) — no auto-resend** (avoids duplicate runs if the original completed server-side).
- **Behind a feature flag** so reconciliation can be disabled in prod without a revert (Architect kill-switch requirement).
- **Acceptance (new axes):**
  - kill -9 SSE mid-stream → reload → no phantom thinking.
  - **Tool-only completed turn → must NOT recover as `streaming`** (F1 explicit test).
  - answered-turn + stale snapshot → clears cleanly.
  - unanswered + non-tool-only + no snapshot → `interrupted` affordance (not thinking).
  - SwitchUI restart mid-run → `interrupted` (not auto-streaming) (#8).

### TRACK 2 — Sustainability consolidation

**Phase 2.0 — Inventory** ✅ DONE (this section). Grep map of every read/write of the 4 stores, producing the adapter migration checklist for Phase 2.3.

**Inventory results (verified against live code 2026-06-08):**

| # | Store | Location | Keys / fields | Status |
|---|---|---|---|---|
| 1 | Zustand `chat-store.ts` (in-memory) | `src/stores/chat-store.ts:105-178` | 7 state slices (`realtimeMessages`, `streamingState`, `lastEventAt`, `sendStreamRunIds`, `messageQueue`, `messageQueueActivity`, `waitingSessionKeys`+`Meta`, `interruptedSessionKeys`) + 19 actions | All consolidated in one Zustand slice — Layer 3 |
| 2 | sessionStorage (tab-scoped) | `src/stores/chat-store.ts:200-352` | `claude_streaming_<sk>` (60s), `claude_recovery_msg_<sk>` (5min), `claude_waiting_<sk>` (120s) | Adapter `runPersistence` (Phase 2.3) |
| 3 | localStorage (cross-tab) | `src/stores/chat-store.ts:358-411` | `switchui:message-queue:<sk>` | **MIGRATE** to sessionStorage in Phase 2.3 (R3/Q1 decided) |
| 4 | run-store JSON (server-side) | `src/server/run-store.ts:37,38,196-216` | `~/.hermes/webui-mvp/runs/<sk>/<runId>.json` | **Out of scope** (server-side, separate process) |

**Extra direct chat storage I/O outside `chat-store.ts`:**
- `use-active-run-check.ts:57` — feature flag `switchui:recovery-reconcile-v1` — keep (not run state)
- `use-realtime-chat-history.ts:79` — real-time history cache — already separate concern
- `chat-screen.tsx:533,552,590,2829` — UI prefs (`switchui:tool-display-mode`, `claude-file-explorer-collapsed`) — not run state

**Adapter migration checklist (gates Phase 2.3 deletes):**

| Operation | Key | TTL | Adapter | Migration |
|---|---|---|---|---|
| Persist streaming | `claude_streaming_<sk>` | 60s | `persistStreamingState` | byte-identical |
| Restore streaming | `claude_streaming_<sk>` | 60s | `restoreStreamingState` | byte-identical |
| Persist recovery msg | `claude_recovery_msg_<sk>` | 5min | `persistRecoveryMessage` | byte-identical |
| Restore recovery msg | `claude_recovery_msg_<sk>` | 5min | `restoreRecoveryMessage` | byte-identical |
| Clear recovery msg | `claude_recovery_msg_<sk>` | — | `clearRecoveryMessage` | byte-identical |
| Persist waiting | `claude_waiting_<sk>` | 120s | `persistWaitingState` | byte-identical |
| Remove waiting | `claude_waiting_<sk>` | — | `removeWaitingState` | byte-identical |
| Restore all waiting | `claude_waiting_*` | 120s | `restoreWaitingSessions` | byte-identical |
| Read queue | `switchui:message-queue:<sk>` | — | `readQueuedMessages` | **CHANGE: sessionStorage, drain from localStorage on first read** |
| Write queue | `switchui:message-queue:<sk>` | — | `writeQueuedMessages` | **CHANGE: sessionStorage** |
| Clear queue | `switchui:message-queue:<sk>` | — | `clearQueuedMessages` | **CHANGE: sessionStorage** |

**`isComposerLoading` signals (`chat-screen.tsx:1632-1639` — 6 inputs):**
1. `sending` (in-memory)
2. `waitingForResponse` (sessionStorage-backed `claude_waiting_`)
3. `hasActiveSend` (ref: `activeSendRef.current`)
4. `activeIsRealtimeStreaming` (in-memory, derived)
5. `derivedIsStreaming: derivedStreamingInfo.isStreaming` (in-memory, derived)
6. `hasPendingGeneration` (in-memory, derived)

**F2 fence guard for `runPhase` (Phase 2.1):**
- `runPhase` → `streaming` ONLY via: SSE event handlers, `setSessionWaiting` (liveness snapshot), `setActiveSend` (ref)
- `runPhase` ← `streaming` via: `clearSessionWaiting`, `clearStreamingSession`, SSE completion, `streamFinish()`
- `runPhase` → `interrupted` from predicate (clear-only, Phase 1.2)
- `runPhase` ← `streaming` from history shape: **NEVER** (F2)

**Phase 2.1 — Layer 3 `runPhase` slice** — add state machine + reducers driven by SSE events + liveness snapshot ONLY (never history). Add `selectRunPhase`, `selectIsComposerBusy`. Parallel path, no cutover.
- **Acceptance:** `selectIsComposerBusy` parity table vs legacy 4-signal `isComposerLoading`; **busy never settable from history shape** (lint/test guard).

**Phase 2.2 — Cut `isComposerLoading` → `selectIsComposerBusy`** — one-line selector swap in `chat-screen.tsx:1623,2694`.
- **Acceptance:** all queue tests pass; GUI parity.

**Phase 2.3 — Layer 4 `runPersistence` adapter** — extract all storage I/O into one dumb module (no conditionals — pre-mortem #2 guard). Delete scattered inline calls. Keep keys byte-identical; keep old keys readable for one release (rollback safety).
- **Acceptance:** zero direct `sessionStorage`/`localStorage` chat-state access outside `runPersistence` (this is a *tidiness* metric, not a reliability claim — Critic note); recovery TTLs unchanged.
- **R3 (Q1) DECIDED:** move queue from localStorage → **sessionStorage (tab-scoped)**. One-time migration: on first read, drain any existing `switchui:message-queue:*` localStorage entries into sessionStorage, then clear the localStorage keys.

### TRACK 3 — Portable persistence — RESOLVED (no endpoint, no cross-repo dep)

> **STEP 0 outcome (2026-06-08):** the gateway **already persists** `/v1/chat/completions` messages to `state.db`. The "portable vanishes on reload" bug was a **header-name mismatch**, not missing persistence: SwitchUI sent the session id under `X-Claude-Session-Id`, but the gateway reads `X-Hermes-Session-Id` → it ignored SwitchUI's id and persisted under a fingerprint-derived id → reload (`getMessages(sessionKey)`) looked up the wrong session.
>
> **Fix (applied, SwitchUI-side, ~1 line):** send the id under `HERMES_SESSION_ID_HEADER` (`X-Hermes-Session-Id`) in `openai-compat-api.ts`. Verified the write-id (`portableSessionKey = sessionKey`, `send-stream.ts:500`) equals the read-id (`getMessages(sessionKey)`, `history.ts:95`), so reload now hits the persisted session. Typechecks clean. **Remaining:** manual GUI proof (portable chat → reload → transcript present).
>
> **HERMES-DEP `POST messages` endpoint is NOT needed** — superseded by STEP 0. No Hermes-agent work required. Full trace in `hermes-dep-post-messages-endpoint.md`.

**Superseded design (kept for reference): ownership split**

> Originally (Q2): the Hermes-agent-side work would have been owned by the **Hermes-agent coder** (separate repo). STEP 0 proved no endpoint is needed, so this split no longer applies.

**Phase 3.0 — probe (SwitchUI, no code change):** probe gateway `/v1/chat/completions` persistence behavior with `X-Hermes-Session-Key` (§2.4). Outcome decides whether the SwitchUI side is "free path" (3.S-a) or "endpoint path" (3.S-b).

#### 3.S — SwitchUI side (THIS repo — my scope)
- **3.S-a (free path, if Phase-0 shows the gateway already persists):** ensure a Hermes session exists before a portable run; pass session headers; portable transcript then reads back via the same `getMessages` path as enhanced. No gateway change needed.
- **3.S-b (endpoint path, if Phase-0 shows it does NOT persist):** after the portable stream completes, SwitchUI calls the new gateway endpoint `POST /api/sessions/:id/messages` to append the user + assistant messages. SwitchUI is responsible only for the client call + runId-keyed idempotency on the request side.
- **SwitchUI acceptance:** portable conversation survives reload via Hermes (free path), OR the append call is wired + tested against the endpoint once it exists (endpoint path). If the endpoint is not yet built, 3.S-b is marked `blocked on HERMES-DEP` and portable stays ephemeral (handled by §2.1 empty-history guard) — no half-shipped state.

#### HERMES-DEP — Hermes-agent side (SEPARATE repo — Hermes-agent coder's scope, NOT done here)
- Build `POST /api/sessions/:id/messages` on the gateway: append a message row to `state.db` for an existing session, idempotent on a client-supplied runId/message key (no duplicate rows on retry).
- This is a **persistence** endpoint, not a busy-policy endpoint → does not violate A1.
- Tracked as a cross-repo dependency. SwitchUI's 3.S-b consumes it but does not implement it. File as a hermes-agent issue; SwitchUI proceeds with everything else regardless of its status.

### Documentation (after Track 1)
- ADR (§9) committed to `docs/`.
- Document "SwitchUI owns busy-input policy (client FIFO); Hermes native queue/busy_input_mode intentionally unused over REST" with rationale + revisit trigger.

---

## 5. Risks and Mitigations

| ID | Risk | Mitigation |
|---|---|---|
| R1 | Recovery `getMessages` on mount → extra load; **portable history is empty** → predicate path unreliable | Reuse the chat screen's in-flight TanStack Query (no extra request). Portable: empty-history guard in §2.1 short-circuits predicate; recovery rests on snapshot only until Track 3. |
| R2 | `runPhase` cutover (2.2) changes busy truth table | 2.1 ships parallel + parity test BEFORE 2.2; cutover is one-line, revertible. |
| R3 | Cross-tab localStorage queue → double-send | **DECIDED:** queue moves to sessionStorage (tab-scoped) in Phase 2.3 — per-tab, no double-send. One-time migration drains existing localStorage queue keys on first read. |
| R4 | Track-3 free-path assumption wrong → silent need for hermes-agent endpoint | Phase 3.0 hard-gates; no 3a/3b scoped until probed. |
| R5 | Heartbeat forces terminal while a slow run is live | Terminal forced ONLY when the *liveness snapshot* says non-recoverable — never from history or a blind timer. A live run keeps its snapshot recoverable → stays `streaming`. |
| R6 | Phase 2.3 deletes an unmapped reader | Phase 2.0 grep map gates deletes; keys byte-identical; old keys readable one release. |
| R7 | **F1 tool-only false-positive** re-arms phantom recovery | §2.1 `latestTurnIsToolOnly` guard; explicit acceptance test in 1.2; predicate can never set busy regardless. |
| R8 | **F3 multi-run**: `getActiveRunForSession` returns only the most-recent recoverable run (`run-store.ts:238`) → concurrent runs in one session collapse | Documented limitation for Track 1 (single-run recovery). If multi-run recovery is needed, it is out-of-scope here and tracked separately. |

---

## 6. Verification Steps

- `pnpm test` green after every phase (esp. 17 queue tests).
- `pnpm build` + `pnpm lint` clean per phase.
- Manual GUI: phantom-thinking repro (kill SSE → reload), **tool-only-completion repro**, drain-order repro, SwitchUI-restart-mid-run repro, portable reload-survival (Track 3).
- Observability: log `runPhase` transitions (sessionKey, runId, from→to, trigger=sse|heartbeat|snapshot|predicate-clear); assert no transition INTO `streaming` with trigger=predicate (fence guard); assert no `streaming→gap→streaming` without a terminal.

---

## 7. Pre-mortem (deliberate mode — strengthened)

1. **F2 self-lock (the fence's own scenario).** History shape leaks back into busy logic during the Track-2 refactor → interrupted sessions self-lock and queue every future message (the documented prod regression). **Pre-empt:** Principle #2 enforced by test + lint — `runPhase` reducers reject any history-derived input as a busy/streaming setter; observability asserts no `→streaming` with trigger=predicate.
2. **F1 tool-only false-recover.** A turn completing with only tool output (no final text) reads as unanswered → would recover as live. **Pre-empt:** `latestTurnIsToolOnly` guard in §2.1; predicate can only reach `interrupted`/`complete`, never `streaming`; explicit acceptance test 1.2.
3. **F3 multi-run collapse.** Two concurrent runs in one session; recovery sees only the most-recent (`run-store.ts:238`) → the other is silently dropped. **Pre-empt:** documented single-run limitation for Track 1; do not claim multi-run recovery; surface a log warning when >1 recoverable run exists for a session so the gap is visible, not silent (Principle #4).
4. **Adapter god-object.** Layer-4 accretes policy until as tangled as the 4 sites. **Pre-empt:** adapter is dumb I/O only; no conditionals (lint/review rule).
5. **Track-3 fork divergence.** 3b ships half-done → portable writes race the stream end → duplicate/missing messages. **Pre-empt:** 3b separate gated task with runId-keyed idempotency test; never inline.

---

## 8. Expanded Test Plan (deliberate mode)

- **Unit:** `runPhase` reducer transition table (incl. assertion that no history input reaches a busy setter); `selectIsComposerBusy` parity vs legacy; **reconcile() matrix = snapshot-present × answered × tool-only × history-empty** (F1 + portable axes added); `latestTurnIsToolOnly`; `runPersistence` key/TTL round-trips.
- **Integration:** SSE events → `runPhase=complete`; **missed completion → heartbeat → snapshot non-recoverable → complete** (drain proceeds); queue drain on terminal; mount reconciliation vs seeded Hermes history; **tool-only completed history → not streaming**; **SwitchUI restart → interrupted**.
- **E2e (GUI):** phantom-thinking (kill SSE, reload → clean); tool-only completion (no phantom); FIFO drain order; SwitchUI-restart-mid-run (interrupted, not thinking); two-tab queue (R3 verified); portable reload-survival (Track 3).
- **Observability:** structured `runPhase` transition log with trigger source; assertion/dashboard catches (a) any `→streaming` with trigger=predicate, (b) stuck non-terminal phases, (c) >1 recoverable run per session (F3 visibility).

---

## 9. ADR

**Decision:** Make SwitchUI recovery authoritative on the existing process-liveness snapshot (`isRecoverablePersistedRun`); use the `hasUnansweredLatestUserTurn` history predicate only as a clear-only hint (guarded for tool-only false-positives), never as a busy/streaming authority — honoring the documented fence at `chat-screen-utils.ts:159-165`. Fix the SSE-desync drain stall via a liveness-snapshot heartbeat (Track 1). Consolidate the 4 UI state sites into one client run-state machine + one persistence adapter for maintainability (Track 2). Persist portable transcripts via Hermes **if and only if** a Phase-0 probe shows the gateway already persists, or a separately-tracked hermes-agent `POST messages` endpoint is built (Track 3) — until then portable persistence is an accepted gap.

**Drivers:** reliability (phantom thinking + drain stall), sustainability (maintenance cost of 4 sites), bounded blast radius (no transport rewrite, no Hermes busy REST).

**Alternatives considered:** History-predicate-as-recovery-authority (v1 — REJECTED: violates the fence, F1 false-positive); Full UI-as-projection / native-parity busy REST (REJECTED: needs REST surface A1 forbids); Pure minimal hardening with no consolidation (PARTIALLY ADOPTED as Track 1 — the bug fixes; consolidation kept as Track 2 on maintainability grounds).

**Why chosen:** Largest reliability win at lowest risk by reusing the verified liveness snapshot instead of a leaky predicate; decouples bug fixes (ship now) from refactor (no urgency borrowing); honors a documented prior fix instead of walking it back.

**Consequences:** SwitchUI permanently owns busy-input policy (documented). Recovery cannot restore busy across a SwitchUI restart (A1 limitation; surfaced as `interrupted`, not phantom). Portable "one transcript truth" is **conditional** on Track 3, not delivered by this plan alone. Multi-run-per-session recovery is out of scope (single-run only, F3). One place to change run state after Track 2.

**Follow-ups:** Q1 (R3) cross-tab queue policy; Phase-0 / Track-3 probe outcome; possible hermes-agent `POST messages` endpoint; F3 multi-run recovery if needed; revisit trigger for native Hermes busy modes if they gain a REST surface.

---

## 10. Open Questions (debate before approval)

- **Q1 (R3): DECIDED** → queue moves to **sessionStorage (tab-scoped)**, per-tab, no cross-tab double-send. Confirmed.
- **Q2 (Track 3): DECIDED** → Hermes-agent `POST messages` endpoint (HERMES-DEP) owned by the **Hermes-agent coder** in the separate gateway repo. SwitchUI scope = client-side wiring only (Track 3.S). See Track 3 ownership split.
- **Q3: DECIDED** → `interrupted` affordance = **button-only resend**. No auto-resend.
- **Q4 (scope): OPEN** → Approve Track 1 alone first (reliability, ships fast), then debate Track 2 separately? Or approve all three as one program? Recommendation: Track 1 first.
