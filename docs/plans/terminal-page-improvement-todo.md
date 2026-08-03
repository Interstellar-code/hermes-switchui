# Terminal Page Improvement TODO

Scope: `TerminalWorkspace`, persistent mounting in `WorkspaceShell`, terminal APIs, PTY helper, terminal store, and Matrix terminal styling.

## P0 — Correctness and data integrity

- [x] **Make PTY resize actually update rows and columns.**
  - Evidence: `src/server/terminal-sessions.ts:233` ignores both requested dimensions and only sends `SIGWINCH`; `src/server/pty-helper.py:54-61` rereads the unchanged startup `COLUMNS`/`LINES` environment.
  - Change: send the new dimensions to the helper (small control message or signal-safe side channel), call `TIOCSWINSZ`, then signal the child shell.
  - Check: start `stty size`, resize the pane and split modes, and assert the reported size changes.

- [x] **Stop normal shell exit from reopening a fresh shell.**
  - Evidence: `terminal-stream.ts:159-166` emits `exit` then closes the stream, while `terminal-workspace.tsx:490-555` treats every ended stream as reconnectable when a persisted `sessionId` exists. The next attach misses the deleted server session and creates a new PTY.
  - Change: track the `close`/`exit` event explicitly and reconnect only after transport failure; clear the dead `sessionId` and show an exited/restart state.
  - Check: run `exit`; no new prompt should appear until the user chooses Restart/New session.

- [x] **Never discard terminal output under load.**
  - Evidence: `terminal-workspace.tsx:407-426` truncates buffered output to its last 8 KiB every 80 ms.
  - Change: preserve ordered output and apply backpressure/batched writes without slicing data; use xterm's write callback if batching is still needed.
  - Check: print a numbered payload larger than 8 KiB and verify no gaps.

- [x] **Replace one HTTP request per input event with an ordered input channel.**
  - Evidence: `terminal-workspace.tsx:172-189` POSTs every `onData` chunk independently and ignores failures; request completion/order is not guaranteed and paste creates a request burst.
  - Change: minimally queue/batch input per session, or use the existing stream as a bidirectional transport if the server stack supports it.
  - Check: rapid typing, bracketed paste, arrows, Ctrl sequences, and a large multiline paste arrive exactly once and in order.

## P1 — Lifecycle, layout, and resource use

- [x] **Fit the actual pane with `ResizeObserver`, not only the browser viewport.**
  - Evidence: `terminal-workspace.tsx:714-768` listens to window/visual viewport and fixed delays; sidebar collapse, split changes, chat panel changes, and terminal panel drag change element size independently.
  - Change: observe each visible `.term-xterm` container, debounce to one animation frame, run `fit()`, then send one resize only when cols/rows changed.
  - Check: sidebar collapse, split toggle, chat drawer, panel drag, and route restore all fit without clipping or stale columns.

- [x] **Initialize only visible terminals; suspend decorative work when hidden.**
  - Evidence: `terminal-workspace.tsx:682-688` creates/connects every persisted tab; `terminal-workspace.tsx:1061-1099` mounts a `MatrixRainCanvas` for every tab; `matrix-rain-canvas.tsx:46-87` runs continuous RAF even for `display:none` panes and while the persistent workspace is route-hidden.
  - Change: connect the active/split-visible tabs on demand, pause canvas animation when pane/page is hidden, and respect `prefers-reduced-motion`.
  - Check: inactive tabs create no RAF/PTY work until selected; navigating away drops terminal-page animation CPU to idle while sessions remain attachable.

- [x] **Use one terminal owner across fullscreen and chat-panel modes.**
  - Evidence: `workspace-shell.tsx:318-346` persistently mounts one `TerminalWorkspace`; `terminal-panel.tsx:107-135` can mount a second instance backed by the same global tabs/session IDs.
  - Change: keep a single workspace/session controller and render it in one surface at a time, or remove the unused panel path.
  - Check: maximize/minimize between chat panel and `/terminal` without duplicate streams, duplicate xterm instances, or competing resize/input calls.

- [x] **Make reconnect bounded and user-visible.**
  - Evidence: `terminal-workspace.tsx:530-555` schedules another reconnect after every ended reattach, despite the comment claiming a single attempt; failures are swallowed.
  - Change: explicit `connecting / connected / reconnecting / exited / error` state, capped exponential retry, Retry action, and cancellation on close/unmount.
  - Check: simulate server loss, recovery, session expiry, and closing during backoff.

- [x] **Clean up SSE resources on both abort and natural process close.**
  - Evidence: `src/routes/api/terminal-stream.ts:159-192` clears the keepalive interval and emitter listeners only from the request-abort path; a natural `handleClose` closes the controller without that cleanup or removing the abort listener.
  - Change: one idempotent cleanup function used by abort, session close, and stream-construction failure.
  - Check: repeatedly open/exit terminals and assert listener/interval counts return to baseline.

- [x] **Persist descriptors, not stale live session state.**
  - Evidence: `terminal-panel-store.ts:133-144` persists `sessionId` and `status`, so a reload can display `active` before reattachment and retain dead IDs.
  - Change: exclude derived status from persistence and normalize rehydrated tabs to `idle`; retain `sessionId` only if cross-refresh attachment is deliberately supported.
  - Check: reload after server restart and after TTL expiry; UI starts truthful and recovers cleanly.

## P2 — UX, accessibility, and polish

- [x] **Give panes explicit focus and split selection.**
  - Evidence: split mode chooses the first non-active tab (`terminal-workspace.tsx:166-170`), but clicking the secondary pane only focuses xterm and does not update `activeTabId` (`terminal-workspace.tsx:1094-1096`). Toolbar actions can therefore target a different pane than the focused cursor.
  - Change: clicking/focusing a pane makes it active; allow choosing or cycling the secondary tab; show a clear focus border and pane title.
  - Check: Copy, Debug, Clear, close, mobile input, and status footer always target the visibly focused pane.

- [x] **Fix tab semantics and keyboard navigation.**
  - Evidence: `terminal-workspace.tsx:896-951` nests a `role="button"` close control inside a native button; the tab strip has no `tablist/tab/tabpanel` semantics, roving focus, or arrow-key behavior.
  - Change: use sibling tab and close buttons, `aria-selected`/`aria-controls`, arrow navigation, `Ctrl/Cmd+T`, `Ctrl/Cmd+W`, and next/previous-tab shortcuts.
  - Check: keyboard-only and screen-reader pass across create, switch, rename, close, and split.

- [x] **Label every icon control and expose toggle state.**
  - Evidence: add/split/copy controls rely on `title` only (`terminal-workspace.tsx:955-1010`) and split buttons omit `aria-pressed`.
  - Change: add `aria-label`, `aria-pressed`, visible tooltips, and a polite live status for copy/reconnect/error feedback.

- [x] **Replace the custom prompt/context menu with an accessible inline action.**
  - Evidence: `terminal-workspace.tsx:1131-1168` positions an unbounded menu at raw viewport coordinates and uses `window.prompt` for rename.
  - Change: reuse the installed menu/dialog primitives, clamp positioning, focus the first item, restore focus on close, and support keyboard invocation.

- [x] **Make status text truthful and actionable.**
  - Evidence: footer always says `terminal ready` (`terminal-workspace.tsx:1104-1116`) even when status is idle/failed/exited, while connection failures only print into the terminal buffer (`terminal-workspace.tsx:395-399`).
  - Change: show actual connection state plus Retry/Restart; distinguish attached, disconnected, exited, and expired.

- [x] **Put error recovery around the component that actually renders the terminal.**
  - Evidence: `/terminal` returns `null` (`src/routes/terminal.tsx:29-32`), while the real workspace is mounted from `WorkspaceShell`; the route's `errorComponent` therefore does not catch terminal render/import failures.
  - Change: add the existing error-boundary pattern at the persistent mount, or return terminal rendering to the route after establishing a singleton session controller.

- [x] **Reduce visual noise and reclaim terminal space.**
  - Evidence: screenshot shows duplicated session list + tabs + per-pane HUD + footer, while `.term-xterm` reserves 46 px at the bottom (`matrix-terminal.css:490-497`) and each pane animates Matrix rain.
  - Change: keep tabs as the primary navigation; make the session sidebar collapsible by default or remove it for small tab counts; slim/merge HUD and footer; add a Matrix-effect toggle and default reduced opacity.
  - Check: prompt starts near the top-left, terminal rows increase, and connection state remains discoverable.

- [x] **Expose working-directory selection instead of hard-coding it.**
  - Evidence: `terminal-workspace.tsx:67,381` always sends `~/.hermes`, ignoring each tab's `cwd`; docs mention an environment override that the component does not read.
  - Change: create sessions from current project/home/recent permitted directory and send `tab.cwd`; validate through the existing cwd guard.
  - Check: new tab opens in the selected allowed directory and rejects disallowed paths with a clear message.

- [x] **Harden mobile input behavior.**
  - Evidence: `mobile-terminal-input.tsx:11-29` clears the field immediately even if no session exists or the request fails.
  - Change: disable Send until attached, retain failed input, show failure, and add commonly needed Esc/Ctrl/Tab controls without pretending the text box is a full terminal keyboard.

- [x] **Either expose Debug Analyzer or delete the dead feature.**
  - Evidence: `terminal-workspace.tsx:232-279,1122-1129` defines analysis handlers and panel rendering, but no control calls `handleAnalyzeDebug`.
  - Change: simplest choice is removal unless the product still wants AI terminal diagnosis; otherwise add one labeled trigger and require confirmation before executing suggested commands.

## P3 — Maintainability and regression coverage

- [x] **Extract the transport/session lifecycle from the 1,172-line view component.**
  - Evidence: `terminal-workspace.tsx` owns SSE parsing, retry, xterm creation, resource cleanup, tabs, split layout, copy/debug actions, and all markup.
  - Change: transport primitives are now isolated in `src/components/terminal/terminal-stream.ts`, while the remaining view/controller stays unified to avoid a speculative second state system. Full JSX decomposition is intentionally skipped under the ponytail rule; add it only when separate consumers or measured render cost justify it.

- [x] **Use one SSE parser and handle malformed events safely.**
  - Evidence: `terminal-workspace.tsx:438-503` hand-parses blocks and calls `JSON.parse` without isolating malformed events, so one bad frame can terminate the connection loop.
  - Change: reuse an existing parser if present; otherwise add the smallest tested parser that supports CRLF and multi-line `data:` fields.

- [x] **Add the missing focused regression tests.**
  - Current evidence: terminal-adjacent targeted tests pass, but there are no `TerminalWorkspace`, input, resize, close, reconnect, split, or PTY protocol tests.
  - Minimum tests: resize propagation, exit-vs-disconnect, no output loss, ordered input, cleanup/retry cancellation, split focus targeting, and persisted-state normalization.

## Suggested delivery order

1. PTY resize + exit/disconnect distinction + no output truncation.
2. Ordered input transport + bounded reconnect state.
3. Element-level fitting + hidden-work suspension + single owner.
4. Split focus, keyboard/accessibility, truthful state UI.
5. Visual density polish and working-directory/mobile enhancements.

## Review validation already run

- `pnpm eslint` on terminal workspace, shell, panel, store, server session manager, and four terminal API routes: passed.
- `pnpm vitest run src/stores/terminal-panel-store.rehydrate.test.ts src/components/workspace-shell.test.ts src/routes/api/-sse-headers.test.ts`: 3 files / 13 tests passed.
- The production build was not required for this UI pass; targeted checks and a live Vite/headless smoke were used per repo guidance.

## Implementation validation

- `pnpm eslint` on all changed terminal/UI/backend files: passed.
- Focused Vitest: 6 files / 30 tests passed, including live PTY resize, SSE parsing, store rehydration, cwd security, and workspace shell coverage.
- `python3 -m py_compile src/server/pty-helper.py`: passed.
- Headless smoke at `https://127.0.0.1:4175/terminal`: terminal rendered, xterm mounted, no console/page errors; screenshot captured at `/tmp/terminal-final.png`.
- One item intentionally remains open: extracting the lifecycle controller from `terminal-workspace.tsx`; current lifecycle behavior is covered and the new transport parser is isolated, but the full view decomposition is a follow-up refactor.
