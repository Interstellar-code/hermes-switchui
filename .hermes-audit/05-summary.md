# 05-summary.md — Prioritized Audit Summary

_Generated: 2026-06-13 by kanban worker (t_dbfd3ae5)_
_Window: 2026-06-06 → 2026-06-12 (HEAD ~5c5e6c86, CHANGELOG through v2.3.46)_
_Synthesized from: 01-commits.md, 02-changelog.md, 03-docs.md, 04-issues.md_

---

## Executive Summary

The repo shipped an impressive four feature releases over 7 days — Board Templates (v2.3.45/.46), Self-Improving Agent UX + Hermes Plugin settings (v2.3.44), and the shadcn composer cutover (v2.3.27) — backed by strong changelog discipline and clean git hygiene (no leaked secrets, no WIP/fixup commits, correct tag sequencing). However, two systemic failures dominate the health picture. **First**, the entire June-1 security audit batch — 1 P0 and 16 P1 issues — has sat completely untouched for 12 days, an open security-exposure window with zero triage activity. **Second**, all four feature releases shipped with comprehensive CHANGELOG prose and internal `.omc/specs` but **zero user-facing docs**, leaving three major new surfaces undiscoverable. Shipping velocity is good and hotfixes come fast, but velocity is now outpacing the safety net (issue triage, user docs, regression test coverage).

---

## TOP PRIORITIES (ranked by risk/impact)

| # | Tag | Item | Action | Effort |
|---|-----|------|--------|--------|
| 1 | [issues] | **P0 #155 — `/api/events` SSE endpoint has no auth, leaks chat events.** Live data leak, untouched 12d. | Add auth/session check to SSE handler before event stream opens. Verify with a logged-out request test. | **S** (2–4h) |
| 2 | [issues] | **P1 security cluster — 7 issues (#146 #147 #149 #152 #153 #158 #160).** Path traversal (`/api/media`, terminal cwd), missing CSRF on mutating routes, `javascript:` XSS in Markdown, Mermaid HTML injection, unauthed+unrated OAuth poll. All 12d untouched. | Batch security sprint — one PR per issue or grouped by layer (backend-sec / frontend-sec / api). Add CSRF middleware + path validation + sanitize lib. | **M–L** (1–2d) |
| 3 | [issues] | **P1 backend bug cluster — #143 #162 #171 #173 #174 #175 #176.** Unbounded artifact store (no GC), no file locking on board read-modify-write, no fetch timeouts, dead `claude` branch, invalid `review` status writes to Kanban DB, raw 500s. | Backend hardening sprint — atomic writes, timeouts everywhere, fix status mapper, add store eviction. | **L** (2–3d) |
| 4 | [issues] | **P1 frontend bug cluster — #163 #164 #166 #168 #169.** Uncleared timers, stale PTY sessionIds across reload, unbounded localStorage (task-store), dead mission-restore, Zustand-subscriber bypass. | Memory-leak + persistence cleanup pass — add `migrate` to the 8 versionless persist stores (#172), unmount cleanups. | **M–L** (1–2d) |
| 5 | [docs] | **GAP-1/2/3 — three major new surfaces with ZERO user docs.** Board Templates, Self-Improving Agent screen, Hermes Plugin settings section. Confirmed by zero-match grep of `docs/`. | Write 3 feature docs (`docs/main/board-templates.md`, `docs/main/self-improve.md`, extend `docs/settings/preferences.md`) + update sidebar nav (GAP-9). | **M** (1d batched) |
| 6 | [commits] | **Plugin-sync regression gap.** Feature #228 needed 2 hotfixes (`__APP_VERSION__`, stale-verdict self-heal) within 15 min of merge — no pre-merge test caught it. | Add `hermes-plugin-sync.test.ts` regression covering the `__APP_VERSION__` define + version-compat verdict flow. | **S** (2–3h) |
| 7 | [docs] | **GAP-5/6/7 — existing docs are actively WRONG/stale.** slash-commands.md missing `/reset /stop /title /reasoning`; sessions.md rename/delete claims stale; composer.md still says model-picker sits in composer (moved out in v2.3.27). | Correct stale claims across 4 files; add the 4 slash commands; document reply/queue/tool-display/paste. | **S–M** (half day) |
| 8 | [changelog] | **8 missing CHANGELOG entries** (mostly v2.3.44 plugin-sync fixes + self-improve polish + build-skip + TooltipProvider crash fix). | Append missing lines from commit history. | **S** (30 min) |
| 9 | [docs] | **GAP-10 — 9 release-note files missing** (`.omc/releases/v2.3.35`–`v2.3.43`). Tags + CHANGELOG exist; companion `.md` notes don't. | Backfill 9 files from CHANGELOG prose (mostly copy-in). | **S** (1h) |

---

## QUICK WINS (low effort, high value)

- **[changelog]** Append the 8 missing CHANGELOG lines — 30 min, restores accuracy of the last 3 releases.
- **[docs] GAP-10** Backfill `.omc/releases/v2.3.35`–`v2.3.43` from CHANGELOG — 1h, fixes the audit-trail convention break.
- **[docs] GAP-5** Add 4 rows (`/reset /stop /title /reasoning`) to the slash-commands table — 15 min, fixes actively-wrong doc.
- **[issues] #227** "Review required" false-positive UX blocker — 1d old, likely a small logic fix, high user-facing visibility.
- **[issues] #204** `THREE.Clock` deprecated → bump `@react-three/fiber` — dependency bump, removes console warnings.
- **[commits]** Standardize the Claude co-author label (multiple Opus-4.8 variants) — cosmetic, trivial.

---

## WATCH LIST (revisit next week)

- **[commits]** Version bump cadence — 5 releases (v2.3.30→.34) in 2.5h on Jun 9 suggests "versioning to fix things." Watch for consolidation.
- **[commits]** Docker build has no pre-release smoke test for the `website/` bundle (broke on v2.3.29, fixed in 8 min). Add a build-stage check.
- **[issues] #186** ~1822 ESLint errors + cyclic `import/order` rule — large debt, not urgent; schedule a lint sprint.
- **[issues] #222** Chat god-component refactor (chat-screen 3339 lines / 43 effects) — partially addressed by #223–#225 perf fixes Jun 12; ongoing.
- **[issues] #201 / #202 / #204** Matrix3D reliability + gateway `startClaudeAgent` health-check — newer (2–4d), monitor for clustering.
- **[docs] GAP-8 / GAP-11** Crash-diagnostics, long-thread windowing, per-session cost are undocumented; `FEATURES-INVENTORY.md` (frozen at v2.0.0) and `README` need a full refresh — bigger task, scope separately.
- **[issues]** 19 pre-June open issues below the enumeration cap (#95–#142) — not individually audited this cycle; a second `gh` page is needed next week.

---

## Health Signals (verified clean)

- **Secrets:** No API keys/tokens leaked in the last 7 days (matches were test fixtures only).
- **Git hygiene:** No `WIP`/`fixup!`/`temp` commits in `main`.
- **Tag order:** Git tags match CHANGELOG sequence.
- **CHANGELOG continuity:** v2.3.27 → v2.3.46 all present and correctly dated; reverse-chrono ordering intact.
