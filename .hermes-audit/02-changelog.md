# 02-changelog.md — Changelog Review (June 13, 2026)

Audit of `CHANGELOG.md` vs commit history for the period June 6 — June 13.

## Summary
The changelog is remarkably thorough, covering almost every feat/fix commit in the window. Version headers are correctly dated and sequential.

## Missing or Incorrect Entries

| Commit SHA | Suggested Changelog Line | Note |
|---|---|---|
| `86fd4b9d` | **Plugin Sync:** Fixed stale incompatible verdict caching by triggering re-registration. | Missing from 2.3.44 |
| `d0b678d3` | **Plugin Sync:** Now derives frontend version via `__APP_VERSION__` build-define for SSR compatibility. | Missing from 2.3.44 |
| `2d8b39a2` | **Settings:** Added Hermes Plugin section with backend config-sync wiring. | Partially covered in "Hermes Plugin settings section", but specific wiring details omitted. |
| `fa283154` | **Settings:** Mirrors saved UI settings to the Hermes plugin endpoint. | Missing from 2.3.44 |
| `eed99e3f` | **Self-Improve:** Fixed profile selectors to source from real agent profiles. | Missing from 2.3.43 (likely internal fix) |
| `8c72e247` | **Self-Improve:** Fixed double-parentheses in Propose label. | Missing from 2.3.43 (UI polish) |
| `8fdd1f26` | **Build:** Skips `build:website` when `website/` is absent to unblock Docker image builds. | Missing from 2.3.40 |
| `0ccd2547` | **UI:** Wrapped agent-card Tooltip in TooltipProvider to prevent crashes. | Missing from 2.3.27 |

## Audit Notes
- **Version Continuity:** All versions from 2.3.27 to 2.3.46 are present and correctly dated.
- **Ordering:** The changelog follows the reverse-chronological order (newest first).
- **Breaking Changes:** No breaking changes were identified in the commit history that weren't already flagged in the changelog.
- **Category Alignment:** `Added`, `Fixed`, and `Performance` sections are used correctly.
