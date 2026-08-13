import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { hermesRpc } from './hermes-rpc'
import { getAgentVersion } from './hermes-agent-version'
import {
  BUNDLE_CATEGORY,
  SKILL_CATEGORY,
  catalogPolicyInputs,
  getHermesCommandCatalog,
  invalidateHermesCommandCatalog,
  normalizeCommandCatalog,
  splitUsageHint,
} from './hermes-commands'
import { resolveCommandTier } from './hermes-command-tiers'
import {
  SLASH_EXEC_ALLOWLIST,
  evaluateSlashCommand,
  isBareOnlySlashCommand,
  usageHintLiteralForms,
} from './hermes-slash-policy'

vi.mock('./hermes-rpc', () => ({
  hermesRpc: vi.fn(),
}))

// The version read is a live HTTP call to the dashboard. Stub it, defaulting
// to the build this catalog fixture was captured from so every existing case
// keeps asserting against an agent above the floor. The comparator that applies
// the floor lives in `agent-version.ts` and is deliberately NOT stubbed —
// replacing it would stop this file testing the thing it claims to.
vi.mock('./hermes-agent-version', () => ({
  getAgentVersion: vi.fn(() => Promise.resolve('0.19.16')),
}))

const CURRENT_AGENT_VERSION = '0.19.16'

/** `normalizeCommandCatalog` with an agent above the version floor. */
function normalize(
  raw: unknown,
  agentVersion: string | null = CURRENT_AGENT_VERSION,
): ReturnType<typeof normalizeCommandCatalog> {
  return normalizeCommandCatalog(raw, { agentVersion })
}

/**
 * Shaped after a real `commands.catalog` response from the running dashboard:
 * categorized registry commands, `_TUI_EXTRA` entries that duplicate a registry
 * name (`/sessions`) and collide with an alias (`/compact`), and skill commands
 * appended to `pairs` with no category.
 *
 * `bundles: []` / `bundle_count: 0` is **this install's live reality**, verified
 * over `commands.catalog` against agent v0.19.16 on 2026-08-13: the keys are
 * present, the list is empty, and no "Bundles" bucket appears in `categories`
 * because the agent only appends one when it has something to put in it. The
 * populated shape could not be exercised live (no bundle is installed, and
 * creating one would write to the user's profile), so it lives in
 * `rawCatalogWithBundles` below, built from the agent's own emit code.
 */
function rawCatalog() {
  return {
    bundles: [] as Array<Record<string, unknown>>,
    bundle_count: 0,
    pairs: [
      ['/new', 'Start a new session'],
      ['/branch', 'Fork the current session'],
      ['/undo', 'Undo the last exchange'],
      ['/yolo', 'Auto-approve everything'],
      ['/reasoning', 'Set reasoning effort'],
      ['/kanban', 'Manage the task board'],
      ['/sessions', 'Switch sessions'],
      ['/compact', 'Toggle compact display mode'],
      ['/sessions', 'Switch between live TUI sessions'],
      ['/test-driven-development', 'TDD: enforce RED-GREEN-REFACTOR.'],
    ],
    sub: {
      // Both are real `sub` lists the live catalog serves. `/kanban` is not on
      // the exec allowlist, so its completions survive; `/reasoning` IS on it,
      // bare-only, so every one of these would be refused and they are stripped.
      '/reasoning': ['low', 'medium', 'high'],
      '/kanban': ['list', 'add'],
      '/nothing': ['x'],
    },
    canon: {
      '/branch': '/branch',
      '/fork': '/branch',
      '/compact': '/compress',
    },
    categories: [
      {
        name: 'Session',
        pairs: [
          ['/new', 'Start a new session'],
          ['/branch', 'Fork the current session'],
          ['/undo', 'Undo the last exchange'],
          ['/sessions', 'Switch sessions'],
        ],
      },
      {
        name: 'Configuration',
        pairs: [
          ['/yolo', 'Auto-approve everything'],
          ['/reasoning', 'Set reasoning effort'],
        ],
      },
      { name: 'Tools & Skills', pairs: [['/kanban', 'Manage the task board']] },
      { name: 'TUI', pairs: [['/compact', 'Toggle compact display mode']] },
    ],
    skill_count: 1,
    warning: '',
  }
}

/**
 * The populated bundle shape, transcribed from the agent's own emit path
 * (`commands.catalog` in installed `tui_gateway/server.py`, v0.19.16). Two
 * bundles, and the fixture reproduces the part that matters: each slug appears
 * **three times over** — in the top-level `bundles` list, in `pairs`, and in a
 * "Bundles" bucket appended to `categories` — exactly as the agent emits it.
 *
 * `/research-stack` is also given a `sub` list the live agent would never send,
 * to prove the normalizer does not start offering completions for a slug just
 * because something claimed some.
 */
function rawCatalogWithBundles() {
  const base = rawCatalog()
  const bundlePairs = [
    ['/research-stack', 'Load 3 skills for literature work'],
    ['/ship-it', 'Load 2 skills as a bundle'],
  ]
  return {
    ...base,
    pairs: [...base.pairs, ...bundlePairs],
    sub: { ...base.sub, '/research-stack': ['list', 'add'] },
    canon: {
      ...base.canon,
      // The agent self-maps every bundle slug; self-mappings are dropped.
      '/research-stack': '/research-stack',
      '/ship-it': '/ship-it',
    },
    categories: [...base.categories, { name: 'Bundles', pairs: bundlePairs }],
    bundles: [
      {
        command: '/research-stack',
        name: 'Research Stack',
        description: 'Load 3 skills for literature work',
        skills: ['arxiv', 'pdf-processing', 'citations'],
      },
      {
        command: '/ship-it',
        name: 'Ship It',
        description: 'Load 2 skills as a bundle',
        skills: ['changelog', 'release-notes'],
      },
    ],
    bundle_count: 2,
  }
}

function byCommand(catalog: ReturnType<typeof normalizeCommandCatalog>) {
  return new Map(catalog.commands.map((c) => [c.command, c]))
}

describe('normalizeCommandCatalog', () => {
  it('assigns each command its category and keeps agent category order', () => {
    const catalog = normalize(rawCatalog())
    const map = byCommand(catalog)

    expect(map.get('/new')?.category).toBe('Session')
    expect(map.get('/reasoning')?.category).toBe('Configuration')
    expect(catalog.categories).toEqual([
      'Session',
      'Configuration',
      'Tools & Skills',
      'TUI',
      SKILL_CATEGORY,
    ])
  })

  it('files uncategorized entries as skill commands', () => {
    const map = byCommand(normalize(rawCatalog()))
    const skill = map.get('/test-driven-development')

    expect(skill?.category).toBe(SKILL_CATEGORY)
    // Skill commands are prompt-shaping, not agent-state mutations.
    expect(skill?.tier).toBe('prompt')
  })

  it('keeps the first of a duplicated command (/sessions is in both the registry and _TUI_EXTRA)', () => {
    const catalog = normalize(rawCatalog())
    const sessions = catalog.commands.filter((c) => c.command === '/sessions')

    expect(sessions).toHaveLength(1)
    expect(sessions[0].description).toBe('Switch sessions')
    expect(sessions[0].category).toBe('Session')
  })

  it('attaches subcommands only where the agent has them', () => {
    const map = byCommand(normalize(rawCatalog()))

    expect(map.get('/kanban')?.subcommands).toEqual(['list', 'add'])
    expect(map.get('/new')?.subcommands).toBeUndefined()
  })

  it('strips the mutating subcommand menu the agent serves for /reasoning', () => {
    // `/reasoning` joined the exec allowlist bare-only: the bare form is a
    // read-only report of agent.reasoning_effort, and EVERY argument the agent
    // advertises mutates — a level sets it, show/hide flips session display,
    // full/clamp writes config.yaml. Serving those completions would put the
    // picker one Enter from a refusal, so `isBareOnlySlashCommand` drops them.
    const map = byCommand(normalize(rawCatalog()))

    expect(map.get('/reasoning')?.runnable).toBe(true)
    expect(map.get('/reasoning')?.subcommands).toBeUndefined()
  })

  it('replaces the agent’s /debug completions with the one that does not upload', () => {
    // The live catalog serves `["nous","local"]`. `nous` uploads, so offering
    // it would put an upload one Enter away; the policy's own list wins.
    const map = byCommand(
      normalize({
        pairs: [['/debug', 'Upload debug report']],
        sub: { '/debug': ['nous', 'local'] },
        categories: [{ name: 'Info', pairs: [['/debug', 'Upload debug report']] }],
      }),
    )

    expect(map.get('/debug')?.runnable).toBe(true)
    expect(map.get('/debug')?.subcommands).toEqual(['local'])
  })

  it('supplies day-count completions for /insights, which the agent serves none for', () => {
    // `sub` has no `/insights` key live, so without this the picker inserts
    // `"/insights "` and dismisses. Bare is valid here, so this is a hint
    // rather than a rescue — but it is still the difference between a usable
    // `[days]` and a guess.
    const map = byCommand(
      normalize({
        pairs: [['/insights', 'Show usage insights and analytics']],
        categories: [
          { name: 'Info', pairs: [['/insights', 'Show usage insights and analytics']] },
        ],
      }),
    )

    expect(map.get('/insights')?.subcommands).toEqual(['7', '30'])
  })

  it('withholds subcommands from bare-only commands', () => {
    // `/help` is allowlisted with `allowArgs: false`. Where the agent
    // advertises subcommands for such a command, serving them makes the picker
    // hold its menu open, insert `/help all`, and earn a refusal for carrying
    // arguments — the UI walking the user into a guaranteed rejection.
    const map = byCommand(
      normalize({
        pairs: [['/help', 'Show available commands']],
        sub: { '/help': ['all', 'session'] },
        categories: [
          { name: 'Info', pairs: [['/help', 'Show available commands']] },
        ],
      }),
    )

    expect(map.get('/help')?.runnable).toBe(true)
    expect(map.get('/help')?.subcommands).toBeUndefined()
  })

  it('marks the unfiltered cli_only catalog entries as not runnable', () => {
    // `commands.catalog` filters `gateway_only` but not `cli_only`, so these
    // still arrive in `pairs`. Nothing downstream needs to know that: the
    // allowlist already answers `runnable: false`, which is what keeps them out
    // of the picker. Asserted here so the normalizer is not "fixed" by adding a
    // cli_only filter — `/history` is cli_only too and was allowlisted for
    // months on the strength of the live path answering it.
    const map = byCommand(
      normalize({
        pairs: [
          ['/prompt', 'Compose your next prompt in $EDITOR'],
          ['/indicator', 'Pick the busy-indicator style'],
          ['/systemprompt', 'Show the current system prompt'],
        ],
        categories: [
          {
            name: 'Session',
            pairs: [['/prompt', 'Compose your next prompt in $EDITOR']],
          },
          {
            name: 'TUI',
            pairs: [
              ['/indicator', 'Pick the busy-indicator style'],
              ['/systemprompt', 'Show the current system prompt'],
            ],
          },
        ],
      }),
    )

    for (const command of ['/prompt', '/indicator', '/systemprompt']) {
      expect(map.get(command)?.runnable, command).toBe(false)
    }
  })

  it('exposes aliases and drops self-mappings', () => {
    const catalog = normalize(rawCatalog())

    expect(catalog.aliases['/fork']).toBe('/branch')
    expect(catalog.aliases['/branch']).toBeUndefined()
  })

  it('computes the tier server-side from the §4 policy', () => {
    const map = byCommand(normalize(rawCatalog()))

    expect(map.get('/branch')?.tier).toBe('local')
    expect(map.get('/undo')?.tier).toBe('prompt')
    // Safety-critical: /yolo over slash.exec reports success and bypasses
    // nothing (design doc §2.5).
    expect(map.get('/yolo')?.tier).toBe('excluded')
    // `pairs` carries the _TUI_EXTRA display toggle under this name, never the
    // /compress alias — so it stays excluded.
    expect(map.get('/compact')?.tier).toBe('excluded')
  })

  it('marks a command runnable only when the exec allowlist permits it', () => {
    const map = byCommand(normalize(rawCatalog()))

    // Not on the allowlist — the picker must not advertise these, and the exec
    // route refuses them regardless of what the picker does.
    expect(map.get('/branch')?.runnable).toBe(false)
    expect(map.get('/undo')?.runnable).toBe(false)
    expect(map.get('/yolo')?.runnable).toBe(false)

    // A skill command is a prompt injection, dispatchable by definition.
    expect(map.get('/test-driven-development')?.runnable).toBe(true)
    expect(map.get('/test-driven-development')?.skill).toBe(true)
    expect(map.get('/branch')?.skill).toBe(false)
  })

  it('exposes the policy inputs the exec route needs', () => {
    const catalog = normalize(rawCatalog())
    const inputs = catalogPolicyInputs(catalog)

    expect(inputs.aliases['/fork']).toBe('/branch')
    expect(inputs.skillCommands.has('/test-driven-development')).toBe(true)
    expect(inputs.skillCommands.has('/branch')).toBe(false)
    // Today's reality: the keys exist, the set is empty.
    expect(inputs.bundleCommands.size).toBe(0)
  })

  it('carries skill_count and warning through', () => {
    const catalog = normalize({
      ...rawCatalog(),
      skill_count: 79,
      warning: 'skill discovery unavailable: boom',
    })

    expect(catalog.skillCount).toBe(79)
    expect(catalog.warning).toBe('skill discovery unavailable: boom')
  })

  it('degrades to an empty catalog on a malformed payload instead of throwing', () => {
    for (const bad of [null, undefined, 42, {}, { pairs: 'nope' }, { pairs: [['']] }]) {
      const catalog = normalize(bad)
      expect(catalog.commands).toEqual([])
      expect(catalog.categories).toEqual([])
      expect(catalog.skillCount).toBe(0)
      expect(catalog.bundleCount).toBe(0)
      expect(catalog.warning).toBe('')
    }
  })
})

/**
 * Skill bundles — new in agent v0.19.16.
 *
 * The empty case is what this install actually serves and is asserted first;
 * the populated case is fixture-only, because installing a bundle would write
 * into the user's profile. Both matter: the empty one is today's behaviour and
 * the populated one is the behaviour the change exists for.
 */
describe('normalizeCommandCatalog — skill bundles', () => {
  it('tolerates the live empty case without inventing a facet', () => {
    // Measured over `commands.catalog` on 2026-08-13: `bundles: []`,
    // `bundle_count: 0`, no "Bundles" bucket. Nothing about the catalog should
    // change shape just because the keys arrived.
    const catalog = normalize(rawCatalog())

    expect(catalog.bundleCount).toBe(0)
    expect(catalog.commands.every((entry) => entry.bundle === false)).toBe(true)
    expect(catalog.categories).not.toContain(BUNDLE_CATEGORY)
  })

  it('tolerates an agent too old to send the keys at all', () => {
    // v0.19.13 and earlier send no `bundles`/`bundle_count`. Indistinguishable
    // from "no bundles installed", and correctly so — both mean nothing to
    // advertise.
    const { bundles: _b, bundle_count: _c, ...older } = rawCatalog()
    const catalog = normalize(older)

    expect(catalog.bundleCount).toBe(0)
    expect(catalog.commands.every((entry) => entry.bundle === false)).toBe(true)
  })

  it('lists each bundle once, though the agent sends it three times', () => {
    // The double-count trap. A bundle slug arrives in `bundles`, in `pairs`
    // AND in a `categories` bucket; `pairs` stays the single source of the
    // command list — the same "first occurrence wins" rule that already handles
    // `/sessions` — and `bundles` is read only as a marker set.
    const catalog = normalize(rawCatalogWithBundles())

    expect(
      catalog.commands.filter((entry) => entry.command === '/research-stack'),
    ).toHaveLength(1)
    expect(catalog.commands.filter((entry) => entry.bundle)).toHaveLength(2)
    expect(catalog.bundleCount).toBe(2)
  })

  it('tiers a bundle slug as prompt rather than failing it closed', () => {
    // The mis-tier trap, and the reason a marker set is needed at all: a bundle
    // IS categorized, so the fail-closed default for an unknown *registry*
    // command would make every slug `excluded` and drop it from the picker.
    const map = byCommand(normalize(rawCatalogWithBundles()))

    expect(map.get('/research-stack')?.tier).toBe('prompt')
    expect(map.get('/ship-it')?.tier).toBe('prompt')
  })

  it('marks a bundle runnable without an allowlist entry, and never as a skill', () => {
    const map = byCommand(normalize(rawCatalogWithBundles()))
    const bundle = map.get('/research-stack')

    expect(bundle?.runnable).toBe(true)
    expect(bundle?.bundle).toBe(true)
    // Mutually exclusive. `skill: true` would be a falsehood with consequences:
    // it drives the picker's Skills facet, the `/api/skills` slug join and the
    // provenance badge, none of which a bundle can satisfy.
    expect(bundle?.skill).toBe(false)
    // …and the skill tail is untouched by their arrival.
    expect(map.get('/test-driven-development')?.skill).toBe(true)
    expect(map.get('/test-driven-development')?.bundle).toBe(false)
  })

  it('keeps the agent’s own Bundles bucket as the category', () => {
    const catalog = normalize(rawCatalogWithBundles())
    const map = byCommand(catalog)

    expect(map.get('/research-stack')?.category).toBe(BUNDLE_CATEGORY)
    expect(catalog.categories).toContain(BUNDLE_CATEGORY)
    // Appended where the agent put it, after the registry buckets, and it does
    // not displace the skill bucket.
    expect(catalog.categories).toContain(SKILL_CATEGORY)
  })

  it('passes a bundle’s completions through, exactly as it does for skills', () => {
    // Asserting the real behaviour rather than an aspiration. `sub` is keyed by
    // registry command name, and the agent only emits a bundle slug the
    // registry does NOT claim, so a bundle can never actually carry one — the
    // fixture invents this list. If it somehow did, passing it through is
    // harmless in a way `/tools list` was not: a bundle's argument is free-form
    // prompt text, so a completion produces an odd instruction, never the
    // refusal `isBareOnlySlashCommand` exists to prevent.
    const map = byCommand(normalize(rawCatalogWithBundles()))

    expect(map.get('/research-stack')?.subcommands).toEqual(['list', 'add'])
    expect(map.get('/ship-it')?.subcommands).toBeUndefined()
  })

  it('hands the exec route a bundle set that is disjoint from the skills', () => {
    const inputs = catalogPolicyInputs(
      normalize(rawCatalogWithBundles()),
    )

    expect([...inputs.bundleCommands].sort()).toEqual([
      '/research-stack',
      '/ship-it',
    ])
    expect(inputs.skillCommands.has('/research-stack')).toBe(false)
    expect(inputs.bundleCommands.has('/test-driven-development')).toBe(false)
  })

  it('drops a bundle the agent named but never put in pairs', () => {
    // Fail toward hiding, matching the agent's own stance in
    // `_dispatchable_bundle_entries`: it would rather omit a bundle than
    // advertise one the dispatcher cannot reach.
    const catalog = normalize({
      ...rawCatalog(),
      bundles: [{ command: '/ghost-stack', name: 'Ghost', skills: ['x'] }],
      bundle_count: 1,
    })

    expect(catalog.commands.some((entry) => entry.command === '/ghost-stack')).toBe(
      false,
    )
    // …and the count follows the entries, not the payload's own `bundle_count`
    // of 1. A count that outran the list is how a UI ends up promising
    // something it cannot show.
    expect(catalog.bundleCount).toBe(0)
    expect(catalog.commands.filter((entry) => entry.bundle)).toHaveLength(0)
  })

  it('ignores malformed bundle entries rather than throwing', () => {
    const catalog = normalize({
      ...rawCatalog(),
      bundles: [null, 42, {}, { command: '' }, { command: 'no-slash' }],
      bundle_count: 5,
    })

    expect(catalog.bundleCount).toBe(0)
    expect(catalog.commands.some((entry) => entry.bundle)).toBe(false)
  })
})

describe('resolveCommandTier', () => {
  it('fails closed for an unrecognised registry command', () => {
    expect(resolveCommandTier('/some-future-command', { categorized: true })).toBe(
      'excluded',
    )
  })

  it('tiers a bundle as prompt even though it is categorized', () => {
    expect(
      resolveCommandTier('/research-stack', { categorized: true, bundle: true }),
    ).toBe('prompt')
    // Without the flag the same slug fails closed, which is what makes the
    // flag load-bearing rather than decorative.
    expect(resolveCommandTier('/research-stack', { categorized: true })).toBe(
      'excluded',
    )
  })

  it('lets a bundle claim beat a stale static tier', () => {
    // Checked before COMMAND_TIERS, which looks like the wrong direction for a
    // fail-closed map but is the honest one: the agent only emits a slug the
    // registry does not claim, so a collision here means this table is stale
    // about a name that is now a bundle.
    expect(resolveCommandTier('/yolo', { categorized: true })).toBe('excluded')
    expect(resolveCommandTier('/yolo', { categorized: true, bundle: true })).toBe(
      'prompt',
    )
  })

  it('treats an unrecognised uncategorized command as a skill', () => {
    expect(resolveCommandTier('/some-skill', { categorized: false })).toBe('prompt')
  })

  it('is case-insensitive', () => {
    expect(resolveCommandTier('/BRANCH', { categorized: true })).toBe('local')
  })
})

describe('getHermesCommandCatalog', () => {
  beforeEach(() => {
    invalidateHermesCommandCatalog()
    vi.mocked(hermesRpc).mockReset()
  })

  afterEach(() => {
    invalidateHermesCommandCatalog()
  })

  it('calls commands.catalog with no session parameters', async () => {
    vi.mocked(hermesRpc).mockResolvedValue(rawCatalog())
    await getHermesCommandCatalog()

    expect(hermesRpc).toHaveBeenCalledWith(
      'commands.catalog',
      {},
      expect.objectContaining({ timeoutMs: expect.any(Number) }),
    )
  })

  it('serves repeat reads from the TTL cache', async () => {
    vi.mocked(hermesRpc).mockResolvedValue(rawCatalog())

    const first = await getHermesCommandCatalog()
    const second = await getHermesCommandCatalog()

    expect(second).toBe(first)
    expect(hermesRpc).toHaveBeenCalledTimes(1)
  })

  it('re-fetches when forced or invalidated', async () => {
    vi.mocked(hermesRpc).mockResolvedValue(rawCatalog())

    await getHermesCommandCatalog()
    await getHermesCommandCatalog({ force: true })
    expect(hermesRpc).toHaveBeenCalledTimes(2)

    invalidateHermesCommandCatalog()
    await getHermesCommandCatalog()
    expect(hermesRpc).toHaveBeenCalledTimes(3)
  })

  it('does not cache a failure — the next read retries', async () => {
    vi.mocked(hermesRpc).mockRejectedValueOnce(new Error('dashboard down'))
    await expect(getHermesCommandCatalog()).rejects.toThrow('dashboard down')

    vi.mocked(hermesRpc).mockResolvedValue(rawCatalog())
    const catalog = await getHermesCommandCatalog()
    expect(catalog.commands.length).toBeGreaterThan(0)
    expect(hermesRpc).toHaveBeenCalledTimes(2)
  })
})

describe('normalizeCommandCatalog — the agent-version floor', () => {
  const OLD = '0.19.9'

  it('leaves the skill tail runnable and empties the allowlist below the floor', () => {
    const map = byCommand(normalize(rawCatalog(), OLD))

    // `/reasoning` is the fixture's one allowlisted registry command; it goes
    // dark…
    expect(map.get('/reasoning')?.runnable).toBe(false)
    // …and the skills, which are the bulk of the picker, do not.
    const skills = [...map.values()].filter((entry) => entry.skill)
    expect(skills.length).toBeGreaterThan(0)
    for (const entry of skills) {
      expect(entry.runnable, entry.command).toBe(true)
    }
  })

  it('keeps bundle slugs runnable below the floor', () => {
    // Academic on a real old agent — below 0.19.16 the catalog emits no
    // `bundles` at all, so this path cannot be reached from a live payload.
    // Asserted anyway because the reason bundles are exempt is their trust
    // level, not the fact that they happen to be absent.
    const map = byCommand(normalize(rawCatalogWithBundles(), OLD))
    const bundles = [...map.values()].filter((entry) => entry.bundle)
    expect(bundles.length).toBeGreaterThan(0)
    for (const entry of bundles) {
      expect(entry.runnable, entry.command).toBe(true)
    }
  })

  it('treats an unknown version as below the floor', () => {
    const map = byCommand(normalize(rawCatalog(), null))
    expect(map.get('/reasoning')?.runnable).toBe(false)
    expect([...map.values()].some((entry) => entry.skill && entry.runnable)).toBe(true)
  })

  it('is unchanged at or above the floor', () => {
    for (const version of ['0.19.16', '0.19.17', '1.0.0']) {
      const map = byCommand(normalize(rawCatalog(), version))
      expect(map.get('/reasoning')?.runnable, version).toBe(true)
    }
  })

  it('leaves tier, category and subcommands alone — only `runnable` moves', () => {
    // The floor must not quietly re-shape the picker's other facets, or a
    // downgrade would look like a different agent rather than a narrower one.
    const high = byCommand(normalize(rawCatalog(), '0.19.16'))
    const low = byCommand(normalize(rawCatalog(), OLD))
    expect([...low.keys()]).toEqual([...high.keys()])
    for (const [command, entry] of high) {
      const other = low.get(command)
      expect({ ...other, runnable: entry.runnable }, command).toEqual(entry)
    }
  })
})

describe('getHermesCommandCatalog — version freshness', () => {
  beforeEach(() => {
    invalidateHermesCommandCatalog()
    vi.mocked(hermesRpc).mockReset()
    vi.mocked(getAgentVersion).mockReset()
    vi.mocked(getAgentVersion).mockResolvedValue(CURRENT_AGENT_VERSION)
  })

  afterEach(() => {
    invalidateHermesCommandCatalog()
    vi.mocked(getAgentVersion).mockResolvedValue(CURRENT_AGENT_VERSION)
  })

  it('computes `runnable` against the version it read alongside the catalog', async () => {
    vi.mocked(hermesRpc).mockResolvedValue(rawCatalog())
    vi.mocked(getAgentVersion).mockResolvedValue('0.19.9')

    const catalog = await getHermesCommandCatalog()
    const entry = catalog.commands.find((c) => c.command === '/reasoning')
    expect(entry?.runnable).toBe(false)
  })

  it('re-derives `runnable` from the cached payload when the agent version changes', async () => {
    vi.mocked(hermesRpc).mockResolvedValue(rawCatalog())

    const first = await getHermesCommandCatalog()
    expect(first.commands.find((e) => e.command === '/reasoning')?.runnable).toBe(
      true,
    )

    // Agent restarted onto an older build inside the 60s catalog TTL. Without
    // this the picker would keep offering commands the exec route has already
    // started refusing, for up to a minute.
    vi.mocked(getAgentVersion).mockResolvedValue('0.19.9')
    const second = await getHermesCommandCatalog()
    expect(second.commands.find((e) => e.command === '/reasoning')?.runnable).toBe(
      false,
    )
    // …and without a second RPC: the payload was already in hand.
    expect(hermesRpc).toHaveBeenCalledTimes(1)
  })
})

describe('splitUsageHint', () => {
  it('pulls the trailing (usage: …) out of a catalog description', () => {
    expect(
      splitUsageHint(
        'Start a new session (fresh session ID + history) (usage: /new [name])',
      ),
    ).toEqual({
      description: 'Start a new session (fresh session ID + history)',
      usage: '[name]',
    })
  })

  it('leaves descriptions without a usage hint alone', () => {
    expect(splitUsageHint('Show conversation history')).toEqual({
      description: 'Show conversation history',
    })
  })

  it('keeps a multi-part hint intact', () => {
    // What it splits out is the RAW agent hint. Correcting it against the exec
    // policy is `slashUsageHint`'s job, and `/reasoning` is the case that
    // proves the two steps are different: this string is accurate about the
    // agent's CLI and false about this transport.
    const result = splitUsageHint(
      'Manage reasoning effort and display (usage: /reasoning [level|show|hide|full|clamp] [--global])',
    )
    expect(result.usage).toBe('[level|show|hide|full|clamp] [--global]')
  })
})

// ── The advertisement guard ─────────────────────────────────────────────────
//
// The fourth instance of one pattern is what this is here to make the last.
// `/tools list` was the first (the picker held its menu open to complete a
// subcommand the exec route then refused), `/compress` was nearly the second,
// `/goal show` was the third — and that one would have SUBMITTED A TURN,
// spending tokens on a goal named "show". Each was fixed for one command.
//
// The invariant is one sentence: **every form the catalog advertises for a
// command the picker will list is a form `evaluateSlashCommand` accepts.** Two
// fields advertise forms — `subcommands` and `usage` — and both are checked
// here against the real decision function, not against a copy of the policy.
//
// The fixture below is the live catalog's own wording, captured from
// `GET /api/hermes-commands` on 2026-08-13 against agent v0.19.16, so this
// fails on the actual strings the agent sends rather than on invented ones.

/**
 * Every allowlisted command, with the description the live agent serves for it
 * — `(usage: …)` and all. Keyed by command so the exact-count assertion below
 * can force a new allowlist entry to bring its real hint with it.
 */
const LIVE_DESCRIPTIONS: Readonly<Record<string, string>> = {
  '/help': 'Show available commands',
  '/history': 'Show conversation history',
  '/compress':
    "Compress conversation context; --preview shows what would happen ('here [N]' keeps the recent N turns — CLI and messaging platforms only, not the desktop/TUI) (usage: /compress [here [N] | focus topic | --preview|--dry-run])",
  '/insights': 'Show usage insights and analytics (usage: /insights [days])',
  '/curator':
    'Background skill maintenance (status, run, pin, archive, list-archived) (usage: /curator [subcommand])',
  '/debug':
    'Upload debug report (system info + logs) and get shareable links (usage: /debug [nous|local])',
  '/reasoning':
    'Manage reasoning effort and display (usage: /reasoning [level|show|hide|full|clamp] [--global])',
  '/version': 'Show Hermes Agent version',
  '/profile': 'Show active profile name and home directory',
  '/memory':
    'Review pending memory writes / toggle the approval gate (usage: /memory [pending|approve|reject|approval] [id|on|off])',
  '/suggestions':
    'Review suggested automations (accept/dismiss) (usage: /suggestions [accept|dismiss N | catalog])',
  '/bundles': 'List skill bundles (aliases /<name> for multiple skills)',
  '/learn':
    'Learn a reusable skill from anything you describe (dirs, URLs, this chat, notes) (usage: /learn <what to learn from>)',
  '/goal':
    'Set a standing goal Hermes works on across turns until achieved (usage: /goal [text | draft <text> | show | pause | resume | clear | status | wait <pid> | unwait])',
  '/subgoal':
    'Add or manage extra criteria on the active goal (usage: /subgoal [text | remove N | clear])',
}

/**
 * A catalog shaped like the live one: every allowlisted command with its real
 * description and the `sub` lists the agent really serves, plus a skill command
 * and a bundle slug (both of which take free prompt text, and neither of which
 * this pass may change).
 */
function liveShapedCatalog() {
  const pairs = Object.entries(LIVE_DESCRIPTIONS).map(([command, description]) => [
    command,
    description,
  ])
  const skillPairs = [
    ['/arxiv', 'Search arXiv papers (usage: /arxiv <query>)'],
    ['/ascii-art', 'Render text as ASCII art'],
  ]
  const bundlePairs = [['/research-stack', 'Load 3 skills for literature work']]
  return {
    pairs: [...pairs, ...bundlePairs, ...skillPairs],
    // The three `sub` lists the live agent serves for allowlisted commands.
    // Every entry in the first two is refused; `/debug`'s `nous` uploads.
    sub: {
      '/reasoning': ['low', 'medium', 'high', 'show', 'hide'],
      '/memory': ['pending', 'approve', 'reject', 'approval'],
      '/debug': ['nous', 'local'],
    },
    canon: { '/compact': '/compress', '/fork': '/branch' },
    categories: [
      { name: 'Session', pairs },
      { name: 'Bundles', pairs: bundlePairs },
    ],
    bundles: [
      {
        command: '/research-stack',
        name: 'Research Stack',
        description: 'Load 3 skills for literature work',
        skills: ['arxiv'],
      },
    ],
    bundle_count: 1,
    skill_count: skillPairs.length,
    warning: '',
  }
}

describe('the catalog advertises only forms the exec route accepts', () => {
  const catalog = normalize(liveShapedCatalog())
  const policyInputs = catalogPolicyInputs(catalog)
  const advertised = catalog.commands.filter((entry) => entry.runnable)

  const decide = (input: string) =>
    evaluateSlashCommand(input, {
      agentVersion: CURRENT_AGENT_VERSION,
      aliases: policyInputs.aliases,
      skillCommands: policyInputs.skillCommands,
      bundleCommands: policyInputs.bundleCommands,
    })

  it('captures the live description of every allowlisted command', () => {
    // The exact-count discipline the allowlist already uses. Without it a new
    // entry would arrive with no hint in this fixture and every assertion below
    // would pass by not looking at it.
    expect(
      Object.keys(LIVE_DESCRIPTIONS).sort(),
      'Add the new allowlist entry to LIVE_DESCRIPTIONS, copying the description\n' +
        'verbatim from `GET /api/hermes-commands` on a running agent — the guard\n' +
        'below is only as honest as the strings it is given.',
    ).toEqual(Object.keys(SLASH_EXEC_ALLOWLIST).sort())
  })

  it('runs every advertised form through evaluateSlashCommand', () => {
    expect(advertised.length).toBeGreaterThan(0)
    for (const entry of advertised) {
      const forms = [
        ...(entry.subcommands ?? []),
        ...(entry.usage ? usageHintLiteralForms(entry.usage) : []),
      ]
      for (const form of forms) {
        const decision = decide(`${entry.command} ${form}`)
        expect(
          decision.ok,
          `The picker advertises \`${entry.command} ${form}\` — from ` +
            `${entry.subcommands?.includes(form) ? '`subcommands`' : `the usage hint \`${entry.usage}\``} ` +
            `— and the exec route refuses it:\n` +
            `  ${decision.ok ? '' : decision.reason}\n\n` +
            `This is the /tools-list / /goal-show defect. Fix it where the form is\n` +
            `derived, in server/hermes-slash-policy.ts (\`slashUsageHint\` for the\n` +
            `hint, \`slashArgumentCompletions\` for the subcommands) — NOT by\n` +
            `special-casing one command in the picker, which is how this bug got\n` +
            `four lives.`,
        ).toBe(true)
      }
    }
  })

  it('shows no usage hint at all for a bare-only command', () => {
    // The rule the literal-form check cannot see: a hint made only of
    // metavariables advertises an argument shape without naming a word, and is
    // just as false beside a command that takes nothing.
    for (const entry of advertised) {
      if (!isBareOnlySlashCommand(entry.command)) continue
      expect(
        entry.usage,
        `${entry.command} runs bare or not at all, but the catalog still ` +
          `advertises \`${entry.usage}\` beside it.`,
      ).toBeUndefined()
    }
  })

  it('never brackets a hint as optional when the bare form is refused', () => {
    // `/compress` and `/debug` are the holders: bare `/compress` compresses and
    // bare `/debug` uploads to a public paste, so both are refused, and a
    // `[…]` hint would tell the user the opposite.
    for (const entry of advertised) {
      if (!entry.usage) continue
      if (decide(entry.command).ok) continue
      expect(
        entry.usage.startsWith('['),
        `${entry.command} refuses its bare form, so its hint must not be ` +
          `optional-bracketed — got \`${entry.usage}\`.`,
      ).toBe(false)
    }
  })

  it('leaves skills and bundle slugs with the agent’s own hint', () => {
    const map = byCommand(catalog)
    expect(map.get('/arxiv')?.usage).toBe('<query>')
    expect(map.get('/arxiv')?.description).toBe('Search arXiv papers')
    expect(map.get('/ascii-art')?.usage).toBeUndefined()
    expect(map.get('/research-stack')?.usage).toBeUndefined()
  })

  it('projects the corrected hint for each of the commands that had a false one', () => {
    const map = byCommand(catalog)
    const usageOf = (command: string) => map.get(command)?.usage

    // Bare-only: the hint is gone entirely.
    expect(usageOf('/reasoning')).toBeUndefined()
    expect(usageOf('/memory')).toBeUndefined()
    expect(usageOf('/suggestions')).toBeUndefined()
    expect(usageOf('/curator')).toBeUndefined()
    // Argument-restricted: replaced by the permitted set.
    expect(usageOf('/compress')).toBe('--dry-run | --preview')
    expect(usageOf('/debug')).toBe('local')
    expect(usageOf('/insights')).toBe('[<days 1-365>]')
    // Free grammar minus the phantoms — `draft`, `show`, `wait`, `unwait` gone,
    // the agent's own wording kept for the five forms that work.
    expect(usageOf('/goal')).toBe('[text | pause | resume | clear | status]')
    // Genuinely free: untouched.
    expect(usageOf('/learn')).toBe('<what to learn from>')
    expect(usageOf('/subgoal')).toBe('[text | remove N | clear]')
    // No hint in, no hint out.
    expect(usageOf('/history')).toBeUndefined()
    expect(usageOf('/version')).toBeUndefined()
  })
})
