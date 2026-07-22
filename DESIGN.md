# Design

## Source of truth

- Status: Draft
- Last refreshed: 2026-07-21
- Primary product surfaces: `/self-improve`, `src/screens/self-improve`, `src/lib/self-improve-*`
- Evidence reviewed: `docs/plans/self-improve-ux-redesign-210.md`, `docs/main/self-improve.md`, `src/screens/self-improve/self-improve-screen.tsx`, `src/screens/memory/memory-screen.tsx`, `src/components/ui/tabs.tsx`, and the installed `karpathy-self-improve` plugin API/DB implementation.

## Brand

- Personality: Calm, technical, trustworthy, Matrix-themed.
- Trust signals: explicit profile scope, visible file target, provenance, scores, lifecycle state, and recoverable actions.
- Avoid: dashboard-dump density, unexplained jargon, false certainty, and green “success” states before verification.

## Product goals

- Goals: make one profile’s improvement loop understandable; make the proposed file change the primary review artifact; expose evaluation evidence beside the action that uses it; keep destructive or irreversible actions honest.
- Non-goals: redesign the plugin algorithm, add a general-purpose editor, or introduce a new chart/diff dependency.
- Success signals: one clear profile scope; three predictable tabs; a reviewer can identify target, change, score, failures, and next action without scrolling through unrelated sections.

## Personas and jobs

- Primary personas: operator reviewing an agent proposal; maintainer diagnosing a failed evaluation; profile owner managing scenarios.
- User jobs: review a proposed change, approve/apply/revert safely, understand why a score changed, and maintain training/holdout scenarios.
- Key contexts of use: desktop review, narrow laptop/mobile inspection, plugin unavailable or profile not bootstrapped.

## Information architecture

- Primary navigation: persistent page header → global profile selector → `Run` / `Evaluation` tabs.
- Core routes/screens: `/self-improve`; existing API proxy routes remain under `/api/self-improve/*`.
- Content hierarchy:
  1. Scope and the one fixed metric.
  2. Run: next decision, compact KPI strip, chronological experiment log, selected change review.
  3. Evaluation: selected experiment's scenario evidence; scenario management is secondary.

### Self-Improve learning-loop decision (2026-07-21, refined 2026-07-22)

- The page must communicate the loop, not merely plugin health: **scenario → proposed
  change → offline evidence → live observation → verified/reverted outcome**.
- **Run** is an experiment notebook, not an admin dashboard. Above the fold it shows only:
  fixed metric and direction, verified baseline, best offline candidate, current live state,
  and the next human decision. The rest is a chronological experiment log. It deliberately
  does not group rows or lead with cost, token, warning, or session metrics.
- Selecting an experiment reveals its full diff, lifecycle, score context, actions, and run
  chooser beneath the log. It is disclosure, not a permanent third workspace.
- **Evaluation** binds every scenario row to the selected experiment and chosen run
  (offline/live), showing score, split, pass/fail, judge rationale, and saved input.
  Scenario creation/deletion lives under a collapsed “Manage scenarios” section.
- Operational metrics and the baseline curve live in collapsed Run diagnostics; render the
  curve only once there are multiple comparable baseline points.
- “No results” is evidence, not a zero: a live experiment with no run says “Waiting for
  N live sessions; no live results yet”; a missing baseline says “Not measured yet”.
- The same selected experiment should be shared across all three tabs. A user can move
  Overview → Experiment → Scenario result and back without losing profile, experiment,
  or run context.

## Design principles

- Evidence before action: show the diff, score source, run kind, and failed scenarios before lifecycle actions.
- One scope: the selected profile governs every query and mutation on the page.
- Progressive disclosure: keep the experiment list scannable; put transitions and raw eval rows in detail/history.
- Honest states: null, unavailable, unrun, rejected, reverted, and self-judged are distinct states.
- Reuse before invention: extend existing tabs, diff, score, lifecycle, scenario, tooltip, and Matrix tokens.

## Visual language

- Color: existing `--theme-*` and `--m-*` tokens; green means verified/improved, red means failed/reverted, accent marks selection/baseline.
- Typography: existing UI font for prose; mono for paths, SHAs, model names, and diff content.
- Spacing/layout rhythm: compact shell and tabs like Memory; generous detail panels; 8–10px card radius consistent with existing Self-Improve and Jobs surfaces.
- Shape/radius/elevation: existing borders and subtle panels; no new shadow system.
- Motion: short tab/detail transitions only; respect reduced motion.
- Imagery/iconography: existing inline/Lucide icons; no decorative imagery.

## Components

- Existing components to reuse: `src/components/ui/tabs.tsx`, `ProfileScopeSelect`, `StatusSummary`, `BaselineChart`, `DiffView`, `ScoreContext`, `LifecycleStepper`, `ScenarioChecklist`, `HistoryDrawer`, `ScenarioWizard`, `ScenarioDeleteDialog`, `InfoTooltip`.
- New/changed components: `SelfImproveTabs` shell, experiment list/detail composition, split-diff renderer/parser, run-result switcher, and a small contract normalizer/fixture set.
- Planned learning-loop additions: a compact Run KPI strip, a chronological `ExperimentLog`,
  a shared selected experiment/run context owned by `SelfImproveScreen`, and
  `ScenarioResultsMatrix` (Evaluation). Reuse the existing scenario table and
  `ScenarioChecklist` row semantics instead of adding a second dashboard.
- Variants and states: loading, unavailable, empty, selected, proposed/approved/live/verified/reverted/rejected, offline/live/holdout, narrow-screen fallback.
- Token/component ownership: page-specific CSS remains in `self-improve-screen.css`; shared tab primitives remain in `src/components/ui/tabs.tsx`.

## Accessibility

- Target standard: WCAG 2.1 AA-oriented behavior using existing component conventions.
- Keyboard/focus behavior: tablist uses the Base UI tabs primitive; experiment list has an exposed selected state; detail actions remain keyboard reachable; dialogs/drawer retain Escape behavior.
- Contrast/readability: do not use color alone for pass/fail or lifecycle; pair with text/icons.
- Screen-reader semantics: tabs/panels, selected experiment, diff column labels, score source labels, and failure counts are announced.
- Reduced motion and sensory considerations: disable nonessential transitions under `prefers-reduced-motion`.

## Responsive behavior

- Supported breakpoints/devices: current Self-Improve desktop layout plus the existing 640px and 1050px breakpoints.
- Layout adaptations: desktop uses experiment list/detail and split diff; narrow screens stack list above detail and falls back to a readable unified diff when columns cannot retain context.
- Touch/hover differences: actions remain visible and large enough for touch; hover is enhancement only.

## Interaction states

- Loading: skeletons within the active panel; do not block the persistent scope/header.
- Empty: explain what data is missing and provide the next valid action.
- Error: show endpoint-specific error with retry; never infer “active” from a failed status request.
- Success: invalidate the affected profile/run queries and show the resulting lifecycle state.
- Disabled: disable actions when the backend contract says the transition is unsafe or required evidence is absent.
- Offline/slow network, if applicable: preserve cached detail and label stale data.

## Content voice

- Tone: concise, operational, plain English.
- Terminology: define offline, live, holdout, baseline, atomic edit, proposer, and judge at first use.
- Microcopy rules: say “not run yet” instead of rendering null; say “Git audit SHA (optional)” because Git commits are best-effort; distinguish “applied” from “verified.”

## Implementation constraints

- Framework/styling system: React 19, TanStack Query/Router, Base UI tabs, existing CSS/token system.
- Design-token constraints: reuse current Matrix and theme tokens; no new dependency.
- Performance constraints: preserve query keys and polling; lazy-load heavy tab bodies; fetch experiment history only for rendered/selected cards.
- Compatibility constraints: keep `/api/self-improve/*` paths and snake_case plugin field names; preserve auth/CSRF behavior.
- Test/screenshot expectations: targeted Vitest, TypeScript, ESLint, and desktop/narrow browser smoke checks; no full build for small UI iterations.

## Open questions

- [ ] Should the plugin expose exact before/after file contents, or is a split view of changed unified-diff hunks sufficient? Product / affects API and storage scope.
- [ ] Should manual Verify remain available, or should verification be daemon/evidence-gated only? Product + backend / affects lifecycle safety.
- [ ] Should Edit & Approve be restored via a clone endpoint, or remain removed until that endpoint exists? Product / affects proposal editing.
