/**
 * Server-side execution policy for Hermes agent slash commands — the allowlist.
 *
 * `docs/plans/hermes-slash-commands-in-switchui.md` — §1 (the list), §2 (the
 * decision rule), §4 (the `--isolated` caveat and its exact count), §5 (the
 * per-command reference), §8 (the argument mechanics). Section numbers are
 * against the restructured document; the pre-restructure numbering this file
 * used to cite no longer exists.
 *
 * Re-verified end to end against **hermes-agent v0.19.13** (the *installed*
 * copy at `~/.hermes/hermes-agent`, which is what runs — the development
 * checkout is older and describes none of this), live over the dashboard's
 * `/api/ws` on 2026-08-12. Two things changed since the previous pass and both
 * invalidated the measurements that had shrunk this list to one entry:
 *
 *   1. **The dashboard now runs in the right profile.** Its systemd unit is
 *      `hermes dashboard --no-open --skip-build --isolated`. Without
 *      `--isolated` a dashboard launched under a named profile re-execs itself
 *      as `-p default` (`hermes_cli/main.py`), and `_get_db()` follows the
 *      *process* profile — so the RPCs read `~/.hermes/state.db` while the
 *      gateway wrote `~/.hermes/profiles/hermes-switch/state.db`.
 *   2. **Agent v0.19.13**, on top of v0.19.12's fixes for all nine issues
 *      SwitchUI filed (#218–#226).
 *
 * ── The two-process split, restated correctly ─────────────────────────────
 * SwitchUI still has a foot in two agent processes. They still do not share
 * memory. They now **do** share a database:
 *
 *   • **the gateway** (`hermes gateway run`, :8642, profile `hermes-switch`)
 *     serves SwitchUI's chat. Turns run here. It persists to
 *     `~/.hermes/profiles/hermes-switch/state.db`.
 *   • **the dashboard** (:9119) hosts every RPC in this file — `slash.exec`,
 *     `command.dispatch`, `session.*`. With `--isolated` its `_get_db()`
 *     (a bare `SessionDB()` cached in a module global, `tui_gateway/server.py`
 *     ~1037) opens that same file.
 *
 * Measured on the user's live chat `92f9f4fb…` on 2026-08-12: the gateway's DB
 * holds **373 active messages**; the old default-profile DB holds **334**, last
 * written 2026-08-11 23:43. `/history` over `slash.exec` now renders the
 * transcript ending in the gateway DB's newest row (2026-08-12 00:55:54), so
 * the reads land in the right file. `/proc/<dashboard pid>/fd` confirms it:
 * every path the dashboard has open is under `profiles/hermes-switch/`.
 *
 * **The underlying agent bug is still open** (Interstellar-code/hermes-agent
 * #229): `_get_db()` is process-global and ignores the `profile_home` that
 * `session.resume` accepts. `--isolated` only makes the *process* profile
 * correct. So the two entries below that read session state work **because of
 * a local systemd setting**, and a default install still reads the wrong file.
 * Each says so in its `why`.
 *
 * ── What the DB fix did NOT repair ────────────────────────────────────────
 * ── Scope of this file as of the 15-command pass ─────────────────────────
 * The allowlist went from 3 entries to 12 on 2026-08-12, against the same
 * installed v0.19.13 and the same `--isolated` dashboard. Every one of the 9
 * additions was executed live against a **throwaway** tui_gateway session
 * (`session.create` → run → `session.close`) rather than the user's chat, and
 * every `why` below quotes what came back. The refused *forms* were not
 * executed — `/debug nous` uploads to a public paste, `/suggestions accept`
 * creates a real cron job, `/memory approve` writes MEMORY.md, `/curator run`
 * does a synchronous LLM pass — so those are argued from installed source and
 * say so.
 *
 * `/bundles` became the 13th on 2026-08-13 against installed **v0.19.16**,
 * measured the same way. It was never unsafe; it was held back because the
 * bundle slugs it lists were absent from `commands.catalog`, so it would have
 * advertised a list SwitchUI could not dispatch. v0.19.16 emits them, which
 * retired the condition — see the entry, and the bundle section at the foot of
 * this header.
 *
 * `/goal` and `/subgoal` became the 14th and 15th the same day, and they are
 * the first two additions unblocked by the AGENT rather than by this file.
 * Both were excluded because a goal set from the web was durable and never
 * evaluated: api_server had no post-turn hook (hermes-agent#230, the doc's
 * backend ask #1). v0.19.14 added `_evaluate_goal_after_turn` (installed
 * `gateway/platforms/api_server.py:3544`), called from the streaming loop
 * SwitchUI sends over, and a live three-turn continuation was measured on a
 * throwaway session on 2026-08-13. They are also the first two entries here
 * that make the agent take turns on its own — see `/goal`'s entry for the
 * budget, the brakes, and why the brakes are allowed.
 *
 * The other family of wrongness is structural and survives untouched: the
 * dashboard's session object for a SwitchUI chat **never runs a turn**. Its
 * usage counters are therefore zero, its `running` flag is always false, and
 * `_cached_system_prompt` is never built — regardless of which database it
 * reads. Measured: `/status` and `/usage` report `Tokens: 0` / every counter 0
 * on a session whose row in the very database they are reading records
 * **32,029,915 input and 72,631 output tokens over 268 API calls**. That is not
 * a stale read. That is a command reading the wrong object.
 *
 * `Last Activity` is a third thing again: `session.status` looks for
 * `updated_at` / `last_updated_at` / `last_activity_at` on the session row and
 * the `sessions` schema has **no such column**, so it always falls back to
 * `Created`. Nothing about profiles or processes can fix that one.
 *
 * ── The three internal routes, as of v0.19.13 ─────────────────────────────
 *   1. **live path** — `_live_slash_command_output` (`server.py` ~14891) is
 *      consulted first and answers `_LIVE_SESSION_DIRECT_COMMANDS`
 *      (`clear compose compress effort history models prompt rename status
 *      systemprompt usage yolo`, plus bare `model`) straight off the
 *      dashboard's in-memory session. 1–35ms. Read-only *except* `compress`
 *      and `yolo`, which are genuinely mutating on this path.
 *   2. **RPC-routed** — `_RPC_ROUTED_COMMANDS = {handoff}` goes to
 *      `handoff.request` instead of the worker (#221's fix), and
 *      `_PENDING_INPUT_COMMANDS` (`retry queue q steer plan goal moa undo learn
 *      compress compact`) goes to `command.dispatch`, in-process.
 *   3. **worker path** — everything else runs in a *separate* `HermesCLI`
 *      subprocess (`tui_gateway/slash_worker.py`) with its own state,
 *      0.2–5.7s. Its side effects are mirrored back onto the **dashboard's**
 *      session for six commands only (`_mirror_slash_side_effects`,
 *      `server.py` ~14962): `model personality compress fast reload-mcp stop`.
 *      (The previous header said seven and included `prompt`; the installed
 *      source has no `prompt` branch.) The mirror target is still the
 *      dashboard session, never the gateway agent that serves this chat.
 *
 * So the rule is unchanged: **fail closed**. A command runs only if it is
 * named here, and only in a form named here.
 *
 * ── The argument shapes, and why there are so few ─────────────────────────
 * Arguments are how a read-only command turns into a mutating one
 * (`/tools enable <name>`, `/model <name>`, `/yolo on`, `/memory approve <id>`,
 * `/suggestions accept 1`, `/reasoning high`), so the default is `allowArgs:
 * false` and the bare form only. Ten of the fifteen entries are exactly that.
 *
 * The exceptions each exist because a real command needs one, and no more
 * general mechanism is offered — a general argument grammar here would be
 * a way to accidentally permit a mutation nobody reviewed.
 *
 *   1. `onlyArgs` — the bare form is **refused** and an explicit set of whole
 *      argument strings is permitted. Two holders:
 *        • `/compress`, where `--preview`/`--dry-run` are read-only (#218's
 *          fix: `_classify_compress_args` reuses `hermes_cli.partial_compress`,
 *          returns a `CompressNotice`, and `_compress_session_history` returns
 *          before `_compress_context`) while bare `/compress` compresses and
 *          rotates the session.
 *        • `/debug`, where `local` is the only form that does not upload:
 *          `_handle_debug_command` (`hermes_cli/cli_commands_mixin.py` ~2810)
 *          computes `local = "local" in words` then `nous = "nous" in words
 *          and not local`, so `local` wins and `run_debug_share` renders to
 *          stdout. Bare `/debug` and `/debug nous` both upload.
 *   2. `optionalCount` — the bare form **and** a single whole number run,
 *      nothing else. One holder, `/insights [days]`. See its entry for why a
 *      literal set could not express it and why it has to fail closed.
 *   3. `allowArgs: true` — free-form arguments pass straight through. Three
 *      holders, and the test they share is that the argument IS the payload
 *      rather than a switch selecting a behaviour: `/learn`, whose arguments
 *      are the thing being learned from; `/goal`, whose argument is the
 *      objective itself; `/subgoal`, whose argument is a criterion to add.
 *      `/learn` returns a prompt to send and mutates nothing. The other two DO
 *      mutate — they are the exception to the rule at the top of this file,
 *      and they earn it because the state they write is the state the gateway
 *      reads (not a throwaway worker's), and because the words that STOP a
 *      running goal are arguments too. See their entries.
 *   4. `phantomArgs` — subtracts from a free grammar. One holder, `/goal`,
 *      refusing the four subcommands the agent's own usage hint advertises
 *      with no branch behind them (`show`, `draft`, `wait`, `unwait`), each of
 *      which would silently become the goal text and start an agent loop.
 *
 * `onlyArgs` and `optionalCount` are both checked before the `allowArgs`
 * branch in `evaluateSlashCommand`, `isBareOnlySlashCommand` returns false for
 * either so the catalog keeps its completions, and `slashArgumentCompletions`
 * feeds the picker the permitted forms so selecting the command leads to an
 * allowed one instead of a refusal. `slashUsageHint` (foot of this file) reads
 * the same four fields a fourth time, to correct the `(usage: …)` string the
 * agent puts in every description — the one surface that used to advertise
 * these commands' refused forms in full. For `onlyArgs` a rejected argument falls
 * through to that command's `SLASH_REFUSALS` entry, so the user is told what
 * bare would do rather than a generic "no arguments" line — which would be
 * actively wrong for `/compress` and `/debug`, where bare is the dangerous
 * form.
 *
 * ── Two routes, not one ───────────────────────────────────────────────────
 * Twelve entries go out over `slash.exec`. Three go over `command.dispatch`,
 * because `slash.exec` would only hand them straight back there anyway:
 * `learn` and `goal` are in `_PENDING_INPUT_COMMANDS` (`server.py:13300`) and
 * `subgoal` is in the sibling `_DISPATCH_ROUTED_COMMANDS` (`:13336`), and
 * `slash.exec` re-dispatches **both** sets in-process (`server.py:15582`) —
 * verified live, `slash.exec /goal` and `slash.exec /subgoal` answer exactly
 * what `command.dispatch` does. Naming the route in the entry keeps the answer
 * shape honest — `command.dispatch` returns `{type:'send', message}` for
 * `/learn` and for `/goal <text>`, and `{type:'exec', output}` for every other
 * goal form and every `/subgoal` form — instead of relying on
 * `normalizeExecResult` sniffing a `type` field out of a payload it did not
 * expect.
 *
 * `subgoal` having its own set is not cosmetic: the comment above it
 * (`server.py:13327`) explains that the slash worker is a separate process
 * whose `GoalState` is stale, and `save_goal()` rewrites the whole blob — so a
 * worker-side write would clobber the `turns_used`/`status`/`last_verdict` the
 * serving process's judge had just written. The agent is refusing the same
 * class of bug this file's `proxy`-is-read-only-only rule refuses.
 *
 * ── `cli_only` is not an execution gate ───────────────────────────────────
 * `commands.catalog` filters `_TUI_HIDDEN` and `cmd.gateway_only` but **not**
 * `cmd.cli_only`, so all the `cli_only` commands still arrive in the payload
 * (156 pairs + 78 skills measured today). That is not the bug it looks like:
 * `cli_only` gates the *messaging gateway*, not `slash.exec`. `/history` is
 * `cli_only` and is answered perfectly by the live path; `/prompt` is
 * `cli_only` and answers with a helpful sentence. Dropping the class wholesale
 * would therefore be wrong. The blast radius is already contained the right
 * way — `runnable` is computed from this allowlist and `agentCatalogEntries`
 * (`slash-command-menu.tsx`) skips everything with `runnable: false`. What was
 * missing was accuracy, not filtering, so the ones a user might still type
 * (`/prompt`, `/indicator`, `/systemprompt`, `/save`, `/handoff`, `/tools`)
 * have per-command refusals below.
 *
 * `gateway_only` needs nothing: `/whoami` is gone from the catalog payload
 * (re-checked today — absent from `pairs`), so the "advertised but
 * unimplemented" case from §10.5 is closed.
 *
 * ── Skill commands are the other half of the surface ──────────────────────
 * `commands.catalog` appends the skill commands to `pairs` without adding them
 * to any category (`skill_count: 78` today). They are not agent-state
 * mutations at all: `command.dispatch` answers `{type:'skill', message}` and
 * the message goes down the normal send path. They are therefore
 * dispatch-eligible without being on this allowlist — see
 * `evaluateSlashCommand`'s `skillCommands` option. They are unaffected by
 * everything above, and remain the bulk of what the picker offers.
 *
 * ── Bundle slugs are a third set, deliberately not folded into the second ─
 * Agent v0.19.16 added a top-level `bundles` list to `commands.catalog`, and
 * every slug on it is invocable as `/<slug>`. Like skills they are prompt text
 * rather than agent state — `command.dispatch` answers `{type:'send',
 * message, notice}` built by `build_bundle_invocation_message`, whose
 * `user_instruction` parameter interpolates the caller's arguments verbatim
 * into a "User instruction:" line (read from installed
 * `agent/skill_bundles.py`). So they take the same route, the same argument
 * treatment and the same trust level as skills, and like skills they are
 * dispatch-eligible without an allowlist entry each — that is the point, since
 * a slug appears and disappears when a user creates or deletes a bundle file
 * and no static table here could track it.
 *
 * They get their **own** option (`bundleCommands`) rather than joining
 * `skillCommands`, for three reasons that are all about not lying elsewhere:
 *
 *   1. The two sets are *derived differently and cannot be conflated at the
 *      source.* `skillCommands` is derived from "uncategorized in
 *      `commands.catalog`"; bundles arrive **categorized**, under the agent's
 *      own "Bundles" bucket. Marking a bundle `skill: true` to reuse the set
 *      would mean writing a falsehood into the catalog entry.
 *   2. That same `skill` flag drives three user-visible behaviours in the
 *      picker — the Skills facet, the `/api/skills` slug join that gives skills
 *      their category headings, and the "Yours" provenance badge. A bundle has
 *      no `/api/skills` row, so folding it in would file every bundle in the
 *      fail-soft `Skills` bucket at the bottom of the Skills tab, under a tab
 *      whose count would then be wrong about what it contains.
 *   3. The answer shapes differ (`{type:'send'}` vs `{type:'skill'}`), and
 *      `hermes-slash-exec.ts` normalizes them as distinct union members.
 *
 * The branch order in `evaluateSlashCommand` mirrors the agent's dispatcher,
 * which checks bundles before skills (`tui_gateway/server.py` ~13728 vs
 * ~13756). Today the two branches produce an identical decision, so the order
 * is unobservable; it is written this way so it stays right if that changes.
 *
 * ── The version floor ─────────────────────────────────────────────────────
 * Everything above was measured against a *specific* agent build, and nothing
 * in the capability layer checks which build is running. So there is a floor:
 * `MIN_AGENT_VERSION_FOR_SLASH_EXEC`. Below it this allowlist is empty and
 * skill/bundle dispatch is untouched. See that constant for the argument.
 */

import { meetsAgentVersionFloor } from './agent-version'

/** Which internal route inside the agent answers an allowed command, and
 *  therefore roughly how long it takes. Diagnostic only.
 *
 *  `live`   — answered in the dashboard process, off `_sessions[sid]` or by an
 *             in-process `command.dispatch` branch. 2–40ms.
 *  `worker` — answered by the `_SlashWorker` subprocess, which has its own
 *             `HermesCLI` and reads profile-scoped disk. 9ms warm to ~2s cold. */
export type SlashExecMode = 'live' | 'worker'

/** Which RPC carries it. `exec` → `slash.exec`; `dispatch` → `command.dispatch`. */
export type SlashExecRoute = 'exec' | 'dispatch'

export type SlashExecAllowEntry = {
  mode: SlashExecMode
  /**
   * Which RPC carries it. Defaults to `exec`. Only `/learn` sets `dispatch`,
   * because `command.dispatch` is where `slash.exec` would forward it anyway
   * and its answer is a `{type:'send'}` union member rather than `{output}`.
   */
  route?: SlashExecRoute
  /**
   * Free-form arguments pass through untouched. False for twelve of the
   * fifteen entries, because arguments are how a read-only command becomes a
   * mutating one. The three exceptions are the ones whose argument IS the
   * payload — `/learn` (prompt text), `/goal` (the objective) and `/subgoal`
   * (a criterion).
   */
  allowArgs: boolean
  /**
   * Exact argument strings that may run, when the *bare* form may not.
   *
   * Compared case-insensitively against the whole argument string, so only the
   * literal forms listed here pass — `--preview` yes, `--preview foo` no,
   * `local` yes, `local nous` no. Anything else falls through to this
   * command's `SLASH_REFUSALS` reason.
   */
  onlyArgs?: ReadonlySet<string>
  /**
   * The bare form runs, and so does a single whole number in `[1, max]`.
   *
   * Deliberately not a pattern field and deliberately not a grammar: this is
   * `/insights [days]` and nothing else. `[1-9]\d{0,3}` bounded by `max` is
   * the entire vocabulary, so `3` runs and `0`, `007`, `+3`, `3.0`, `3 4`,
   * `--preview` and `; rm -rf` are all refused before the wire.
   *
   * Mutually exclusive with `onlyArgs` (asserted in the tests) — one of them
   * refuses the bare form and the other permits it, so setting both would be
   * a contradiction rather than a combination.
   */
  optionalCount?: {
    /** Inclusive upper bound. Above it, refused. */
    max: number
    /** What the number counts, quoted back in the refusal. */
    label: string
    /** Concrete values the picker offers. Every one must satisfy the rule. */
    completions: ReadonlyArray<string>
  }
  /**
   * What to tell the user when the bare-only rule rejects an argument.
   *
   * The generic line — "it would change settings in a throwaway copy of your
   * agent and report success, leaving the real one untouched" — is true of
   * `/reasoning <level>` and of the mirror-bound commands it was written for,
   * and **false** of several entries here: `/memory approve` writes the real
   * on-disk memory store through `load_on_disk_store()`, `/suggestions accept`
   * creates a cron job that really fires, and `/curator prune` does not
   * "report success" at all — it wedges the worker on `input()`. A refusal
   * that understates the risk is the same defect as one citing a closed issue,
   * so those entries say what actually happens.
   */
  argsRefusal?: string
  /**
   * First words that are refused even though `allowArgs` is true.
   *
   * The one holder is `/goal`, and it exists because of a defect in the agent
   * rather than a policy preference. Its registry `args_hint`
   * (`hermes_cli/commands.py:116`) advertises
   * `[text | draft <text> | show | pause | resume | clear | status | wait <pid>
   * | unwait]`, and `commands.catalog` serves that hint to the picker — but the
   * `command.dispatch` branch (`tui_gateway/server.py:13915`) implements only
   * bare/`status`/`pause`/`resume`/`clear`/`stop`/`done`. Everything else falls
   * through to `mgr.set(arg)`, which SETS THE GOAL to the literal word and
   * answers `{type:'send'}` — a turn is submitted and a multi-turn agent loop
   * starts. Measured live 2026-08-13: `/goal show` answered "⊙ Goal set
   * (20-turn budget): show", and `/goal wait 12345` the same with "wait 12345".
   *
   * So this is the `/insights` failure mode with teeth: the UI's own usage hint
   * walks the user into a mutation that looks like success and spends real
   * tokens. Matched against the FIRST token, lowercased, because the phantom
   * forms take arguments of their own (`draft <text>`, `wait <pid>`).
   */
  phantomArgs?: {
    /** Lowercase first tokens to refuse. */
    words: ReadonlySet<string>
    /**
     * What the user is told instead. It has to name the forms that DO work:
     * the whole failure being corrected is a hint that lists forms which do
     * not, so a refusal that only says "no" repeats the defect.
     */
    refusal: string
  }
  /** Why this one is safe. Surfaced in no UI; it exists to be reviewed. */
  why: string
}

/**
 * The only non-literal argument this file understands: a whole number with no
 * leading zero and at most four digits. ASCII only — JS `\d` is not Unicode
 * aware without the `u` flag, which matters because the agent's own parse is
 * `str.isdigit()`, which accepts Devanagari and Arabic-Indic digits.
 */
const COUNT_ARGUMENT = /^[1-9][0-9]{0,3}$/

/**
 * The agent build every entry below was measured against, and the floor under
 * which **none** of them may run.
 *
 * ── Why there is a floor at all ───────────────────────────────────────────
 * Nothing in the capability layer checks a version. `probeAgentCommands()`
 * sets `agentCommands: true` on "dashboard reachable + catalog non-empty",
 * which is a liveness test, not a compatibility one. Every measurement in this
 * file was taken against v0.19.13–v0.19.16, and against an older agent the
 * same allowlist is actively wrong:
 *
 *   • **below 0.19.12** — `/compress --preview` performs a **real,
 *     irreversible compression** (hermes-agent#218; the `_classify_compress_args`
 *     early return that makes `--preview` read-only does not exist yet). A
 *     user asks for a preview and loses the conversation. This is the one that
 *     forces the floor to exist.
 *   • **below 0.19.14** — api_server has no post-turn hook, so `/goal` stores
 *     an objective that is never evaluated: the command reports success, the
 *     goal sits in `state.db`, and no turn ever runs against it
 *     (hermes-agent#230). Silent, and indistinguishable from a working goal
 *     the judge happens to be satisfied with.
 *   • **below 0.19.15** — `_get_db()` is not profile-scoped (#229), so
 *     `/history`, `/profile`, `/insights`, `/memory` and the rest read a
 *     different profile's data and report it as this chat's.
 *   • **below 0.19.16** — `commands.catalog` emits no bundle slugs, so
 *     `/bundles` lists things the dispatcher cannot reach. That is precisely
 *     the condition `/bundles` was held back on, so running it below the floor
 *     would un-hold it behind our own backs.
 *
 * ── Why one blunt floor instead of a minimum per entry ────────────────────
 * A per-command floor is more precise and has fifteen places to be wrong,
 * each needing its own measurement against an agent nobody here runs. One
 * number, set to the newest build the allowlist was measured against, is
 * checkable by reading this line. Raise it when the measurements are redone.
 *
 * ── What the floor deliberately does NOT gate ─────────────────────────────
 * Skill commands and bundle slugs. They are prompt injection over
 * `command.dispatch` — `{type:'skill'|'send', message}` down the normal send
 * path — not agent-state mutation, and they have worked on every build in this
 * range. They are also ~78 of the ~90 things in the picker, so failing them
 * closed would gut the feature to punish a risk that is confined to the
 * fifteen registry commands. Below the floor the exec allowlist is empty and
 * the skills keep working; see `isSlashCommandRunnable` and the `allowed`
 * branch of `evaluateSlashCommand`.
 */
export const MIN_AGENT_VERSION_FOR_SLASH_EXEC = '0.19.16'

/**
 * What the user is told when the floor refuses a command.
 *
 * It **names both versions**. "Not available" is useless — it does not say
 * whether the command is gone, broken, or merely older than this build
 * expects. Naming the required version and the one actually running turns the
 * refusal into an instruction.
 */
export function agentVersionFloorRefusal(
  command: string,
  agentVersion: string | null | undefined,
): string {
  const running =
    typeof agentVersion === 'string' && agentVersion.trim()
      ? `this one reports ${agentVersion.trim()}`
      : 'this one did not report a version, so SwitchUI has to assume it is older'
  return (
    `${command} needs hermes-agent ${MIN_AGENT_VERSION_FOR_SLASH_EXEC} or newer — ${running}. ` +
    `Every agent command SwitchUI runs was measured against ${MIN_AGENT_VERSION_FOR_SLASH_EXEC}, and on ` +
    `older builds they misbehave in ways that look like success: below 0.19.15 they read ` +
    `another profile's data, and below 0.19.12 \`/compress --preview\` really compresses. ` +
    `Skill commands are unaffected and still work. Update the agent from Settings → Updates.`
  )
}

/**
 * The allowlist.
 *
 * Fifteen entries, each with a measurement taken against the *installed*
 * agent with the dashboard running `--isolated` — twelve on 2026-08-12 against
 * v0.19.13, and `/bundles`, `/goal` and `/subgoal` on 2026-08-13 against
 * v0.19.16. Nothing here was admitted on the strength of a changelog or a doc:
 * every entry was executed and its answer read.
 *
 * **Twelve of the fifteen carry the `--isolated` caveat** — `/history`,
 * `/compress`, `/insights`, `/curator`, `/debug`, `/reasoning`, `/profile`,
 * `/memory`, `/suggestions` and `/bundles` all read profile-scoped disk through
 * a process-global `_get_db()`/`get_hermes_home()`, and `/goal`/`/subgoal`
 * write goal state through the same process-global `get_hermes_home()` while a
 * DIFFERENT process reads it. The other three do not: `/help` renders
 * `COMMAND_REGISTRY`, `/version` reports the *shared* install (`PROJECT_ROOT`
 * is `~/.hermes/hermes-agent`, outside every profile), and `/learn` builds a
 * prompt string in process. `hermes-slash-policy.test.ts` pins that 12/3 split
 * as an exact count, so a new entry cannot be added without someone deciding
 * which side it falls on.
 *
 * Everything else stayed refused, most of it because "the database is right
 * now" was never why it was wrong.
 */
export const SLASH_EXEC_ALLOWLIST: Readonly<
  Record<string, SlashExecAllowEntry>
> = {
  '/help': {
    mode: 'worker',
    allowArgs: false,
    why:
      'Read-only and session-independent — it renders COMMAND_REGISTRY and ' +
      'touches no session state, so neither the profile split nor the ' +
      'never-ran-a-turn problem can make it wrong. Re-measured 212ms on a ' +
      "warm worker (566ms previously). Shadowed in practice by SwitchUI's " +
      'own /help handler (which opens the picker), so it should never arrive ' +
      'here — allowed anyway because the allowlist is the control, not the ' +
      'routing layer. It is the ONE deliberate shadow, recorded with its ' +
      'reason in INTENTIONALLY_SHADOWED_COMMANDS below; every other overlap ' +
      'between this list and LOCAL_COMMAND_HANDLERS is a bug and fails a test.',
  },
  '/history': {
    mode: 'live',
    allowArgs: false,
    why:
      'Reads the transcript the chat is actually written to, now that the ' +
      'dashboard runs in the right profile. Re-measured live at 35ms on the ' +
      "user's 92f9f4fb… chat: 254 rendered entries — 34 user + 44 assistant " +
      'messages carrying text + 176 tool calls — from the 373 active rows in ' +
      'profiles/hermes-switch/state.db, ending on that DB\'s newest message ' +
      '(2026-08-12 00:55:54). The 119 assistant rows it omits are tool-call ' +
      'carriers with no text. The stale default-profile DB holds 334 rows for ' +
      'the same session and stops at 2026-08-11 23:43, so the answer is ' +
      'demonstrably coming from the right file. Unlike the preview below it ' +
      're-reads the DB on every call, so it cannot go stale within a binding. ' +
      'CAVEAT: this works only because this host launches the dashboard ' +
      '`--isolated`. The agent bug is unfixed (hermes-agent #229): _get_db() ' +
      'is process-global, so a default install still reads the wrong file and ' +
      'this command silently lies there.',
  },
  '/compress': {
    mode: 'live',
    allowArgs: false,
    onlyArgs: new Set(['--preview', '--dry-run']),
    why:
      'The preview is the only read-only form and it is now accurate. ' +
      'Re-measured live at 14ms: "Would compress 366 of 366 message(s) ' +
      '(~212,130 tokens currently in context)" — which is exactly the ' +
      "session's real size. It previously reported 333 / ~171k, the shape of " +
      "the stale default-profile DB (334 rows). Both flags measured " +
      'identical; the rejected forms were checked too and refuse cleanly ' +
      '(`here 3`, `--aggressive`, `--bogus`, all 7–8ms, no mutation). Bare ' +
      '/compress stays refused — see SLASH_REFUSALS. ' +
      'CAVEATS, both real: (1) like /history this depends on the local ' +
      '`--isolated` dashboard, because the history it counts is loaded by ' +
      'session.resume through the same process-global _get_db(). (2) It ' +
      'counts session["history"], the in-memory snapshot taken when the ' +
      'binding opened, and nothing in this process ever reloads it for an ' +
      'api_server session (read from installed source; not executed). So the ' +
      'figure is exact on a fresh binding and can lag by whatever was sent ' +
      'since — bounded by hermes-slash-session.ts\'s 5-minute idle TTL, and ' +
      'fixable here rather than in the agent.',
  },

  // ── Read-only reports with no SwitchUI equivalent ───────────────────────
  // All worker-path: a separate HermesCLI subprocess whose answers come off
  // profile-scoped disk, not off any session object. That makes them immune to
  // the never-ran-a-turn problem that kills /status and /usage, and exposed to
  // #229 instead.

  '/insights': {
    mode: 'worker',
    allowArgs: false,
    optionalCount: { max: 365, label: 'days', completions: ['7', '30'] },
    why:
      'Reads the analytics database directly and is the only surface in ' +
      'SwitchUI that reports across sessions. `_show_insights` ' +
      '(cli.py:10192) opens its own SessionDB() and runs InsightsEngine — it ' +
      'never touches the `insights.get` RPC that the earlier pass measured ' +
      'and wrongly judged it on. Measured bare on a cold worker at 2001ms: ' +
      '"Last 30 days", 23 sessions, 2,373 messages, 92,036,920 input + ' +
      '368,369 output = 96,194,601 total tokens, a per-platform split ' +
      '(subagent 15 sessions / api_server 7 / a2a_fleet 1), 15 tools ranked ' +
      'by share (terminal 723 calls, 46.0%), top skills, weekday histogram ' +
      'and notable sessions. Four of those categories have no SwitchUI ' +
      'screen at all. The session ids it names (92f9f4fb…, eeae0db1…) are ' +
      "this profile's. " +
      'THE ARGUMENT: measured `/insights 3` at 1673ms — the header really ' +
      're-renders as "Last 3 days" and the totals drop to 14 sessions / ' +
      '42,200,608 tokens, and `/insights 1` at 14ms answers "No sessions ' +
      'found in the last 1 days." So the number is honoured, which is why it ' +
      'is worth allowing. It is `optionalCount`, not a free `allowArgs`, ' +
      'because the agent does NOT fail closed on a bad one: the parse loop ' +
      'ends in `else: i += 1`, silently skipping any token it does not ' +
      'recognise, and `/insights --preview` was measured at 1994ms returning ' +
      'the ordinary 30-day report. An unrecognised argument there looks ' +
      'exactly like a successful one, so this layer has to be the one that ' +
      'refuses it. ' +
      'CAVEAT: correct here only because this host launches the dashboard ' +
      '`--isolated`. SessionDB() resolves through the process profile ' +
      '(hermes-agent #229, unfixed), so a default install would report the ' +
      "default profile's sessions while claiming to describe this one.",
  },
  '/profile': {
    mode: 'worker',
    allowArgs: false,
    why:
      'Answers the one question #229 makes worth asking, and is the cheapest ' +
      'way for a user to check whether every other worker-path card on this ' +
      'list is telling the truth. `_handle_profile_command` ' +
      '(hermes_cli/cli_commands_mixin.py:509) prints ' +
      '`get_active_profile_name()` and `display_hermes_home()`, both resolved ' +
      'from the worker process. Measured 96ms: "Profile: hermes-switch / ' +
      'Home: ~/.hermes/profiles/hermes-switch" — the same profile the gateway ' +
      'writes this chat to. No SwitchUI screen reports it. ' +
      'CAVEAT: this command IS the `--isolated` caveat in command form. It ' +
      'reports the profile of the process that answered, so on a default ' +
      'install it would print "default" — which is the honest answer for ' +
      'that process and the wrong answer about your chat (hermes-agent #229).',
  },
  '/version': {
    mode: 'worker',
    allowArgs: false,
    why:
      'Agent build identity, which nothing in SwitchUI reports — the Updates ' +
      'section knows about releases, not about which tree is installed. ' +
      'Measured 348ms on a cold worker, 23ms warm: "Hermes Agent v0.19.13 ' +
      '(2026.8.12.2) · upstream 4df9267a / Install directory: ' +
      '/home/rohit/.hermes/hermes-agent / Install method: git / Python: ' +
      '3.11.15 / OpenAI SDK: 2.24.0 / Up to date". ' +
      'NO --isolated caveat, deliberately, and this was measured rather than ' +
      'assumed: every field `_print_version_info` (hermes_cli/main.py:4578) ' +
      'prints comes from the SHARED install — VERSION/RELEASE_DATE are module ' +
      'constants, PROJECT_ROOT is ~/.hermes/hermes-agent which sits outside ' +
      'every profile, and the git label is that one checkout. Only the 6-hour ' +
      '.update_check cache is per-profile (~/.hermes/.update_check records ' +
      'ver 0.19.12 while the profile\'s records 0.19.13), and it is ' +
      'invalidated on a version mismatch, so both profiles compute the same ' +
      'answer. The version is the same under any profile.',
  },
  '/reasoning': {
    mode: 'worker',
    allowArgs: false,
    argsRefusal:
      'reads the current effort here; it does not set it. A level or ' +
      'show/hide would change the throwaway worker and report success while ' +
      'your chat kept the old value — but `full`, `clamp` and anything with ' +
      '--global are worse than that: they write config.yaml globally, from a ' +
      'chat composer, with no confirmation. Change it in ~/.hermes/config.yaml',
    why:
      'The only truthful readout of a real setting that has no other surface ' +
      "anywhere. SwitchUI's composer ships a reasoning picker whose value is " +
      'dropped before the wire (api_server has no per-request reasoning ' +
      'parameter), and Settings has no control for it; what actually applies ' +
      'is agent.reasoning_effort from config.yaml, re-read on every agent ' +
      'build. Measured 2ms on a warm worker: "Reasoning effort: medium / ' +
      'Reasoning display: off (clamped to 10 lines)". ' +
      'BARE ONLY, and every argument is a mutation, not a variant: ' +
      '`_handle_reasoning_command` (cli_commands_mixin.py:2587) treats ' +
      'show/hide as session state, writes display.reasoning_full to ' +
      'config.yaml unconditionally for full/clamp, and sets ' +
      'agent.reasoning_effort (globally, with --global) for a level — all in ' +
      'the throwaway worker for the session-scoped half, so it would report ' +
      'success and change nothing the chat can see. ' +
      'CAVEAT: measured proof that this depends on the local `--isolated` ' +
      'dashboard — display.show_reasoning is `true` in ~/.hermes/config.yaml ' +
      'and `false` in profiles/hermes-switch/config.yaml, and the command ' +
      'answered "off". It read the right file because the process profile is ' +
      'right; a default install would read the other one (hermes-agent #229).',
  },
  '/curator': {
    mode: 'worker',
    allowArgs: false,
    argsRefusal:
      'runs bare here, which is its status view. Its subcommands are a ' +
      'different matter: `prune`, `rollback` and `archive` ask for ' +
      'confirmation at a terminal prompt that has no terminal on this ' +
      'transport, so they hang rather than refuse, and `run` starts a real ' +
      'LLM review pass over your actual skills',
    why:
      'Read-only status of a subsystem that runs on its own schedule and has ' +
      'no SwitchUI screen — the Skills screen lists skills, it does not say ' +
      'whether anything is about to archive them. Bare is genuinely the ' +
      'status form: `_handle_curator_command` (cli_commands_mixin.py:1570) ' +
      'substitutes ["status"] when no tokens are given. Measured 27ms: ' +
      '"curator: ENABLED, runs: 0, last run: 2d ago, interval: every 7d, ' +
      'stale after: 30d unused, archive after: 90d unused, consolidate: off", ' +
      'then 73 agent-created skills (73 active / 0 stale / 0 archived) with ' +
      'least-recently-active, most-active and least-active tables. ' +
      'BARE ONLY. `prune` and `rollback` call a bare input() ' +
      '(hermes_cli/curator.py:361 and :463) unless given -y, and in the ' +
      'worker input() reads the JSON-RPC pipe and wedges it; `archive` ' +
      'prompts the same way; `run` triggers a synchronous LLM review pass. ' +
      'None of those were executed — read from installed source. ' +
      'CAVEAT: .curator_state and the skills tree are ' +
      'get_hermes_home()-anchored (agent/curator.py:86, agent/curator_backup' +
      '.py:75) and this host\'s two skill trees are separate directories, so ' +
      'without `--isolated` this counts the wrong profile\'s skills ' +
      '(hermes-agent #229).',
  },
  '/memory': {
    mode: 'worker',
    allowArgs: false,
    argsRefusal:
      'runs bare here, which shows the pending queue and whether the ' +
      'approval gate is on. `approve` and `reject` are not previews — with no ' +
      'live agent in this process they fall back to the on-disk store and ' +
      'commit or drop the write for real — and `approval on|off` rewrites ' +
      'config.yaml for every future session. Neither belongs behind a slash ' +
      'command with no confirmation step',
    why:
      "Hermes' /memory is the write-APPROVAL QUEUE, which is a different " +
      "thing from SwitchUI's memory screen (browse/graph/wiki) — the name " +
      'collision is exactly why it passes information-gain: nothing in ' +
      'SwitchUI shows pending writes or the state of the approval gate. ' +
      'Measured 9ms: "memory.write_approval = off" followed by "No pending ' +
      'memory writes." ' +
      'BARE ONLY. `approve <id>` and `reject <id>` commit or drop a real ' +
      'pending write and `approval on|off` calls save_config_value on ' +
      'memory.write_approval for every future session ' +
      '(`_handle_memory_command`, cli_commands_mixin.py:1660) — and the ' +
      'no-live-agent fallback means an approve from here writes to the ' +
      'on-disk MEMORY.md rather than failing safe. Not executed. ' +
      'CAVEAT: load_on_disk_store() resolves get_hermes_home() / "memories" ' +
      '(tools/memory_tool.py:57), a separate directory per profile on this ' +
      'host, so without `--isolated` the queue shown is the wrong profile\'s ' +
      '(hermes-agent #229).',
  },
  '/suggestions': {
    mode: 'worker',
    allowArgs: false,
    argsRefusal:
      'runs bare here, which lists what the agent has proposed. `accept` ' +
      'creates a real scheduled job that will fire on its own afterwards, ' +
      '`dismiss` latches a suggestion off permanently, and `catalog` and ' +
      '`clear` write to the same store. Scheduling recurring work deserves a ' +
      'confirmation step SwitchUI does not have',
    why:
      'Surfaces automations the agent proposed that the user never asked to ' +
      'see — there is no other way to discover them, and ignoring them ' +
      'silently is the default. Measured 39ms: "No suggested automations ' +
      'right now. Try `/suggestions catalog` to see the curated starter set, ' +
      'or install a blueprint skill to get one." (An empty queue is a real ' +
      'answer, and the same call renders the pending list when there is one.) ' +
      'BARE ONLY. `accept` calls store.accept_suggestion ' +
      '(hermes_cli/suggestions_cmd.py:96) which creates an actual cron job ' +
      'that will fire on schedule; `dismiss` latches a suggestion off ' +
      'permanently; `catalog` seeds new pending rows; `clear` deletes ' +
      'records. Not executed. ' +
      'CAVEAT: the store is CRON_DIR = get_hermes_home() / "cron" / ' +
      '"suggestions.json" (cron/suggestions.py:48 — whose own comment says it ' +
      'is anchored on the profile home), so without `--isolated` this lists ' +
      "the wrong profile's suggestions (hermes-agent #229).",
  },
  '/bundles': {
    mode: 'worker',
    allowArgs: false,
    why:
      'The index for the bundle slugs the catalog now serves, and the only ' +
      'surface anywhere in SwitchUI that reports them. UNHELD on 2026-08-13: ' +
      'it was never unsafe or wrong, only premature — `commands.catalog` ' +
      'omitted `scan_bundles()`, so this would have listed things typing which ' +
      'got "not on the allowlist". Agent v0.19.16 (verified live at /health) ' +
      'adds a top-level `bundles` list plus `bundle_count`, and mirrors the ' +
      'same slugs into `pairs`/`canon`/`categories` under a "Bundles" bucket, ' +
      'so every slug this lists is now dispatchable — see the bundle section ' +
      'in the module header for how, and `_dispatchable_bundle_entries` ' +
      '(tui_gateway/server.py:13365) for the agent-side gate that only emits a ' +
      'slug the dispatcher can really reach. ' +
      'Measured live against a throwaway tui_gateway session on 2026-08-13: ' +
      '428ms on a cold worker, 337ms warm, answering "No skill bundles ' +
      'installed." plus the create hint and the directory. That empty answer ' +
      'is this install\'s real state (bundle_count: 0 over the same RPC) and ' +
      'is a useful one — it names the directory and the command that fills it. ' +
      'The populated rendering was NOT executed: no bundle is installed here ' +
      'and creating one would write to the user\'s profile. It is argued from ' +
      'installed source (`_handle_bundles_command`, ' +
      'hermes_cli/cli_commands_mixin.py:1848), which lists each bundle as ' +
      '`/<slug> — description (N skills)` with its members underneath. ' +
      'BARE ONLY, and for once that is not a restriction: the handler takes ' +
      '`cmd` and never parses it, the registry CommandDef ' +
      '(hermes_cli/commands.py:190) declares no `args_hint` and no ' +
      '`subcommands`, and `commands.catalog` serves no `sub` entry for it ' +
      '(confirmed in the live payload). So an argument would be silently ' +
      'dropped and the same list returned — the /insights failure mode, where ' +
      'a misunderstood argument looks exactly like a successful one. Refusing ' +
      'it here is the only place that can be caught. ' +
      'WORKER PATH, not live: `/bundles` is absent from ' +
      '_LIVE_SESSION_DIRECT_COMMANDS, _PENDING_INPUT_COMMANDS, ' +
      '_RPC_ROUTED_COMMANDS, _WORKER_BLOCKED_COMMANDS and ' +
      '_ISOLATED_SESSION_READ_COMMANDS, and the measured 428/337ms is worker ' +
      'latency rather than the 2–35ms the live path answers in. ' +
      'CAVEAT: `_bundles_dir()` is `get_hermes_home() / "skill-bundles"` ' +
      '(agent/skill_bundles.py:75), so this is profile-scoped like the rest of ' +
      'the worker path. Proven by its own output rather than inferred — the ' +
      'command printed "Directory: ~/.hermes/profiles/hermes-switch/' +
      'skill-bundles". Without `--isolated` it would list the default ' +
      "profile's bundles, and every slug it named would then be one this " +
      'install cannot dispatch — the exact defect it was held back for, ' +
      'reintroduced by a process detail (hermes-agent #229).',
  },
  '/debug': {
    mode: 'worker',
    allowArgs: false,
    onlyArgs: new Set(['local']),
    why:
      'One click to produce the artefact a maintainer asks for, without the ' +
      'user pasting anything anywhere. `local` is the only form that never ' +
      'touches the network: `_handle_debug_command` ' +
      '(hermes_cli/cli_commands_mixin.py ~2810) computes `local = "local" in ' +
      'words` and then `nous = "nous" in words and not local`, so local wins ' +
      'and run_debug_share renders to stdout. Measured 1296ms: the dump ' +
      'names profile hermes-switch, home ~/.hermes/profiles/hermes-switch, ' +
      'model auto, provider custom, per-provider key presence (values never ' +
      'printed), feature counts and config overrides, then the tail of ' +
      'agent.log. ' +
      'SIZE — the one thing about this entry worth watching, and the reason ' +
      'there is now a cap. Measured three times, growing each time: 863,549 ' +
      'characters over the RPC, a 395,991-byte response through ' +
      'POST /api/hermes-commands/exec, and 1,153,097 bytes over the RPC on ' +
      '2026-08-13 (v0.19.16, throwaway session, 1777ms) against 69 bytes for ' +
      '/profile on the same session. It varies because the bulk is the tail ' +
      'of agent.log and those lines vary in length. ' +
      'CAPPED SINCE 2026-08-13: SLASH_OUTPUT_LIMIT_BYTES (64 KiB) in ' +
      'hermes-slash-exec.ts truncates it inside runSlashCommand — every ' +
      'caller, not just the route — and appends a notice carrying the real ' +
      'byte count and a pointer at GET /api/logs, so a truncated dump can ' +
      'never read as the whole answer. Measured after: a 67,621-byte HTTP ' +
      'response. The card renders it collapsed (max-h-56) and ' +
      'command-output-store.ts keeps at most 20 entries per session and never ' +
      'persists, but neither of those was ever a limit on what crosses the ' +
      'wire. ' +
      'Note also that "redacted at upload time" means the LOCAL render is ' +
      'not redacted; that is the point of the form, and it goes only to the ' +
      "user's own browser. " +
      'BARE AND `nous` STAY REFUSED — both upload, bare to a public paste, ' +
      'and the privacy notice states prompts, responses, tool output, display ' +
      'name, user id and paths are not redacted. Neither was executed. ' +
      'CAVEAT: everything it reports is get_hermes_home()-derived, so ' +
      'without `--isolated` the support dump describes the wrong profile — ' +
      "which is worse here than elsewhere, because it is read as this host's " +
      'ground truth (hermes-agent #229).',
  },

  // ── The one agentic command ─────────────────────────────────────────────
  '/learn': {
    mode: 'live',
    route: 'dispatch',
    allowArgs: true,
    why:
      'The only genuinely agentic command on the list, and the only one whose ' +
      'answer is a turn rather than a card. It is in _PENDING_INPUT_COMMANDS ' +
      '(server.py ~13123), so it runs in-process and returns ' +
      "{type:'send', message} built by build_learn_prompt(arg) " +
      '(server.py:13463) — no worker, no session state read, no mutation ' +
      'anywhere: the message goes down the normal send path and the live ' +
      'agent does the work with its own tools. Measured 20ms with arguments ' +
      'and 19ms bare, over command.dispatch, returning a ~6.0k-character ' +
      'standards-guided prompt; `name` is lstrip("/")-ed server-side ' +
      '(server.py:13329) so the leading slash is accepted. ' +
      'ARGUMENTS PASS THROUGH, which is the whole point — they are what is ' +
      'being learned from (a path, a URL, "this conversation", pasted notes) ' +
      'and they are interpolated verbatim into THE REQUEST section. Verified ' +
      'both ways: with an argument the prompt carried it; bare, the agent ' +
      'substitutes its own default ("the workflow we just went through in ' +
      'this conversation"). This is the same trust level as a skill command — ' +
      'prompt text, not agent state — which is why it is the one entry with ' +
      'allowArgs: true. ' +
      'No --isolated caveat: it reads no database and no profile home. It was ' +
      'never blocked by the agent at all — only by this allowlist.',
  },

  // ── The standing goal, and its criteria ─────────────────────────────────
  // Added 2026-08-13 against installed v0.19.16, after agent v0.19.14 shipped
  // the post-turn hook this pair was blocked on (the doc's backend ask #1;
  // hermes-agent#230). Both were `excluded` with reasons that are now void —
  // see hermes-command-tiers.ts for the retirement, and the entries below for
  // what replaced them. Both were executed live on a throwaway tui_gateway
  // session bound to a throwaway api_server session, including a real
  // three-turn continuation.
  '/goal': {
    mode: 'live',
    route: 'dispatch',
    allowArgs: true,
    phantomArgs: {
      words: new Set(['show', 'draft', 'wait', 'unwait']),
      refusal:
        'is in the agent\'s usage hint but has no handler on this transport — ' +
        'it would not show or draft anything, it would SET your goal to that ' +
        'literal text and start an agent loop working on it (measured: ' +
        '"/goal show" answered "⊙ Goal set (20-turn budget): show"). The forms ' +
        'that work here are `/goal <text>` to set one, `/goal` or `/goal ' +
        'status` to read it, and `/goal pause` · `/goal resume` · `/goal ' +
        'clear` to control it. If your goal really does start with that word, ' +
        'reword it — the first word is all this rule looks at.',
    },
    why:
      'The one command whose whole point is to outlive the turn that set it, ' +
      'and the only way to reach the agent\'s multi-turn loop from a browser. ' +
      '`/goal <text>` stores an objective in state.db (goals.py:557 → ' +
      'db.set_meta("goal:<session_key>")) and answers {type:"send", notice, ' +
      'message} — the goal text is submitted as the kickoff turn and the ' +
      'notice is toasted, which is the existing send/skill arm of ' +
      'use-slash-commands.ts, unchanged. ' +
      'WHY IT WORKS NOW, AND DID NOT BEFORE: the state was always durable; ' +
      'nothing evaluated it. api_server had no post-turn hook, so a goal set ' +
      'from the web sat in the database forever (the doc\'s §5.5b, ' +
      'hermes-agent#230). v0.19.14 added `_evaluate_goal_after_turn` ' +
      '(installed gateway/platforms/api_server.py:3544), called from BOTH the ' +
      'JSON path (:3709) and the stream loop (:4083) — the path SwitchUI ' +
      'sends over. MEASURED LIVE 2026-08-13 on a throwaway api_server session ' +
      'with a 3-turn budget: one POST /api/sessions/{id}/chat/stream produced ' +
      'assistant.completed → goal.status "↻ Continuing toward goal (1/3): …" ' +
      '→ goal.continuation turn=1 with a NEW message_id → a second turn ("1") ' +
      '→ the same again for turn 2 ("2") → goal.status "⏸ Goal paused — 3/3 ' +
      'turns used" and run.completed carrying goal_continuations: 2. ' +
      'THE BINDING IS THE PART THAT COULD HAVE BEEN WRONG AND IS NOT: the ' +
      'dispatch branch keys the goal on `session["session_key"]` ' +
      '(server.py:13924) while api_server keys the judge on its own path ' +
      'parameter. Verified they are the same string — resuming a real ' +
      'api_1786591020_666183a6 session over hermes-slash-session.ts\'s own ' +
      'binding reported session_key "api_1786591020_666183a6", and `/goal ' +
      '<text>` then wrote exactly `goal:api_1786591020_666183a6` into ' +
      'profiles/hermes-switch/state.db. So a goal set from the composer is ' +
      'the goal the judge reads. ' +
      'ARGUMENTS ARE THE PAYLOAD, like /learn — the text IS the goal, so ' +
      'allowArgs: true. The mutating control words are allowed deliberately ' +
      'and each earns it: `pause` and `resume` (server.py:13937/13941) and ' +
      '`clear`/`stop`/`done` (:13956) are the ONLY brakes on a loop that ' +
      'spends real tokens — refusing them would leave a user able to start ' +
      'one and unable to stop it, which is a worse safety position than ' +
      'allowing them. They act in-process on the same shared row the judge ' +
      'reads, so they take effect on the next turn rather than reporting a ' +
      'success nothing can see. `resume` also RESETS the budget to 0 ' +
      '(goals.py:1187, reset_budget=True) — that is the agent\'s behaviour, ' +
      'not ours, and it is why the notice quotes the budget. ' +
      'WHAT IS REFUSED: `show`, `draft`, `wait` and `unwait` — see ' +
      'phantomArgs. They are CLI-only forms the registry advertises and this ' +
      'route silently turns into goal text. ' +
      'BUDGET, measured: the dispatch branch has no way to pass max_turns, so ' +
      'it takes goals.max_turns from config (default 20, config.py:2413) — ' +
      '"⊙ Goal set (20-turn budget)". A separate per-REQUEST cap of 10 ' +
      'continuations (MAX_GOAL_CONTINUATIONS_PER_REQUEST, api_server.py:243) ' +
      'stops one HTTP request from running away; the goal survives it and ' +
      'says so. ' +
      'CAVEAT — the `--isolated` one, in its sharpest form. Goal state is read ' +
      'and written through goals.py:506 `_get_session_db()`, a bare ' +
      'SessionDB() bound to get_hermes_home(); neither dispatch branch ' +
      'installs a set_hermes_home_override for the session\'s profile_home. ' +
      'The WRITER is the dashboard process and the READER is the gateway, so ' +
      'unlike every worker-path entry the failure is not "shows the wrong ' +
      'profile\'s data" but "the two processes use different files": without ' +
      '`--isolated` the goal is stored under ~/.hermes/state.db and the judge ' +
      'looks for it under profiles/<p>/state.db, finds nothing, and the goal ' +
      'silently never fires — hermes-agent#230\'s symptom re-created by #229. ' +
      'On this host both resolve to profiles/hermes-switch, which is what the ' +
      'live continuation above proves.',
  },
  '/subgoal': {
    mode: 'live',
    route: 'dispatch',
    allowArgs: true,
    why:
      'The criteria half of /goal, and useless without it — the judge weighs ' +
      'subgoals when it decides whether to continue, so this is how a user ' +
      'steers a running loop without restarting it. Same route, same session ' +
      'key, same shared row. ' +
      'ITS OWN ROUTE, not the worker: `subgoal` is NOT in ' +
      '_PENDING_INPUT_COMMANDS — it is in _DISPATCH_ROUTED_COMMANDS ' +
      '(tui_gateway/server.py:13336), a sibling set added for exactly the ' +
      'reason this policy would otherwise have refused it. The comment above ' +
      'it says it: the slash worker is a separate process holding a stale ' +
      'GoalState, and save_goal() rewrites the whole blob, so a worker-side ' +
      'write would clobber the turns_used/status/last_verdict the serving ' +
      'process\'s judge had just written. `slash.exec` forwards both sets to ' +
      'command.dispatch (:15582), so neither can reach the worker and neither ' +
      'can 4018 — the second half of the stale "unreachable via ' +
      'command.dispatch" reason this entry replaces. ' +
      'ARGUMENTS ARE THE PAYLOAD and the grammar is the agent\'s, which is ' +
      'why this is allowArgs rather than a literal set: `remove <n>` and ' +
      '`clear` are fixed, but every other string is a criterion to add. All ' +
      'measured live 2026-08-13, and the failure modes are the point — the ' +
      'agent answers a bad form with 4004 AND A FIXABLE MESSAGE rather than ' +
      'silently accepting it (server.py:14044 says so explicitly): bare → the ' +
      'goal line plus "(no subgoals — use /subgoal <text> to add criteria)"; ' +
      '`say only the number` → "✓ Added subgoal 1: …"; `remove` → 4004 ' +
      '"usage: /subgoal remove <n>"; `remove abc` → 4004 "<n> must be an ' +
      'integer (1-based index)"; `remove 9` → 4004 "index out of range ' +
      '(1..1)"; `remove 1` → "✓ Removed subgoal 1: …"; `clear` → "No ' +
      'subgoals to clear." With no goal set at all, every form answers "No ' +
      'active goal. Set one with /goal <text>." So there is no form that ' +
      'mutates something the user did not ask for and no form that looks like ' +
      'success while doing nothing — the two conditions that make a free ' +
      'argument grammar unsafe elsewhere on this list. ' +
      'Every answer is {type:"exec", output} — a command-output card, not a ' +
      'turn. Only /goal submits one. ' +
      'CAVEAT: the same one as /goal, and inherited from it — the row it edits ' +
      'is the row the judge reads, through the same process-global ' +
      'get_hermes_home() (hermes-agent#229). Without `--isolated` the criteria ' +
      'land in a file the gateway never opens.',
  },
}

/**
 * The allowlisted commands a SwitchUI handler is *deliberately* allowed to
 * shadow — and the only ones.
 *
 * ── Why this table exists ─────────────────────────────────────────────────
 * `LOCAL_COMMAND_HANDLERS` (`screens/chat/hooks/use-slash-commands.ts`) answers
 * a command before the exec route sees it, and `agentCatalogEntries`
 * (`components/slash-command-menu.tsx`) drops anything on that list from the
 * picker as "shadowed". So a command on BOTH lists is added to an allowlist and
 * then silently deleted: never advertised, never executed, and the reasoning in
 * its `why` above never reaches a user.
 *
 * That is not hypothetical. `/status` hit it, was diagnosed, and was fixed by
 * removing its handler and its deep-link — and then the 3 → 12 pass re-created
 * it four times over, because nobody generalised the fix into a check.
 * Measured before this table existed: 12 allowlisted, 5 shadowed
 * (`/help /insights /profile /reasoning /version`), 7 reaching the picker.
 *
 * ── The bar for being in here ─────────────────────────────────────────────
 * A shadow is legitimate only when the SwitchUI answer is *better than* the
 * agent's, not merely different. "A screen exists" is not enough — that is the
 * overcorrection §A.3 of the plan records, and it is what wrongly buried
 * `/insights` under `/dashboard`, `/profile` under `/profiles` and `/version`
 * under Settings → Updates, each of which lacks the very thing the command was
 * allowlisted to report.
 *
 * If a command belongs here, it needs a reason in this table AND its entry in
 * `SLASH_EXEC_ALLOWLIST` must still be justified on its own — the allowlist is
 * the control, the routing layer is not.
 *
 * Enforced in three places, deliberately at different altitudes:
 *   • `slash-command-menu.test.tsx` — the *list* check: allowlist ∩ handlers
 *     must equal this table, in both directions, so a stale exception fails too.
 *   • `use-slash-commands.test.ts` — the *behavioural* check: an allowlisted,
 *     non-excepted command must not be handled locally. This is the one that
 *     catches a leftover `DEEP_LINK_ROUTES` / `SETTINGS_SECTION_COMMANDS`
 *     mapping, which intercepts just as effectively as a named handler and
 *     would sail past a list comparison.
 *   • `hermes-slash-policy.test.ts` — every key here is really on the allowlist
 *     and carries a reason.
 */
export const INTENTIONALLY_SHADOWED_COMMANDS: Readonly<Record<string, string>> =
  {
    '/help':
      "The picker IS the help surface. SwitchUI's /help opens it with the live " +
      'catalog — every command this install can actually run, searchable, with ' +
      'descriptions and argument hints. The agent\'s own /help renders ' +
      'COMMAND_REGISTRY as ~18KB of 120-column ASCII listing CLI commands that ' +
      'mostly do not work over this transport, so proxying it would be a ' +
      'strictly worse answer to the same question. It stays on the allowlist ' +
      'anyway, because the allowlist is the control and not the routing layer: ' +
      'if the handler is ever removed, /help must run rather than fail.',
  }

/**
 * Commands refused with a reason the user sees. Everything absent from
 * `SLASH_EXEC_ALLOWLIST` is refused regardless; these entries exist so the
 * refusal explains itself instead of saying "not allowed".
 *
 * Every reason below was re-derived against installed v0.19.13 — either
 * executed live (the safe ones, output quoted) or read out of the installed
 * source (the mutating ones, which were deliberately not run). A refusal that
 * cites a fixed defect is worse than no refusal at all: it teaches the reader
 * something false about their own agent. That now cuts both ways — the
 * profile-DB argument was retired from every entry below, because on this host
 * it is no longer true.
 */
export const SLASH_REFUSALS: Readonly<Record<string, string>> = {
  // ── Read an object that never ran a turn ────────────────────────────────
  // Not a database problem and never fixable by one. The dashboard's session
  // for a SwitchUI chat is resumed, never run: usage counters live on the
  // in-memory agent and are not restored on resume, and turns execute in the
  // gateway's api_server, not here. Re-measured on 92f9f4fb… (373 messages,
  // 32,029,915 input tokens recorded on its row in the same DB these commands
  // read).
  '/status':
    'reports the dashboard\'s in-memory copy of this session, which never runs a turn — so 3 of its 9 lines are false here: "Tokens: 0" (your session has logged 32 million), "Agent Running: No" no matter how busy the chat is, and "Last Activity" always equal to "Created" because the session row has no last-activity column at all. The lines that are true are already in the chat header and sidebar',
  '/usage':
    'reads the counters on the resumed agent object, which are never restored — re-measured today, every single one still 0 (input, output, prompt, completion, total, API calls) while the same session\'s stored row records 32,029,915 input and 72,631 output tokens over 268 calls. Only its message count is real. The chat header meter has the numbers',
  '/systemprompt':
    'cannot see the system prompt your chat actually sends. It reads the prompt built by the process it runs in, and that process never runs a turn for this chat; agent 0.19.13 added a fallback to the *configured* prompt, but nothing is configured here, so it answers "No system prompt is configured, and none has been built yet." about a session that demonstrably has one',

  // ── Destructive ─────────────────────────────────────────────────────────
  // #218 is genuinely fixed and re-verified: --preview/--dry-run no longer
  // compress, and `here [N]`, `--aggressive` and an unknown `--flag` are
  // rejected instead of silently full-compressing. --preview is now allowed
  // (see SLASH_EXEC_ALLOWLIST). Bare is not, and the profile fix made that
  // *more* important, not less: it now compresses the database your chat
  // really reads.
  '/compress':
    'on its own compresses this conversation and then ends the session and rotates to a continuation, which is not reversible and would break the chat you are in. Run `/compress --preview` to see what it would do — that form is read-only and is allowed here',
  '/snapshot':
    'restores are refused by the agent itself (4018) and every other subcommand mutates a throwaway subprocess that is discarded a moment later',
  '/snap':
    'restores are refused by the agent itself (4018) and every other subcommand mutates a throwaway subprocess that is discarded a moment later',
  // `/debug local` is allowed (see SLASH_EXEC_ALLOWLIST); this reason is what
  // a user gets for the two forms that upload, including bare.
  '/debug':
    'on its own, and with `nous`, uploads a state dump off this machine — the bare form to a *public* paste, with prompts, responses, tool output, display name, user id and paths NOT redacted. That needs an explicit consent step, and SwitchUI does not have one. Run `/debug local` instead: it renders the same report here and never touches the network, and that form is allowed',

  // ── Change a process that is not the one serving this chat ──────────────
  // The shared database changed nothing here: these mutate in-memory objects,
  // and the object they mutate belongs to the dashboard process.
  '/yolo':
    'is not the way to control approvals from the browser — the agent now exposes a real one at GET/POST /api/sessions/{id}/yolo on the gateway, the same process that enforces your approvals, and SwitchUI drives it as a UI control. The slash command flips an in-memory set inside the dashboard process instead, which enforces nothing for this chat',
  '/personality':
    'appends a persona marker to the dashboard\'s in-memory copy of this session, which your chat never reads, so it changes nothing you would see. With --global it writes agent.personality to config.yaml for every future session, from a chat composer, with no confirmation',
  '/reload-mcp':
    "rebuilds the tool set on the dashboard's copy of this session rather than the agent serving your chat — and it invalidates the prompt cache, so the next message re-sends the whole context",
  '/model':
    "reports and switches the dashboard session's model (it answers \"auto (custom)\" here), not the model this chat sends with — SwitchUI picks that per chat in the browser. Use the model picker",
  '/fast':
    'has nothing to act on: the transport SwitchUI sends over never sets service_tier at all (gateway/platforms/api_server.py has no such field), so this would report success and change nothing',
  '/handoff':
    'hands this conversation to Telegram or Discord for good — and now that the dashboard shares your database, the gateway watcher really would execute it. Bare it only prints its own usage line; with a platform it is a one-way transfer of the chat you are typing in, which deserves a confirmation step SwitchUI does not have',
  '/stop':
    "kills every background process on the agent host, and does NOT stop the current turn — SwitchUI's /interrupt is the one that stops a turn",

  // ── Not interactive, and the UI already does it ─────────────────────────
  // #220 is fixed and re-verified: bare /new returned in 4ms with "Interactive
  // prompts aren't available on this surface … /new cancelled (no input)".
  // The inline tokens (--yes, -y, /reset now) do run, which is the problem.
  '/new':
    'is not interactive here: bare /new just cancels, and /new --yes creates a session inside the dashboard process that never becomes a SwitchUI chat. Use the New chat button',
  '/update':
    'restarts the agent mid-stream and cannot confirm over this transport — bare /update cancels. Update from Settings → Updates, which knows to expect the restart',
  '/save':
    'exports the slash worker\'s own transcript, which is empty — re-measured today, it still answers "(;_;) No conversation to save." Use SwitchUI\'s own export',
  '/prompt':
    'opens $EDITOR to compose a message and only works in the classic CLI; over this transport it does nothing but say so. The composer you are typing in is the equivalent',
  '/indicator':
    'sets the terminal busy-indicator style. The catalog still lists it (it is served from _TUI_EXTRA) but no handler exists — the agent still answers "Unknown command: /indicator" — and SwitchUI has no terminal indicator to style',

  // ── Not reachable, or superseded by a screen ────────────────────────────
  // `/bundles` used to be the one CONDITIONAL refusal on this list — held back
  // not because anything about it was wrong or dangerous, but because
  // `commands.catalog` never folded in `scan_bundles()`, so it would have
  // listed slugs SwitchUI could not dispatch. Agent v0.19.16 emits them, the
  // condition is retired, and the entry moved to SLASH_EXEC_ALLOWLIST on
  // 2026-08-13. No refusal replaces it: every form of it now runs, and the
  // argument case is answered by the bare-only rule's own line.
  '/context':
    'is not reachable in this agent build ("Unknown command: /context" from the worker; the live formatter only answers for compute-host sessions) — the context ring in the composer is the equivalent',
  '/tools':
    'the Toolsets screen shows this properly — re-measured today the command spends 5.7s rendering an 80-column ASCII table of the same data',
}

export type SlashDecision =
  | {
      ok: true
      /** Canonical command including the leading slash, lowercased. */
      command: string
      /**
       * The argument string that may run with it — empty for a bare command,
       * one of `onlyArgs` for an argument-restricted one, the validated digits
       * for an `optionalCount` one, and the caller's own text for `/learn` and
       * for skill and bundle commands. The exec route must send `command` +
       * `args`, never the raw client string.
       */
      args: string
      /**
       * `exec` → slash.exec; `dispatch` → command.dispatch. Skill commands,
       * bundle slugs and `/learn` take the dispatch route; everything else on
       * the allowlist takes exec.
       */
      route: SlashExecRoute
      mode: SlashExecMode | null
    }
  | { ok: false; command: string; reason: string }

export type EvaluateSlashOptions = {
  /**
   * The version the running agent reports, or **null** when it could not be
   * established. Required rather than optional because the allowlist cannot be
   * evaluated without it: every entry was measured against a specific build
   * (`MIN_AGENT_VERSION_FOR_SLASH_EXEC`) and an older one makes several of them
   * lie or destroy data. Null — and anything unparseable — fails closed, which
   * empties the allowlist while leaving skills and bundles dispatchable.
   */
  agentVersion: string | null
  /** Alias → canonical, from `commands.catalog`'s `canon` map. */
  aliases?: Readonly<Record<string, string>>
  /** Canonical names of skill commands, which dispatch instead of exec'ing. */
  skillCommands?: ReadonlySet<string>
  /**
   * Canonical names of skill-bundle slugs, from the catalog's top-level
   * `bundles` list. Same route and same trust level as `skillCommands`, kept
   * separate because the two are derived from different signals and the
   * `skill` flag drives user-visible behaviour that would be wrong for a
   * bundle — see the bundle section of the module header.
   */
  bundleCommands?: ReadonlySet<string>
}

function refuse(command: string, reason: string): SlashDecision {
  return { ok: false, command, reason }
}

function refusalFor(command: string): string | null {
  return Object.prototype.hasOwnProperty.call(SLASH_REFUSALS, command)
    ? SLASH_REFUSALS[command]
    : null
}

/**
 * Decide whether a raw slash input may run, and how. Pure and total.
 *
 * This is the whole control. The menu hides what it cannot run, but hiding is
 * not a control — every path into the exec route goes through here.
 */
export function evaluateSlashCommand(
  input: string,
  options: EvaluateSlashOptions,
): SlashDecision {
  const trimmed = input.trim()
  if (!trimmed.startsWith('/')) {
    return refuse(trimmed, 'not a slash command')
  }

  const [rawToken = '', ...argParts] = trimmed.split(/\s+/)
  const args = argParts.join(' ').trim()
  const token = rawToken.toLowerCase()

  // Resolve `/fork` → `/branch`, `/compact` → `/compress`, … before every
  // lookup, so an alias can never smuggle a refused command past the map.
  const aliased = options.aliases?.[token]
  const command =
    typeof aliased === 'string' && aliased.startsWith('/')
      ? aliased.toLowerCase()
      : token

  const allowed = Object.prototype.hasOwnProperty.call(
    SLASH_EXEC_ALLOWLIST,
    command,
  )
    ? SLASH_EXEC_ALLOWLIST[command]
    : null

  if (allowed) {
    // The version floor, checked before any argument rule and before the
    // command is otherwise proven — below it this whole branch is closed.
    //
    // It sits here, inside the allowlist branch, rather than at the top of the
    // function, because that placement *is* the policy: skill commands and
    // bundle slugs fall through to the branches below and are unaffected. It
    // also covers `/learn`, which is an allowlist entry that happens to take
    // the dispatch route — the floor is blunt on purpose and gates membership
    // of this list, not the transport a member uses.
    if (!meetsAgentVersionFloor(options.agentVersion, MIN_AGENT_VERSION_FOR_SLASH_EXEC)) {
      return refuse(command, agentVersionFloorRefusal(command, options.agentVersion))
    }

    const route: SlashExecRoute = allowed.route ?? 'exec'
    const allow = (permitted: string): SlashDecision => ({
      ok: true,
      command,
      args: permitted,
      route,
      mode: allowed.mode,
    })

    // Argument-restricted: the bare form is NOT allowed, and only the exact
    // strings in `onlyArgs` are. Checked before `allowArgs` so the two rules
    // can never be read as additive.
    if (allowed.onlyArgs) {
      const normalized = args.toLowerCase()
      if (allowed.onlyArgs.has(normalized)) return allow(normalized)
      const permitted = [...allowed.onlyArgs].sort().join(' or ')
      const reason = refusalFor(command)
      return refuse(
        command,
        reason
          ? `${command} ${reason}`
          : `${command} only runs here as ${permitted}`,
      )
    }

    // Optional whole-number argument: bare runs, `<n>` runs, nothing else.
    // Checked before `allowArgs` for the same reason as `onlyArgs` — the two
    // are alternatives, not layers. This is deliberately strict: the agent's
    // own parser skips tokens it does not recognise and then answers as if
    // nothing were wrong, so `/insights --preview` returns a perfectly
    // plausible default report. Refusing here is the only place a bad
    // argument can be caught.
    if (allowed.optionalCount) {
      if (!args) return allow('')
      if (COUNT_ARGUMENT.test(args)) {
        const value = Number(args)
        if (value >= 1 && value <= allowed.optionalCount.max) return allow(args)
      }
      const { label, max } = allowed.optionalCount
      return refuse(
        command,
        `${command} takes an optional whole number of ${label} (1–${max}) and nothing else — ` +
          `run \`${command}\` on its own, or e.g. \`${command} 7\`. Any other argument is ` +
          `refused here because the agent does not reject it: it silently skips what it ` +
          `does not understand and answers with the default report, which looks exactly ` +
          `like success.`,
      )
    }

    if (args && !allowed.allowArgs) {
      return refuse(
        command,
        allowed.argsRefusal
          ? `${command} ${allowed.argsRefusal}`
          : `${command} only works on its own here — run it without arguments. ` +
              `With arguments it would change settings in a throwaway copy of your ` +
              `agent and report success, leaving the real one untouched.`,
      )
    }

    // A phantom subcommand: advertised by the agent's own usage hint, with no
    // branch behind it. Checked LAST, and only for `allowArgs` entries, because
    // it subtracts from an otherwise free grammar rather than defining one —
    // the other three rules each describe what may run, this one names the few
    // things that must not. `/goal show` is the whole reason it exists: it does
    // not show anything, it sets the goal to "show" and starts a turn.
    if (allowed.phantomArgs && args) {
      const firstWord = args.split(/\s+/)[0]?.toLowerCase() ?? ''
      if (allowed.phantomArgs.words.has(firstWord)) {
        return refuse(
          command,
          `${command} ${firstWord} ${allowed.phantomArgs.refusal}`,
        )
      }
    }
    // `allowArgs` entries pass their arguments through verbatim; everything
    // else has already been proven bare at this point.
    return allow(allowed.allowArgs ? args : '')
  }

  // Bundle slugs and skill commands are prompt injections, not agent-state
  // mutations: they come back as `{type:'send'}` / `{type:'skill'}` and the
  // message goes down the normal send path. Both are checked AFTER the
  // allowlist, so a stale or hostile catalog cannot smuggle a refused *form*
  // through by claiming a name — bare `/compress` stays refused even when
  // something lists it as a bundle or a skill.
  //
  // Bundles first, matching the agent's own dispatcher order.
  if (options.bundleCommands?.has(command)) {
    return { ok: true, command, args, route: 'dispatch', mode: null }
  }
  if (options.skillCommands?.has(command)) {
    return { ok: true, command, args, route: 'dispatch', mode: null }
  }

  const explained = refusalFor(command)
  if (explained) return refuse(command, `${command} ${explained}`)

  return refuse(
    command,
    `${command} can't be run from SwitchUI — it isn't on the allowlist of commands that behave correctly over this transport`,
  )
}

/**
 * Whether the picker may advertise a catalog command.
 *
 * Deliberately the same predicate the exec route enforces, so the menu can
 * never list something the server would refuse in *every* form (§8a: a picker
 * full of entries that only produce a notice is noise). An argument-restricted
 * command is listed because it does have a runnable form, and
 * `slashArgumentCompletions` is what walks the user to it rather than into the
 * refusal. The reverse is allowed — a command may be runnable and still
 * hidden, e.g. when a SwitchUI handler shadows it.
 *
 * This is also what keeps the unfiltered `cli_only` entries in
 * `commands.catalog` harmless: they arrive, they are not on the allowlist, so
 * they are never advertised. See the module header.
 */
export function isSlashCommandRunnable(
  command: string,
  options: {
    isSkillCommand: boolean
    isBundleCommand?: boolean
    /**
     * The running agent's version, or null when unknown. Required for the same
     * reason `EvaluateSlashOptions.agentVersion` is: below
     * `MIN_AGENT_VERSION_FOR_SLASH_EXEC` the allowlist is empty, so a version
     * is part of the answer. Unknown fails closed.
     */
    agentVersion: string | null
  },
): boolean {
  const key = command.trim().toLowerCase()
  // A bundle slug is runnable for the same reason a skill command is, and for
  // one more: the agent only emits a slug it has already proved the dispatcher
  // reaches (`_dispatchable_bundle_entries`). Note the asymmetry with skills —
  // a bundle IS categorized, so this cannot be inferred from the category and
  // has to be passed in.
  //
  // Both are checked before the floor, and deliberately: they dispatch prompt
  // text rather than mutating agent state, so none of the defects the floor
  // exists for can reach them. An old agent loses the fifteen registry
  // commands and keeps its ~78 skills.
  if (options.isBundleCommand === true) return true
  if (options.isSkillCommand) return true
  if (!meetsAgentVersionFloor(options.agentVersion, MIN_AGENT_VERSION_FOR_SLASH_EXEC)) {
    return false
  }
  return Object.prototype.hasOwnProperty.call(SLASH_EXEC_ALLOWLIST, key)
}

/**
 * True when the command runs bare or not at all.
 *
 * The catalog uses this to strip `subcommands` before the picker ever sees
 * them. Without it the UI contradicts the policy: `/tools` advertises
 * `[list|disable|enable]`, the picker holds the menu open to complete one,
 * inserts `/tools list`, and the exec route then refuses it for carrying
 * arguments — the picker walking the user into a guaranteed rejection.
 *
 * False for any entry that accepts an argument in some form — `onlyArgs`
 * (`/compress`, `/debug`), `optionalCount` (`/insights`) or `allowArgs`
 * (`/learn`) — because for those the completions are the whole point of
 * listing it, or the arguments are the payload.
 *
 * Skills and bundle slugs are unaffected: their arguments are prompt text, not
 * agent state, so they never reach the allowlist's argument rule. `/bundles`
 * itself is a different thing from the slugs it lists and IS on the allowlist,
 * bare-only, so this returns true for it.
 */
export function isBareOnlySlashCommand(command: string): boolean {
  const key = command.trim().toLowerCase()
  const entry = Object.prototype.hasOwnProperty.call(SLASH_EXEC_ALLOWLIST, key)
    ? SLASH_EXEC_ALLOWLIST[key]
    : null
  if (!entry) return false
  if (entry.onlyArgs || entry.optionalCount) return false
  return !entry.allowArgs
}

/**
 * The argument forms the picker should offer for a command, if any.
 *
 * The agent's own catalog serves no `sub` list for `/compress` or `/insights`,
 * so without this the picker would insert `"/compress "` and dismiss, leaving
 * the user one Enter away from the exact refusal this policy is trying to
 * avoid. It serves the WRONG list for `/debug` (`["nous","local"]`, of which
 * only `local` may run) and for `/reasoning`, `/curator`, `/memory` and
 * `/suggestions` (whole menus of mutating subcommands) — those are bare-only,
 * so `normalizeCommandCatalog` strips them via `isBareOnlySlashCommand` and
 * this returns nothing for them.
 *
 * For `/insights` the answers are examples rather than an exhaustive set: bare
 * is valid too, so unlike `/compress` the picker cannot walk anyone into a
 * refusal here — these just save the user guessing what `[days]` wants.
 *
 * Sorted so the menu order is stable — lexicographically for literals,
 * numerically for counts (`['7', '30']`, not `['30', '7']`).
 */
export function slashArgumentCompletions(command: string): Array<string> {
  const key = command.trim().toLowerCase()
  const entry = Object.prototype.hasOwnProperty.call(SLASH_EXEC_ALLOWLIST, key)
    ? SLASH_EXEC_ALLOWLIST[key]
    : null
  if (!entry) return []
  if (entry.onlyArgs) return [...entry.onlyArgs].sort()
  if (entry.optionalCount) {
    return [...entry.optionalCount.completions].sort((a, b) => Number(a) - Number(b))
  }
  return []
}

// ── The usage hint ──────────────────────────────────────────────────────────
//
// `commands.catalog` embeds the registry's `args_hint` in each description as a
// trailing `(usage: /cmd …)`, and the picker renders it beside the command
// token. Until this section existed that hint was the ONE thing about a command
// that no policy touched: `runnable` came from the allowlist, `subcommands`
// came from `slashArgumentCompletions`, and the hint came straight from the
// agent — so `/reasoning` was advertised as
// `[level|show|hide|full|clamp] [--global]` when every one of those forms is
// refused, and `/goal` still advertised `show`/`draft`/`wait`/`unwait` after
// `phantomArgs` was written specifically to refuse them.
//
// That was the same defect four times over (`/tools list`, `/compress`,
// `/goal show`, and this), each fixed one command at a time, so the correction
// lives HERE rather than in the picker: the hint is now derived from the same
// entry `evaluateSlashCommand` reads, projected onto the catalog next to
// `runnable` and `subcommands` (`hermes-commands.ts`), and rendered verbatim by
// a picker that decides nothing. `hermes-commands.test.ts` holds the guard that
// re-derives every advertised form and runs it through `evaluateSlashCommand`.
//
// ── The one convention a hint must obey ───────────────────────────────────
// **Angle brackets mean "metavariable"; every other word is a literal form the
// route must accept.** `<text>`, `<days 1-365>` and `<pid>` stand for values;
// `pause`, `--preview` and `local` are strings a user can type and therefore
// strings the exec route has to allow. `usageHintLiteralForms` is the shared
// parser for that rule — the derivation below obeys it and the guard enforces
// it, so a hint cannot advertise a refused word without failing a test.

/**
 * Split on a separator that is not nested inside `[...]` or `<...>`.
 *
 * The agent's hints nest one level (`[text | draft <text> | wait <pid>]`), so a
 * naive `split('|')` would cut inside a metavariable that happened to contain
 * one.
 */
function splitTopLevel(text: string, separator: string): Array<string> {
  const parts: Array<string> = []
  let depth = 0
  let current = ''
  for (const char of text) {
    if (char === '[' || char === '<') depth += 1
    else if (char === ']' || char === '>') depth = Math.max(0, depth - 1)
    else if (char === separator && depth === 0) {
      parts.push(current)
      current = ''
      continue
    }
    current += char
  }
  parts.push(current)
  return parts
}

/**
 * Unwrap a hint that is ONE `[...]` group wrapping the whole thing, so its
 * alternatives can be split. Returns null when the hint is anything else —
 * notably `/reasoning`'s `[a|b] [--global]`, where a greedy `^\[(.*)\]$` would
 * "unwrap" across two groups and corrupt the string.
 */
function unwrapOptionalGroup(hint: string): string | null {
  if (!hint.startsWith('[') || !hint.endsWith(']')) return null
  let depth = 0
  for (let i = 0; i < hint.length; i += 1) {
    const char = hint[i]
    if (char === '[') depth += 1
    else if (char === ']') {
      depth -= 1
      // The opening bracket closed before the end ⇒ more than one group.
      if (depth === 0 && i !== hint.length - 1) return null
    }
  }
  return depth === 0 ? hint.slice(1, -1) : null
}

/**
 * Every literal word a usage hint advertises — i.e. everything a user could
 * type verbatim, with the `<…>` metavariables removed.
 *
 * This is the parser behind the guard: for a command the picker advertises,
 * each of these has to be a form `evaluateSlashCommand` accepts, or the hint is
 * telling the user to type something the server will refuse.
 *
 * It is deliberately crude — it flattens `[a|b] [--c]` to `a b --c` and reads
 * the first word of a multi-word form (`remove N` ⇒ `remove`, `N`) as a form in
 * its own right. Crude in the safe direction: it can only ever produce MORE
 * strings to check, so a hint passes the guard by being restrictive, never by
 * being unparseable.
 */
export function usageHintLiteralForms(hint: string): Array<string> {
  const withoutMetavariables = hint.replace(/<[^>]*>/g, ' ')
  const forms: Array<string> = []
  for (const raw of withoutMetavariables.split(/[\s|[\]()]+/)) {
    const token = raw.trim()
    if (!token) continue
    if (!forms.includes(token)) forms.push(token)
  }
  return forms
}

/**
 * Drop the alternatives a `phantomArgs` entry refuses, keeping the rest of the
 * agent's own hint.
 *
 * `/goal` is the holder and the reason: its hint advertises nine forms, four of
 * which (`show`, `draft <text>`, `wait <pid>`, `unwait`) have no branch behind
 * them and would become the goal text — a real turn, on a goal named "show".
 * Subtraction rather than replacement because the other five are the agent's
 * wording and are correct.
 *
 * Fails closed: if the result still advertises a refused word — a hint shaped
 * in a way this parser did not anticipate — the whole hint is dropped rather
 * than shown wrong.
 */
function subtractPhantomForms(
  hint: string,
  words: ReadonlySet<string>,
): string | null {
  const inner = unwrapOptionalGroup(hint)
  const body = inner ?? hint
  const kept = splitTopLevel(body, '|')
    .map((part) => part.trim())
    .filter((part) => {
      if (!part) return false
      const first = part.split(/\s+/)[0]?.toLowerCase() ?? ''
      return !words.has(first)
    })
  if (kept.length === 0) return null
  const rebuilt = kept.join(' | ')
  const result = inner === null ? rebuilt : `[${rebuilt}]`
  for (const form of usageHintLiteralForms(result)) {
    if (words.has(form.toLowerCase())) return null
  }
  return result
}

/**
 * The usage hint the picker may render for a command: the agent's own
 * `args_hint`, corrected to the forms the exec route will actually accept.
 *
 * Five cases, one per argument mechanism in `SlashExecAllowEntry`:
 *
 *   1. **Not on the allowlist** — returned unchanged. That is skill commands
 *      and bundle slugs (whose arguments are free prompt text, so the agent's
 *      hint is already true of them) and the ~140 catalog commands that are
 *      never advertised at all because `runnable` is false.
 *   2. **`onlyArgs`** — replaced by the permitted set, unbracketed, because
 *      the bare form is REFUSED and `[…]` would say the opposite. `/compress`
 *      goes from `[here [N] | focus topic | --preview|--dry-run]` — three
 *      quarters of which is refused, and one quarter of which really
 *      compresses — to `--dry-run | --preview`.
 *   3. **`optionalCount`** — replaced by the bound, as a metavariable, since
 *      the permitted set is 365 values wide: `[<days 1-365>]`. The brackets
 *      are honest here; bare runs.
 *   4. **`allowArgs: false`** — no hint at all. This is the bug in its purest
 *      form: ten of the fifteen entries are bare-only, six of them arrive with
 *      a hint listing subcommands, and every one of those subcommands is
 *      refused. `isBareOnlySlashCommand` already strips the *completions* for
 *      these; the hint was the half nobody stripped.
 *   5. **`allowArgs: true`** — the agent's hint, minus any `phantomArgs`
 *      alternatives. `/learn` and `/subgoal` pass through untouched, which is
 *      right: their arguments are the payload and any text is valid.
 */
export function slashUsageHint(
  command: string,
  catalogHint?: string | null,
): string | null {
  const key = command.trim().toLowerCase()
  const hint = typeof catalogHint === 'string' ? catalogHint.trim() : ''
  const entry = Object.prototype.hasOwnProperty.call(SLASH_EXEC_ALLOWLIST, key)
    ? SLASH_EXEC_ALLOWLIST[key]
    : null
  if (!entry) return hint || null
  if (entry.onlyArgs) return [...entry.onlyArgs].sort().join(' | ')
  if (entry.optionalCount) {
    return `[<${entry.optionalCount.label} 1-${entry.optionalCount.max}>]`
  }
  if (!entry.allowArgs) return null
  if (!hint) return null
  if (!entry.phantomArgs) return hint
  return subtractPhantomForms(hint, entry.phantomArgs.words)
}
