# SwitchUI canary frontend verification

Use this for UI-facing chat/history fixes before calling them done.

## Required runtime

- SwitchUI running locally, preferably at `https://127.0.0.1:3000`
- Hermes Agent gateway/dashboard running
- Browser skill available
- Node REPL browser runtime available (`node_repl js`)
- In-app browser (`iab`) controllable

If the browser runtime is missing, stop calling the check “full frontend canary”.

## Best canary target

Use a known long chat session:

- 200+ messages preferred
- includes tool cards / reasoning blocks if relevant
- stable session id that can be reused across checks

## Canary flow

1. Open SwitchUI in the in-app browser.
2. Navigate to the target chat session.
3. Confirm initial history load succeeds.
4. Verify the visible message tail matches the expected bounded fetch.
5. Leave the tab/view and return.
6. Wait for idle/backfill behavior.
7. Confirm the UI still renders correctly.
8. Capture screenshots at key states if the task is visual.

## Pass criteria

- Chat opens without crash or blank history
- No duplicate messages
- No missing tail messages
- No live-buffer overwrite after returning to tab
- No obvious full-transcript regression on initial load
- No 4xx/5xx history errors in console or network path
- If pagination was part of the change, the visible tail matches the backend tail

## Minimum evidence to record

- target URL
- session id used
- whether browser canary runtime was available
- PASS / FAIL
- one-line reason
- screenshots if visuals matter
- relevant endpoint facts if backend paging was part of the fix

## Good companion backend checks

When chat/history paging is involved, compare:

- gateway `/api/sessions/{id}/messages`
- dashboard `/api/sessions/{id}/messages`
- workspace `/api/history`

Check:

- omitted `limit`
- `limit=50&offset=0`
- `limit=50&offset=50`
- `limit=0`
- invalid `limit`

## Report template

```md
Canary frontend verification: PASS|FAIL

- Runtime: browser canary available | unavailable
- App URL: ...
- Session: ...
- Scenario: ...
- Result: ...
- Evidence: ...
- Screenshots: ...
```

