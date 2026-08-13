/**
 * Tier policy for Hermes agent commands — the ONE home for this decision.
 *
 * Source of truth: `docs/plans/hermes-slash-commands-in-switchui.md` §4
 * ("Command inventory, ranked by value"). The doc's tier letters map onto the
 * wire-facing names used here:
 *
 *   doc tier A → `local`     handle in SwitchUI / deep-link to an existing screen
 *   doc tier B → `proxy`     proxy the agent's text output (`slash.exec`)
 *   doc tier C → `prompt`    prompt-shaping via `command.dispatch`
 *   doc tier D → `excluded`  never routed to the agent
 *
 * Why the policy lives server-side: the tier is computed once, in
 * `GET /api/hermes-commands`, so the menu, the exec route's blocklist, and any
 * future surface all read the same answer. §5 step 7 of the doc.
 *
 * ── Safety notes that this map encodes ────────────────────────────────────
 * `slash.exec` runs mutating commands inside a *separate* `HermesCLI`
 * subprocess (`tui_gateway/slash_worker.py`); only seven commands have their
 * side effects mirrored back onto the live agent — `model`, `personality`,
 * `prompt`, `compress`, `fast`, `reload-mcp`, `stop` (§2.5). Everything else
 * mutates a throwaway process and returns a success banner. So `proxy` is only
 * ever assigned to read-only commands, and anything mutating is `local`
 * (structured RPC / REST) or `excluded`.
 *
 * ── Unlisted commands fail closed ─────────────────────────────────────────
 * A registry command that is not in this map resolves to `excluded`. Skill
 * commands (which arrive uncategorized from `commands.catalog` and are not in
 * the doc at all) resolve to `prompt` — they are skill invocations that go
 * through the send path, not agent-state mutations. See `resolveCommandTier`.
 *
 * ── Bundle slugs are the third case ───────────────────────────────────────
 * Since agent v0.19.16 `commands.catalog` also emits skill-bundle slugs, and
 * unlike skills they arrive *categorized* — the agent files them under a
 * "Bundles" bucket. So the categorized/uncategorized signal cannot tell them
 * apart from registry commands, and the fail-closed default would tier every
 * one of them `excluded`. They are identified by the payload's own top-level
 * `bundles` list instead, and resolve to `prompt` for the same reason skills
 * do: `command.dispatch` answers `{type:'send', message}` and the message goes
 * down the ordinary send path.
 */

export type HermesCommandTier = 'local' | 'proxy' | 'prompt' | 'excluded'

/**
 * Canonical command → tier. Keys include the leading slash and are the
 * canonical names `commands.catalog` returns in `pairs` (it emits no aliases;
 * aliases live in its `canon` map and are resolved before lookup).
 */
export const COMMAND_TIERS: Readonly<Record<string, HermesCommandTier>> = {
  // ── §4.1 The default menu — 12 commands that earn their place ──────────
  '/undo': 'prompt', // returns {type:"prefill"} → composer
  '/compress': 'prompt', // context-ring remedy; see the --preview trap in §7.2
  '/branch': 'local', // forkSession() + POST /api/sessions/{id}/fork already exist
  '/new': 'local',
  '/model': 'local', // native and correct — never route to the agent (§7.3)
  // The usage-meter feature was removed entirely — header pill, details
  // dialog, ⌘K entry, `/usage` handler and the `/api/provider-usage` route it
  // was the only consumer of. The agent's own `/usage` stays refused (it reads
  // zero on a resumed session), so nothing surfaces usage as a command.
  '/usage': 'local',
  '/help': 'local', // rendered from this very catalog
  '/skills': 'local',
  '/kanban': 'local', // /tasks + /boards screens
  '/cron': 'local', // the /jobs screen IS the crons screen
  '/learn': 'prompt',
  '/title': 'local',

  // ── §4.2 Worth building, second tier ───────────────────────────────────
  '/rollback': 'local', // rollback.list/diff/restore; gate on checkpoints.enabled
  '/background': 'local', // returns {task_id}; needs the event channel + task tray
  '/topup': 'local', // billing.* — render the URL, never webbrowser.open (§7.3)
  '/subscription': 'local', // subscription.* — same
  '/steer': 'prompt', // real mid-turn injection; live agent only, via /api/ws
  '/reasoning': 'local',
  '/fast': 'local',
  '/suggestions': 'proxy', // read-only; accept → jump to /jobs
  '/bundles': 'proxy', // short self-describing markdown
  '/memory': 'proxy', // write-approval queue — do NOT deep-link /memory (§4.2)
  '/reload-skills': 'proxy', // pure action + short diff
  '/curator': 'local', // dashboard REST; prune/rollback are interactive → not exposed
  '/debug': 'proxy', // requires an explicit consent modal — leaks PII (§7.3)
  '/tools': 'local',
  '/toolsets': 'local',

  // ── §4.3 Already covered better — deep-link only, never proxy ──────────
  '/status': 'local',
  '/insights': 'local',
  '/platforms': 'local',
  '/version': 'local',
  '/update': 'local',
  '/history': 'local',
  '/profile': 'local',
  '/plugins': 'local',
  '/agents': 'local', // `/tasks` is an alias of `/agents` in the live registry
  '/sessions': 'local',
  '/resume': 'local',
  '/save': 'local',
  '/clear': 'local',
  '/config': 'local',
  '/skin': 'local',
  '/journey': 'local',
  '/queue': 'local',
  '/copy': 'local', // must use navigator.clipboard; the agent writes OSC52

  // ── §4.4 Exclude ───────────────────────────────────────────────────────
  // Terminal-only.
  '/redraw': 'excluded',
  '/statusbar': 'excluded',
  '/indicator': 'excluded',
  '/busy': 'excluded',
  '/timestamps': 'excluded',
  '/verbose': 'excluded',
  '/prompt': 'excluded', // $EDITOR on the CLI side; means something else over RPC
  '/quit': 'excluded',
  '/mouse': 'excluded', // _TUI_EXTRA
  '/logs': 'excluded', // _TUI_EXTRA
  // _TUI_EXTRA's "/compact — Toggle compact display mode". NOTE: `/compact` is
  // ALSO the alias `canon` maps to `/compress`. `pairs` only ever carries the
  // TUI display toggle under this name, so excluding it is correct; the
  // compress capability is reached through `/compress` above. Alias resolution
  // in the catalog route must not be allowed to turn this into `/compress`.
  '/compact': 'excluded',
  // Host-bound — would act on the agent's machine, not the user's browser.
  '/paste': 'excluded',
  '/image': 'excluded',
  '/browser': 'excluded',
  '/voice': 'excluded',
  '/reload': 'excluded',
  // Blocked or unsafe over RPC.
  '/snapshot': 'excluded', // _WORKER_BLOCKED_COMMANDS in tui_gateway/server.py
  '/handoff': 'excluded', // 60s block vs a 45s worker timeout → orphaned state
  // No web meaning.
  '/whoami': 'excluded', // no role model in SwitchUI; no CLI handler either
  '/pet': 'excluded',
  '/hatch': 'excluded', // bare form is interactive

  // ── Registry commands the doc does not tier explicitly ─────────────────
  // Listed rather than left to the fail-closed default so every command the
  // live registry returns has a reason attached.
  '/retry': 'prompt', // in the _PENDING_INPUT set → routed to command.dispatch
  '/moa': 'prompt', // same set
  // Both were `excluded` for reasons that agent v0.19.14 retired. The old
  // ones, kept because they say what changed: "/goal — judge loop needs the
  // live agent; state never fires" and "/subgoal — unreachable via
  // command.dispatch — falls to 4018". Neither is true of the installed build:
  // `_evaluate_goal_after_turn` (gateway/platforms/api_server.py:3544) runs the
  // judge after every turn on the path SwitchUI actually sends over, and
  // `subgoal` has its own dispatch branch (tui_gateway/server.py:13986) plus
  // membership of `_DISPATCH_ROUTED_COMMANDS` (:13336), so it never reaches the
  // 4018 fallthrough. Both verified live on a throwaway session, 2026-08-13.
  // `prompt` (doc tier C) because both take the command.dispatch route — see
  // their entries in hermes-slash-policy.ts for the answer shapes, which
  // differ: `/goal <text>` answers {type:'send'}, everything else {type:'exec'}.
  '/goal': 'prompt',
  '/subgoal': 'prompt',
  '/blueprint': 'excluded', // `slot=…` creates cron jobs that will fire (§7.3)
  '/yolo': 'excluded', // safety-critical: reports success, bypasses nothing (§2.5)
  '/personality': 'excluded', // clobbers agent.system_prompt globally, no backup (§7.2)
  '/stop': 'excluded', // name collision with SwitchUI's own /stop (§7.3)
  '/reload-mcp': 'proxy', // one of the seven mirrored commands (§2.5)
  '/footer': 'excluded', // terminal chrome, same family as /statusbar
  '/codex-runtime': 'excluded', // not in the inventory — fail closed
}

/**
 * Tier for a command from `commands.catalog`.
 *
 * @param command  canonical command including the leading slash
 * @param options.categorized
 *   Whether the command appeared inside a `categories[].pairs` bucket.
 *   `commands.catalog` appends skill commands to `pairs` WITHOUT adding them to
 *   any category, so "not categorized" is exactly the skill-command signal.
 *   Skill commands are prompt-shaping (`command.dispatch` → `skill` → send
 *   path); unknown *registry* commands fail closed.
 * @param options.bundle
 *   Whether the payload's top-level `bundles` list named this command. Checked
 *   **before** `COMMAND_TIERS`, which looks backwards for a fail-closed map but
 *   is the honest order: the agent only lists a bundle slug after proving the
 *   registry does NOT claim it (`resolve_command(slug) is None`, plus every
 *   earlier dispatch branch), so if a static entry here ever collided with a
 *   live bundle slug, that entry would be describing a command which is not the
 *   one dispatch would run.
 */
export function resolveCommandTier(
  command: string,
  options: { categorized: boolean; bundle?: boolean },
): HermesCommandTier {
  if (options.bundle === true) return 'prompt'
  const key = command.trim().toLowerCase()
  if (Object.prototype.hasOwnProperty.call(COMMAND_TIERS, key)) {
    return COMMAND_TIERS[key]
  }
  return options.categorized ? 'excluded' : 'prompt'
}
