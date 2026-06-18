# 03-docs.md — Documentation Drift Review (last 7d)

_Generated: 2026-06-13 by kanban worker (t_77053bc3)_
_Window: 2026-06-06 → 2026-06-12 (HEAD 5c5e6c86)_
_Method: each gap verified by reading the actual repo file under `/Volumes/Ext-nvme/Development/hermes-switchui` and grepping `docs/` for the feature term. Zero-match grep = undocumented._

This window shipped **four user-facing feature releases** (Kanban Board Templates v2.3.45/.46, Hermes Plugin settings + Self-Improve UX + composer paste v2.3.44, Matrix3D/Cron reliability, shadcn composer cutover v2.3.27) plus major sidebar, session-classifier, slash-command, and error-boundary changes. The docs tree was **not** updated for any of them — every doc gap below was confirmed against the live files, not inferred.

---

## Severity legend

- **🔴 Major** — a whole new user-facing surface (page, settings section, capability) with zero docs. Users cannot discover or operate the feature.
- **🟡 Moderate** — a shipped feature that is mentioned but materially incomplete or stale in an existing doc.
- **🟢 Minor** — accuracy polish, a missing row in a table, or an internal-only doc gap.

---

## Gaps

### GAP-1 — Kanban Board Templates: no docs at all 🔴

**Triggering commits / release**
- `b5d6f4da` feat(kanban): 5-step template creation wizard (#231 follow-up)
- `bf41c98b` feat(kanban): template task runtime/turn fields + keep-status copy (#233)
- `01e0ed22` feat(kanban): Board Templates management page (#231)
- Releases v2.3.45, v2.3.46 (CHANGELOG has full prose; `.omc/releases/v2.3.45.md` + `v2.3.46.md` exist; `.omc/specs/board-templates/SPEC.md` + `WIZARD.md` exist)

**Evidence of drift**
- `grep` of `docs/` for `board-templates|Board Templates|template wizard|instantiate|save-as-template|max_runtime_seconds|goal_max_turns` → **0 matches**.
- `docs/main/tasks.md` (lines 60-74) describes the Tasks board, real-time updates, and the drawer — but **no mention** of the new `/board-templates` page, the "Save as template" header button, the instantiate modal, or per-task runtime/turn controls.
- `docs/settings/sidebar.md` lists "Tasks (with optional sub-items for individual boards when expanded)" but omits the new **Templates** sub-item (confirmed present in `primary-nav-v2.tsx:353` `{ label: 'Templates', to: '/board-templates', ... }`).
- The sidebar nav group "Main" in `sidebar.md` (lines 20-30) also omits the **Commands** (`/commands`) and **Self-Improve** pages added in this window (see GAP-2 / GAP-4).

**Doc file(s) to update**
- `docs/main/tasks.md` — add a "## Board Templates" section (page route `/board-templates`, capability-gated, save-as-template, instantiate with `{{variable}}` substitution, raw-YAML advanced escape hatch, per-task `max_runtime_seconds` / `goal_max_turns` / `goal_mode`).
- `docs/settings/sidebar.md` — add **Templates** (under Tasks) and **Commands** and **Self-Improve** to the Main nav group.
- Consider a new `docs/main/board-templates.md` if the feature merits its own page (it is a multi-step wizard with variables, dependencies, recurrence, and a review step — likely does).

**Concrete edit suggestion for `docs/main/tasks.md`** — append after the "Related" section:
```
## Board Templates (New in 2.3.45/2.3.46)

Reusable board definitions you can instantiate into live boards. Reached from the
**Templates** item under **Tasks** in the sidebar, or the **Save as template**
button in a board's header.

- **List** — installed templates with name, slug, variables, and recurrence.
- **Create / edit** — a 5-step wizard: Basics (name, auto-slug, description,
  colour) → Variables → Tasks (status, priority, assignee, body with
  `{{variable}}` insertion) → Dependencies + Recurrence (parent→child editor with
  self-link/duplicate/cycle guards) → Review (pre-commit checklist + YAML preview).
  A raw-YAML editor is kept as an "Advanced" escape hatch.
- **Per-task runtime controls** — optional `max_runtime_seconds` and
  `goal_max_turns` on template tasks (Advanced section), round-tripped through
  create/edit/instantiate.
- **Instantiate** — modal collects per-variable values (`{{key}}` substitution),
  optional target board and auto-dispatch; shows created/skipped counts.
- **Capability-gated** — hides/degrades cleanly when the Kanban backend predates
  templates (404) or the capability is absent.

The page requires the Hermes Agent Kanban plugin and the Templates backend
(hermes-agent #135 P2). Backend errors (413 oversized, 422 validation, 409
refused) are surfaced inline rather than as raw payloads.
```

---

### GAP-2 — Self-Improving Agent screen: no docs at all 🔴

**Triggering commits / release**
- `23e4c0e9` feat(self-improve): narrative UX redesign — single scope, hero diff, stepper (#210)
- `bf291835` feat(self-improve): P3 scenarios, pause/resume, baseline chart
- `232c70b6` feat(self-improve): P2 lifecycle apply/verify/revert + history drawer
- `a701ce66` feat(self-improve): P1 proposal queue with approve/reject/propose
- `2c17cea0` feat(self-improve): P0 capability-gated observability scorecard
- `3096d6ec` docs(self-improve): add self-improving-agent assessment & proposal ← **internal proposal only**, not a user-facing feature doc

**Evidence of drift**
- `grep` of `docs/` for `self-improve|experiment|baseline|propose|scorecard|lifecycle stepper` → **0 user-facing matches** (only `docs/self-improving-agent-proposal.md` + `docs/plans/self-improve-ux-redesign-210.md`, both internal design docs, not feature docs).
- `docs/main/` directory has **no `self-improve.md`**.
- `docs/settings/sidebar.md` Main nav list omits **Self-Improve** (route `/self-improve`, capability-gated via `useSelfImproveAvailable`).
- The feature has its own screen, 5+ components (lifecycle-stepper, experiment-card, score-context, scenario-checklist, history-drawer, baseline-chart, profile-scope-select, info-tooltip), and a multi-endpoint BFF (`/api/self-improve/*`).

**Doc file(s) to update**
- Create `docs/main/self-improve.md` — describe the observability scorecard, proposal queue (propose/approve/reject), lifecycle (apply/verify/revert), scenarios, baselines, pause/resume, capability gating, and the v2.3.44 narrative UX (single global profile scope, hero diff, stepper).
- `docs/settings/sidebar.md` — add **Self-Improve** to the Main nav group (capability-gated).

---

### GAP-3 — Hermes Plugin settings section + backend config-sync: no docs 🔴

**Triggering commits / release**
- `2d8b39a2` feat(settings): Hermes plugin section + backend config-sync wiring (P1-P3, #228)
- `fa283154` feat(settings): mirror saved settings to hermes plugin endpoint (P4, #228)
- `d0b678d3` / `86fd4b9d` fix(plugin-sync): version resolution + stale-verdict self-heal (#229, #230)
- Release v2.3.44 (CHANGELOG has full prose).

**Evidence of drift**
- `grep` of `docs/` for `Hermes Plugin|hermes-switch-ui plugin|plugin-sync|config-sync|version-compat|heartbeat age` → **0 matches**.
- `docs/settings/preferences.md` (lines 14-56) lists the full settings sidebar — **General / Models / Agent / Memory / Skills / MCP / System / Shortcuts / Advanced / Danger** — with no **Hermes Plugin** section anywhere.
- The feature is a whole new `/settings` section surfacing the bundled backend plugin: status pill with heartbeat age, connection info, reported settings, and a version-compatibility banner.

**Doc file(s) to update**
- `docs/settings/preferences.md` — add a **Hermes Plugin** entry to the sidebar list (place under "System" or a new "Integration" group) and a section describing: status pill + heartbeat age, connection info (ports, profile, enabled plugins), reported settings, version-compat banner with the "unknown until registered" state, and the degrade behaviour (plugin-not-enabled vs backend-unreachable).
- Cross-link from `docs/plugins/overview.md` (which documents the four bundled plugins but not the UI settings section that surfaces their status).

---

### GAP-4 — Commands page + client-side custom commands: no docs 🟡

**Triggering commits / release**
- `a9fa2c4c` Persist custom chat commands in SwitchUI-owned SQLite storage
- `2b0709dd` / `67094c77` Align command management / mirror MCP drawer interactions
- `e4728840` Make command macros usable from composer
- `77227612` Add visible slash command discovery to the chat composer

**Evidence of drift**
- `docs/main/chat/slash-commands.md` documents built-in slash commands but has **no mention** of:
  - The new `/commands` management page (route exists in `primary-nav-v2.tsx`).
  - User-authored custom commands persisted in SwitchUI's own SQLite (`src/server/commands-store.ts`, `src/server/switchui-db.ts`).
- `docs/settings/sidebar.md` omits **Commands** in the Main nav group.

**Doc file(s) to update**
- `docs/main/chat/slash-commands.md` — add a "## Custom commands" section pointing to the `/commands` page, and explain that user-authored command macros are stored locally in SwitchUI (not the agent config) and surfaced in both the composer slash menu and the command palette.
- `docs/settings/sidebar.md` — add **Commands** to Main nav.

---

### GAP-5 — Client-side slash commands (`/reset /stop /title /reasoning`) missing from slash-commands.md 🟡

**Triggering commit**
- `2e61ad51` feat(chat): client-side slash commands (/reset /stop /title /reasoning)

**Evidence of drift**
- `src/screens/chat/chat-screen.tsx:2561,2610,2631,2648` confirms all four are handled client-side.
- `docs/main/chat/slash-commands.md` (lines 28-38) command table lists `/new /clear /model /skin /save /skills /plugins /mcp /help` only — **no** `/reset`, `/stop`, `/title`, or `/reasoning`.

**Doc file(s) to update**
- `docs/main/chat/slash-commands.md` — add four rows to the command table:
  - `/reset` — alias for `/new` (start a fresh session).
  - `/stop` — abort the active stream (inline, mirrors the Stop button).
  - `/title <name>` — rename the current session.
  - `/reasoning <off|low|adaptive>` — set the thinking level for the session.

---

### GAP-6 — CLI / A2A / Telegram session sources not in sessions docs 🟡

**Triggering commits / release**
- `0666fe23` feat(chat): surface CLI and A2A sessions as first-class sources (v2.3.33)
- `24d32aaf` fix(chat): enable Delete for Telegram, CLI, and A2A sessions
- `8ebf6746` fix(chat): make Telegram sessions clickable in V2 sidebar (v2.3.32)
- `7d40f191` fix(chat): keep Task sessions in the Task chip (precedence over cli/a2a) (v2.3.34)

**Evidence of drift**
- `grep` of `docs/` for `CLI session|A2A session|a2a_fleet|source chip|CLI and A2A|telegram session|classifySessionSource` → **0 matches**.
- `docs/main/chat/sessions.md` (line 44) says "Renaming is available only for chat sessions, not for task or job entries" — **stale**: rename/delete is now available for `tg`, `cli`, `a2a` sources too (v2.3.33).
- `docs/main/chat/sessions.md` (line 52) says "Delete is only available for chat sessions." — **stale** for the same reason.
- No doc explains the source chips (Telegram / CLI teal / A2A violet) in the V2 sidebar filter rail.

**Doc file(s) to update**
- `docs/main/chat/sessions.md` — add a "## Session sources" subsection listing the source chips (`chat`, `telegram`, `cli`, `a2a_fleet`, `cron`, `api`, `task`) and how they're classified (`classifySessionSource` precedence: telegram/cron/api → task overlay → cli/a2a). Update the rename/delete availability statements (lines 44, 52) to reflect that `tg`/`cli`/`a2a` are now deletable.

---

### GAP-7 — Composer: shadcn cutover, reply, queue, tool-display, paste-format not in composer.md 🟡

**Triggering commits / release**
- `d16643f9` feat(chat): shadcn composer live cutover at /chat (#187) (v2.3.27)
- `be02c656` feat(chat): preserve formatting on paste + table copy button (v2.3.44)
- Various reply/queue/tool-display commits in the v2.3.27 mega-commit.

**Evidence of drift**
- `grep` of `docs/` for `switchui:shadcn-composer|ChatComposer\b|chat-composer-shadcn|shadcn composer|SessionSelectorsV2|tool-display|reply-to|reply chip` → **0 matches**.
- `docs/main/chat/composer.md` (lines 14-22) describes the composer bar with "model picker" and "thinking level" inside it — **stale**: those four selectors (model/profile/workspace/thinking) were **moved out of the composer into the meta bar** (`SessionSelectorsV2`) in v2.3.27. The composer toolbar is now icons + context ring + send only.
- No doc mentions: the **Reply** button + quote chip, the **queue sends while streaming** FIFO, the **tool-display 3-state toggle** (expanded/collapsed/hidden, persisted under `switchui:tool-display-mode`), or the **paste-preserves-formatting** (HTML→Markdown) + table copy button.
- `docs/main/chat.md` (line 30) says "A model picker and a thinking-level control sit inside the composer bar" — same staleness.

**Doc file(s) to update**
- `docs/main/chat/composer.md` — (a) correct the "model picker / thinking level sit inside the composer" claim (they moved to the meta bar); (b) add a "## Reply-to quoting" section; (c) add a "## Queuing messages while streaming" section; (d) add a "## Tool display modes" section (3-state toggle); (e) add a "## Paste formatting" note (HTML→Markdown, table copy button).
- `docs/main/chat.md` (line 30) — fix the model-picker-in-composer description.

---

### GAP-8 — Crash-diagnostics error boundary + long-thread windowing + per-session cost: no docs 🟢

**Triggering commits / release**
- `bccd7569` fix(chat): crash-diagnostics error boundary (v2.3.44) — `localStorage['hermes:ui-crash-log']`, Copy-details, last-3-crashes.
- `53108a58` perf(chat): collapsed-head windowing for long threads (#213) — "Show N earlier messages" expander over 80 entries.
- `162aa3f4` feat(chat): surface per-session cost + token/api detail in chat UI (v2.3.29).

**Evidence of drift**
- `grep` of `docs/` for `crash-log|hermes:ui-crash-log|error boundary|copy-details`, `windowing|Show earlier messages|long threads`, `cost|per-session cost|cost ledger` → **0 matches** each.

**Doc file(s) to update**
- `docs/troubleshooting/crash-recovery.md` — add a section on the new in-app crash card: "Crashed in: <component>" label, last-3 crash log in `localStorage['hermes:ui-crash-log']`, and the Copy-details button (useful for bug reports). Currently this doc covers agent-side crash recovery, not the new UI-side boundary.
- `docs/main/chat.md` or `docs/main/chat/sessions.md` — note long-thread windowing (threads >80 entries collapse the head; search auto-expands) so users aren't confused when older messages are hidden.
- `docs/main/chat.md` or `docs/main/dashboard.md` — mention per-session cost/token display in the meta bar and the dashboard cost-ledger card.

---

### GAP-9 — `docs/settings/sidebar.md` nav groups are stale across the board 🟡

(Consolidates the sidebar-list items from GAP-1, GAP-2, GAP-4.)

**Evidence of drift**
- `docs/settings/sidebar.md` (lines 19-43) "Main" group lists: Dashboard, Chat, Files, Terminal, Jobs, Tasks, Workflows, Conductor, Operations.
- `primary-nav-v2.tsx` actually renders (under Tasks): **Board, Boards, Templates**; plus top-level **Commands**, **Self-Improve** pages added this window.

**Doc file(s) to update**
- `docs/settings/sidebar.md` — update the "Main" group to add:
  - **Tasks** → note the sub-items: Board, Boards, Templates.
  - **Commands** (new).
  - **Self-Improve** (new, capability-gated).

---

### GAP-10 — Release notes missing for v2.3.35 → v2.3.43 (9 versions) 🟢

**Evidence of drift**
- `.omc/releases/` contains: v2.3.28, .29, .30, .31, .32, .33, .34, .44, .45, .46.
- **Missing**: v2.3.35, .36, .37, .38, .39, .40, .41, .42, .43 (nine consecutive versions, all from this window).
- The `CHANGELOG.md` entries for these versions exist and are detailed; the per-version `.omc/releases/*.md` companion notes (which prior releases have) simply weren't written.

**Doc file(s) to update**
- `.omc/releases/` — backfill `v2.3.35.md` through `v2.3.43.md` (the CHANGELOG already has the prose; this is mostly a copy-into-file task). Not user-facing, but breaks the release-notes convention used for every other release in this window. The prior commit-analysis task (t_0d509a1a) flagged a v2.3.44-only gap; the actual gap is the 35-43 range.

---

### GAP-11 — FEATURES-INVENTORY.md and README are version-frozen 🟢

**Evidence of drift**
- `FEATURES-INVENTORY.md` header reads "**Version:** 2.0.0" (line 3) and its chat-composer section (lines 40-44) lists only `/new /clear /model /save /skills /skin /help` — predating the entire 2.3.x line.
- `README.md` feature table has a single "Composer" row comparing Matrix-themed popovers vs. a standard wrapper; no mention of Templates, Self-Improve, Hermes Plugin section, CLI/A2A sources, or any 2.3.x feature.

**Doc file(s) to update**
- `FEATURES-INVENTORY.md` — bump version header to 2.3.46 and add sections for Board Templates, Self-Improve, Hermes Plugin settings, Commands, CLI/A2A sources, reply/queue/tool-display, paste-formatting, crash-diagnostics, windowing, per-session cost. (This file is large; a full refresh is a separate task.)
- `README.md` — refresh the feature highlights to reflect 2.3.x capabilities.

---

## Cross-cutting observation

The docs tree is internally well-maintained for the **2.0–2.3.27** feature set (composer, sessions, boards, plugins, deployment, troubleshooting all have real content). The drift is concentrated entirely in the **last 7 days**: four feature releases shipped with full CHANGELOG prose and internal `.omc/specs` + `.omc/plans` docs, but **zero user-facing `docs/main/*` or `docs/settings/*` updates**. The recurring pattern is: feature ships → CHANGELOG updated → internal planning docs written → user docs skipped.

Priority for remediation: **GAP-1, GAP-2, GAP-3** first (whole new surfaces with no docs), then GAP-5/GAP-6/GAP-7 (existing docs actively wrong/stale), then the rest.
