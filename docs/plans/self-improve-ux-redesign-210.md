# /self-improve UX redesign — spec (issue #210)

Redesign the `/self-improve` page from a "database dump" into a narrative, single-scope,
Matrix-themed page. **Backend is stable — no API changes.** Preserve every existing data
hook, mutation, query key, and API call. This is a presentation + IA + copy refactor.

Files in play:
- `src/screens/self-improve/self-improve-screen.tsx` (root + sections, 1325 LOC — rewrite presentation, keep logic)
- `src/screens/self-improve/self-improve-screen.css` (extend; already uses `--theme-*`/`--m-*` tokens + `si-state-badge--*`)
- `src/screens/self-improve/components/*` (diff-view, eval-table, baseline-chart, history-drawer)
- New component files under `components/`
- Data: `@/lib/self-improve-types`, `@/lib/self-improve-api`, hook `@/hooks/use-agent-profiles`

## Data contract (already exists — do NOT change)
- `Experiment`: `state` (proposed|approved|live|verified|reverted|rejected), `diff`, `rationale`,
  `offline_score`, `live_score` (**may be null even when a live run exists**), `proposer_model`,
  `judge_model`, `sentence_delta_count`, `base_commit_sha`, `apply_commit_sha`, `file`, `profile`,
  `approved_at`, `applied_at`, `verified_at`, `reverted_at`, `created_at`, `baseline_id`.
- `fetchExperimentHistory(id)` → `{ experiment, transitions[], eval_runs[], scenario_results[] }`.
  - `EvalRun.kind` = offline|live, `aggregate_score`. **Read the live score from `eval_runs` (kind=live), not `experiment.live_score`.**
  - `ScenarioResult`: `split` (train|holdout), `pass_fail` (0|1), `judge_rationale`, `scenario_snapshot` (JSON).
- `Baseline`: `{ profile, file, score|null, created_at, commit_sha }`.
- `fetchExperiments({ profile?, state? })`, `fetchScenarios({profile, includeHoldout})`, `fetchBaselines()`,
  `fetchLatestMetrics()`, `fetchMetrics({limit})`, `fetchHealth()`.
- Mutations (keep exactly): approve / editApprove / reject / apply / verify / revert / propose /
  createScenario / deleteScenario / pause / resume / collect.

## The 6 problems → the fixes

### FIX 1 — One profile selector governs the WHOLE page (issue ask #4, top priority)
- Lift a single `profile` state to `SelfImproveScreen`. Initialize from `useAgentProfiles().activeProfile`,
  fall back to first profile, else `''`.
- Render ONE `<ProfileScopeSelect>` in the header (options = `useAgentProfiles().profiles`).
- Every section filters by this one `profile`:
  - Metrics scorecard: show the snapshot whose `profile === selected` (from `fetchLatestMetrics`), not a grid of all.
  - Experiments feed: `fetchExperiments({ profile })` (no per-section profile dropdowns anymore).
  - Baseline curve: `<BaselineChart profile={selected} …>`.
  - Scenarios: `fetchScenarios({ profile: selected, … })`.
- Remove the per-section profile `<select>`s (propose select, scenario select) — they inherit the global scope.
  The Propose button proposes for the globally-selected profile.

### FIX 2 — Lead with plain-English experiment cards; diff is the hero (asks #1, #2, IA)
Replace the separate **Proposals** + **Lifecycle** sections with ONE **Experiments** feed:
`fetchExperiments({ profile })` (all states), newest first. One `<ExperimentCard>` per experiment.

`<ExperimentCard exp>` layout (top→bottom):
1. **Header row**: `<StateBadge state>` · file (mono pill) · relative time · experiment #id (muted, right).
2. **Plain-English summary sentence** (prominent, ~14px). Build with `summarizeExperiment(exp, liveScore)`:
   - Verb from rationale if present, else generic. Pattern:
     `"{Rationale, first sentence}. Behavior-test score {offline_base?→}{offline} → {live} ({▲|▼|=}). {Kept|Rejected|Proposed|Reverted|Pending}."`
   - State→tail word: verified/live→"Kept", rejected→"Rejected", reverted→"Reverted",
     proposed→"Awaiting review", approved→"Approved, not yet applied".
   - If a score is null, omit that token gracefully (no "null").
3. **HERO diff** — `<DiffView diff={exp.diff}>` ALWAYS shown (not behind a button), styled red/green,
   max-height with scroll, prominent border. This is the single most important artifact.
4. **Score context strip** — `<ScoreContext offline live baselineScore atomic={sentence_delta_count}>`:
   - Show `offline_score` and live score as 0–100% bars with baseline marker + delta arrow.
   - Label: "Behavior-test pass rate · higher is better · 0–1 = fraction of scenarios passed".
   - Pull live score from history `eval_runs` (kind=live).aggregate_score; if absent, show "live: not run yet".
   - Show "atomic edit ({n} sentence{s} changed)" with tooltip.
   - Direction semantics: **up = green = good** (note: existing `.si-delta--up` is RED — add a new
     `.si-score-delta--up{color:green}` / `--down{color:red}` class; do NOT reuse the inverted metric delta).
5. **Lifecycle stepper** — `<LifecycleStepper exp>`: horizontal steps
   `Proposed → Approved → Applied → Verified` (reverted shows a red terminal step).
   Each step: done (green check + timestamp from `approved_at`/`applied_at`/`verified_at`/`created_at`),
   current (accent ring), or pending (muted). Timestamps via `relativeTime`/`toLocaleString`.
6. **Scenario checklist** — `<ScenarioChecklist results>` from history `scenario_results`
   (offline run preferred): each row = ✓/✗ + scenario input (from `scenario_snapshot` JSON `.input` or name)
   + split badge (train/holdout). **Highlight failing rows** (red left-border) — the actionable signal.
   Collapse behind "Show N scenario results" if you prefer, but failures should be visible by default.
7. **Actions** (state-appropriate, reuse existing mutations):
   - proposed → Approve / Edit & Approve / Reject
   - approved → Apply
   - live → Verify / Revert
   - verified → Revert
   - Keep "History" button → existing `<HistoryDrawer>` for the raw transitions/eval detail.

Fetch per-card history with `useQuery(['self-improve','experiment-history',exp.id], …)` to drive the
stepper, live score, and checklist. Keep it enabled (small counts) or lazy-on-mount.

### FIX 3 — Scores in context (ask #3)
Covered by `<ScoreContext>` above + `<BaselineChart>` already has labeled axes. Add a one-line caption
under the baseline curve: "Score = fraction of behavior scenarios passed (0–100%). Higher is better."

### FIX 4 — Friendly empty / known-limitation states (ask #5)
- Metrics `profile="(unknown)"` or `sessions=0`: render a friendly note, not an error:
  "Metrics populate once agent activity is tagged to this profile (backend follow-up). Proposals & diffs below still work."
- No baseline: "No baseline yet — run an experiment (Propose) to establish the first score."
- Empty experiments feed: "No experiments for {profile} yet. Click Propose to generate the first atomic edit."

### FIX 5 — Tooltips for jargon + intro (ask #6)
- Add `<InfoTooltip term>` (small ⓘ / dotted-underline) with a glossary. Terms + copy:
  - **offline**: "Score from a fixed scenario set, run before going live. Cheap, repeatable."
  - **live**: "Score from real sessions after the edit is applied."
  - **holdout**: "Scenarios hidden from the proposer so it can't game them — a fairness check."
  - **ratchet**: "An edit is kept only if it scores better; the baseline only moves up."
  - **atomic edit**: "One small change (ideally a single sentence) so wins/losses are attributable."
  - **proposer vs judge**: "A different model proposes the edit than the one that grades it — anti-gaming."
- A dismissible one-line intro card at top: "This page lets the agent propose one small edit to a
  profile's instructions, test it against behavior scenarios (graded by a different model), and keep it
  only if it scores better — with your approval. Each kept change is committed to git."

### FIX 6 — Matrix theme alignment (ask #1)
CSS already uses `--theme-*`/`--m-*` tokens, mono where needed, `si-state-badge--{approved,live,verified,
reverted,rejected,muted}`. Extend that treatment to: experiment card border/accent, stepper, score bars,
scenario checklist, tooltip. Green accent = `var(--m-green-400,#4ade80)`. Use mono font for file paths,
SHAs, model names. Match Jobs/Kanban card border + radius (already `8px`, `1px solid var(--theme-border)`).

## New files
- `components/experiment-card.tsx` — `<ExperimentCard exp profile onMutated>` (composes the below)
- `components/lifecycle-stepper.tsx` — `<LifecycleStepper exp>`
- `components/scenario-checklist.tsx` — `<ScenarioChecklist results>`
- `components/score-context.tsx` — `<ScoreContext offline live baselineScore atomic>`
- `components/info-tooltip.tsx` — `<InfoTooltip term>` + glossary map (export `GLOSSARY`)
- `components/profile-scope-select.tsx` — `<ProfileScopeSelect value onChange profiles>`
- `summarizeExperiment(exp, liveScore)` helper — colocate in experiment-card.tsx or a small `experiment-summary.ts`.

## Constraints / gotchas
- Keep all existing query keys and mutation wiring; only move/lift the `profile` state.
- `noUncheckedIndexedAccess` is OFF — `arr[0]` is typed non-undefined; avoid unnecessary `?.`/`??`
  (eslint `no-unnecessary-condition` will flag them). Guard arrays by `.length` then index.
- `live_score` null is expected — read live from `eval_runs`.
- Pause state not readable from API — Pause/Resume stay fire-and-confirm with the existing note.
- Don't break the existing tests in `src/routes/api/self-improve/-*.test.ts` (API routes untouched).

## Acceptance
- `pnpm exec tsc --noEmit` clean for all touched files.
- `pnpm exec eslint <touched files>` clean (no NEW errors).
- `pnpm vitest run` — existing self-improve tests still pass.
- One profile selector; switching it re-scopes metrics + experiments + baseline + scenarios together.
- Each experiment shows: summary sentence, visible red/green diff, score context, stepper, scenario checklist.
- Friendly empties; tooltips on jargon; intro card.
