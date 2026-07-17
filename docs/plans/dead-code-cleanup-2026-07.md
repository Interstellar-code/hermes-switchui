# Dead-code cleanup plan — July 2026

## Goal

Remove verified dormant workspace-era code without changing active behavior. Keep every cleanup batch independently revertible and add no dependencies or replacement abstractions.

## Rules

- Confirm zero production importers with repository-wide search before deletion.
- Delete one coherent feature group per commit.
- Run targeted lint/tests after each batch; stop and revert if active behavior changes.
- Do not remove compatibility adapters, migrations, direct-URL previews, or dependencies without separate evidence.
- Keep `/agora` and the old gateway agents screen until their product status is explicitly decided.

## Status

- [x] Phase 1 completed in `cdd8153f`, `07cfda67`, and `180f1645` (4,339 lines removed).
- [x] Phase 2 completed in `3daba368` (1,570 lines removed).
- [x] Phase 3a completed: research-card plumbing (`0508104f`), `WorkspaceShell` leftovers (`42aabe11`), and terminal-route imports (`10accce9`).
- [x] Phase 3b settings cleanup completed in `1a690239` (342 lines removed).
- [x] Legacy dashboard helper cleanup completed in `605636c5` (425 lines removed); active `WidgetShell`/edit-mode visibility remains unchanged.
- [x] Demo-agent generator cleanup completed in `d77a0cf4` (84 lines removed).
- [x] Standalone prompt-kit cleanup completed in `dd374b24` (722 lines removed); active chat container and composer implementations were preserved.
- [ ] Next: discuss whether the documented, direct `/agora` preview should remain.
- [ ] Later active-file cleanup: settings, dashboard, demo data, and prompt-kit exports.
- [ ] Product decisions remain deferred.

## Phase 1 — high-confidence artifacts and orphaned modules ✅

1. **Backup and superseded screens**
   - `src/routes/settings/_legacy-index.tsx.bak`
   - `src/screens/skills/workspace-skills-screen.tsx`
   - `src/screens/crew/crew-screen.tsx`
   - `src/screens/agents/agents-screen.tsx`

2. **Disconnected model suggestions**
   - `src/hooks/use-model-suggestions.ts`
   - `src/components/model-suggestion-toast.tsx`

3. **Small zero-caller utilities and UI**
   - `src/components/claude-health-banner.tsx`
   - `src/hooks/use-pinned-sessions.ts`
   - `src/lib/local-chat-threads.ts`
   - `src/lib/approvals-store.ts` (root no-op; preserve the live gateway store)
   - `src/components/agent-view/agent-stream-panel.tsx`
   - `src/components/agent-view/guardrails-modal.tsx`

## Phase 2 — orphaned gateway UI subtree ✅

Delete together after confirming no route or lazy importer owns them:

- `src/screens/gateway/components/agent-output-panel.tsx`
- `src/screens/gateway/components/approvals-panel.tsx`
- `src/screens/gateway/components/approvals-page.tsx`
- `src/screens/gateway/components/inline-approval-card.tsx`
- Review `kanban-board.tsx` separately because it imports the live approval store and may carry independent behavior.

## Phase 3 — dormant plumbing inside active files 🚧

1. Remove the research-card stub, null component, and unreachable chat-list plumbing.
2. Remove compiler-confirmed unused `WorkspaceShell` state and handlers.
3. Remove unused lazy imports from the null terminal route while retaining route behavior.
4. [next] Remove compiler-confirmed unused settings implementations and dashboard widgets in separate commits.
5. Remove unused demo-agent generators and standalone prompt-kit exports only after caller checks.

## Explicit product decisions

- `/agora`: unlinked and mock-backed but documented and directly reachable.
- `src/screens/gateway/agents-screen.tsx`: zero importers and likely superseded by `/operations`, but large enough to require explicit retirement.
- `src/components/terminal/terminal-panel.tsx` and `src/screens/chat/components/command-session.tsx`: orphaned former features; confirm they are not intentionally shelved.

## Verification

For each commit:

1. `git diff --check`
2. targeted ESLint for touched surviving files
3. targeted route/component tests for the affected feature
4. repository-wide import search for deleted symbols/files
5. clean working tree before the next batch

Avoid full builds for small cleanup batches unless route generation, production bundling, or deployment behavior changes.
