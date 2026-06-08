# HERMES-DEP: `POST /api/sessions/:id/messages` persistence endpoint

**Status: STEP 0 COMPLETE — ENDPOINT NOT NEEDED**

Handoff spec for the **Hermes-agent coder** (separate repo — the Python gateway, e.g. `Interstellar-code/hermes-agent`, active install `~/.hermes/hermes-agent`). SwitchUI consumes this endpoint but does not implement it. Reviewed by the SwitchUI side after build.

Copy the block below to the Hermes-agent coding agent.

---

## STEP 0 FINDING (2026-06-08): No new endpoint needed

**The gateway already persists `/v1/chat/completions` messages to state.db.**

### Trace

1. `_handle_chat_completions` (`api_server.py:1683`) extracts `session_id` from `X-Hermes-Session-Id` header (line 1755), or derives one from conversation fingerprint
2. `_create_agent` (`api_server.py:968`) creates AIAgent with `session_db=self._ensure_session_db()` (line 1024)
3. `run_conversation` calls `agent._ensure_db_session()` (`conversation_loop.py:383`) — creates session row in state.db
4. After agent runs, `_persist_session` → `_flush_messages_to_session_db` (`run_agent.py:1507`) → calls `self._session_db.append_message()` for each new message (line 1548)

### The real bug: header name mismatch

| SwitchUI sends (`openai-compat-api.ts:281`) | Gateway reads (`api_server.py:1755`) |
|---|---|
| `X-Claude-Session-Id` | `X-Hermes-Session-Id` |

SwitchUI sends the wrong header name → gateway ignores it → derives a session ID from conversation fingerprint → messages ARE persisted but under a derived ID → SwitchUI looks up the wrong session on reload → "portable conversations vanish."

### Fix (SwitchUI-side, no hermes-agent changes needed)

Change `openai-compat-api.ts:281` to send `X-Hermes-Session-Id` instead of `X-Claude-Session-Id`:

```typescript
// Before (wrong):
headers['X-Claude-Session-Id'] = options.sessionId

// After (correct):
headers['X-Hermes-Session-Id'] = options.sessionId
```

Additionally, ensure the session exists before sending chat. The gateway's `_ensure_db_session` creates the session row on first use, but only if the session ID is passed correctly. SwitchUI should either:
1. Pre-create the session via `POST /api/sessions` with an explicit ID, OR
2. Trust that the gateway auto-creates on first `/v1/chat/completions` call with a valid `X-Hermes-Session-Id`

Option 2 already works — the gateway's `_ensure_db_session` creates the session row if it doesn't exist.

### What SwitchUI must do

1. Send `X-Hermes-Session-Id` (not `X-Claude-Session-Id`) with the session ID
2. Ensure the session exists first (either pre-create via `POST /api/sessions`, or let the gateway auto-create on first chat call)
3. Read messages back via `GET /api/sessions/{session_id}/messages`

No hermes-agent endpoint build is required.

---

## Original spec (superseded by STEP 0 finding above)

The following was the original plan before investigation proved it unnecessary. Kept for reference.

<details>
<summary>Original spec (do not implement)</summary>

## PROMPT

You are working in the **hermes-agent** Python gateway repo (FastAPI, REST server on port 8642, the same process that serves `/api/sessions/{id}/chat/stream` and `/v1/chat/completions`). Do NOT touch the hermes-switchui repo.

### Why this is needed

hermes-switchui ("SwitchUI") has two chat backends:
- **Enhanced mode** → `POST /api/sessions/{id}/chat/stream`. The gateway runs the model and **persists** the user + assistant turns to `state.db` as a side effect. Good.
- **Portable / OpenAI-compat mode** → `POST /v1/chat/completions`. SwitchUI passes `X-Hermes-Session-Key` and `X-Claude-Session-Id` headers, but as far as SwitchUI can tell, **nothing is persisted to `state.db`** for these runs. Portable conversations vanish on reload.

Goal: give SwitchUI a way to write a portable run's messages into the **same** `state.db` session store the enhanced path uses, so there is one transcript truth regardless of backend.

### STEP 1 — Endpoint contract

`POST /api/sessions/{session_id}/messages`

- **Auth:** identical to the other `/api/sessions/*` routes (Bearer token / `API_SERVER_KEY`). Reuse the existing auth dependency — do not invent a new scheme.
- **Path:** `session_id` must reference an existing session. Return **404** if it does not exist. Do NOT auto-create sessions here (session creation stays `POST /api/sessions`).
- **Request body (JSON):**
  ```json
  {
    "client_run_id": "string (required) — SwitchUI run id, used for idempotency",
    "messages": [
      {
        "role": "user | assistant",
        "content": "string",
        "client_message_id": "string (required, unique per message within the run)",
        "model": "string (optional, for assistant turns)",
        "finish_reason": "string (optional)",
        "token_count": "int (optional)"
      }
    ]
  }
  ```
- **Idempotency (hard requirement):** if a message with the same `client_message_id` (or the same `(session_id, client_run_id, role, ordinal)`) already exists, do **not** insert a duplicate. Re-sending the identical body must be a no-op that returns the already-stored ids. SwitchUI may retry on network failure — duplicate rows are a correctness bug.
- **Response (200):**
  ```json
  {
    "session_id": "string",
    "inserted_message_ids": ["..."],
    "deduped": false
  }
  ```
  `deduped: true` when the request matched already-stored messages and nothing new was written.

### STEP 2 — Persistence rules

- **Reuse the existing internal message-write path** the enhanced/`chat/stream` flow uses to append a message — do NOT hand-write a raw `INSERT INTO messages`. The existing path handles the side effects below; a raw insert will silently skip them.
- On append, the following must stay consistent (match whatever the enhanced path already does):
  - `messages` row: `session_id`, `role`, `content`, `timestamp`, `token_count`, `finish_reason`, plus the `active`/`observed` flags at their normal defaults.
  - `sessions` counters: `message_count`, and token counters (`input_tokens`/`output_tokens`) if the enhanced path updates them.
  - **FTS index** (`messages_fts*`): the new rows must be searchable like enhanced-mode messages.
- **Timestamps must be stored in the same type/units as existing rows** (integer epoch, matching the enhanced path). Do not write ISO strings if the column is integer — mismatched timestamp types have previously poisoned other Hermes SQLite tables (a single bad-typed row broke an entire board with a 503). Coerce explicitly.
- Wrap the multi-message append in a single transaction; partial writes on error are not acceptable.

### STEP 3 — Acceptance / tests

- Append 1 user + 1 assistant message to an existing session → both readable via `GET /api/sessions/{id}/messages` in order; `message_count` increments by 2; both rows appear in FTS search.
- Re-POST the identical body → `deduped: true`, no new rows, `message_count` unchanged.
- POST to a non-existent `session_id` → 404, nothing written.
- Missing/blank `client_run_id` or `client_message_id` → 400.
- Timestamp column type of the new rows matches existing enhanced-mode rows (assert in test).
- Concurrent double-POST of the same `client_run_id` → exactly one set of rows (idempotency holds under race).

### Out of scope

- No queue / interrupt / steer / busy-mode semantics. This is a pure transcript-persistence endpoint.
- No session creation, no model invocation. SwitchUI already ran the model via `/v1/chat/completions`; this only records the result.

### Deliverable

The endpoint (or the STEP-0 "already persists, here's how to trigger it" finding), tests passing, and a one-paragraph note to the SwitchUI side describing the exact request shape and any header/session-precreation requirements so SwitchUI can wire the client call.

</details>

---

## Notes for SwitchUI-side review (me)

When the work comes back, verify:
- ~~STEP 0 answered explicitly (free path vs endpoint path).~~ **DONE: Free path confirmed.**
- ~~Idempotency actually holds (re-POST = no dup) — this is the highest-risk part.~~ **N/A: No endpoint.**
- ~~Timestamp type matches existing rows (poisoning guard).~~ **N/A: No endpoint.**
- ~~FTS rows present (portable messages searchable like enhanced).~~ **N/A: No endpoint.**
- ~~Reused the existing append path, not a raw INSERT.~~ **N/A: No endpoint.**

### SwitchUI-side action items

1. **Fix header name**: `openai-compat-api.ts:281` — change `X-Claude-Session-Id` to `X-Hermes-Session-Id`
2. **Verify session pre-creation**: Ensure SwitchUI creates the session via `POST /api/sessions` before sending chat, OR verify the gateway auto-creates on first chat call
3. **Test**: Send a portable chat message → reload → verify message appears in `GET /api/sessions/{id}/messages`
