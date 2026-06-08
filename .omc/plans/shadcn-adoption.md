# Status: shadcn/ui adoption alongside @base-ui/react

**Umbrella issue:** Interstellar-code/hermes-switchui#187  
**Status:** Implemented and merged on `main`; issue ready to close.  
**Last updated:** 2026-06-08

## Final outcome

shadcn/ui now coexists with the existing base-ui layer as an additive UI primitive set. The chat composer cutover is complete, command/slash surfaces are cmdk-backed, and custom commands have a SwitchUI-owned DB/sidebar/chat integration.

Transport/backend behavior for chat streaming remains REST/SSE; this work was UI-layer + SwitchUI command persistence only.

## Merged implementation record

| Area | Status | Merged PR / commit evidence | Notes |
| --- | --- | --- | --- |
| Phase 0 — shadcn coexistence + Tailwind v4 token bridge | ✅ Done | PR #189 `feat/ui: shadcn/ui Phase 0 — isolated coexistence + token bridge (#187)` | `components.json` aliases shadcn to `src/components/shadcn/ui`; `lucide-react` real dependency; token bridge + `@theme inline`; smoke coverage. |
| Phase 1 / composer cutover | ✅ Done | PR #190 `feat(chat): shadcn composer live cutover at /chat (#187)` and commit `e66e6bcf` | `ChatComposerShadcn` is the only rendered composer. Legacy `chat-composer.tsx` was deleted after extracting shared contracts/helpers/services. |
| Phase 2 #1 — Tooltip | ✅ Done | PR #192 `feat(ui): migrate 9 base-ui Tooltip consumers to shadcn (Phase 2 #1)` | Consumers now import `@/components/shadcn/ui/tooltip`. |
| Phase 2 #2 — Dialog | ✅ Done | PR #193 `feat(ui): migrate 19 base-ui Dialog consumers to shadcn (Phase 2 #2)` | `render`/base-ui close patterns rewritten to shadcn/Radix `asChild` where needed. |
| Phase 2 #3 — AlertDialog | ✅ Done | PR #194 `chore(ui): delete dead src/components/ui/alert-dialog.tsx (Phase 2 #3)` | No live consumer; deleted instead of migrating dead primitive. |
| Phase 2 #4–#5 — Command palette + slash menu | ✅ Done | PR #195 `feat(ui): migrate command and slash menu to cmdk` | `src/components/ui/command.tsx` is cmdk-backed; slash command menu uses shadcn popover/command while preserving filtering/select behavior. |
| Commands product surface | ✅ Done | PR #196 `feat(commands): add DB-backed custom command macros` | SwitchUI-owned SQLite-backed commands, `/commands` sidebar/mobile nav, command palette and chat composer integration. |
| Old composer cleanup | ✅ Done | Commit `e66e6bcf` | Shared code lives in `chat-composer-types.ts`, `chat-composer-attachments.ts`, and `chat-composer-services.ts`; no imports remain from deleted `chat-composer.tsx`. |
| Streaming/activity UX follow-ups | ✅ Done | Commit `23801e80` | Closed #129 and #170 after fixing phantom tool spinners and stale activity polling. |

## Current source-of-truth files

| Concern | Current file(s) |
| --- | --- |
| Live chat composer | `src/screens/chat/components/chat-composer-shadcn.tsx` |
| Composer shared contracts | `src/screens/chat/components/chat-composer-types.ts` |
| Composer attachment helpers | `src/screens/chat/components/chat-composer-attachments.ts` |
| Composer/model/profile/workspace services | `src/screens/chat/components/chat-composer-services.ts` |
| Meta selectors | `src/screens/chat/components/v2/session-selectors-v2.tsx` |
| Command primitive | `src/components/ui/command.tsx` backed by `cmdk` and shadcn dialog |
| Slash command menu | `src/components/slash-command-menu.tsx` |
| Command palette | `src/components/command-palette.tsx` |
| Commands screen/routes/store/API | `src/screens/commands/`, `src/routes/commands*.tsx`, `src/lib/commands-api.ts`, SwitchUI DB layer |
| shadcn primitives | `src/components/shadcn/ui/` |
| base-ui primitives intentionally retained | `src/components/ui/autocomplete.tsx`, `src/components/ui/menu.tsx`, `src/components/ui/collapsible.tsx`, and other non-migrated primitives where there is no adoption value |

## Final decisions

- shadcn remains **additive**, not a global base-ui replacement.
- `src/components/shadcn/ui/*` is the shadcn primitive namespace.
- `src/components/ui/*` remains available for primitives we intentionally keep on base-ui or compatibility wrappers.
- The old live base-ui composer is gone; do not recreate `chat-composer.tsx` as a rendered component.
- Future composer shared logic belongs in:
  - `chat-composer-types.ts`
  - `chat-composer-attachments.ts`
  - `chat-composer-services.ts`
- Command macros are SwitchUI-owned app functionality, stored in SwitchUI DB, and inserted/expanded into the chat composer; they are not Hermes-agent-native endpoints.

## Remaining non-blocking follow-ups

These are no longer blockers for #187 and should be tracked as separate issues if desired:

1. Visual polish for any shadcn dialog/tooltip differences discovered during regular QA.
2. Optional broader migration of non-chat base-ui consumers only when there is clear product value.
3. Additional command macro templates/examples beyond the seeded useful defaults.
4. Any future voice/TTS expansion should be scoped separately; the current composer preserves existing voice hooks rather than treating voice as part of shadcn adoption.

## Verification already run during implementation

- Phase 0 shadcn smoke tests and Tailwind utility bridge checks.
- Phase 2 acceptance gates for #192–#194:
  - no imports from `@/components/ui/tooltip` or `@/components/ui/dialog` outside base-ui primitives themselves
  - no `TooltipRoot` / `DialogRoot` references
  - no `render={<X />}` on `DialogClose` or `TooltipTrigger`
  - targeted `tsc --noEmit` checks for migrated files, with unrelated repo-wide errors documented separately
- Command/slash migration tests and review through PR #195.
- Commands DB/sidebar/chat integration through PR #196.
- Old composer cleanup verification:
  - `pnpm vitest run src/screens/chat/components/chat-composer-model-switch.test.ts src/screens/chat/components/chat-composer-context-controls.test.ts src/stores/chat-store.test.ts`
  - no remaining imports from deleted `chat-composer.tsx`
  - `graphify update .`
- Streaming/activity follow-up verification:
  - `pnpm vitest run src/screens/chat/components/v2/chat-tab-views-v2.test.tsx src/stores/chat-activity-store.test.ts`
  - `graphify update .`

## Closure recommendation

Close issue #187 as complete. Any future shadcn/base-ui migration should be opened as a narrowly-scoped issue/PR, not as a continuation of this umbrella.
