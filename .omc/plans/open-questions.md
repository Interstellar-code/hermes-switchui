
## shadcn-adoption - 2026-06-08

- [x] **CLOSED — umbrella complete:** Issue #187 implementation is merged on `main` via PRs #189, #190, #192, #193, #194, #195, and #196, plus cleanup commit `e66e6bcf`.
- [x] **CLOSED:** operator1/source-gated Phase 1 was superseded by the live `ChatComposerShadcn` cutover in PR #190; legacy `chat-composer.tsx` was deleted after shared contracts/helpers/services were extracted.
- [x] **CLOSED — OUT OF SCOPE:** operator1 TTS (4 modes) + audio capture were not treated as shadcn adoption requirements. Existing SwitchUI voice hooks remain in the live composer.
- [x] **CLOSED (Codex review):** Tailwind v4 `@theme inline` block was required and shipped in Phase 0.
- [x] **CLOSED (Phase 0 execution 2026-06-06):** pinned shadcn CLI version used = `4.10.0`; `@import "shadcn/tailwind.css"` intentionally excluded; app build verified `bg-background`, `text-foreground`, `border-border`, `ring-ring`, and radius utilities resolve to bridge vars without clobbering existing `--color-primary-50..950` scale utilities.
