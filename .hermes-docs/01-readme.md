# README / Getting-Started Drift Report

- Generated: 2026-06-13 (task t_79e2073c)
- Repo: `/Volumes/Ext-nvme/Development/hermes-switchui`
- README last touched: `25bcdaab` (2026-06-05) — predates the entire 7-day feature window.
- Source for claims: `README.md` cross-referenced against live code under `src/`, `install.sh`, `docs/screenshots/`, and the parent inventory `00-context.md`.
- Method: read-only. Every gap below names (a) the doc location, (b) the triggering commit(s) from the window, and (c) a suggested edit. No repo writes.

Conventions in this report:
- `README L<n>` = README.md line number.
- "Triggering commit" = the window commit(s) that made the claim stale. Hashes are short-form; full hash + message are in `00-context.md`.
- Severity: **HIGH** = wrong fact a new user would hit immediately; **MED** = missing feature in a "what's different" table or feature list; **LOW** = cosmetic / clarification.

---

## Gap 1 — Themes list is wrong (count, default, and membership)  [HIGH]

- **Doc location:** `README L36` (comparison table, "Theme" row) and `README L438` ("Themes" subsection).
- **Current README claim:** "Five themes: Matrix (default), Claude Nous, Claude Official, Claude Classic, Claude Slate."
- **Actual code:** `src/lib/theme.ts` exports `THEMES` with **10 entries** — each of the five has a paired `-light` variant. The **default is `claude-nous`**, not `matrix` (line 82: `DEFAULT_THEME = 'claude-nous'`). The label for `claude-official` is "Hermes", and `claude-classic` is "Bronze" — both renamed from the README's prose names. `matrix-light` / `claude-nous-light` / etc. are first-class selectable themes, not a separate mode toggle.
- **Triggering commit:** light themes were added by `6c9be04f` (feat(theme): add Matrix dark/light theme) and surfaced via `ffcb1ab1` (feat(chat): matrix theme composer, wire meta bar). Both predate the window but the README has never been updated since the 5→10 theme expansion. The matrix default→Nous default switch also predates the window.
- **Why it matters:** A user following the README to set "Matrix as default" or expecting exactly five themes will be confused by the picker.
- **Suggested edit:** Replace L36 cell and L437–438 with:
  > Ten themes (five dark + five matching light variants): Nous (default), Matrix, Hermes, Bronze, Slate. Each dark theme has a `-light` twin selectable directly from the theme picker; Switch UI auto-switches between dark/light variants when the OS toggles mode. Applied via `data-theme` on `<html>`. Stored in `localStorage` under `claude-theme`.

---

## Gap 2 — Meta bar description omits cost and still claims ctx % / tool count  [HIGH]

- **Doc location:** `README L39` (comparison table, "Meta bar" row): "Live tok/s, model, ctx %, tool count, profile, session ID — wired to gateway + derived locally."
- **Actual code:** `src/screens/chat/components/v2/chat-meta-bar-v2.tsx` renders only: `tok/s` (while streaming, lines 109–117), **per-session cost** with token breakdown tooltip (lines 119–133, `formatCostUsd` + in/out/cache/reasoning in the `title`), model/profile/workspace/thinking selectors (lines 135–151), and session id (lines 156–162). **There is no `ctx %` field anywhere in the component** (grep for `ctx|context|contextWindow|contextPct` returns no matches in this file). **`toolCount` is declared as a prop (line 29) but never rendered** — dead.
- **Triggering commits (all in window):**
  - `162aa3f4` (2026-06-09) added per-session cost + token/api detail.
  - `e8191cb8` (2026-06-09) "strip live/profile/tools from meta bar, surface tok + api".
  - `f0321e03` (2026-06-09) "drop tok/api from meta bar, add message/tool/skill counts to source tabs" — then `d4d3e069` partially restored. The meta bar changed shape ~6 times in the window; the README describes none of the final state.
- **Why it matters:** The README promises features (ctx %, tool count) that don't exist and omits the one headline feature (per-session cost) that does.
- **Suggested edit:** Replace L39 cell with:
  > Meta bar: streaming `tok/s`, per-session **cost** (USD, with in/out/cache/reasoning tooltip), model/profile/workspace/thinking selectors, and session id. Cost is hidden when the gateway reports $0 (subscription providers).
  Then delete or correct the `tool count` and `ctx %` mentions wherever else they appear.

---

## Gap 3 — Unified sessions sidebar omits CLI, A2A, Telegram, Tools sources  [MED]

- **Doc location:** `README L37` (comparison table, "Sessions sidebar" row): "Unified feed across chat / cron / api / task sources, day-grouped, live source filter chips, persisted collapse." Also `README L473–474` (Unified sessions sidebar subsection): "Single feed merging chat, cron, api, and task sources…"
- **Actual code:** `src/screens/chat/components/sidebar/v2/sidebar-source-chips-v2.tsx` defines `SOURCE_DEFS` with **eight** sources: `CHAT`, `TASK`, `CRON`, `API`, `TOOLS`, `CLI`, `A2A`, `TELEGRAM` (lines ~20–95), each with its own accent color (lines 102–106). Telegram/CLI/A2A sessions are now first-class, deletable, and clickable.
- **Triggering commits (all in window):**
  - `0666fe23` (2026-06-09) "surface CLI and A2A sessions as first-class sources".
  - `24d32aaf` (2026-06-09) "enable Delete for Telegram, CLI, and A2A sessions".
  - `8ebf6746` (2026-06-09) "make Telegram sessions clickable in V2 sidebar".
  - `7d40f191` (2026-06-09) "keep Task sessions in the Task chip (precedence over cli/a2a)".
- **Why it matters:** The sidebar is the Switch UI's signature surface and the README undersells it by ~50%.
- **Suggested edit:** Replace both L37 and L473–474 source lists with:
  > chat, task, cron, api, tools, cli, a2a, telegram
  and add a sentence: "Telegram, CLI, and A2A sessions are deletable and clickable like native chats."

---

## Gap 4 — New top-level features have no README mention at all  [MED]

- **Doc location:** Whole README. The "What's different from upstream" table (L34–43) and "Switch UI specifics" (L434+) describe the pre-window surface only.
- **Features shipped in-window with zero README coverage:**
  - **Board Templates** — `/board-templates` route, 5-step creation wizard, save-as-template + instantiate API. Commits `01e0ed22`, `bf41c98b`, `b5d6f4da` (#231/#233). Nav entry added in `primary-nav-v2.tsx`.
  - **Self-Improve scorecard** — `/self-improve` route, capability-gated observability scorecard, P0–P3 lifecycle (propose/approve/apply/verify/revert), scenarios, baseline chart, narrative UX redesign (#210). Commits `2c17cea0` → `23e4c0e9`. Nav entry present at `primary-nav-v2.tsx:583`.
  - **Custom Commands** — `/commands` route, SwitchUI-owned SQLite command store, composer slash menu, macros. Commits `a9fa2c4c`, `e4728840`, `77227612`. Nav entry present at `primary-nav-v2.tsx:579`.
  - **Hermes plugin settings section** — `section-hermes-plugin.tsx`, config-sync wiring (#228). Commits `2d8b39a2`, `fa283154`.
  - **shadcn composer cutover** — composer migrated from base-ui to shadcn/ui; Matrix-themed slash-command picker. Commits `d16643f9`, `a28cbf8a`, `85adf210`.
- **Why it matters:** Three new top-level screens (Board Templates, Self-Improve, Commands) are reachable from primary nav but a README reader would never know they exist.
- **Suggested edit:** Add a "What's new" or expand the comparison table with rows for Board Templates, Self-Improve, Commands, and the Hermes plugin settings section. Minimally, list the new nav routes under "Switch UI specifics".

---

## Gap 5 — Screenshots caveat is stale; splash referenced is old  [MED]

- **Doc location:** `README L15` (`![Switch UI](./docs/screenshots/splash.png)`) and `README L48–50` (Issues/screenshots/roadmap caveat): "the images under `docs/screenshots/` are inherited from upstream and don't yet show the Matrix UI. New Switch UI screenshots are queued."
- **Actual state:** `docs/screenshots/` contains 14 PNGs. The generic ones (`splash.png`, `chat.png`, `dashboard.png`, etc.) date from **2026-04-28** (pre-window, pre-Matrix-redesign) — so the "inherited from upstream" framing is directionally accurate for those. **But** three terminal screenshots (`terminal-redesign*.png`, dated 2026-05-11) ARE new Matrix-aesthetic shots and are present but never referenced by the README. The splash image itself was last changed `a581ab4c` (2026-04-20).
- **Triggering context:** No window commit touched screenshots directly, but the README's promise that "new screenshots are queued" is now over a month stale relative to the May-11 terminal shots that did land.
- **Why it matters:** The README tells readers the screenshots are wrong; some now are and some aren't.
- **Suggested edit:** Either (a) reference `terminal-redesign-rain-upgraded.png` in the terminal section and update the caveat to "most screenshots are pre-redesign; terminal and splash reflect the Matrix UI", or (b) refresh the full set and delete the caveat. At minimum, narrow the blanket "don't yet show the Matrix UI" claim to the specific stale images.

---

## Gap 6 — hermes-agent upstream org is inconsistent (NousResearch vs Interstellar-code)  [MED]

- **Doc location:** `README L13` credits "Hermes Agent" linking to `https://github.com/NousResearch/hermes-agent`. But `README L69`, `L92`, `L258`, and `install.sh L5/L9/L21/L143` all point the installer at `https://github.com/Interstellar-code/hermes-agent`.
- **Actual state:** `install.sh` hard-codes `Interstellar-code/hermes-agent` as the installer source (`HERMES_AGENT_INSTALLER_URL` default, L21). The README prose at L13 links to a *different* org (`NousResearch`). One of these is wrong.
- **Triggering context:** `32b8d5d8` ("feat(install): Interstellar fork installer + background-service guidance") switched the installer to the Interstellar-code fork; L13's NousResearch link was not updated to match.
- **Why it matters:** A reader who follows the L13 link lands on a repo that may not match what `install.sh` actually clones — confusing for anyone debugging the install.
- **Suggested edit:** Decide which org is canonical for the *agent backend* (the installer says Interstellar-code) and make L13 agree with install.sh. If the agent is genuinely at NousResearch and the installer uses a fork, say so explicitly: "backend installer pulls the Interstellar-code fork of [Hermes Agent](https://github.com/NousResearch/hermes-agent)."

---

## Gap 7 — "Manifest provider" config example doesn't reflect plugin-sync wiring  [LOW]

- **Doc location:** `README L455–470` ("Manifest provider" subsection) shows a static `config.yaml` `manifest` provider block and says the API key lives in `~/.hermes/.env` as `CUSTOM_API_KEY`.
- **Actual code:** `src/server/hermes-plugin-sync.ts` (added `2d8b39a2`, #228) now mirrors saved UI settings to a Hermes plugin endpoint and re-registers when a cached incompatible verdict is stale (`86fd4b9d`). `src/screens/settings/sections/section-hermes-plugin.tsx` exposes this in the settings UI. The README's static-config framing is not wrong, but it omits that the settings UI now round-trips plugin config bidirectionally.
- **Triggering commits:** `2d8b39a2`, `fa283154`, `86fd4b9d`, `d0b678d3` (all in window).
- **Why it matters:** Minor — the static config still works, but a user who edits `config.yaml` by hand may be surprised when the settings UI overwrites or syncs it.
- **Suggested edit:** Add a one-liner under the manifest example: "Settings → Hermes Plugin now syncs this config bidirectionally with the gateway; hand-editing `config.yaml` is still supported but may be reconciled on next settings save."

---

## Gap 8 — Docker / `start:all` description omits dashboard auto-start guidance is fine, but "Two backends" section still implies manual dashboard launch only  [LOW]

- **Doc location:** `README L126–156` ("Two backends: gateway + dashboard").
- **Actual state:** The section is largely accurate — `pnpm start:all` (`package.json`: `concurrently "hermes gateway run" "pnpm dev"`) starts gateway + UI but NOT the dashboard, matching the README's "you, separately" note. The dashboard manual-launch commands remain valid. No code drift here.
- **Note (not a gap, recorded for completeness):** The README correctly states the dashboard is required for sessions/skills/memory/kanban/jobs. The Board Templates feature (Gap 4) is kanban-backed, so a user who skips the dashboard will see Board Templates fail — worth a forward-reference once Gap 4's README addition lands.
- **Suggested edit:** None required for this section alone; but when Gap 4 is addressed, add a cross-reference: "Board Templates, Self-Improve, and Jobs all require the dashboard running."

---

## Summary table

| # | Severity | README location | What's wrong | Triggering commit(s) |
|---|---|---|---|---|
| 1 | HIGH | L36, L438 | Themes: 5 listed, actually 10; default is Nous not Matrix | `6c9be04f`, `ffcb1ab1` (pre-window, never doc'd) |
| 2 | HIGH | L39 | Meta bar: claims ctx % + tool count (absent); omits cost | `162aa3f4`, `e8191cb8`, `f0321e03` |
| 3 | MED | L37, L473 | Sidebar sources: lists 4, actually 8 (adds tools/cli/a2a/telegram) | `0666fe23`, `24d32aaf`, `8ebf6746` |
| 4 | MED | whole README | Board Templates, Self-Improve, Commands, Hermes-plugin settings undocumented | `01e0ed22`+kanban, `2c17cea0`+self-improve, `a9fa2c4c`, `2d8b39a2` |
| 5 | MED | L15, L48–50 | Screenshots caveat stale; new terminal shots unreferenced | (no window commit; May-11 shots predate window) |
| 6 | MED | L13 vs L69/L92/install.sh | hermes-agent org: NousResearch link vs Interstellar-code installer | `32b8d5d8` |
| 7 | LOW | L455–470 | Manifest provider: omits settings-UI bidirectional sync | `2d8b39a2`, `fa283154` |
| 8 | LOW | L126–156 | (No drift; forward-ref note for Gap 4) | — |

**Highest-leverage fixes:** Gaps 1, 2, 3 are one-paragraph edits each and correct facts a new user hits on first load. Gap 4 is the largest content addition (three new feature sections) but is additive rather than corrective.

All claims above were verified against live source at `/Volumes/Ext-nvme/Development/hermes-switchui` on 2026-06-13. No repo state was modified.
