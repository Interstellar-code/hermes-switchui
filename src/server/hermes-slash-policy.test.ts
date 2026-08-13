import { describe, expect, it } from 'vitest'

import {
  INTENTIONALLY_SHADOWED_COMMANDS,
  MIN_AGENT_VERSION_FOR_SLASH_EXEC,
  SLASH_EXEC_ALLOWLIST,
  SLASH_REFUSALS,
  agentVersionFloorRefusal,
  evaluateSlashCommand,
  isBareOnlySlashCommand,
  isSlashCommandRunnable,
  slashArgumentCompletions,
  slashUsageHint,
  usageHintLiteralForms,
} from './hermes-slash-policy'
import type { EvaluateSlashOptions } from './hermes-slash-policy'

/**
 * The version the agent on this host runs, and the floor itself. Every case
 * below that is *not* about the floor passes this, so the existing behaviour
 * is asserted against an agent new enough for the allowlist to be open. The
 * floor's own tests pass older, equal, unknown and malformed versions
 * explicitly.
 */
const CURRENT_AGENT_VERSION = '0.19.16'

function evaluate(
  input: string,
  options: Partial<EvaluateSlashOptions> = {},
): ReturnType<typeof evaluateSlashCommand> {
  return evaluateSlashCommand(input, {
    agentVersion: CURRENT_AGENT_VERSION,
    ...options,
  })
}

function canRun(
  command: string,
  options: { isSkillCommand: boolean; isBundleCommand?: boolean; agentVersion?: string | null },
): boolean {
  return isSlashCommandRunnable(command, {
    agentVersion: CURRENT_AGENT_VERSION,
    ...options,
  })
}

/**
 * The refusals are tested at least as hard as the successes.
 *
 * A command that is merely *hidden* from the picker is not refused — the whole
 * point of this module is that the control lives server-side. So every case
 * below asserts on `evaluateSlashCommand`, which is what the exec route calls,
 * not on what any menu happens to list.
 *
 * Every pattern here is pinned to the *v0.19.13* justification, measured with
 * the dashboard running `--isolated` so it shares the gateway's database. That
 * matters in both directions: a refusal arguing from a defect the agent fixed
 * is a refusal that lies, and so is one arguing from the profile-DB split that
 * this host no longer has.
 */

const REFUSED_BY_NAME = [
  // Read an in-memory object that never runs a turn — not a DB problem, and
  // not fixable by one.
  ['/status', /Agent Running/i],
  ['/usage', /header meter|still 0/i],
  ['/systemprompt', /never runs a turn|demonstrably has one/i],

  // Destructive.
  ['/compress', /not reversible|--preview/i],
  ['/snapshot', /4018/i],
  ['/snap', /4018/i],
  // Bare /debug and /debug nous upload; /debug local does not and is allowed.
  ['/debug', /public\* paste|NOT redacted|\/debug local/i],

  // Act on a process that is not the one serving this chat.
  ['/yolo', /api\/sessions|enforces nothing/i],
  ['/personality', /agent\.personality|never reads/i],
  ['/reload-mcp', /prompt cache|dashboard's copy/i],
  ['/model', /model picker/i],
  ['/fast', /service_tier/i],
  ['/handoff', /one-way transfer|confirmation step/i],
  ['/stop', /interrupt/i],

  // Not interactive, and SwitchUI already has the affordance.
  ['/new', /New chat button/i],
  ['/update', /Settings → Updates/i],
  ['/save', /No conversation to save/i],
  ['/prompt', /\$EDITOR|classic CLI/i],
  ['/indicator', /Unknown command/i],

  // Not reachable, or superseded by a screen. `/bundles` used to sit here as
  // the one CONDITIONAL refusal; agent v0.19.16 emits the slugs it lists, so
  // the condition was met and it moved to the allowlist. There is no refusal
  // left for it.
  ['/context', /not reachable/i],
  ['/tools', /Toolsets screen/i],
] as const

describe('evaluateSlashCommand — refusals', () => {
  for (const [command, reasonPattern] of REFUSED_BY_NAME) {
    it(`refuses ${command} server-side, with a reason`, () => {
      const decision = evaluate(command)
      expect(decision.ok).toBe(false)
      if (decision.ok) return
      expect(decision.command).toBe(command)
      expect(decision.reason).toMatch(reasonPattern)
      // The reason names the command, so a toast makes sense on its own.
      expect(decision.reason).toContain(command)
    })
  }

  it('covers every refusal entry — none is left untested', () => {
    expect(Object.keys(SLASH_REFUSALS).sort()).toEqual(
      REFUSED_BY_NAME.map(([command]) => command).sort(),
    )
  })

  it('never blames a defect the agent has already fixed', () => {
    // #218–#226 all shipped in agent v0.19.12, and v0.19.13 re-fixed #219. A
    // user-visible refusal citing one of them would send its reader to a closed
    // issue and teach them something false about their own agent. The refusals
    // that survived the fixes survived for *different* reasons, and must say so.
    for (const [command, reason] of Object.entries(SLASH_REFUSALS)) {
      expect(reason, command).not.toMatch(/hermes-agent#\d+/i)
      expect(reason, command).not.toMatch(/#2(1[89]|2[0-6])\b/)
    }
  })

  it('no longer argues from a profile-database split this host does not have', () => {
    // The dashboard runs `--isolated` and shares profiles/hermes-switch/state.db
    // with the gateway (verified live: /history renders the gateway DB's newest
    // message). A refusal still saying "reads a different database" or "the
    // stale copy" would be as false as one citing a closed issue.
    for (const [command, reason] of Object.entries(SLASH_REFUSALS)) {
      expect(reason, command).not.toMatch(/different database/i)
      expect(reason, command).not.toMatch(/stale copy/i)
      expect(reason, command).not.toMatch(/messages behind/i)
    }
  })

  it('fails closed on a command nobody has tiered', () => {
    const decision = evaluate('/some-command-that-does-not-exist')
    expect(decision.ok).toBe(false)
    if (decision.ok) return
    expect(decision.reason).toMatch(/allowlist/i)
  })

  it('refuses every registry command outside the allowlist', () => {
    // A sample of the wider registry — none of these are on the allowlist and
    // none may run just because they are harmless-looking. `/learn`,
    // `/curator`, `/memory`, `/suggestions`, `/insights` and `/version` moved
    // to the allowlist in the 12-command pass, and `/bundles` — proposed with
    // them, held back, and then unheld once agent v0.19.16 started emitting
    // the bundle slugs it lists — in the 13-command pass.
    for (const command of [
      '/undo',
      '/rollback',
      '/background',
      '/steer',
      // `/goal` and `/subgoal` were here until agent v0.19.14 gave api_server a
      // post-turn hook (hermes-agent#230) — before that a goal set from the web
      // was stored and never evaluated. Both are on the allowlist now.
      '/blueprint',
      '/reload-skills',
      '/journey',
      '/queue',
      '/retry',
      '/branch',
      '/title',
      '/clear',
      '/skills',
      '/kanban',
      '/cron',
      '/config',
      // Gone from `commands.catalog` since v0.19.12 (re-checked today: absent
      // from `pairs`), but the exec route must refuse it regardless of what the
      // catalog says.
      '/whoami',
    ]) {
      expect(evaluate(command).ok).toBe(false)
    }
  })

  it('refuses an alias that resolves onto a refused form', () => {
    // `/compact` → `/compress` in the agent's own `canon` map. Resolving the
    // alias BEFORE the allowlist lookup is what stops it smuggling one past —
    // and bare `/compress` is refused, so bare `/compact` must be too.
    const decision = evaluate('/compact', {
      aliases: { '/compact': '/compress' },
    })
    expect(decision.ok).toBe(false)
    if (decision.ok) return
    expect(decision.command).toBe('/compress')
    expect(decision.reason).toMatch(/not reversible/i)
  })

  it('resolves an alias onto an allowed argument form too', () => {
    const decision = evaluate('/compact --preview', {
      aliases: { '/compact': '/compress' },
    })
    expect(decision).toMatchObject({
      ok: true,
      command: '/compress',
      args: '--preview',
      route: 'exec',
      mode: 'live',
    })
  })

  it('refuses an alias pointing at a command that is merely unlisted', () => {
    const decision = evaluate('/fork', {
      aliases: { '/fork': '/branch' },
    })
    expect(decision.ok).toBe(false)
    if (decision.ok) return
    expect(decision.command).toBe('/branch')
  })

  it('refuses anything that is not a slash command', () => {
    expect(evaluate('status').ok).toBe(false)
    expect(evaluate('').ok).toBe(false)
    expect(evaluate('   ').ok).toBe(false)
  })
})

describe('evaluateSlashCommand — argument filtering', () => {
  it('refuses arguments on every bare-only allowlisted command', () => {
    // Ten of the thirteen. The three that take an argument in some form are
    // covered by their own describe blocks below.
    const bareOnly = Object.keys(SLASH_EXEC_ALLOWLIST).filter((command) =>
      isBareOnlySlashCommand(command),
    )
    expect(bareOnly.sort()).toEqual([
      '/bundles',
      '/curator',
      '/help',
      '/history',
      '/memory',
      '/profile',
      '/reasoning',
      '/suggestions',
      '/version',
    ])

    for (const command of bareOnly) {
      const entry = SLASH_EXEC_ALLOWLIST[command]
      const bare = evaluate(command)
      expect(bare.ok, command).toBe(true)
      if (bare.ok) expect(bare.args).toBe('')

      const withArg = evaluate(`${command} something`)
      expect(withArg.ok, command).toBe(false)
      if (withArg.ok) continue
      expect(withArg.reason, command).toContain(command)
      if (entry.argsRefusal) {
        expect(withArg.reason, command).toBe(`${command} ${entry.argsRefusal}`)
      } else {
        expect(withArg.reason, command).toMatch(/on its own/i)
      }
    }
  })

  it('refuses the mutating subcommand of every bare-only new entry', () => {
    // These are the forms that make the bare-only rule worth having, and the
    // reason each of them was NOT executed against the live agent: they create
    // a cron job, write the real memory store, wedge the worker on input(), or
    // rewrite config.yaml. Each must be refused by name, not merely absent
    // from a menu.
    for (const input of [
      '/curator prune',
      '/curator rollback',
      '/curator run',
      '/curator archive',
      '/memory approve 1',
      '/memory reject 1',
      '/memory approval off',
      '/suggestions accept',
      '/suggestions accept 1',
      '/suggestions dismiss 1',
      '/suggestions catalog',
      '/reasoning high',
      '/reasoning high --global',
      '/reasoning show',
      '/reasoning full',
      '/profile switch other',
      '/version --check',
      '/help all',
      '/history 20',
    ]) {
      const decision = evaluate(input)
      expect(decision.ok, input).toBe(false)
      if (decision.ok) continue
      expect(decision.reason, input).toContain(input.split(' ')[0])
    }
  })

  it('never understates what a refused subcommand would really do', () => {
    // The generic bare-only line ends "…in a throwaway copy of your agent and
    // report success, leaving the real one untouched." That is true of the
    // mirror-bound commands it was written for and FALSE of these three:
    // `/memory approve` writes the on-disk store, `/suggestions accept`
    // creates a cron job that fires, `/curator prune` hangs rather than
    // reporting anything. A refusal that reassures is worse than none.
    for (const command of ['/curator', '/memory', '/suggestions']) {
      const entry = SLASH_EXEC_ALLOWLIST[command]
      expect(entry.argsRefusal, command).toBeTruthy()
      expect(entry.argsRefusal, command).not.toMatch(/throwaway/i)
      expect(entry.argsRefusal, command).not.toMatch(/leaving the real one/i)
    }

    // And each names the specific hazard.
    expect(SLASH_EXEC_ALLOWLIST['/curator'].argsRefusal).toMatch(/hang/i)
    expect(SLASH_EXEC_ALLOWLIST['/memory'].argsRefusal).toMatch(/on-disk store/i)
    expect(SLASH_EXEC_ALLOWLIST['/suggestions'].argsRefusal).toMatch(
      /scheduled job|fire/i,
    )
    // /reasoning keeps the throwaway framing, because for a level it is the
    // truth — but it must still name the writes that are global.
    expect(SLASH_EXEC_ALLOWLIST['/reasoning'].argsRefusal).toMatch(
      /config\.yaml globally/,
    )
  })

  it('refuses /tools enable, which mutates a throwaway subprocess', () => {
    const decision = evaluate('/tools enable web_search')
    expect(decision.ok).toBe(false)
  })

  it('tolerates trailing whitespace as a bare command', () => {
    expect(evaluate('  /help   ').ok).toBe(true)
  })
})

describe('evaluateSlashCommand — /debug, where bare is the dangerous form', () => {
  // `local` never uploads: _handle_debug_command computes `local = "local" in
  // words` and then `nous = "nous" in words and not local`, so local wins and
  // run_debug_share renders to stdout. Bare /debug uploads to a PUBLIC paste
  // and /debug nous uploads to Nous storage; neither was executed.
  it('allows only /debug local', () => {
    expect(evaluate('/debug local')).toMatchObject({
      ok: true,
      command: '/debug',
      args: 'local',
      route: 'exec',
      mode: 'worker',
    })
    expect(evaluate('  /DEBUG   LOCAL  ')).toMatchObject({
      ok: true,
      command: '/debug',
      args: 'local',
    })
  })

  it('refuses bare /debug and /debug nous, which are the two that upload', () => {
    for (const input of [
      '/debug',
      '/debug nous',
      // The agent's own parse is set membership, so `local nous` and
      // `nous local` would BOTH be local there. This layer does not care: only
      // the exact string `local` passes, so a form the reviewer never looked at
      // never reaches the wire.
      '/debug local nous',
      '/debug nous local',
      '/debug --local',
      '/debug locally',
    ]) {
      expect(evaluate(input).ok, input).toBe(false)
    }
  })

  it('explains the refusal with the upload risk and points at the safe form', () => {
    const decision = evaluate('/debug nous')
    expect(decision.ok).toBe(false)
    if (decision.ok) return
    expect(decision.reason).toBe(`/debug ${SLASH_REFUSALS['/debug']}`)
    expect(decision.reason).toMatch(/\/debug local/)
  })
})

describe('evaluateSlashCommand — /insights, the one numeric argument', () => {
  // Bare AND `<n>` run; nothing else does. The agent is no help here: its parse
  // loop ends in `else: i += 1`, so it silently skips tokens it does not
  // understand and answers with the default 30-day report — measured, that is
  // exactly what `/insights --preview` returns. So this layer is the only place
  // a bad argument can be caught, and it has to fail closed.
  it('allows the bare form', () => {
    expect(evaluate('/insights')).toMatchObject({
      ok: true,
      command: '/insights',
      args: '',
      route: 'exec',
      mode: 'worker',
    })
  })

  it('allows a whole number of days and forwards it verbatim', () => {
    for (const days of ['1', '3', '7', '30', '365']) {
      expect(evaluate(`/insights ${days}`), days).toMatchObject({
        ok: true,
        command: '/insights',
        args: days,
      })
    }
  })

  it('refuses everything that is not a plain in-range whole number', () => {
    for (const input of [
      // Shell metacharacters — the case that matters most, even though the
      // args never reach a shell: nothing on this path may pass an unreviewed
      // string to the agent. Both spacings, because they take different
      // routes to the same refusal: `/insights;` tokenizes as an unknown
      // COMMAND (whitespace is the only separator), while `/insights ; rm -rf`
      // reaches the allowlist and is refused by the argument rule.
      '/insights; rm -rf',
      '/insights ; rm -rf',
      '/insights && whoami',
      '/insights $(id)',
      '/insights `id`',
      '/insights | cat',
      // Flags. The agent accepts `--days N` and ignores anything else; neither
      // is offered here, because "ignored" is indistinguishable from "worked".
      '/insights --preview',
      '/insights --days 3',
      '/insights --source cli',
      // Out of range, or not a bare positive integer.
      '/insights 0',
      '/insights -1',
      '/insights 366',
      '/insights 99999',
      '/insights 007',
      '/insights +3',
      '/insights 3.0',
      '/insights 3d',
      '/insights 3 4',
      '/insights 3 --source cli',
      '/insights thirty',
      // Non-ASCII digits. Python's str.isdigit() accepts these, so the agent
      // would parse `/insights ٣`; JS \d does not, so this layer refuses it.
      '/insights ٣',
      '/insights ３',
    ]) {
      expect(evaluate(input).ok, input).toBe(false)
    }
  })

  it('explains what it does take, and why a wrong argument is not silently run', () => {
    const decision = evaluate('/insights --preview')
    expect(decision.ok).toBe(false)
    if (decision.ok) return
    expect(decision.reason).toMatch(/whole number of days \(1–365\)/)
    expect(decision.reason).toMatch(/looks exactly like success/i)
  })
})

describe('evaluateSlashCommand — /learn, the one free-argument entry', () => {
  // Its arguments ARE the payload: build_learn_prompt(arg) interpolates them
  // into the prompt that goes down the normal send path. Nothing is mutated,
  // which is why this is the same trust level as a skill command.
  it('takes the dispatch route with its arguments intact', () => {
    expect(
      evaluate('/learn ./src/server and focus on the RPC layer'),
    ).toMatchObject({
      ok: true,
      command: '/learn',
      args: './src/server and focus on the RPC layer',
      route: 'dispatch',
      mode: 'live',
    })
  })

  it('runs bare too — the agent substitutes its own default source', () => {
    expect(evaluate('/learn')).toMatchObject({
      ok: true,
      command: '/learn',
      args: '',
      route: 'dispatch',
    })
  })

  it('preserves the argument text rather than lowercasing it', () => {
    // The onlyArgs path normalizes case because it matches literals; this one
    // must not, or every URL and path the user types would be mangled.
    const decision = evaluate('/learn https://Example.com/Docs')
    expect(decision.ok).toBe(true)
    if (!decision.ok) return
    expect(decision.args).toBe('https://Example.com/Docs')
  })
})

describe('evaluateSlashCommand — the argument-restricted entry', () => {
  // `/compress --preview` is read-only in agent 0.19.13 and, with the dashboard
  // sharing the gateway's database, now reports the session's real size
  // (measured: "366 of 366 message(s) (~212,130 tokens)"). Bare `/compress`
  // still compresses and rotates the session, so the bare form must stay
  // refused while exactly two flags run. `allowArgs` is a boolean and cannot
  // express that; `onlyArgs` is what does.
  it('allows only the two preview flags', () => {
    for (const flag of ['--preview', '--dry-run']) {
      const decision = evaluate(`/compress ${flag}`)
      expect(decision, flag).toMatchObject({
        ok: true,
        command: '/compress',
        args: flag,
        route: 'exec',
        mode: 'live',
      })
    }
  })

  it('normalizes case and spacing on the permitted form', () => {
    expect(evaluate('  /COMPRESS   --PREVIEW  ')).toMatchObject({
      ok: true,
      command: '/compress',
      args: '--preview',
    })
  })

  it('refuses the bare form and every other argument', () => {
    // Including the forms the agent itself now rejects, and — critically —
    // anything that merely *starts* with a permitted flag: `--preview` is
    // matched as the whole argument string, never as a prefix.
    for (const input of [
      '/compress',
      '/compress here 5',
      '/compress --aggressive',
      '/compress refactor plan',
      '/compress --preview refactor plan',
      '/compress --preview --aggressive',
      '/compress --previewish',
    ]) {
      expect(evaluate(input).ok, input).toBe(false)
    }
  })

  it('explains a rejected argument with the bare form’s own reason', () => {
    // Not the generic "run it without arguments" line, which would be actively
    // wrong here — bare is the one form that must not run.
    const decision = evaluate('/compress here 5')
    expect(decision.ok).toBe(false)
    if (decision.ok) return
    expect(decision.reason).toBe(`/compress ${SLASH_REFUSALS['/compress']}`)
    expect(decision.reason).toMatch(/--preview/)
  })
})

describe('evaluateSlashCommand — what is allowed', () => {
  // Was three, then twelve. The nine Phase 4 additions were each executed live
  // against a throwaway tui_gateway session on 2026-08-12 rather than against
  // the user's chat, and `/bundles` the same way on 2026-08-13 against agent
  // v0.19.16. An exact-equality assertion, deliberately: adding an entry must
  // be a decision someone makes here, not a diff that slips through.
  it('allows exactly fifteen commands', () => {
    expect(Object.keys(SLASH_EXEC_ALLOWLIST).sort()).toEqual([
      '/bundles',
      '/compress',
      '/curator',
      '/debug',
      // `/goal` and `/subgoal` joined on 2026-08-13 against agent v0.19.16,
      // once v0.19.14's post-turn hook made a goal set from the web actually
      // fire. Measured the same way as the rest — a throwaway tui_gateway
      // session bound to a throwaway api_server session, including a real
      // three-turn continuation.
      '/goal',
      '/help',
      '/history',
      '/insights',
      '/learn',
      '/memory',
      '/profile',
      '/reasoning',
      '/subgoal',
      '/suggestions',
      '/version',
    ])
  })

  it('every entry carries a measurement, not just a rationale', () => {
    for (const [command, entry] of Object.entries(SLASH_EXEC_ALLOWLIST)) {
      expect(entry.why, command).toMatch(/measured/i)
    }
  })

  it('lets exactly three entries take free-form arguments', () => {
    // `allowArgs: true` is how a read-only command becomes a mutating one, so
    // it is not a default anybody should reach for. All three earn it the same
    // way: the argument IS the payload, not a switch that changes what the
    // command does. `/learn` learns from its text, `/goal` sets its text as the
    // objective, `/subgoal` adds its text as a criterion. Any entry where the
    // argument selects a BEHAVIOUR (`/tools enable`, `/memory approve`,
    // `/reasoning high`) stays bare-only.
    const free = Object.entries(SLASH_EXEC_ALLOWLIST)
      .filter(([, entry]) => entry.allowArgs)
      .map(([command]) => command)
      .sort()
    expect(free).toEqual(['/goal', '/learn', '/subgoal'])
  })

  it('refuses the /goal subcommands the agent advertises but does not implement', () => {
    // The registry's args_hint (hermes_cli/commands.py:116) promises
    // `draft <text> | show | wait <pid> | unwait`, `commands.catalog` serves
    // that hint into the picker, and the dispatch branch
    // (tui_gateway/server.py:13915) has no branch for any of them: they fall
    // through to `mgr.set(arg)`. Measured live 2026-08-13 — `/goal show`
    // answered "⊙ Goal set (20-turn budget): show" and submitted a turn. That
    // is the /insights failure mode with a token bill attached, so this layer
    // is the one that has to catch it.
    for (const input of [
      '/goal show',
      '/goal unwait',
      '/goal draft the release notes',
      '/goal wait 12345',
      '/goal WAIT 12345',
    ]) {
      const decision = evaluate(input)
      expect(decision.ok, input).toBe(false)
      if (decision.ok) continue
      // The refusal names the forms that DO work, because a hint listing forms
      // that do not is the whole defect being corrected.
      expect(decision.reason, input).toMatch(/\/goal pause/)
      expect(decision.reason, input).toMatch(/reword/i)
    }
  })

  it('lets /goal set a goal and drive it, including the words that stop it', () => {
    // Only the first token is inspected, so an ordinary goal that merely
    // contains one of the phantom words is unaffected.
    for (const input of [
      '/goal',
      '/goal status',
      '/goal pause',
      '/goal resume',
      '/goal clear',
      '/goal ship the release and wait for CI',
      '/goal Draft-mode rewrite of the parser',
    ]) {
      const decision = evaluate(input)
      expect(decision.ok, input).toBe(true)
      if (!decision.ok) continue
      expect(decision.command, input).toBe('/goal')
      expect(decision.route, input).toBe('dispatch')
      // Arguments reach the agent verbatim: the text IS the goal, and
      // `pause`/`resume`/`clear` are the only brakes on a loop that spends
      // real turns. Refusing them would leave a user able to start one and
      // unable to stop it.
      expect(decision.args, input).toBe(input.slice('/goal'.length).trim())
    }
  })

  it('passes the /subgoal grammar through to the agent, which answers 4004 on a bad one', () => {
    // Deliberately NOT re-implemented here. Measured live: `remove` → 4004
    // "usage: /subgoal remove <n>", `remove abc` → 4004 "<n> must be an
    // integer (1-based index)", `remove 9` → 4004 "index out of range (1..1)".
    // A 4004 is a fixable message, not a "command does not exist" — the agent
    // says so in its own comment (server.py:14044) — so mirroring the grammar
    // here would add a second parser that can disagree with the first.
    for (const input of [
      '/subgoal',
      '/subgoal remove 1',
      '/subgoal clear',
      '/subgoal say only the number',
    ]) {
      const decision = evaluate(input)
      expect(decision.ok, input).toBe(true)
      if (!decision.ok) continue
      expect(decision.route, input).toBe('dispatch')
      expect(decision.args, input).toBe(input.slice('/subgoal'.length).trim())
    }
  })

  it('keeps the phantom-argument rule to the one entry that needs it', () => {
    // It subtracts from a free grammar rather than defining one, so it is only
    // meaningful on an `allowArgs` entry — and it exists solely because the
    // agent advertises forms it does not implement. A second holder means a
    // second agent-side defect, which is worth noticing.
    const holders = Object.entries(SLASH_EXEC_ALLOWLIST)
      .filter(([, entry]) => entry.phantomArgs)
      .map(([command]) => command)
    expect(holders).toEqual(['/goal'])
    expect(SLASH_EXEC_ALLOWLIST['/goal'].allowArgs).toBe(true)
  })

  it('never lets one entry claim two argument rules at once', () => {
    // `onlyArgs` refuses the bare form and `optionalCount` permits it, so an
    // entry setting both would be a contradiction rather than a combination —
    // and `evaluateSlashCommand` would silently honour whichever it checked
    // first.
    for (const [command, entry] of Object.entries(SLASH_EXEC_ALLOWLIST)) {
      const rules = [entry.onlyArgs, entry.optionalCount, entry.allowArgs || null]
      expect(rules.filter(Boolean).length, command).toBeLessThanOrEqual(1)
    }
  })

  it('flags exactly the twelve entries that depend on the local --isolated dashboard', () => {
    // hermes-agent #229 is unfixed: `_get_db()` and `get_hermes_home()` are
    // process-global. A default install reads the wrong profile's database,
    // skills tree, memories, cron store and config.yaml — so every entry whose
    // answer comes off profile-scoped disk must say so rather than imply the
    // bug is gone. Silent wrong-profile data is worse than a refusal, because
    // the card looks authoritative.
    //
    // Exact counts on both sides. A new entry cannot be added without someone
    // deciding which list it belongs on. `/bundles` decided it the
    // hard way: `_bundles_dir()` is `get_hermes_home() / "skill-bundles"`, and
    // the command PRINTS that path — measured
    // "~/.hermes/profiles/hermes-switch/skill-bundles".
    //
    // `/goal` and `/subgoal` are the first two LIVE-path entries on the caveat
    // list, and they are the worst case of it. Everything else here reads
    // profile-scoped disk and shows the wrong profile's data; these two are
    // written by the dashboard process and read by the GATEWAY process
    // (goals.py:506 `_get_session_db()` → SessionDB() at get_hermes_home(),
    // with no profile_home override on either dispatch branch). Without
    // `--isolated` the two processes use different files, so the goal is
    // stored and never evaluated — which is exactly the symptom
    // hermes-agent#230 was filed for, re-created by #229.
    // The convention an entry must follow to claim the caveat: an uppercase
    // `CAVEAT` marker AND the `--isolated` token. Both, because the three
    // unaffected entries also name `--isolated` — they have to, to say why
    // they do *not* need it — and a bare token grep would count them in.
    const carriesCaveat = Object.entries(SLASH_EXEC_ALLOWLIST)
      .filter(
        ([, entry]) => /CAVEAT/.test(entry.why) && /--isolated/.test(entry.why),
      )
      .map(([command]) => command)
      .sort()

    expect(carriesCaveat).toEqual([
      '/bundles',
      '/compress',
      '/curator',
      '/debug',
      '/goal',
      '/history',
      '/insights',
      '/memory',
      '/profile',
      '/reasoning',
      '/subgoal',
      '/suggestions',
    ])

    // The three that genuinely do not read profile-scoped state, each for its
    // own measured reason: /help renders COMMAND_REGISTRY, /version reports the
    // shared install at ~/.hermes/hermes-agent (outside every profile), and
    // /learn builds a prompt string in process.
    for (const command of ['/help', '/version', '/learn']) {
      expect(SLASH_EXEC_ALLOWLIST[command].why, command).not.toMatch(/CAVEAT/)
    }
    expect(carriesCaveat.length + 3).toBe(
      Object.keys(SLASH_EXEC_ALLOWLIST).length,
    )
  })

  it('routes twelve entries to slash.exec and three to command.dispatch', () => {
    // Asserted on the entries rather than on bare evaluations, because two
    // entries (/compress, /debug) refuse their bare form by design.
    //
    // The three dispatch entries are the three whose answer is a union member
    // rather than `{output}`, and all three are in a set `slash.exec` forwards
    // straight back to `command.dispatch` anyway — `/learn` and `/goal` via
    // `_PENDING_INPUT_COMMANDS`, `/subgoal` via `_DISPATCH_ROUTED_COMMANDS`
    // (tui_gateway/server.py:13300 and :13336, both forwarded at :15582).
    // Naming the route keeps the answer shape honest instead of sniffed.
    const dispatched = Object.entries(SLASH_EXEC_ALLOWLIST)
      .filter(([, entry]) => entry.route === 'dispatch')
      .map(([command]) => command)
      .sort()
    expect(dispatched).toEqual(['/goal', '/learn', '/subgoal'])

    // …and the decision agrees, for one runnable form of every entry.
    for (const [command, entry] of Object.entries(SLASH_EXEC_ALLOWLIST)) {
      const form = entry.onlyArgs
        ? `${command} ${[...entry.onlyArgs][0]}`
        : command
      const decision = evaluate(form)
      expect(decision.ok, form).toBe(true)
      if (!decision.ok) continue
      expect(decision.route, form).toBe(entry.route ?? 'exec')
    }
  })

  it('routes allowlisted commands to slash.exec', () => {
    const decision = evaluate('/HELP')
    expect(decision).toMatchObject({
      ok: true,
      command: '/help',
      args: '',
      route: 'exec',
      mode: 'worker',
    })
  })

  it('answers /history off the live path', () => {
    expect(evaluate('/history')).toMatchObject({
      ok: true,
      command: '/history',
      args: '',
      route: 'exec',
      mode: 'live',
    })
  })

  it('resolves the aliases the live catalog serves for the new entries', () => {
    // `canon` carries `/v` → `/version` and `/suggest` → `/suggestions`
    // (measured against commands.catalog today). Resolution happens before the
    // allowlist lookup, so an alias reaches the same entry — and, for a
    // bare-only entry, the same argument rule.
    expect(
      evaluate('/v', { aliases: { '/v': '/version' } }),
    ).toMatchObject({ ok: true, command: '/version', args: '' })

    expect(
      evaluate('/suggest', { aliases: { '/suggest': '/suggestions' } }),
    ).toMatchObject({ ok: true, command: '/suggestions', args: '' })

    const mutating = evaluate('/suggest accept 1', {
      aliases: { '/suggest': '/suggestions' },
    })
    expect(mutating.ok).toBe(false)
    if (mutating.ok) return
    expect(mutating.command).toBe('/suggestions')
  })

  it('routes a skill command to command.dispatch, arguments and all', () => {
    const decision = evaluate('/arxiv attention is all you need', {
      skillCommands: new Set(['/arxiv']),
    })
    expect(decision).toMatchObject({
      ok: true,
      command: '/arxiv',
      args: 'attention is all you need',
      route: 'dispatch',
    })
  })

  it('does not treat an unknown command as a skill command', () => {
    expect(
      evaluate('/arxiv', { skillCommands: new Set(['/other']) }).ok,
    ).toBe(false)
  })

  it('routes a bundle slug to command.dispatch, arguments and all', () => {
    // Same shape as a skill command, and deliberately a separate option: a
    // bundle arrives categorized, so the "uncategorized ⇒ skill" signal cannot
    // express it, and folding it into `skillCommands` would require writing
    // `skill: true` into a catalog entry that is not a skill.
    const decision = evaluate('/research-stack summarise the RFC', {
      bundleCommands: new Set(['/research-stack']),
    })
    expect(decision).toMatchObject({
      ok: true,
      command: '/research-stack',
      // Verbatim: `build_bundle_invocation_message` interpolates this into a
      // "User instruction:" line, exactly as a skill's argument is.
      args: 'summarise the RFC',
      route: 'dispatch',
      mode: null,
    })
  })

  it('needs no allowlist entry per bundle slug', () => {
    // The requirement that shaped the design: a slug appears the moment a user
    // writes a YAML file and disappears when they delete it, so no static
    // table here could track them. Membership of the live catalog IS the
    // permission — which is why `catalogPolicyInputs` is the only producer of
    // this set and the client never supplies it.
    expect(evaluate('/research-stack').ok).toBe(false)
    expect(
      evaluate('/research-stack', {
        bundleCommands: new Set(['/research-stack']),
      }).ok,
    ).toBe(true)
  })

  it('does not treat an unknown command as a bundle', () => {
    expect(
      evaluate('/research-stack', {
        bundleCommands: new Set(['/other-stack']),
      }).ok,
    ).toBe(false)
  })

  it('never lets a bundle claim override the allowlist rules', () => {
    // The twin of the skill assertion below, and the reason the bundle branch
    // sits AFTER the allowlist: a stale or hostile catalog must not be able to
    // smuggle a refused form through by naming it a bundle. Bare /compress
    // compresses and rotates the session; it stays refused.
    expect(
      evaluate('/compress', {
        bundleCommands: new Set(['/compress']),
      }).ok,
    ).toBe(false)
  })

  it('keeps /bundles itself distinct from the slugs it lists', () => {
    // Two different things that a reader conflates at their peril. `/bundles`
    // is a registry command on the exec allowlist, worker-path, bare-only, and
    // answers with a card; a slug is a dispatch that starts a turn. A bundle
    // claim on the name `/bundles` must not turn the card into a dispatch.
    expect(
      evaluate('/bundles', {
        bundleCommands: new Set(['/bundles']),
      }),
    ).toMatchObject({
      ok: true,
      command: '/bundles',
      args: '',
      route: 'exec',
      mode: 'worker',
    })
  })

  it('refuses arguments to /bundles, which the agent would silently ignore', () => {
    // `_handle_bundles_command` takes `cmd` and never parses it, and the
    // registry CommandDef declares no args_hint and no subcommands. So an
    // argument would come back looking like a success — the /insights failure
    // mode — and this layer is the only place it can be caught.
    const decision = evaluate('/bundles list')
    expect(decision.ok).toBe(false)
    if (decision.ok) return
    expect(decision.reason).toContain('/bundles')
    expect(slashArgumentCompletions('/bundles')).toEqual([])
    expect(isBareOnlySlashCommand('/bundles')).toBe(true)
  })

  it('never lets a skill-command claim override the allowlist rules', () => {
    // A compromised or stale catalog must not be able to smuggle a refused
    // *form* through by labelling it a skill: the allowlist is consulted first,
    // so bare /compress is still refused even when it is claimed as a skill.
    const asSkill = evaluate('/compress', {
      skillCommands: new Set(['/compress']),
    })
    expect(asSkill.ok).toBe(false)

    const decision = evaluate('/yolo', {
      skillCommands: new Set(['/yolo']),
    })
    // It IS dispatchable-as-a-skill by this rule — which is why the catalog is
    // the only source of that set and it is derived from "uncategorized in
    // commands.catalog", never from client input. Assert the seam explicitly so
    // the trust boundary is visible if anyone widens it.
    expect(decision.ok).toBe(true)
    if (!decision.ok) return
    expect(decision.route).toBe('dispatch')
  })
})

describe('INTENTIONALLY_SHADOWED_COMMANDS', () => {
  /**
   * The allowlist's half of the shadow guard.
   *
   * The full invariant — "allowlisted is not shadowed, unless deliberately
   * excepted" — needs both tables and is asserted where both are in scope
   * (`slash-command-menu.test.tsx` on the lists, `use-slash-commands.test.ts`
   * on the hook's behaviour, which is what catches a leftover deep-link). This
   * file owns only the allowlist, so it pins the *licence*: what is excepted,
   * that each exception is a real allowlist entry, and that each says why.
   *
   * Exact equality, deliberately, for the same reason the twelve-entry
   * assertion above is exact: a second exception must be a decision someone
   * makes here — and argues for — not a line that slips through review. The
   * bar is that SwitchUI's answer is BETTER than the agent's, not that a screen
   * exists; that weaker test is what wrongly buried `/insights`, `/profile` and
   * `/version` under screens missing the very facts they report.
   */
  it('excepts exactly one command, and it is /help', () => {
    expect(Object.keys(INTENTIONALLY_SHADOWED_COMMANDS)).toEqual(['/help'])
  })

  it('excepts only commands that are actually on the allowlist', () => {
    for (const command of Object.keys(INTENTIONALLY_SHADOWED_COMMANDS)) {
      expect(
        Object.prototype.hasOwnProperty.call(SLASH_EXEC_ALLOWLIST, command),
        `${command} is excepted from the shadow rule but is not on SLASH_EXEC_ALLOWLIST — ` +
          `there is nothing for the exception to license.`,
      ).toBe(true)
      expect(command, command).toBe(command.toLowerCase())
      expect(command.startsWith('/'), command).toBe(true)
    }
  })

  it('gives every exception a reason that says what SwitchUI does instead', () => {
    // Not decoration: the exception is the one way an allowlist entry can be
    // made unreachable on purpose, so the reason is the only record of why the
    // measurement in its `why` will never be seen by a user.
    for (const [command, reason] of Object.entries(
      INTENTIONALLY_SHADOWED_COMMANDS,
    )) {
      expect(reason.length, command).toBeGreaterThan(80)
      expect(reason, command).toMatch(/SwitchUI|picker/i)
    }
  })
})

describe('isSlashCommandRunnable', () => {
  it('matches the allowlist for registry commands', () => {
    for (const command of Object.keys(SLASH_EXEC_ALLOWLIST)) {
      expect(
        canRun(command, { isSkillCommand: false }),
        command,
      ).toBe(true)
    }
    // Still refused after the profile fix, for reasons the fix never touched.
    // `/bundles` used to sit with them, for a different reason again — the
    // catalog could not serve the thing it lists — and no longer does.
    for (const command of [
      '/status',
      '/usage',
      '/tools',
      '/yolo',
      '/systemprompt',
    ]) {
      expect(
        canRun(command, { isSkillCommand: false }),
        command,
      ).toBe(false)
    }
  })

  it('reports the unfiltered cli_only catalog entries as not runnable', () => {
    // `commands.catalog` filters `gateway_only` but not `cli_only`, so the
    // cli_only commands still arrive in the payload. `runnable` is what keeps
    // them out of the picker, so assert it rather than assuming the catalog
    // will start filtering them. `/history` is cli_only too and IS runnable —
    // the class is not the gate, the allowlist is.
    for (const command of [
      '/prompt',
      '/indicator',
      '/save',
      '/handoff',
      '/snapshot',
      '/toolsets',
      '/config',
    ]) {
      expect(
        canRun(command, { isSkillCommand: false }),
        command,
      ).toBe(false)
    }
    expect(canRun('/history', { isSkillCommand: false })).toBe(
      true,
    )
  })

  it('treats every skill command as runnable', () => {
    expect(canRun('/arxiv', { isSkillCommand: true })).toBe(true)
  })

  it('treats every bundle slug as runnable, without an allowlist entry', () => {
    // The asymmetry that makes this a separate flag: a bundle slug IS
    // categorized, so unlike a skill it cannot be recognised by the absence of
    // a category. Without the flag it would fall through to the allowlist
    // lookup and be refused — the picker would list it and the exec route
    // would turn it down, which is precisely what `/bundles` was held back to
    // prevent.
    expect(
      canRun('/research-stack', {
        isSkillCommand: false,
        isBundleCommand: true,
      }),
    ).toBe(true)
    expect(
      canRun('/research-stack', {
        isSkillCommand: false,
        isBundleCommand: false,
      }),
    ).toBe(false)
    // Omitting the option entirely is the same as false — an older catalog
    // that knows nothing about bundles must not accidentally open the door.
    expect(canRun('/research-stack', { isSkillCommand: false })).toBe(
      false,
    )
  })

  it('advertises nothing the exec route refuses in every form', () => {
    // The menu may only list a command that has at least one runnable form.
    // For a bare-only command that means the bare form; for an
    // argument-restricted one it means a completion the picker will offer.
    for (const command of [
      ...Object.keys(SLASH_EXEC_ALLOWLIST),
      '/status',
      '/tools',
      '/yolo',
      '/new',
      '/model',
      '/systemprompt',
      '/indicator',
    ]) {
      const runnable = canRun(command, { isSkillCommand: false })
      const forms = [
        command,
        ...slashArgumentCompletions(command).map((arg) => `${command} ${arg}`),
      ]
      expect(
        forms.some((form) => evaluate(form).ok),
        command,
      ).toBe(runnable)
    }
  })
})

describe('isBareOnlySlashCommand', () => {
  it('is true for the bare-only entries and false for the rest', () => {
    for (const [command, entry] of Object.entries(SLASH_EXEC_ALLOWLIST)) {
      const takesAnArgument = Boolean(
        entry.onlyArgs || entry.optionalCount || entry.allowArgs,
      )
      expect(isBareOnlySlashCommand(command), command).toBe(!takesAnArgument)
    }
    // Not on the allowlist at all → the catalog has no subcommands to strip,
    // because the picker will not offer the command in the first place.
    expect(isBareOnlySlashCommand('/tools')).toBe(false)
  })

  it('strips the mutating subcommand menus the agent serves', () => {
    // This is what stops the picker walking a user into a refusal. The live
    // catalog serves `sub` lists for four of the new bare-only entries —
    // /reasoning ["none"…"--global"], /curator ["status","run",…],
    // /memory ["pending","approve","reject","approval"] and
    // /suggestions ["accept","dismiss","catalog","clear"] — and every one of
    // those completions would be refused. Returning true here is what makes
    // `normalizeCommandCatalog` drop them.
    for (const command of [
      '/reasoning',
      '/curator',
      '/memory',
      '/suggestions',
    ]) {
      expect(isBareOnlySlashCommand(command), command).toBe(true)
      expect(slashArgumentCompletions(command), command).toEqual([])
    }
  })
})

describe('slashArgumentCompletions', () => {
  it('offers the permitted forms for an argument-restricted command', () => {
    expect(slashArgumentCompletions('/compress')).toEqual([
      '--dry-run',
      '--preview',
    ])
    expect(slashArgumentCompletions('/COMPRESS')).toEqual([
      '--dry-run',
      '--preview',
    ])
  })

  it('offers only `local` for /debug, not the catalog’s `nous`', () => {
    // The agent's catalog serves `["nous","local"]`. Offering `nous` would put
    // an upload one Enter away, which is the exact trap this function exists
    // to close — so the policy's list replaces the catalog's rather than
    // extending it.
    expect(slashArgumentCompletions('/debug')).toEqual(['local'])
  })

  it('offers example day counts for /insights, in numeric order', () => {
    // Bare is valid for /insights, so unlike /compress the picker cannot walk
    // anyone into a refusal here. These exist so `[days]` is not a guess. The
    // sort is numeric: a lexicographic one would offer 30 before 7.
    expect(slashArgumentCompletions('/insights')).toEqual(['7', '30'])
  })

  it('offers nothing for bare-only or unlisted commands', () => {
    expect(slashArgumentCompletions('/help')).toEqual([])
    expect(slashArgumentCompletions('/history')).toEqual([])
    expect(slashArgumentCompletions('/version')).toEqual([])
    expect(slashArgumentCompletions('/learn')).toEqual([])
    expect(slashArgumentCompletions('/tools')).toEqual([])
  })

  it('only offers completions the exec route would actually accept', () => {
    for (const command of Object.keys(SLASH_EXEC_ALLOWLIST)) {
      for (const arg of slashArgumentCompletions(command)) {
        expect(evaluate(`${command} ${arg}`).ok, arg).toBe(true)
      }
    }
  })
})

describe('slashUsageHint', () => {
  // The unit-level half of the guard in `hermes-commands.test.ts`. That one
  // proves the projected catalog advertises nothing the exec route refuses;
  // this one pins the shape each argument mechanism produces, so a change of
  // wording is a visible diff rather than a silently different hint.

  it('withholds the hint entirely from a bare-only command', () => {
    // The bug, in its purest form: six bare-only commands arrived with a hint
    // listing subcommands, and every one of those subcommands is refused.
    expect(
      slashUsageHint(
        '/reasoning',
        '[level|show|hide|full|clamp] [--global]',
      ),
    ).toBeNull()
    expect(slashUsageHint('/memory', '[pending|approve|reject] [id|on|off]')).toBeNull()
    expect(slashUsageHint('/curator', '[subcommand]')).toBeNull()
    expect(slashUsageHint('/suggestions', '[accept|dismiss N | catalog]')).toBeNull()
  })

  it('replaces an argument-restricted hint with the permitted forms', () => {
    // Unbracketed on purpose — the bare form of both is REFUSED (bare
    // /compress compresses, bare /debug uploads to a public paste), so `[…]`
    // would say the opposite of the policy.
    expect(
      slashUsageHint(
        '/compress',
        '[here [N] | focus topic | --preview|--dry-run]',
      ),
    ).toBe('--dry-run | --preview')
    expect(slashUsageHint('/debug', '[nous|local]')).toBe('local')
  })

  it('states the bound for a counted argument, as a metavariable', () => {
    // 365 permitted values cannot be listed, and `[days]` alone does not say
    // that `--preview` is refused while `7` is not. Angle brackets mark it as
    // a value rather than a literal word — the convention the guard's parser
    // reads.
    expect(slashUsageHint('/insights', '[days]')).toBe('[<days 1-365>]')
  })

  it('subtracts the phantom forms and keeps the agent’s wording for the rest', () => {
    expect(
      slashUsageHint(
        '/goal',
        '[text | draft <text> | show | pause | resume | clear | status | wait <pid> | unwait]',
      ),
    ).toBe('[text | pause | resume | clear | status]')
  })

  it('drops a phantom-bearing hint it cannot parse rather than showing it', () => {
    // Fail closed. This shape (two groups, the phantom in the second) is not
    // one the agent sends today, and the subtraction cannot rewrite it safely
    // — so nothing is shown rather than something false.
    expect(slashUsageHint('/goal', '[text] [show|pause]')).toBeNull()
  })

  it('leaves a genuinely free grammar alone', () => {
    expect(slashUsageHint('/learn', '<what to learn from>')).toBe(
      '<what to learn from>',
    )
    expect(slashUsageHint('/subgoal', '[text | remove N | clear]')).toBe(
      '[text | remove N | clear]',
    )
  })

  it('passes through anything not on the allowlist', () => {
    // Skills and bundle slugs take free prompt text, so the agent's hint is
    // already true of them; `/tools` is never advertised at all.
    expect(slashUsageHint('/arxiv', '<query>')).toBe('<query>')
    expect(slashUsageHint('/tools', '[list|disable|enable]')).toBe(
      '[list|disable|enable]',
    )
    expect(slashUsageHint('/history', undefined)).toBeNull()
  })
})

describe('usageHintLiteralForms', () => {
  it('reads every word a user could type verbatim, and no metavariable', () => {
    expect(
      usageHintLiteralForms('[level|show|hide|full|clamp] [--global]'),
    ).toEqual(['level', 'show', 'hide', 'full', 'clamp', '--global'])
    expect(usageHintLiteralForms('[<days 1-365>]')).toEqual([])
    expect(usageHintLiteralForms('<what to learn from>')).toEqual([])
    expect(usageHintLiteralForms('--dry-run | --preview')).toEqual([
      '--dry-run',
      '--preview',
    ])
    // Crude in the safe direction: a multi-word form yields both of its words,
    // so the guard checks more strings than the hint strictly promises.
    expect(usageHintLiteralForms('[text | remove N | clear]')).toEqual([
      'text',
      'remove',
      'N',
      'clear',
    ])
  })
})

describe('the agent-version floor', () => {
  // The deployment this exists for: an install on 0.19.9, where
  // `/compress --preview` really compresses (hermes-agent#218 lands in
  // 0.19.12) and every profile-scoped read answers from the wrong profile
  // (#229, 0.19.15).
  const OLD = '0.19.9'

  it('empties the exec allowlist below the floor', () => {
    for (const command of Object.keys(SLASH_EXEC_ALLOWLIST)) {
      expect(evaluate(command, { agentVersion: OLD }).ok, command).toBe(false)
      expect(canRun(command, { isSkillCommand: false, agentVersion: OLD }), command).toBe(
        false,
      )
    }
  })

  it('refuses the runnable *forms* too, not just the bare command', () => {
    // `/compress --preview` is the whole reason for the floor: below 0.19.12
    // it is not a preview at all. The argument-restricted forms must not slip
    // past a check that only looked at the bare name.
    for (const input of [
      '/compress --preview',
      '/compress --dry-run',
      '/debug local',
      '/insights 3',
      '/learn ./src and focus on the RPC layer',
    ]) {
      expect(evaluate(input, { agentVersion: OLD }).ok, input).toBe(false)
    }
  })

  it('names both versions in the refusal', () => {
    const decision = evaluate('/compress --preview', { agentVersion: OLD })
    expect(decision.ok).toBe(false)
    if (decision.ok) return
    // "Not available" would be useless. The user needs to know what to update
    // to, and what they have.
    expect(decision.reason).toContain(MIN_AGENT_VERSION_FOR_SLASH_EXEC)
    expect(decision.reason).toContain(OLD)
    expect(decision.reason).toMatch(/Settings → Updates/)
  })

  it('says so explicitly when the version could not be read', () => {
    const decision = evaluate('/history', { agentVersion: null })
    expect(decision.ok).toBe(false)
    if (decision.ok) return
    expect(decision.reason).toMatch(/did not report a version/)
    expect(decision.reason).toContain(MIN_AGENT_VERSION_FOR_SLASH_EXEC)
  })

  it('fails closed on an unknown or malformed version', () => {
    for (const version of [null, '', '   ', 'unknown', 'latest', '0.19.x', 'v', 'dev']) {
      expect(evaluate('/history', { agentVersion: version }).ok, String(version)).toBe(
        false,
      )
      expect(
        canRun('/history', { isSkillCommand: false, agentVersion: version }),
        String(version),
      ).toBe(false)
    }
  })

  it('keeps skill commands runnable below the floor — the whole point', () => {
    // ~78 of the ~90 things in the picker are skills. They are prompt
    // injection over command.dispatch, they have worked on every build in this
    // range, and killing them to punish a registry-command risk would gut the
    // feature. Bundle slugs ride along for the same reason.
    for (const version of [OLD, null, 'nonsense']) {
      expect(canRun('/arxiv', { isSkillCommand: true, agentVersion: version })).toBe(true)
      expect(
        canRun('/research-stack', {
          isSkillCommand: false,
          isBundleCommand: true,
          agentVersion: version,
        }),
      ).toBe(true)

      const skill = evaluate('/arxiv attention is all you need', {
        agentVersion: version,
        skillCommands: new Set(['/arxiv']),
      })
      expect(skill).toMatchObject({
        ok: true,
        command: '/arxiv',
        args: 'attention is all you need',
        route: 'dispatch',
      })

      const bundle = evaluate('/research-stack summarise the RFC', {
        agentVersion: version,
        bundleCommands: new Set(['/research-stack']),
      })
      expect(bundle).toMatchObject({ ok: true, route: 'dispatch' })
    }
  })

  it('still refuses a refused form that a catalog claims is a skill, below the floor', () => {
    // The allowlist branch is checked before the skill branch, so the floor's
    // refusal cannot be routed around by a stale or hostile catalog listing
    // `/compress` as a skill — the same ordering guarantee the floor-free case
    // already relies on.
    const decision = evaluate('/compress', {
      agentVersion: OLD,
      skillCommands: new Set(['/compress']),
    })
    expect(decision.ok).toBe(false)
  })

  it('opens the allowlist at exactly the floor and above', () => {
    for (const version of [MIN_AGENT_VERSION_FOR_SLASH_EXEC, '0.19.17', '0.20.0', '1.0.0']) {
      expect(evaluate('/history', { agentVersion: version }).ok, version).toBe(true)
      expect(canRun('/history', { isSkillCommand: false, agentVersion: version }), version).toBe(
        true,
      )
    }
  })

  it('resolves an alias before applying the floor', () => {
    // `/compact` → `/compress`. If the floor were applied to the raw token the
    // alias would sail past it and land on the allowlist entry underneath.
    const decision = evaluate('/compact --preview', {
      agentVersion: OLD,
      aliases: { '/compact': '/compress' },
    })
    expect(decision.ok).toBe(false)
    expect(decision.command).toBe('/compress')
  })

  it('builds a refusal that names the command', () => {
    expect(agentVersionFloorRefusal('/history', '0.19.9')).toContain('/history')
    expect(agentVersionFloorRefusal('/history', null)).toMatch(
      /did not report a version/,
    )
    expect(agentVersionFloorRefusal('/history', '  ')).toMatch(
      /did not report a version/,
    )
  })
})
