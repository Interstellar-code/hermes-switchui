# Hermes' command surface in SwitchUI

**Status:** **shipped.** Phases 1–4d are done (§7). The allowlist is **15
commands**, up from 3. Every one of the 9 Phase-4 additions was executed live
against a throwaway tui_gateway session on 2026-08-12; the 13th — `/bundles`,
held back until the agent could serve the slugs it lists — the same way on
2026-08-13; and the 14th and 15th — `/goal` and `/subgoal`, held back until the
agent grew a post-turn hook — the same day, including a real three-turn
continuation on a throwaway api_server session. Each carries its measurement in
`src/server/hermes-slash-policy.ts`.

Researched against `hermes-agent` **v0.19.13 as installed** at
`~/.hermes/hermes-agent` and `hermes-switchui` @ `f43cec1`, then re-checked
against installed **v0.19.16** on 2026-08-13 for the bundle work (§1, §9). All
line references in this document are against the installed tree — the dev
checkout at `~/development/hermes-agent` is stale and must not be used for
behaviour.

> **Reading note.** ✅ marks a claim verified directly against source or a live
> call. Measurements in `ms`/`s` are wall-clock against the running
> gateway (:8642) and dashboard (:9119) on this host.

---

## 1. The answer: 14 reachable commands + ~78 skills + 0 bundles, out of a 156-command catalog

| | Count |
| --- | --- |
| Catalog commands (`commands.catalog`, live) | 156 |
| On the exec allowlist — the server will run these | **15** |
| **Visible in the Agent tab** — what a user can actually reach | **14** |
| Intentionally shadowed by a better SwitchUI answer | 1 (`/help`) |
| Skill commands (safe — prompt injection, not state mutation) | ~78 |
| Bundle slugs (same trust level as skills; own picker facet) | 0 installed here |
| Held back, conditional | 0 — `/bundles` shipped on 2026-08-13 |
| Everything else | excluded, with a reason in §5 |

> **Read the two counts as different questions.** `runnable: true` on the
> catalog route means *the exec route would accept it* — the server has no idea
> what SwitchUI shadows locally. A command that is allowlisted **and** in
> `LOCAL_COMMAND_HANDLERS` is dropped from the picker and answered locally, so
> it is neither advertised nor run. That gap silently hid 5 of 12 until it was
> measured (§7.4); `/help` is the only one that should be hidden, and it is now
> declared in `INTENTIONALLY_SHADOWED_COMMANDS` with a guard that fails if any
> other appears.

### Already shipped before this phase (3)

| Command | Mode | Evidence |
| --- | --- | --- |
| `/help` | worker, bare | 242ms warm (was 566ms). Session-independent. Shadowed by a local handler anyway, so it costs nothing |
| `/history` | live, bare | 35ms. 254 rendered entries from 373 active rows; tail matches the gateway DB exactly. The 119 omitted rows are tool-call carriers with no text |
| `/compress --preview` \| `--dry-run` | live, `onlyArgs` | 14ms. `"Would compress 366 of 366 message(s) (~212,130 tokens)"` — the session's real size (was `333 / ~171k` pre-`--isolated`) |

### Added in phase 4 (9) — all executed live on a throwaway session ✅

| Command | Form | Measured | Why it earns a slot |
| --- | --- | --- | --- |
| `/insights [days]` | worker, bare + `optionalCount` | 2001ms cold bare; 1673ms for `3`; 14ms for `1` | Reads the local analytics DB directly (`cli.py:10192`), **not** the `insights.get` stub. 23 sessions, 2,373 messages, 96,194,601 tokens, per-platform split, top-15 tools, top skills, weekday histogram. Four categories the dashboard lacks. `/insights 3` really re-headers "Last 3 days" and re-totals |
| `/curator` | worker, bare only | 27ms | Read-only status of a subsystem with no SwitchUI screen: schedule, thresholds, 73 agent-created skills with activity tables. Bare *is* `status` (`cli_commands_mixin.py:1570` substitutes `["status"]`). `prune`/`rollback`/`archive` stay excluded — bare `input()` at `curator.py:361`/`:463`; `run` is a synchronous LLM pass |
| `/debug local` | worker, `onlyArgs {local}` | 1296ms / **863,549 chars** over RPC; 1.10s / **396KB** through the route | The one-click "give a maintainer my state" path. `local` never uploads (§5.4). Dump confirms profile `hermes-switch`, `agent.max_turns: 60` (the profile's value, not the default's 166). ⚠️ **New finding, not in the plan:** the size varies with the agent.log tail and nothing caps it — see §7 |
| `/reasoning` | worker, bare only | 2ms warm | The only truthful readout of `agent.reasoning_effort`, a real user-visible setting with **no** other surface (§5.3). Every argument mutates, so bare only |
| `/version` | worker, bare | 348ms cold / 23ms warm | Agent build identity; no SwitchUI surface reports it. **The one addition with no `--isolated` caveat** — see §4 |
| `/profile` | worker, bare | 96ms | Which profile the worker resolved — directly actionable given #229 (§4). Answered `hermes-switch` / `~/.hermes/profiles/hermes-switch` |
| `/learn` | live, **dispatch route**, `allowArgs` | 20ms with args, 19ms bare | The one genuinely agentic command. Returns `{type:'send', message}` from `build_learn_prompt(arg)` (`server.py:13463`), ~6.0k chars. Arguments are the payload and pass through verbatim. Was blocked only by our own allowlist |
| `/memory` | worker, bare only | 9ms | Hermes' `/memory` is the **write-approval queue**, not SwitchUI's browse/graph/wiki screen. The name collision is exactly why it passes information-gain. `approve`/`reject`/`approval` mutate |
| `/suggestions` | worker, bare only | 39ms | Surfaces automations the user never asked for. `accept` stays excluded — `store.accept_suggestion` creates a real cron job |

### Added in phase 4c (1) — the one that was held back ✅

| Command | Form | Measured | Why it earns a slot |
| --- | --- | --- | --- |
| `/bundles` | worker, bare only | 428ms cold / 337ms warm | The index for the bundle slugs the catalog now serves, and the only surface anywhere in SwitchUI that reports them. **The condition it was held on is met.** Agent **v0.19.16** (verified at `/health`) adds a top-level `bundles` list + `bundle_count` to `commands.catalog`, and mirrors the same slugs into `pairs`/`canon`/`categories` under a new **"Bundles"** bucket — and `_dispatchable_bundle_entries` (`tui_gateway/server.py:13365`) only emits a slug the dispatcher can really reach: absent from the registry, unclaimed by an earlier branch, at least one installed and enabled member skill. Answered "No skill bundles installed." here, which is the honest state (`bundle_count: 0` over the same RPC) and still useful — it names the directory and the create command. BARE ONLY: `_handle_bundles_command` (`cli_commands_mixin.py:1848`) takes `cmd` and never parses it, the CommandDef declares no `args_hint`/`subcommands`, and the catalog serves no `sub` for it — so an argument would be silently dropped and look like success. **CAVEAT:** `_bundles_dir()` is `get_hermes_home()/"skill-bundles"` (`skill_bundles.py:75`) and the command **prints the path** — measured `~/.hermes/profiles/hermes-switch/skill-bundles` — so it is #229-exposed like the rest of the worker path |

### Added in phase 4d (2) — the ones the agent had to fix first ✅

| Command | Form | Measured | Why it earns a slot |
| --- | --- | --- | --- |
| `/goal [text\|status\|pause\|resume\|clear]` | live, **dispatch route**, `allowArgs` + `phantomArgs` | 36ms to set, 20–27ms for every control word | The only way to reach the agent's multi-turn loop from a browser, and the first addition unblocked by the **agent** rather than by our allowlist. `/goal <text>` answers `{type:'send', notice, message}` and the goal text is submitted as the kickoff turn. **The blocker in ask #1 is gone**: v0.19.14 added `_evaluate_goal_after_turn` (installed `api_server.py:3544`), called from the streaming loop (`:4083`). Measured live on a throwaway api_server session with a 3-turn budget: `assistant.completed` → `goal.status` "↻ Continuing toward goal (1/3)…" → `goal.continuation` turn=1 with a **new** `message_id` → a second turn → the same again → `⏸ Goal paused — 3/3 turns used` and `run.completed` carrying `goal_continuations: 2`. The binding was verified too: `hermes-slash-session.ts` resumes the chat session, whose `session_key` is the api session id, and `/goal` wrote exactly `goal:api_1786591020_666183a6` — the key the judge reads. **REFUSED:** `show`, `draft`, `wait`, `unwait` — the registry `args_hint` advertises them, the dispatch branch has no branch for them, and each would silently become the goal text and start a loop (measured: `/goal show` → "⊙ Goal set (20-turn budget): show"). **CAVEAT:** #229 in its sharpest form — the dashboard WRITES the goal and the gateway READS it, both through a process-global `get_hermes_home()`, so without `--isolated` they use different files and the goal never fires |
| `/subgoal [text\|remove N\|clear]` | live, **dispatch route**, `allowArgs` | 21–38ms | The criteria half, and useless without `/goal` — the judge weighs subgoals in its verdict. Not in `_PENDING_INPUT_COMMANDS` but in the sibling `_DISPATCH_ROUTED_COMMANDS` (`server.py:13336`), added for exactly the reason this policy would otherwise have refused it: a worker-side `save_goal()` rewrites the whole blob and would clobber the judge's `turns_used`. Every form measured, including the failures — `remove` → 4004 "usage: /subgoal remove \<n\>", `remove abc` → 4004 "\<n\> must be an integer", `remove 9` → 4004 "index out of range (1..1)". A 4004 is a fixable message, never a 4018, so the grammar needs no second parser here |

> **The `/subgoal` "unreachable via `command.dispatch` — falls to 4018" verdict
> was wrong when written and is now doubly wrong.** It has had its own branch
> since #222, and `slash.exec` forwards both dispatch sets in-process
> (`server.py:15582`) — verified live: `slash.exec /subgoal` answers exactly
> what `command.dispatch` does.

> **⚠️ Correction to the earlier claim, kept because it is still the useful
> distinction:** `/bundles` *itself* was always in the catalog payload (category
> "Tools & Skills") — it is a registry command. What the catalog used to omit
> was the bundle *slugs*. The blocker was "lists things you cannot run", never
> "the picker cannot show it".

---

## 2. The decision rule

Three questions, in order. This replaces the four ad-hoc reasons used earlier in
this project's life; every verdict in §5 cites one of them.

### Q1 — Does the answer come from a surface both processes share?

Only **two** shared surfaces exist:

- `state.db`, read **DB-authoritatively** (not off a cached object)
- `config.yaml` on disk

Anything read off the dashboard's in-memory session dict
(`tui_gateway/server.py:128` — `_sessions: dict[str, dict] = {}` ✅) or off the
worker's own `HermesCLI` instance is **false for a SwitchUI chat**.

*This* is what "structurally wrong" means in this document. It is not a
statement about databases being out of sync — that was a different bug, fixed
(§6.5).

### Q2 — Does the effect land where turns actually run?

`api_server` builds a **fresh `AIAgent` per HTTP request**
(`gateway/platforms/api_server.py:6017` ✅), from
`db.get_messages_as_conversation` (`:3089` ✅) and re-reading config on every
build (`:2402` ✅ — `GatewayRunner._load_reasoning_config()`).

Nothing crosses from the dashboard process:
`grep -rn "from tui_gateway" gateway/` returns **0 hits** ✅.

So a command whose effect lands on the dashboard's agent, or on the worker's,
lands nowhere the user can see.

### Q3 — Does the card carry information a SwitchUI screen does not?

Not *"does a screen exist"* — that was the error that wrongly excluded
`/insights`, `/version` and `/profile`. The test is **information gain**.

---

## 3. Backend asks, ranked

The most actionable output in this document. Ranked by value per unit of
backend diff.

| # | Ask | Why it ranks here | Size |
| --- | --- | --- | --- |
| ~~**1**~~ | ~~**A post-turn hook in `api_server._run_agent`**~~ — **SHIPPED in agent v0.19.14, consumed 2026-08-13** | `_evaluate_goal_after_turn` (installed `api_server.py:3544`) runs the judge after every turn on both the JSON path (`:3709`) and the stream loop (`:4083`), which is the one SwitchUI sends over. `/goal` and `/subgoal` are allowlisted and the two SSE events are rendered — see §1 phase 4d and §5.5 | done |
| **2** | **`POST /v1/runs/{run_id}/steer`** | Smallest diff of the lot. `AIAgent.steer` already exists (`run_agent.py:2899` ✅) and api_server already publishes live agents by run id (`self._active_run_agents[run_id]`, `api_server.py:3657` ✅) for `/stop` | small |
| **3** | **Per-request `reasoning_effort`** on `POST /api/sessions/{id}/chat/stream` | Un-deadens a control SwitchUI **already ships to users** (§5.4). Arguably #1 on user-visible impact | small |
| **4** | **Resolve the continuation id when building turn history** | `_conversation_history_for_session` (`:3089`) loads by the literal `session_id`. Unblocks bare `/compress`. **Smaller than previously thought** — see the note below | very small |
| **5** | [**hermes-agent#229**](https://github.com/Interstellar-code/hermes-agent/issues/229) — profile-scoped `_get_db()` | Has a local workaround (`--isolated`), but see §4 | medium |

> **Correction to ask #4, found during this restructure ✅.** The claim
> "api_server never calls `resolve_resume_session_id`" is **wrong as stated**:
> `grep -c resolve_resume_session_id gateway/platforms/api_server.py` = **1**,
> at `:3311`. But it sits in `_handle_session_messages` (`:3282`), the
> read-only `GET /api/sessions/{id}/messages` listing — **not** in
> `_conversation_history_for_session` (`:3089`), which is what builds the turn.
> So the substantive point stands (a compressed session strands the chat on the
> ended parent), and the fix is *smaller* than assumed: the primitive is
> already imported and used in the same file, one call away.

---

## 4. #229's blast radius went from 2 to 10 — measured, not assumed

Everything on the worker path reads **profile-scoped disk**, and the worker
inherits the dashboard's profile.

Without `--isolated`, **7 of the 9 Phase-4 additions** would silently report the
wrong profile's data. With the 2 existing entries that already carried the
caveat, and `/bundles` in Phase 4c, that is **10 of the 13** exposed to #229, up
from 2. `/version` is the one addition that turned out **not** to be affected.

| Entry | Affected? | The profile-scoped thing it reads |
| --- | --- | --- |
| `/history` | ✅ | `_get_db()` — the transcript |
| `/compress --preview` | ✅ | history loaded by `session.resume` through the same `_get_db()` |
| `/insights` | ✅ | its own `SessionDB()` (`cli.py:10192`) |
| `/profile` | ✅ | `get_active_profile_name()` — this command *is* the caveat |
| `/reasoning` | ✅ | the profile's `config.yaml`. **Proven:** `display.show_reasoning` is `true` in `~/.hermes/config.yaml:88` and `false` in `profiles/hermes-switch/config.yaml:114`, and it answered `off` |
| `/curator` | ✅ | `get_hermes_home()/skills/.curator_state` (`agent/curator.py:86`); the two skill trees are distinct directories |
| `/memory` | ✅ | `get_hermes_home()/memories` (`tools/memory_tool.py:57`), distinct inodes per profile |
| `/suggestions` | ✅ | `get_hermes_home()/cron/suggestions.json` (`cron/suggestions.py:48`, whose own comment says it is anchored on the profile home) |
| `/debug local` | ✅ | everything it prints. Confirmed live: `agent.max_turns: 60` is the profile's value; the default profile has `166` |
| `/bundles` | ✅ | `_bundles_dir()` = `get_hermes_home() / "skill-bundles"` (`agent/skill_bundles.py:75`). **Proven by its own output** — it prints `Directory: ~/.hermes/profiles/hermes-switch/skill-bundles`. Worse here than elsewhere: the wrong profile's list would name slugs this install cannot dispatch, reintroducing the exact defect the command was held back for |
| `/help` | ❌ | renders `COMMAND_REGISTRY` |
| `/learn` | ❌ | builds a prompt string in process |
| `/version` | ❌ | **the shared install.** `PROJECT_ROOT` is `~/.hermes/hermes-agent`, outside every profile; `VERSION`/`RELEASE_DATE` are module constants; the git label is that one checkout. Only the 6-hour `.update_check` cache is per-profile (`~/.hermes/.update_check` records ver `0.19.12`, the profile's records `0.19.13`) and it self-invalidates on a version mismatch, so both profiles compute the same answer |

**Enforced in code:** `hermes-slash-policy.test.ts` asserts the affected set by
name and pins `10 + 3 = 13` as an exact count, so a fourteenth entry cannot be
added without someone deciding which side it falls on. The convention is an
uppercase `CAVEAT` marker plus the `--isolated` token in the entry's `why`.

Silent wrong-profile data is worse than a refusal, because the card looks
authoritative.

---

## 5. Per-command reference

Verdicts are **three-way**. The old binary include/exclude is what produced
several of the wrong answers in the appendix.

- **works** — correct over this transport today; ship it
- **ask** — genuinely valuable, structurally blocked, worth a backend ask (§3)
- **drop** — not worth having

### 5.1 The 13 — see §1 for the list

All **works**, and all now ship. `/bundles` was the last hold-out and no longer
is: it always worked over the transport, but until agent v0.19.16 the bundle
slugs it advertises were absent from `commands.catalog`, so it listed things
SwitchUI could not dispatch. Recording it as a *conditional* refusal rather
than dropping it is what made unholding it a one-entry change when the
condition was met.

**Bundle slugs themselves** are a fourth class alongside registry commands,
skill commands and user commands. They need no allowlist entry each — a slug
appears the moment a user writes a YAML file into
`~/.hermes/profiles/<p>/skill-bundles` and no static table could track them — so
membership of the live catalog *is* the permission, exactly as it is for skills.
They take `command.dispatch`, answer `{type:'send', message, notice}`, and their
arguments are interpolated verbatim into the message as a "User instruction:"
line. They are **not** folded into the skill set: they arrive *categorized*
(under the agent's own "Bundles" bucket), so the "uncategorized ⇒ skill" signal
cannot express them, and the `skill` flag drives three picker behaviours — the
Skills facet, the `/api/skills` slug join, the provenance badge — that a bundle
cannot satisfy. Hence a separate `bundleCommands` set and a **fourth picker
facet**, which `visibleSlashCommandTabs` hides while it is empty, i.e. always,
until someone creates a bundle.

### 5.2 Right verdict, wrong reason — corrected in place

These stay excluded. The published reasons were wrong and are replaced.

| Command | Verdict | Corrected reason | Evidence |
| --- | --- | --- | --- |
| `/status` | drop | `session.resume` **does** accept `eager_build: true` (`server.py:6485` ✅) and it makes things **worse**: `_session_usage_snapshot` (`:3869` ✅) returns `_get_usage(agent)` whenever an agent exists, guaranteeing zeros. `session.status` (`:8858` ✅) has no argument that changes what it reports. The schema claim is **confirmed**: `hermes_state.py:781` `CREATE TABLE IF NOT EXISTS sessions` has no `updated_at`/`last_activity_at`, and no production `ALTER TABLE sessions` exists, so the loop at `server.py:8886-8890` is **dead code against a non-existent column** ✅ | 3 of 9 lines false; `Tokens: 0` on a session whose row records 32M input tokens |
| `/usage` | drop | Same cause as `/status`. Only `Messages: 366` became correct after `--isolated` | counters all zero |
| `/systemprompt` | drop | Gained a configured-prompt fallback in 0.19.13, but nothing is configured here, so it reports the chat has no system prompt when it demonstrably does | — |
| `/compress` (bare) | ask (#4) | **Not** "irreversible". `_sync_session_key_after_compress` (`:3656` ✅) rotates the session to a continuation child, and turn history loads by the literal `session_id` (`:3089`), so the chat would keep writing to the **ended parent**. A broken binding, not just lost context | §3 ask #4 |
| `/stop` | drop | Does **not** kill every process on the host. `process_registry` is a module-level singleton (`tools/process_registry.py:2016` ✅); `kill_all()` reaches only dashboard-spawned processes. Excluded because it reaches the wrong process set (Q2), not because it is dangerous | — |
| `/personality` | drop | `--global` **does** write `agent.personality`, but api_server never resolves it: `grep -c personality gateway/platforms/api_server.py` = **0** ✅ | Q2 |
| `/queue` `/q` | drop | Not "acts on the dashboard's agent" — `server.py:13458` is a **pure echo** returning `{type:'send', message: arg}` ✅. The composer already queues | — |
| `/reload-mcp` | drop | A dead branch in *any* process. `grep -rn "def reload_mcp_tools"` = **0** ✅; the only two hits are the guarded call itself (`server.py:15064-15065`, `hasattr(agent, "reload_mcp_tools")`), so the branch can never be taken | — |
| `/toolsets` `/platforms` `/plugins` `/snapshot` | drop | Fail on **information gain** (Q3), not "a screen exists". `/platforms` also prints a **false instruction** (`python cli.py --gateway`). ⚠️ `/toolsets` is the weakest call — **flip it** if the Toolsets screen turns out not to carry per-toolset descriptions and tool counts | `tools.list`: 14ms, 63 toolsets with description, `tool_count`, `enabled`, resolved `tools[]` |
| `/tools` | drop | Retired by the Toolsets screen. ⚠️ **The "fix the refusal string" note here was itself wrong and is withdrawn.** The 2184ms reading was taken on a *warm* worker; re-measured as the first command on a fresh binding it is **5735ms**, so the refusal's "~5.7s" is right and stays. A SwitchUI binding is per-chat and idle-reaped at 5 min, so cold is the common case | 5735ms cold, 2184ms warm |
| `/paste` | drop | "Terminal-only" swept in something real. Live: **6.04s**, returned `📎 Image #1 attached from clipboard` — it read the **host's X clipboard**. Still excluded, but the reason is a **cross-host data read**, not "terminals don't exist in browsers" | 6.04s |
| `/handoff` | drop (for now) | Non-blocking since 0.19.13 and with a shared DB the gateway watcher really would execute it: a one-way transfer of the chat you are typing in, with no confirmation. Also nothing is configured, so it can only fail. See §9 | — |
| `/yolo` | drop | By design — call `GET\|POST /api/sessions/{session_id}/yolo` on the **gateway** instead. `_yolo_session_key` (`api_server.py:6838`) returns `gateway_session_key or session_id`, the same expression `_run_agent` binds to `HERMES_SESSION_KEY`, so `resolveSessionKeyValue` keys it correctly for free. Forwarding `slash.exec /yolo` would route to the *dashboard*, which calls back to the gateway — two processes and a partial-success mode where the palette reports a toggle the enforcer never received. State is process-resident and does not survive a gateway restart, so the UI must self-correct rather than cache an "on" | — |
| `/config` | **drop — do not add** | It was proposed; it has **three false lines**. Live: `API Key: Not set!` while `model.api_key: mnfst_…` **is** set (`~/.hermes/config.yaml:4`); `Working Dir` is the worker's cwd, not the session's; `Started` is the worker's start time. All read `self.*` on the worker's own `HermesCLI` (`cli.py:6866-6900` ✅ — `api_key_display = "Not set!"` at `:6869`) | Q1 |

### 5.3 `/reasoning` — the largest miss, now added

SwitchUI's composer ships a reasoning picker that is **dead**:

- `send-stream.ts:355-398` accepts `body.thinking` and **deliberately drops it**
  — api_server has no per-request effort parameter
  (`grep -c reasoning_effort gateway/platforms/api_server.py` = **0** ✅).
- The effort that actually applies comes from `agent.reasoning_effort` in
  `config.yaml` (live: `medium`, `~/.hermes/config.yaml:12`) via
  `GatewayRunner._load_reasoning_config()`
  (`api_server.py:2402` → `gateway/run.py:5246` ✅), re-read on **every** agent
  build.
- There is **no Settings control** for it either.

So bare `/reasoning` is the only truthful readout of a real, user-visible
setting. `/reasoning <level> --global` should **not** become a slash command
(§A.3 rule: a slash command should not duplicate a visible affordance) — and
see §9 for what changes if the picker is fixed.

### 5.4 `/debug local` — never uploads

`local` and `nous` are **mutually exclusive and `local` wins**
(`hermes_cli/cli_commands_mixin.py:2810` ✅ — `/debug local` renders the report
to stdout, no upload). Refusing `/debug` wholesale was wrong; the safe variant
needs no confirmation modal.

The unsafe variants stay excluded: bare `/debug` uploads to a **public** paste,
and the privacy notice states prompts, responses, tool output, display name,
user ID and paths are **not** redacted.

### 5.5 `_PENDING_INPUT_COMMANDS`, split three ways

`tui_gateway/server.py:13123` ✅ short-circuits this set straight into
`command.dispatch`, which runs **in-process against the live `_sessions[sid]`** —
no `_SlashWorker`, no stale history:

```
retry  queue  q  steer  plan  goal  moa  undo  learn  compress  compact
```

Since v0.19.16 there is a **second** set with the same routing and a different
reason: `_DISPATCH_ROUTED_COMMANDS = {subgoal}` (`server.py:13336`). Its comment
is worth reading — the slash worker is a separate process whose `GoalState` is
stale, and `save_goal()` rewrites the whole blob, so a worker-side write would
clobber the `turns_used`/`status`/`last_verdict` the serving process's judge had
just written. `slash.exec` forwards **both** sets in-process (`:15582`).

The old binary include/exclude collapsed three different situations into one.
**This split is the most important structural fix in this document.**

#### (a) works today

| Command | Note |
| --- | --- |
| `learn` | Ships in the 13 |
| `plan` | Resolves as the **`plan` skill**, not the registry. A **registry bug** ✅: `plan` is in `_PENDING_INPUT_COMMANDS` (`server.py:13129`) but has **no `CommandDef`** in `hermes_cli/commands.py` and no dispatch branch, so it 4018s and is rescued by the same-named skill |
| `undo` | **Not blocked.** `db.rewind_to_message` (`hermes_state.py:5361` ✅) soft-deletes `active=0`, visible cross-process. Dropped by **product decision only** (§7.3) |

#### (b) valuable but structurally blocked — worth a backend ask

| Command | Blocked by | Ask |
| --- | --- | --- |
| ~~`goal`~~ | ~~See below~~ — **unblocked, shipped 2026-08-13** | ~~#1~~ |
| `steer` | Needs the live-agent registry | #2 |
| `compress` (bare) | Continuation-id binding | #4 |
| `moa` | Same post-turn hook as `goal` — the hook now exists, so this is a re-measurement, not a blocker | ~~#1~~ |

**`/goal`, resolved ✅.** The finding below was true of v0.19.13 and is kept
because it is what got the hook built: *"`grep -c goal
gateway/platforms/api_server.py` = 0. State is durable (`hermes_cli/goals.py`
→ `db.set_meta("goal:<sid>")`), so it is stored and never evaluated. The
continuation hook is `gateway/run.py:11538-11563`, inside `_handle_message`;
api_server calls its own `_run_agent` and never enters it."*

**Agent v0.19.14 fixed it** (hermes-agent#230). Installed v0.19.16 now has
`_evaluate_goal_after_turn` at `gateway/platforms/api_server.py:3544`, the
public projection `_goal_public_block` at `:3619`, and two call sites: the
non-streaming `POST /api/sessions/{id}/chat` (`:3709`), which evaluates and
returns a `goal` block but does **not** auto-continue, and the stream loop
(`:4083`), which does. `_PENDING_INPUT_COMMANDS` still routes `goal`
in-process (`server.py:13307`), so nothing about the command changed — only
whether anything read what it wrote. See §1 phase 4d for the live trace.

#### (c) not worth having

| Command | Reason |
| --- | --- |
| `queue` / `q` | Pure echo (`server.py:13458`); the composer already queues |
| `retry` | Truncates in-memory history with **zero DB calls**, so api_server still sees the untruncated transcript and the retry lands as a **duplicate** |
| `compact` | Alias of `compress`; also a name collision (§6.1) |

---

## 6. Architecture reference

### 6.1 The registry — `hermes_cli/commands.py`

Single source of truth. Every consumer (CLI help, gateway dispatch, Telegram
BotCommands, Slack, autocomplete) derives from `COMMAND_REGISTRY`.

```python
@dataclass(frozen=True)
class CommandDef:
    name: str; description: str; category: str
    aliases: tuple[str, ...] = ()
    args_hint: str = ""
    subcommands: tuple[str, ...] = ()
    cli_only: bool = False          # excluded from GATEWAY_KNOWN_COMMANDS
    gateway_only: bool = False
    gateway_config_gate: str | None = None
```

✅ 82 commands: Session 32, Tools & Skills 18, Info 16, Configuration 15,
Exit 1. 30 `cli_only`, 8 `gateway_only`, 24 aliases.

**`cli_only` is not an execution gate** — it only excludes a command from
`GATEWAY_KNOWN_COMMANDS`. It says nothing about whether `slash.exec` will run it.

**Observed wire behaviour of `commands.catalog`** ✅ (measured live):

- Merges `COMMAND_REGISTRY` + `_TUI_EXTRA` + `quick_commands` +
  `scan_skill_commands()`, and **since v0.19.16** `scan_bundles()` as well, via
  `_dispatchable_bundle_entries` ✅. Still **no plugin commands** — those appear
  only if the plugin ships a `SKILL.md` the skill scanner finds.
- **Bundles arrive twice over** (v0.19.16 ✅, re-measured 2026-08-13): a
  top-level `bundles` list of `{command, name, description, skills}` plus a
  `bundle_count`, **and** the same slugs folded into `pairs` / `canon` (as
  self-mappings, therefore dropped) / a `categories` bucket named `"Bundles"` —
  the same pattern as the existing `"User commands"` bucket, and appended only
  when non-empty. Every pre-existing key kept its exact shape. Live here:
  `bundles: []`, `bundle_count: 0`, no `"Bundles"` bucket.
- **Skill commands are appended to `pairs` but to no category.** That absence is
  the *only* signal distinguishing them; the normalizer keys off it. Live:
  **79 skill entries** vs 77 registry/TUI entries; **156 unique** commands,
  6 categories. `skill_count` is **78**.
- `pairs` contains a **duplicate**: `/sessions` appears twice (registry +
  `_TUI_EXTRA`).
- **`/compact` is a name collision *in the agent*.** `pairs` carries the
  `_TUI_EXTRA` entry "Toggle compact display mode" (category TUI), while `canon`
  maps `/compact` → `/compress`. Two different things.
- **`/tasks` is an alias of `/agents`**, not `/kanban`. **`/jobs` and `/mcp` are
  not in the registry at all** — the canonical names are `/cron` and
  `/reload-mcp`. `/jobs` and `/mcp` exist only as SwitchUI route names.
- ✅ **Needs no session.** Bare connect + one request returns the full catalog.

### 6.2 Three dispatch paths — and which one SwitchUI is on

| Surface | Transport | Slash support |
| --- | --- | --- |
| CLI (`cli.py`) | terminal / prompt_toolkit | full, interactive |
| Messaging gateway (`gateway/run.py::_handle_message`, `:10073`) | `MessageEvent` from Telegram/Slack/Discord | full, minus `cli_only` |
| **HTTP API server** (`gateway/platforms/api_server.py`, :8642) | REST + SSE | **none** |
| tui_gateway JSON-RPC (`/api/ws` on dashboard :9119) | WebSocket | full, structured |

✅ **SwitchUI is on the third row, and it has no slash support.** `api_server.py`
never constructs a `MessageEvent` and never calls `_handle_message`. Its chat
handlers call `self._run_agent()` directly. Its `gateway_runner` back-reference
is used only to resolve sibling adapters for `/api/platforms/{platform}/events`.

**Consequence:** every `/command` SwitchUI does not handle client-side would go
to the model as literal prose. Closing that hole is the routing invariant in §7.

### 6.3 The two-process split

The dashboard (:9119, hosting every RPC) and the gateway (:8642, serving
SwitchUI's chat) are **different processes**. A SwitchUI chat's session object
on the dashboard is **resumed and never run**, which is why every "live state"
readout is structurally zero (Q1/Q2).

`tui_gateway/server.py` exposes ~120 JSON-RPC methods over `/api/ws`
(`hermes_cli/web_server.py:18075` → `tui_gateway/ws.py`). Envelope is JSON-RPC
2.0 (`server.py:1452`). Auth is `?token=` on loopback, or a single-use 30s
`?ticket=` from `POST /api/auth/ws-ticket` (`dashboard_auth/routes.py:615`).

Wire notes ✅: `/api/ws` has a second gate, `_ws_request_is_allowed`
(Host/Origin + peer IP) — the client sends **no `Origin` header**, because
`_ws_host_origin_reason` skips the origin check entirely when it is absent,
whereas inventing one risks a mismatch. `POST /api/auth/ws-ticket` returns
**401** on an ungated dashboard, so detection falls through to `?token=`.
Handshake is exactly one frame on accept:
`{"jsonrpc":"2.0","method":"event","params":{"type":"gateway.ready",…}}`.

### 6.4 The mirror — and `slash.exec`'s subprocess

`slash.exec`'s fallback path spawns `_SlashWorker`, a **separate `HermesCLI`
process** (`tui_gateway/slash_worker.py`) constructed once with its own copy of
session state.

`_mirror_slash_side_effects` (`server.py:14962` ✅) mirrors **six** commands —
not seven; the installed source has no `prompt` branch:

```
model   personality   compress   fast   reload-mcp   stop
```

✅ **Verified: the mirror mutates only `_sessions[sid]` and that process's
`AIAgent`.** `fast` sets `agent.service_tier` (`:15060-15062`), and
`grep -c service_tier gateway/platforms/api_server.py` = **0**. **All three
mirror-based refusals stand** (`/personality`, `/fast`, `/reload-mcp`).

`_MUTATES_WHILE_RUNNING` also rejects `model`/`personality`/`compress` during an
in-flight turn (`server.py:14994`), but every other worker-routed mutating
command bypasses that busy-guard entirely, since it never reaches the mirror.

Read-only commands are safe *only* when intercepted upstream by
`_live_slash_command_output` (`server.py:14891` ✅), which reads the live
session: `compress, usage, history, prompt, status, context, tools, help, clear,
models, rename, effort`.

`_WORKER_BLOCKED_COMMANDS` = `{snapshot, snap}` (`server.py:13140`).

> **Rule.** Proxy-text is sound only for read-only commands on the live-output
> path. Mutating commands must use a structured RPC or a real REST API — never
> `slash.exec`.

### 6.5 `--isolated`, and hermes-agent#229

`~/.config/systemd/user/hermes-dashboard.service` runs
`hermes dashboard --no-open --skip-build --isolated`. Without it, `hermes
dashboard` under a named profile re-execs as `-p default … --open-profile
hermes-switch` (`hermes_cli/main.py` ~12617) — deliberate upstream design for a
machine-wide dashboard, but its `_get_db()` (`tui_gateway/server.py:1039` ✅)
follows the **process** profile, so the RPCs read a database behind the one the
chat writes.

Measured **before** the fix: `~/.hermes/state.db` vs
`~/.hermes/profiles/hermes-switch/state.db`, distinct inodes, 2881 vs 2920
messages.

| call | before `--isolated` | after |
| --- | --- | --- |
| `session.resume{session_id}` | **4007 session not found** | OK, **366 messages** |
| `session.resume{…, profile:'hermes-switch'}` | OK, 4 messages | — |
| `session.history` | **`{count:0}`** despite a successful resume | 254 entries |
| `command.dispatch{name:'undo'}` | **4018 "no user messages to undo"** | works |
| `session.branch` | **5008 FOREIGN KEY constraint failed** | works |
| stray `slash_worker` processes | **9** observed (two for one session key) | **0** |

The upstream bug is still open — a default install still hits exactly this,
which is what §4 is about.

### 6.6 Output shape

The slash worker forces `Console(force_terminal=True, width=120)` and strips
ANSI at exit. Output is escape-free but **120-col hard-wrapped ASCII** full of
box-drawing — render as `<pre>` + monospace + `overflow-x:auto`, **never**
markdown. `/insights`, `/help` and `/platforms` are the worst offenders.

---

## 7. What has shipped

| Phase | State |
| --- | --- |
| Bug fixes | **Done** — 4 defects in `send-stream.ts` (§7.1) |
| Phase 1 — wire up what exists | **Done** — `/branch`, `/usage` meters, `steerAgent` removed, deep-links |
| Phase 2 — live catalog | **Done** — `hermes-rpc.ts`, `GET /api/hermes-commands`, catalog-driven menu, `agentCommands` capability gate |
| Phase 3 — execution | **Done** — `POST /api/hermes-commands/exec`, **3-command** allowlist + reasoned refusals, per-chat session binding, output card |
| Phase 4 — the additions (§1) | **Done** — allowlist **3 → 12**. 9 added, `/bundles` held back as a conditional refusal. Two new mechanisms: `optionalCount` for `/insights [days]`, and a per-entry `route` so `/learn` takes `command.dispatch`. `--isolated` caveat widened 2 → 9 and pinned as an exact count |
| Phase 4b — the shadow bug (§7.4) | **Done** — 5 of the 12 never reached the user. 4 unshadowed, `/help` excepted, guard added |
| Phase 4c — bundles (§1, §5.1, §9) | **Done, 2026-08-13 against installed v0.19.16** — allowlist **12 → 13**, `/bundles` unheld. The normalizer absorbs `bundles`/`bundle_count`, marks those `pairs` entries `bundle: true` (tier `prompt`, runnable, never `skill`), and `catalogPolicyInputs` serves a third set `bundleCommands` that `evaluateSlashCommand` dispatches without an allowlist entry each. Fourth picker facet, hidden while empty. `--isolated` caveat widened 9 → 10 |
| Phase 4d — the standing goal (§1, §3, §5.5) | **Done, 2026-08-13 against installed v0.19.16** — allowlist **13 → 15**. Unblocked by agent v0.19.14's post-turn hook, not by anything here. One new policy mechanism, `phantomArgs`, for the four `/goal` subcommands the registry advertises with no branch behind them. Both `goal.status` and `goal.continuation` are translated in `send-stream.ts` and rendered in `use-streaming-message.ts`: a continuation SEALS the finished turn so each one is its own assistant message, and the judge's verdict trail lands in a `goal-progress-store` card beside the transcript, never in it. `--isolated` caveat widened 10 → 12 |
| Phase 5 — reconcile user commands | Not started |

**Phase 4, what actually changed.** `src/server/hermes-slash-policy.ts` (types,
allowlist, refusals, `evaluateSlashCommand`, `isBareOnlySlashCommand`,
`slashArgumentCompletions`) and comment-only updates to
`src/server/hermes-slash-exec.ts`. Tests: `hermes-slash-policy.test.ts`,
`hermes-slash-exec.test.ts`, `hermes-commands.test.ts`. No UI file changed —
the picker picks the new entries up through `runnable` and `subcommands`, which
are already computed from the policy.

> ⚠️ **That last sentence was the bug.** It holds only for an entry nothing
> shadows, and four of the nine were shadowed by a SwitchUI handler, so they
> were added to an allowlist and silently deleted. Fixed in **§7.4**, which is
> also where the guard lives.

**Open follow-up from phase 4:** `POST /api/hermes-commands/exec` has **no
output size cap**, and `/debug local` is the first entry that makes that
visible — 396KB–864KB per call, varying with the agent.log tail, versus ~90
bytes for `/profile`. It is survivable today (the card renders collapsed, the
store is in-memory and capped at 20 entries per session) and it was shipped
rather than held, but a cap on the route is the obvious next change and must
land before anything else large joins the list.

Two catalog-driven traps closed on the way in, both the exact failure §8
describes. `/reasoning`, `/curator`, `/memory` and `/suggestions` all ship
`sub` lists in the live catalog whose every entry mutates, so
`isBareOnlySlashCommand` strips them. `/debug`'s `sub` is `["nous","local"]`,
of which `nous` uploads — `slashArgumentCompletions` replaces it with `local`
alone. And `/insights`, for which the agent serves no `sub` at all, gets `7`
and `30` as hints.

**Menu today:** `LOCAL_SLASH_COMMANDS` is `[]`. The target is **agent commands +
the user's custom commands, no SwitchUI source at all**.

**The routing invariant:** no catalog-known command can reach the model as
prose. Tier is enforced **twice** — the menu drops excluded entries, and the
router refuses them — because hiding a command is not a control. The seam is a
single function, `agentCommandNotice()`.

**Session binding:** per-chat, not shared. A fresh tui_gateway session is
*empty*, so `/status` and `/history` would report a session the user has never
seen; `session.resume(<chat session id>)` fixes it (**13ms**). Bindings are
LRU-capped at 4 (each is a real `slash_worker` subprocess) and idle-reaped at
5 min via `session.close`, verified non-destructive on a real session.

### 7.1 The four `send-stream.ts` defects — fixed ✅

`use-send-message-state.ts:502` sent the reasoning *effort label*
(`'low'`/`'adaptive'`…) as `body.thinking`. Three consumers treated it as the
model's reasoning text, plus a fourth defect not originally spotted:

1. **The thinking pane rendered the literal word "low".** `send-stream.ts:876`
   emitted `sendEvent('thinking', { text: thinking })` on every reasoning chunk
   — the label — while `chatThinking`, accumulating the model's real reasoning
   one line above, was built and thrown away. → now `chatThinking`.
2. **The final assistant message persisted the label** as its thinking block
   (`:951`). → now `chatThinking`. (`responseThinking` is *not* the right
   variable: it is `const responseThinking = ''` at `:699`, permanently empty,
   in a `/v1/responses` branch this path never enters.)
3. **The label was injected as the turn's system prompt** ✅ — the enhanced
   sessions path sent `system_message: thinking`, and the gateway applies
   `system_message` verbatim as `ephemeral_system_prompt`. Every
   reasoning-enabled send prepended the literal string `"low"` as a system
   prompt. → field removed.
4. `hermes-slash-exec.ts` sent `decision.command` only, **discarding
   arguments** — see §8.

411 test files / 4460 tests pass, zero lint errors.

**Latent inconsistency, left for review:** `ThinkingLevel`
(`chat-composer-types.ts:13`) is `off|low|medium|high|adaptive`, but
`/reasoning` accepts only `off|low|adaptive` (`use-slash-commands.ts:285`), and
`use-thinking-level.ts:26`'s rehydration allowlist silently discards a stored
`medium`/`high`.

### 7.2 `/model` — the one per-request parameter that does work ✅

Added in hermes-agent 0.19.12 (PR #216) and **fully implemented in SwitchUI**
(commit `d72c037`). Recorded because it is the counter-example to §5.3: it
proves the REST path *can* carry per-request control when the backend adds it.

`POST /api/sessions/{id}/chat` and `/chat/stream` read a top-level `model`
field, applied by `_apply_requested_model` (`api_server.py:2144`) *before* the
agent is built — `:3410` sync, `:3464` stream, deliberately ahead of the SSE
response so a refusal is a plain 400 rather than an error frame on a committed
stream.

- **Sticky, not per-turn.** Installs the session's model *override* (the HTTP
  equivalent of `/model`, outranking static `model_routes`).
- **Keyed on `X-Hermes-Session-Key` if sent, else the URL `{session_id}`.**
  Inconsistent headers write under one key and read under another.
- **Persisted** — `_persist_session_model_override` (`:2040`) writes
  `model_config['_model_override']` + the `model` column, restricted to
  `_PERSISTABLE_MODEL_OVERRIDE_KEYS = ("model", "provider", "base_url")`
  (`:243`); `api_key`/`api_mode` are re-resolved on rehydration, never written
  to disk.
- **Echoed back as the *effective* model** — `run.started`.`model` (`:3685`) and
  the sync response's top-level `model` (`:3433`), both from
  `_effective_model_name()` (`:1994`).
- **Two no-ops:** the server's own advertised identity from `GET /v1/models`
  (here `hermes-switch`) is treated as "no preference"; and a request naming the
  already-installed model short-circuits before credential resolution.

**Three failure shapes**, all observed live:

| Shape | Wire | Body |
| --- | --- | --- |
| Empty/non-string `model` | **400** | `{"error":{"message":"model must be a non-empty string","type":"invalid_request_error","param":"model","code":"invalid_model"}}` |
| Provider refuses at resolution | **400** | same envelope, `"code":"model_not_available"` |
| Provider accepts at resolution, refuses at inference | **200** | ordinary SSE turn whose assistant content *is* the refusal |

The third is dangerous here because this deployment's provider is a permissive
aggregator. Observed verbatim for `model: "zai/glm-99-does-not-exist"`:
`run.started` echoed the bogus id, then `assistant.delta` carried
`[🦚 Manifest M302] Model "…" is not available for this agent.` — HTTP 200
throughout, and the bad model is now **sticky** for that session.

SwitchUI handles all of it: `resolveSessionKeyValue`
(`src/lib/send-stream-session-headers.ts`) centralises the key fallback;
`parseModelErrorEnvelope` (`send-stream.ts:262`) parses the 400;
`detectModelRejection` (`chat-store.ts:391`) catches the 200 and rolls the
picker back; `run.started`.`model` is re-emitted as `model_effective`
(`send-stream.ts:1242`).

### 7.3 `/undo` and `/retry` — dropped by product decision

**Not building turn-rewind.** The user's call; it is not a capability this
product needs. This supersedes every "highest-value gap" framing of `/undo`.

Recorded because the facts stay true if the decision is revisited:

- **It is unblocked, not blocked** (§5.5a).
- **`session.undo` is the wrong RPC**, re-verified in v0.19.13: it pops
  in-memory `session["history"]` with **zero** `rewind_to_message` calls,
  returning `{removed: N}` while the transcript is untouched. Proven live:
  returned `{removed: 2}` while the api_server transcript stayed at 4 messages.
  The working path is `command.dispatch{name:'undo'}` (`server.py:13407`) →
  `db.rewind_to_message` → `active=0` soft-delete → history reload → memory-
  provider notification → `{type:'prefill', message, notice}`.
- **The better surface was probably not a slash command** — a "rewind to here"
  action on a message fits the `prefill` return better.

**Consequence, plainly:** nothing in SwitchUI can rewind a turn. A bad turn is
handled by starting a new chat, branching (`/branch`, which exists), or editing
and resending.

`/retry` depended on `/undo` and is dropped with it (and see §5.5c — it is
broken independently). The per-message Retry in `message-actions-bar.tsx` stays;
it resends **without** truncating server-side history, a different operation
already documented as divergent.

### 7.4 The shadow bug — 5 of the 12 never reached a user ✅

Phase 4's claim that "no UI file changed — the picker picks the new entries up
through `runnable`" was **wrong for four of the nine**. A command that is on the
exec allowlist *and* in `LOCAL_COMMAND_HANDLERS` is dropped from the picker by
`agentCatalogEntries` as *shadowed* **and** answered by the local handler when
typed, so the agent's version is neither advertised nor runnable and every
measurement in its `why` is dead text.

Measured against the live catalog on 2026-08-13: **12 allowlisted, 5 shadowed**
(`/help /insights /profile /reasoning /version`), **7 reaching the Agent tab**.

**This was a recurrence.** `/status` hit it, was diagnosed, and was fixed by hand
— and the fix was never generalised, so the 3 → 12 pass re-created it four times.
Each of the four had been allowlisted *for* something its shadow destination
lacks: `/insights` deep-linked to `/dashboard` (the screen without its
per-platform split, top-15 tools, top skills and aggregate messages), `/profile`
to `/profiles` (a different thing entirely), `/version` to Settings → Updates
(losing install dir, install method, Python and SDK versions — and it was mapped
in *both* tables, the settings one winning, so its `DEEP_LINK_ROUTES` entry was
unreachable dead weight).

**Outcome.** Four unshadowed; `/help` kept, deliberately — the picker *is* the
help surface. Agent tab **7 → 11**, verified live.

**`/reasoning`'s handler was deleted, not merely unshadowed.** It set a thinking
level whose only two consumers both dead-end: `body.thinking` is deliberately
dropped by `send-stream.ts` (§5.3), and the composer's
`effectiveFastMode = fastMode && thinkingLevel === 'off'` gate feeds `fastMode`,
dropped on the same grounds. So it reported `Reasoning: low` for a change that
cannot reach a turn, while shadowing the only truthful readout of
`agent.reasoning_effort`. The composer's picker is untouched; when the gateway
grows a per-request parameter, wire it there (§3 ask #3), not here.

**The guard.** The permitted overlap is now one named table,
`INTENTIONALLY_SHADOWED_COMMANDS` (`server/hermes-slash-policy.ts`), currently
`/help` alone, enforced at three altitudes:

| Where | What it catches |
| --- | --- |
| `slash-command-menu.test.tsx` | allowlist ∩ `LOCAL_COMMAND_HANDLERS` ≠ the exception table, in **both** directions (so a stale exception fails too); plus a rendered check that every un-excepted entry reaches the Agent facet |
| `use-slash-commands.test.ts` | the **behavioural** half — an allowlisted command must not be answered by the hook. This is the one that catches a leftover `DEEP_LINK_ROUTES` / `SETTINGS_SECTION_COMMANDS` mapping, which intercepts just as well as a named handler and sails past a list comparison. Verified by reintroducing the bug: the list check passed, this one failed |
| `hermes-slash-policy.test.ts` | the exception table is pinned to `['/help']`, each key is really allowlisted, each carries a written reason |

Every failure message names the three ways out (unshadow / de-allowlist /
except) and states the bar for the third: SwitchUI's answer must be *better*,
not merely different — "does a screen exist" is the §A.3 overcorrection that
caused this.

---

## 8. Mechanics: the `onlyArgs` gate

`allowArgs` is a boolean, which cannot express "bare form refused, one flag
permitted" — the shape `/compress` needs, and the shape `/debug local` and
`/curator` will need.

`onlyArgs?: ReadonlySet<string>` is checked **before** the `allowArgs` branch,
matches whole strings (so `--previewish` and `--preview foo` are refused), and a
rejected argument falls through to the command's **own** refusal rather than the
generic "run it without arguments" — which would be actively wrong when bare is
the dangerous form.

Building it surfaced a latent defect: **`hermes-slash-exec.ts` sent
`decision.command` only, discarding arguments.** Allowing `/compress --preview`
without fixing that would have put **bare `/compress`** on the wire.
`SlashDecision` now carries `args` and the route sends `command + args`
(`hermes-slash-exec.ts:163`), pinned by two tests.

Second-order: the agent's catalog serves **no `sub` list** for `/compress`, so
the picker would have inserted `"/compress "` and dismissed, leaving the user
one Enter from a refusal. `slashArgumentCompletions` now feeds the policy's
permitted forms in as subcommands.

**Done for the 9, and it was needed in three different shapes** — this is the
trap this project has now hit three times:

- **No list served** — `/insights` (and `/compress`). The policy supplies one.
- **The wrong list served** — `/debug`, whose `sub` is `["nous","local"]` and
  where `nous` uploads to a public paste. The policy's list *replaces* the
  catalog's rather than extending it, so the upload is never one Enter away.
- **A whole mutating menu served** — `/reasoning`
  (`["none"…"ultra","show","hide","full","clamp","--global"]`), `/curator`
  (`["status","run","pause",…]`), `/memory`
  (`["pending","approve","reject","approval"]`) and `/suggestions`
  (`["accept","dismiss","catalog","clear"]`). All four are bare-only, so
  `isBareOnlySlashCommand` strips the lot.

**A third mechanism was needed after all.** `onlyArgs` covers `/debug local`
exactly as predicted, but `/insights [days]` fits neither it nor `allowArgs`:
the bare form must run *and* so must a number. `optionalCount { max, label,
completions }` is that shape and nothing more — `^[1-9]\d{0,3}$` bounded by
`max`, no pattern field, no grammar. It has to fail closed here because the
agent does not: `_show_insights`'s parse loop ends in `else: i += 1`, silently
skipping tokens it does not recognise, and `/insights --preview` was measured
returning the ordinary 30-day report. An ignored argument is indistinguishable
from an honoured one.

**And a `route` field.** `/learn` is in `_PENDING_INPUT_COMMANDS`, so
`slash.exec` would only forward it to `command.dispatch`; naming the route on
the entry sends it there directly and keeps the `{type:'send'}` answer shape
expected rather than sniffed out of a payload by `normalizeExecResult`.

**Caveat, recorded in `/compress --preview`'s `why`:** the preview counts
`session["history"]`, the snapshot taken when the binding opened, and nothing
reloads it for an `api_server` session. Exact on a fresh binding; can lag by
whatever was sent since, bounded by the 5-minute idle TTL in
`hermes-slash-session.ts`. Fixable in our code, not the agent's. `/history`
re-reads the DB per call and does not have this problem.

**Known defect in Phase 3's own code:** output is written under
`forcedSessionKey || resolvedSessionKey || …` but rendered by
`chat-screen.tsx:1333` as `<CommandOutputList sessionKey={activeCanonicalKey}>`.
In embedded chat these differ, so `exec` output goes to a key nothing renders.
Affects `/history`; not `/learn` or skills, which take the send path.

---

## 9. Things that would change the answer

| Change | Effect |
| --- | --- |
| ~~**Install a skill bundle**~~ | **Resolved in agent v0.19.16, absorbed 2026-08-13.** `commands.catalog` now emits `bundles` + `bundle_count` and mirrors the slugs into `pairs`/`canon`/`categories` under a "Bundles" bucket, gated by `_dispatchable_bundle_entries` so only a slug the dispatcher reaches is listed. SwitchUI marks those entries `bundle: true`, tiers them `prompt`, makes them runnable without an allowlist entry, and gives them their own picker facet. Installing a bundle now just makes the Bundles tab appear. `/bundles` shipped with it (§1) |
| **Fix the composer's reasoning picker** | If SwitchUI writes `agent.reasoning_effort` itself, `/reasoning` bare stays useful as a **readout**, but `/reasoning <level> --global` should *not* become a slash command (§A.3 rule) |
| **Configure a messaging platform** | `/handoff` is out partly because nothing is configured, so it can only fail. With Telegram or Discord live it becomes a legitimate `ConfirmDialog` candidate |
| **Toolsets screen lacks per-toolset descriptions / tool counts** | Flip `/toolsets` from drop to works (§5.2) |

---

## 10. Agent defects

### 10.1 Filed — all fixed in v0.19.13

Verified empirically (isolated `HERMES_HOME`, agent working tree untouched),
filed against `Interstellar-code/hermes-agent`. All 118 existing issues searched
first; none were duplicates.

| Issue | Defect |
| --- | --- |
| [#218](https://github.com/Interstellar-code/hermes-agent/issues/218) | `/compress --preview` / `--dry-run` perform a **real** compression — flags parsed as a focus topic. Also: `here [N]` silently degrades to full compression |
| [#219](https://github.com/Interstellar-code/hermes-agent/issues/219) | `/yolo` reports an approval-bypass change that never reaches the live session. Re-fixed after v0.19.12's attempt moved the state to the dashboard process rather than the gateway that enforces approvals |
| [#220](https://github.com/Interstellar-code/hermes-agent/issues/220) | Confirm-prompting commands (`/new`, `/update`, `/reload-mcp`) block on `input()` reading the JSON-RPC pipe |
| [#221](https://github.com/Interstellar-code/hermes-agent/issues/221) | `/handoff` 60s poll outlives the 45s worker timeout → `handoff_state='pending'` forever; plus a no-op fallback that misreports the cause |
| [#222](https://github.com/Interstellar-code/hermes-agent/issues/222) | Registry advertises behaviour implementations lack: `/prompt` (two meanings), `/indicator` (no handler), `/verbose` (`log` unreachable) |
| [#223](https://github.com/Interstellar-code/hermes-agent/issues/223) | `/personality` overwrites global `agent.system_prompt` with no backup |
| [#224](https://github.com/Interstellar-code/hermes-agent/issues/224) | `/debug` calls `sys.exit(1)` inside the worker, killing it and swallowing the error |
| [#225](https://github.com/Interstellar-code/hermes-agent/issues/225) | `/reasoning show\|hide\|full\|clamp` always persist to config.yaml; `--global` / `scope=session` parsed then ignored |
| [#229](https://github.com/Interstellar-code/hermes-agent/issues/229) | Profile-scoped `_get_db()` — **still open**; see §4 and §6.5 |

### 10.2 Found, not yet filed

1. **`/debug local` renders `toolsets: h, e, r, m, e, s, -, c, l, i, …`** — a
   string iterated as characters, in the support dump. Cosmetic but in the
   artefact a maintainer reads. Blocks nothing; `/debug local` still ships.
2. **A hard worker crash on `/hatch`** (17.3s) and a transient
   `5030 slash worker closed pipe` after `/paste`. Both **killed the bound
   session**; neither reproducible on retry.
3. **`/plan` has no `CommandDef`** ✅ — in `_PENDING_INPUT_COMMANDS`
   (`server.py:13129`) with no registry entry and no dispatch branch, so it
   4018s and is rescued only by the same-named skill (§5.5a).
4. **`/whoami`** — in `COMMAND_REGISTRY` with `cli_only=False`, so
   `commands.catalog` advertises it to every client, but the only handler is
   `GatewayRunner._handle_whoami_command`. Live: `Unknown command: /whoami`.
   Same family as #222.
5. **`/platforms` prints a false instruction** — `python cli.py --gateway`.
6. **`/reload-skills`' output lies** — it reported all 79 skills as "➕ Added"
   (the catalog rescans disk every call).
7. **Docs drift** in `website/docs/reference/slash-commands.md`: `/undo`
   documented as "remove the last exchange" when it takes `[N]` and
   *re-prompts*; `/curator archive` and `/skills publish` don't exist; `/update`
   listed messaging-only despite a CLI handler; `/topup`, `/subscription`,
   `/journey` undocumented. Sibling `tui.md:118` documents a `/details` command
   with no handler anywhere.

### 10.3 Refuted — deliberately not filed

- *`/subgoal` unreachable over RPC.* Absent from `command.dispatch` (falls to
  4018 at `server.py:13619`) but reaches the worker via `slash.exec`, and
  `save_goal`/`load_goal` persist through SessionDB. It works.
- *`/debug` `yes=True` is a privacy defect.* Over `slash.exec` the caller is
  still the user typing `/debug`, and `_PRIVACY_NOTICE` is printed — same
  consent model as the CLI. No path lets a non-user actor reach it.
- *The `#23185` guard covers `slash.exec`.* It does **not**: the guard is
  `if self._app and not in_main_thread` (`cli.py:7627`), and in the worker
  `_app` is `None` *and* handlers run on the main thread, so both halves fail.
  Proven: `/version` returned in 0.1s; `/new` and `/update` produced nothing
  after 30s/25s, wedged in `input()`.
- *`/verbose` is fully broken.* Only partly — `gateway/slash_commands.py:3240`
  does cycle all five modes including `log`; only `cli.py:9616` and
  `server.py:11490` cycle four.
- *`/personality`'s tui_gateway half writes config.*
  `_apply_personality_to_session` writes no config and explicitly preserves
  history (`history_reset` is always `False`). The real defect is the CLI
  handler's global `save_config_value`, which fires over RPC (#223).

---

## 11. Standing traps

| Trap | Detail |
| --- | --- |
| **`/stop` is a name collision** | SwitchUI's aborts the current stream; the agent's kills dashboard-spawned processes and does *not* stop the turn. **Decision: rename SwitchUI's to `/interrupt`** — needs a transitional alias and a release note |
| **`/memory` is a false friend** | Hermes = write-approval queue; SwitchUI's screen = browse/graph/wiki. Do **not** deep-link. The correct home for the agent's is a "Pending writes" tab — and the collision is why it passes information-gain (§1) |
| **`/update` restarts the agent** | Kills SSE mid-stream. No update-aware reconnect path exists; suppress the "agent down" toast for the update window |
| **Server-side `webbrowser.open`** | `/subscription` and `/topup` open a browser **on the agent host**. Take the URL from `subscription.state`/`billing.state` and render an anchor |
| **Interactive over RPC** | `$EDITOR`, `prompt_toolkit` pickers and bare `input()` cannot work: `/prompt`, `/hatch` (bare), `/curator prune\|rollback`, `/kanban template delete`, bare `/resume`, `/journey delete\|edit`, `/new` confirm |
| **Never-returning** | `/kanban tail` and `/kanban watch` are `while True:` loops |
| **Creates real scheduled work** | `/suggestions accept` and `/blueprint <name> slot=…` create cron jobs that will fire. Bare `/suggestions` is safe and ships; `accept` does not |
| **Skills don't hot-reload** | `/skills install\|uninstall` don't reload the live agent's skill map — needs a follow-up `/reload-skills`, whose own output lies (§10.2) |
| **`/copy` writes OSC52** | The agent's implementation emits a terminal escape. Use `navigator.clipboard` client-side instead |
| **Billing renders empty** | `billing.*` / `subscription.*` RPCs are ready and `portal_url` solves the remote-browser problem, but this install is `provider: custom` (`~/.hermes/config.yaml:2`) and logged out of Nous — every field renders empty. **Do not build** while that holds |
| **`/blueprint`'s `agent_seed` is dropped** | On every non-REPL path. Use the cron REST instead |
| **`/rollback` needs a gate** | `rollback.list/diff/restore` are structured and ready, but gate on `checkpoints.enabled` (default **off**) or every call says "not enabled". `/backups` is a decoy — config zips, unrelated |

---

## 12. Client-side wins that are not slash commands

Recorded here because three of them **retire** commands, which is why §5 can
refuse those commands on information-gain grounds.

| What | Why | Path |
| --- | --- | --- |
| **Group the ~78 skills by category** | `/api/skills` — which SwitchUI already calls — returns **78 rows, 15 categories**, provenance and usage. 77/79 join by slug. Biggest usability win available | client-only |
| **Context breakdown in the ring popover** | The only genuinely *new* information found. `session.context_breakdown` → `{system_prompt 3507, tool_definitions 28201, conversation 212139, …}`. SwitchUI has a dead `staticTokens` slot already | `session.context_breakdown` |
| **Feed Toolsets from `tools.list`** | Sessionless, **14ms**, 63 toolsets with description, `tool_count`, `enabled`, resolved `tools[]` — the four things the screen lacked. **Retires `/tools` and `/toolsets`** | `tools.list` |
| **Real usage numbers** | `/api/session-status` already has them; resumed agents structurally report `0`. **Retires `/usage`** | existing route |

Phase 5 remains open: `commands-store.ts` and Hermes' `quick_commands` (in
`config.yaml`, typed `exec`/`alias`/`send`) are two independent user-command
systems, mutually invisible. `commands.catalog` already surfaces
`quick_commands` under a `"User commands"` category, so the overlap is
user-visible today.

---

## Appendix A — what we believed, and why it was wrong

Kept short deliberately. Its only job is to stop someone re-deriving a wrong
answer. The running commentary that produced these has been deleted.

### A.1 Wrong premises about the transport

| Believed | Reality |
| --- | --- |
| `web_server.py` is the :8642 gateway, so the RPC surface is unreachable | `web_server.py` is the **dashboard on :9119**, and it is exactly where `/api/ws` is mounted (`:18075`). The transport exists |
| SwitchUI's chat path is dispatched by `gateway/run.py`, so non-`cli_only` commands proxy today | Refuted in §6.2 — nothing proxies for free. `/learn`, `/bundles`, `/memory` and `/suggestions` work only because each was allowlisted and measured; `/blueprint` still does not |
| `cli_only` gates execution | It only excludes a command from `GATEWAY_KNOWN_COMMANDS` (§6.1) |
| `session.undo` is the undo RPC | It pops in-memory history only. `command.dispatch{name:'undo'}` is the real one (§7.3) |
| The `_SlashWorker` subprocess constraint applies to everything | `_PENDING_INPUT_COMMANDS` short-circuits 11 commands into in-process dispatch (§5.5) |
| `commands.catalog` merges plugin commands and bundles | It merged neither when this was written, which was `/bundles`' blocker. **Half-true now:** agent v0.19.16 folds in `scan_bundles()` (§6.1) and `/bundles` shipped; plugin commands are still absent |

### A.2 The three "genuinely missing capabilities" — all three wrong

The original executive summary named `/undo`, `/compress` and billing as the
only gaps justifying new surface. None survived: `/undo` was **dropped by
product decision** (§7.3), `/compress --preview` **shipped** and bare
`/compress` is a backend ask (#4), and billing is **do not build** while this
install is `provider: custom` and logged out of Nous (§11).

### A.3 The redundancy correction, and its overcorrection

Raised by the user after using it, and correct: SwitchUI had **three
overlapping navigation surfaces** — the sidebar, the ⌘K palette, and the slash
menu's deep-link tier. Roughly **16 slash commands were a third way to do what
two surfaces already did**, and "show all" listed **129 commands of which 117
could not run**. That is noise, not discoverability.

**The rule that came out of it, and still holds:** "SwitchUI has a better
surface for this" is a reason to **not have the command**, not a reason to
deep-link it. A slash command should not duplicate a visible affordance.

**The overcorrection:** the rule was then applied as *"does a screen exist?"*,
which is what wrongly excluded `/insights`, `/version`, `/profile` and
`/curator`. Q3 (§2) is the repaired form: **information gain**, not screen
existence.

A second miss in the same pass: "remove the SwitchUI commands" meant the whole
SwitchUI *source*, keeping the user's custom commands and the agent's core
commands. The first attempt cut the agent catalog and kept ten SwitchUI
commands — the opposite.

### A.4 Verdicts that were right for the wrong reason

Re-deriving these from the old reasons produces the wrong answer, so the old
reasons are recorded as **dead**:

| Command | Dead reason | Live reason |
| --- | --- | --- |
| `/status` `/usage` | "the dashboard reads a different database" | Structural: a resumed-never-run session (§5.2). Purged from every refusal string, with a test that fails if "different database" / "stale copy" / "messages behind" reappears |
| `/compress` bare | "irreversible" | Broken session binding (§5.2) |
| `/stop` | "kills every process on the host" | Reaches only dashboard-spawned processes (§5.2) |
| `/queue` | "acts on the dashboard's agent" | Pure echo (§5.2) |
| `/personality` | "clobbers global `agent.system_prompt`" (#223, fixed) | api_server never resolves `personality` (§5.2) |
| `/paste` | "terminal-only" | Cross-host clipboard read, 6.04s (§5.2) |
| `/insights` | "`insights.get` is a stub, 8 sessions vs 24" | **Verdict reversed.** The slash command never uses that RPC (§1) |
| `/debug` | "uploads to a public paste" | True of bare `/debug`; **`local` never uploads** and is now included (§5.4) |

### A.5 Two architecture options, resolved

Option 1 (a WebSocket JSON-RPC client to the dashboard, fork-local) was built —
`src/server/hermes-rpc.ts`, Phase 2. Option 2 (slash pre-dispatch inside
`api_server`, upstream-eligible) was **not** built, and the backend asks in §3
replace it: they are smaller, more targeted, and each one unblocks a named
command rather than adding a general dispatcher that still could not provide
the structured behaviour the best commands need.

### A.6 Orphaned code, wired up (Phase 1)

Every item was *also* broken, not merely unwired.

| What | What was actually wrong | Outcome |
| --- | --- | --- |
| `forkSession()` | Broken **two** independent ways, invisible to tests that stub `fetch` and assert only on URLs: (1) `claudePost(path, undefined, …)` sent **no body**, and `_handle_fork_session` calls `_read_json_body()` unconditionally → every real fork returned **400**; (2) the unscoped path takes a dashboard shortcut, but **the dashboard has no fork route at all** | Fixed body + 404/405 fallthrough to the gateway. Live: **HTTP 200**, child carries `parent_session_id` |
| `usage-meter` components | Would have **shipped blank**: `/api/session-status` is keyed on `?sessionKey=` and answers a bare request with the `sessionKey:'new'` payload — all zeros. Both meters fetched it with no query string | Fixed via a shared `sessionStatusUrl()` helper + `sessionKey` prop |
| `/api/provider-usage` | Route was correct; but provider lookup consulted only `cfg.providers`, so a config declaring the endpoint inline under `model:` matched nothing — a real `model.base_url: https://openrouter.ai/api/v1` was unreachable | Fixed; now has a live consumer |
| `steerAgent()` | **Dead code behind dead code** — `BASE_URL` is `window.location.origin`, so it targeted SwitchUI's own server where no route exists; its only caller `agent-chat-panel.tsx:191` is itself in a component with **zero import sites** | Removed, with a tombstone saying not to reimplement as REST — real steering needs backend ask #2 |

**Bonus:** mounting `UsageMeter` revived a genuinely dead command —
`search-modal.tsx:161` emits `SEARCH_MODAL_EVENTS.OPEN_USAGE` and `UsageMeter`
is its only listener, so the palette's "Usage" entry did nothing at all.

**Deliberately left:** `usage-meter-compact.tsx` fixed and exported but
unmounted (no path to the details modal; would show the same rate-limit windows
twice). `AgentChatPanel` (~365 lines, orphaned) left as a deletion candidate —
`killAgentSession()` and `setDefaultModel()` in the same file also target
non-existent routes with no callers.
