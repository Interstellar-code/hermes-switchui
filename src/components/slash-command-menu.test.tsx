// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  waitFor,
  within,
} from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement, createRef } from 'react'
import {
  LOCAL_CATEGORY,
  LOCAL_SLASH_COMMANDS,
  SKILLS_FALLBACK_CATEGORY,
  SKILL_ARGUMENT_HINT,
  SlashCommandMenu,
  USER_CATEGORY,
  agentCatalogEntries,
  applySkillMetadata,
  buildSlashCommandSections,
  countSlashCommandTabs,
  curatedSlashCommands,
  filterSlashCommandsByTab,
  findSkillInvocation,
  groupByCategory,
  mergeSlashCommands,
  orderSlashCommandSections,
  rankSkillSectionItems,
  readRecentSlashCommands,
  recordRecentSlashCommand,
  skillArgumentNotice,
  slashCommandFacet,
  slashCommandMatches,
  splitSubcommandQuery,
  useSlashCommandDefinitions,
  visibleSlashCommandTabs,
} from './slash-command-menu'
import type { ReactNode } from 'react'

import type {
  SlashCommandDefinition,
  SlashCommandMenuHandle,
} from './slash-command-menu'
import { buildSkillMetadataIndex } from '@/lib/skill-metadata'
import { LOCAL_COMMAND_HANDLERS } from '@/screens/chat/hooks/use-slash-commands'
import {
  INTENTIONALLY_SHADOWED_COMMANDS,
  SLASH_EXEC_ALLOWLIST,
} from '@/server/hermes-slash-policy'

describe('LOCAL_SLASH_COMMANDS', () => {
  it("advertises nothing on SwitchUI's own behalf", () => {
    // Phase 3 emptied this list. Every command it used to carry duplicates a
    // control already on screen, and the picker\'s job is now to surface what
    // the agent can do.
    expect(LOCAL_SLASH_COMMANDS).toEqual([])
  })

  it('keeps a routing handler for every command it stopped advertising', () => {
    // The non-negotiable half of the change: unadvertised is not unhandled.
    // Each of these still routes when typed, which is what stops it reaching
    // the model as prose. Do NOT "restore parity" by re-listing them above.
    for (const unadvertised of [
      // the ten conversation commands removed in Phase 3 step 2
      '/new',
      '/clear',
      '/model',
      '/title',
      // NO `/reasoning`: its local handler is gone, not merely unadvertised.
      // It set a thinking level that `send-stream.ts` deliberately drops (the
      // gateway has no per-request effort parameter), so it reported success
      // and changed nothing — while shadowing the agent's `/reasoning`, the
      // only truthful readout of `agent.reasoning_effort`. Asserted the other
      // way round in the shadow-guard block below.
      '/interrupt',
      '/branch',
      // NO `/usage`: the usage-meter feature was removed entirely — the header
      // pill, its details dialog, the ⌘K entry and this handler. It is not
      // "unadvertised but handled", it no longer exists on the SwitchUI side.
      // The agent's own `/usage` stays refused (it reads zero on a resumed
      // session), so nothing advertises it either.
      '/save',
      '/copy',
      // the deep-link tier, unadvertised since §8a
      '/mcp',
      '/plugins',
      // NO `/status`: §8b removed SwitchUI's own command set, so the agent's
      // `/status` is the only one left and it runs on the exec route instead of
      // deep-linking. It is asserted the other way round below — advertised in
      // the Agent facet, with no local handler to shadow it.
      //
      // NO `/insights`, `/version` or `/profile` either, and for the same
      // reason: all three are on the exec allowlist, all three were shadowed by
      // a deep-link to a screen that lacks what they report, and all three now
      // run on the agent. See the shadow-guard block below.
      '/platforms',
      '/update',
      '/agents',
      '/cron',
      '/kanban',
      '/config',
      '/skin',
      '/help',
      '/skills',
    ]) {
      expect(LOCAL_SLASH_COMMANDS.map((entry) => entry.command)).not.toContain(
        unadvertised,
      )
      expect(LOCAL_COMMAND_HANDLERS).toContain(unadvertised)
    }
  })

  // Retained one-directional invariant: advertised ⊆ handled. Vacuously true
  // while the list is empty, and the assertion that catches a careless refill.
  it('every local entry has a routing handler', () => {
    for (const entry of LOCAL_SLASH_COMMANDS) {
      expect(entry.command.startsWith('/')).toBe(true)
      expect(entry.description.length).toBeGreaterThan(0)
      expect(LOCAL_COMMAND_HANDLERS).toContain(entry.command)
    }
  })
})

// --- The shadow guard --------------------------------------------------
//
// The counterpart to the invariant above. That one is "unadvertised is not
// unhandled"; this one is "allowlisted is not shadowed, unless deliberately
// excepted".
//
// Why it exists: a command on `SLASH_EXEC_ALLOWLIST` **and** in
// `LOCAL_COMMAND_HANDLERS` is dropped from the picker by `agentCatalogEntries`
// and answered by the local handler when typed — so the agent's version is
// never advertised and never runs, and every measurement in its allowlist entry
// is dead text. `/status` hit this, was diagnosed and fixed by hand, and the
// fix was not generalised; the 3 → 12 allowlist pass then re-created it four
// times over (`/insights`, `/profile`, `/reasoning`, `/version`). Four
// one-off comments would have been the fifth version of the same mistake.

const lower = (command: string) => command.trim().toLowerCase()

describe('allowlisted commands are not shadowed by a SwitchUI handler', () => {
  const allowlisted = Object.keys(SLASH_EXEC_ALLOWLIST).map(lower)
  const handled = new Set(LOCAL_COMMAND_HANDLERS.map(lower))
  const excepted = Object.keys(INTENTIONALLY_SHADOWED_COMMANDS).map(lower)

  it('shadows exactly the commands that are meant to be shadowed', () => {
    const shadowed = allowlisted.filter((command) => handled.has(command)).sort()

    expect(
      shadowed,
      `Every command listed here is on SLASH_EXEC_ALLOWLIST (server/hermes-slash-policy.ts) AND in\n` +
        `LOCAL_COMMAND_HANDLERS (screens/chat/hooks/use-slash-commands.ts), which means the agent's\n` +
        `version is dropped from the picker as "shadowed" and intercepted locally when typed — so it\n` +
        `is neither advertised nor runnable, and the reasoning in its allowlist entry reaches nobody.\n\n` +
        `Pick one, do not leave it as it is:\n` +
        `  (a) UNSHADOW it — remove it from LOCAL_COMMAND_HANDLERS *and* from DEEP_LINK_ROUTES /\n` +
        `      SETTINGS_SECTION_COMMANDS (either mapping intercepts on its own), and delete the\n` +
        `      handler branch in handleUiSlashCommand. This is right when the agent's answer carries\n` +
        `      information the SwitchUI screen does not — the test is information gain, NOT "a screen\n` +
        `      exists" (that error is what buried /insights under /dashboard).\n` +
        `  (b) DE-ALLOWLIST it — remove the SLASH_EXEC_ALLOWLIST entry and, if a user might type it,\n` +
        `      add a SLASH_REFUSALS reason instead.\n` +
        `  (c) EXCEPT it — add it to INTENTIONALLY_SHADOWED_COMMANDS with a written reason, but only\n` +
        `      if SwitchUI's answer is genuinely BETTER than the agent's, as /help's is.`,
    ).toEqual([...excepted].sort())
  })

  it('has no stale exception left behind', () => {
    // The other direction: an exception whose shadow or allowlist entry is gone
    // is a licence nobody is using, and it would silently permit the next
    // shadow of the same command.
    for (const command of excepted) {
      expect(
        allowlisted,
        `${command} is excepted in INTENTIONALLY_SHADOWED_COMMANDS but is not on SLASH_EXEC_ALLOWLIST — drop the exception.`,
      ).toContain(command)
      expect(
        handled.has(command),
        `${command} is excepted in INTENTIONALLY_SHADOWED_COMMANDS but nothing shadows it any more — drop the exception.`,
      ).toBe(true)
      expect(
        INTENTIONALLY_SHADOWED_COMMANDS[command].length,
        `${command} needs a written reason, not an empty string.`,
      ).toBeGreaterThan(40)
    }
  })
})

describe('mergeSlashCommands', () => {
  const local: SlashCommandDefinition = {
    command: '/clear',
    description: 'Clear this conversation',
    source: 'local',
  }
  const agentClear: SlashCommandDefinition = {
    command: '/clear',
    description: 'Clear screen and start a new session',
    source: 'agent',
    tier: 'local',
  }
  const agentOther: SlashCommandDefinition = {
    command: '/compress',
    description: 'Compress conversation context',
    source: 'agent',
    tier: 'prompt',
  }
  const agentExcluded: SlashCommandDefinition = {
    command: '/redraw',
    description: 'Force a full UI repaint',
    source: 'agent',
    tier: 'excluded',
  }
  const user: SlashCommandDefinition = {
    command: '/mine',
    description: 'My command',
    source: 'user',
  }

  it('local wins over agent on a name collision', () => {
    const merged = mergeSlashCommands({
      local: [local],
      user: [],
      agent: [agentClear],
    })
    const clears = merged.filter((entry) => entry.command === '/clear')
    expect(clears).toHaveLength(1)
    expect(clears[0].source).toBe('local')
    expect(clears[0].description).toBe('Clear this conversation')
  })

  it('user wins over agent on a name collision', () => {
    const merged = mergeSlashCommands({
      local: [],
      user: [{ command: '/compress', description: 'mine', source: 'user' }],
      agent: [agentOther],
    })
    expect(merged.filter((e) => e.command === '/compress')).toHaveLength(1)
    expect(merged[0].source).toBe('user')
  })

  it('local aliases suppress the agent entry of the same name', () => {
    const merged = mergeSlashCommands({
      local: [
        {
          command: '/interrupt',
          description: 'Stop the current turn',
          source: 'local',
          aliases: ['/stop'],
        },
      ],
      user: [],
      agent: [
        {
          command: '/stop',
          description: 'Stop background processes',
          source: 'agent',
          tier: 'excluded',
        },
      ],
    })
    expect(merged.map((entry) => entry.command)).toEqual(['/interrupt'])
  })

  it('drops excluded-tier agent commands entirely', () => {
    const merged = mergeSlashCommands({
      local: [],
      user: [],
      agent: [agentOther, agentExcluded],
    })
    expect(merged.map((entry) => entry.command)).toEqual(['/compress'])
  })

  it('keeps all three sources when nothing collides', () => {
    const merged = mergeSlashCommands({
      local: [local],
      user: [user],
      agent: [agentOther],
    })
    expect(merged.map((entry) => entry.source)).toEqual([
      'local',
      'user',
      'agent',
    ])
  })
})

// `splitUsageHint` used to live in this component and is now server-side, in
// `server/hermes-commands.ts` — with the policy correction that has to be
// applied to whatever it splits out. Its tests moved with it, next to the guard
// that proves the corrected hint only advertises runnable forms.

describe('agentCatalogEntries renders the hint it is given, and derives none', () => {
  const catalogEntry = (over: Record<string, unknown>) => ({
    command: '/x',
    description: 'd',
    category: 'Session',
    tier: 'local' as const,
    runnable: true,
    skill: false,
    bundle: false,
    ...over,
  })

  it('carries the server’s policy-corrected usage through untouched', () => {
    const [entry] = agentCatalogEntries(
      {
        available: true,
        commands: [
          catalogEntry({ command: '/insights', usage: '[<days 1-365>]' }),
        ],
        categories: ['Session'],
        aliases: {},
        skillCount: 0,
        bundleCount: 0,
        warning: '',
      },
      new Set(),
    )

    expect(entry.usage).toBe('[<days 1-365>]')
  })

  it('does not re-parse a description into a hint the policy withheld', () => {
    // The withholding is the point. `/reasoning` is bare-only, so the server
    // sends no `usage` — and if this component ever splits one back out of the
    // description again it will advertise the five subcommands and the
    // `--global` flag that the exec route refuses, which is the bug this whole
    // pass removed. The description below is deliberately the raw agent
    // wording, i.e. the worst case.
    const [entry] = agentCatalogEntries(
      {
        available: true,
        commands: [
          catalogEntry({
            command: '/reasoning',
            description:
              'Manage reasoning effort and display (usage: /reasoning [level|show|hide|full|clamp] [--global])',
          }),
        ],
        categories: ['Session'],
        aliases: {},
        skillCount: 0,
        bundleCount: 0,
        warning: '',
      },
      new Set(),
    )

    expect(entry.usage).toBeUndefined()
  })
})

describe('curatedSlashCommands', () => {
  const commands: Array<SlashCommandDefinition> = [
    {
      command: '/new',
      description: 'a',
      featured: true,
      source: 'local',
      category: 'SwitchUI',
    },
    {
      command: '/clear',
      description: 'b',
      featured: true,
      source: 'local',
      category: 'SwitchUI',
    },
    { command: '/compress', description: 'c', source: 'agent', tier: 'prompt' },
    { command: '/learn', description: 'd', source: 'agent', tier: 'prompt' },
  ]

  it('shows only featured entries when there are no recents', () => {
    const curated = curatedSlashCommands(commands, [])
    expect(curated.map((entry) => entry.command)).toEqual(['/new', '/clear'])
  })

  it('puts recents in front of the featured set', () => {
    const curated = curatedSlashCommands(commands, ['/learn'])
    expect(curated.map((entry) => entry.command)).toEqual([
      '/learn',
      '/new',
      '/clear',
    ])
  })

  it('moves a featured recent to the top instead of repeating it', () => {
    const curated = curatedSlashCommands(commands, ['/new'])
    expect(curated.map((entry) => entry.command)).toEqual(['/new', '/clear'])
    // /new is listed once, under Recent — everything is featured now, so
    // dropping it from the recents block would empty that section forever.
    expect(curated[0].category).toBe('Recent')
    expect(curated[1].category).toBe('SwitchUI')
  })

  it('lists a repeated command once even via two spellings', () => {
    const withAlias: Array<SlashCommandDefinition> = [
      {
        command: '/interrupt',
        description: 'stop',
        featured: true,
        source: 'local',
        aliases: ['/stop'],
      },
    ]
    const curated = curatedSlashCommands(withAlias, ['/stop', '/interrupt'])
    expect(curated.map((entry) => entry.command)).toEqual(['/interrupt'])
  })

  it('keeps each entry in its own category so the headers survive', () => {
    const curated = curatedSlashCommands(commands, [])
    expect(curated.map((entry) => entry.category)).toEqual([
      'SwitchUI',
      'SwitchUI',
    ])
  })

  it('ignores recents that no longer exist', () => {
    const curated = curatedSlashCommands(commands, ['/gone'])
    expect(curated.map((entry) => entry.command)).toEqual(['/new', '/clear'])
  })
})

describe('recent slash commands', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('records most-recent-first and dedupes', () => {
    recordRecentSlashCommand('/new')
    recordRecentSlashCommand('/clear')
    recordRecentSlashCommand('/new')
    expect(readRecentSlashCommands()).toEqual(['/new', '/clear'])
  })

  it('ignores non-slash input', () => {
    recordRecentSlashCommand('hello')
    expect(readRecentSlashCommands()).toEqual([])
  })

  it('caps the list', () => {
    for (const name of ['/a', '/b', '/c', '/d', '/e', '/f']) {
      recordRecentSlashCommand(name)
    }
    expect(readRecentSlashCommands()).toHaveLength(5)
    expect(readRecentSlashCommands()[0]).toBe('/f')
  })
})

describe('splitSubcommandQuery', () => {
  it('returns null for a bare token', () => {
    expect(splitSubcommandQuery('reasoning')).toBeNull()
  })

  it('splits a token with an empty argument', () => {
    expect(splitSubcommandQuery('reasoning ')).toEqual({
      token: '/reasoning',
      partial: '',
    })
  })

  it('splits a token with a partial argument', () => {
    expect(splitSubcommandQuery('reasoning lo')).toEqual({
      token: '/reasoning',
      partial: 'lo',
    })
  })

  it('returns null once there is a second argument', () => {
    expect(splitSubcommandQuery('title My New Title')).toBeNull()
  })
})

describe('slashCommandMatches', () => {
  const local: SlashCommandDefinition = {
    command: '/new',
    description: 'Start new session',
    source: 'local',
    category: 'SwitchUI',
  }
  const userCmd: SlashCommandDefinition = {
    command: '/my-custom',
    description: 'My custom command',
    source: 'user',
  }
  const agentCmd: SlashCommandDefinition = {
    command: '/branch',
    description: 'Branch the current session',
    source: 'agent',
    aliases: ['/fork'],
  }

  it('matches when query is empty', () => {
    expect(slashCommandMatches(local, '')).toBe(true)
    expect(slashCommandMatches(userCmd, '')).toBe(true)
  })

  it('matches by command name', () => {
    expect(slashCommandMatches(local, 'new')).toBe(true)
    expect(slashCommandMatches(userCmd, 'my-custom')).toBe(true)
  })

  it('matches by description substring', () => {
    expect(slashCommandMatches(local, 'session')).toBe(true)
  })

  it('matches by source label', () => {
    expect(slashCommandMatches(local, 'local')).toBe(true)
    expect(slashCommandMatches(userCmd, 'user')).toBe(true)
    expect(slashCommandMatches(agentCmd, 'agent')).toBe(true)
  })

  it('matches by alias so /fork finds /branch', () => {
    expect(slashCommandMatches(agentCmd, 'fork')).toBe(true)
  })

  it('matches by category', () => {
    expect(slashCommandMatches(local, 'switchui')).toBe(true)
  })

  it('normalizes diacritics and case', () => {
    expect(slashCommandMatches(local, 'NEW')).toBe(true)
  })

  it('returns false for non-matching query', () => {
    expect(slashCommandMatches(local, 'nothing')).toBe(false)
  })
})

// --- The picker's own sources, end to end over the real query layer ---
//
// Phase 3: the agent catalog IS a source again, filtered to entries the exec
// allowlist can actually run (`runnable`) and to entries no SwitchUI handler
// shadows. `local` is empty, so what is left is agent + user.

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  })
  return createElement(QueryClientProvider, { client }, children)
}

const CATALOG_COMMANDS = [
  // runnable, unshadowed → listed
  {
    command: '/history',
    description: 'Show conversation history',
    category: 'Session',
    subcommands: ['show', 'clear'],
    tier: 'local',
    runnable: true,
    skill: false,
  },
  // runnable skill command → listed. `usage` arrives already split out of the
  // description and already reconciled with the exec policy — see
  // `server/hermes-commands.ts`. A skill's hint passes through untouched
  // because its argument really is free prompt text.
  {
    command: '/arxiv',
    description: 'Search arXiv papers',
    usage: '<query>',
    category: 'Skills',
    tier: 'prompt',
    runnable: true,
    skill: true,
  },
  // runnable and no longer shadowed (§8b dropped the local handler) → listed
  {
    command: '/status',
    description: 'Show session status',
    category: 'Info',
    tier: 'local',
    runnable: true,
    skill: false,
  },
  // runnable BUT shadowed by a SwitchUI handler → dropped. `/help` is the only
  // one left in this class: the picker itself is SwitchUI's help surface, so
  // the agent's 18KB ASCII listing of mostly-inapplicable CLI commands is
  // deliberately not advertised.
  {
    command: '/help',
    description: 'Show available commands',
    category: 'Info',
    tier: 'local',
    runnable: true,
    skill: false,
  },
  // not runnable (server allowlist refuses it) → dropped
  {
    command: '/yolo',
    description: 'Toggle approval bypass',
    category: 'Configuration',
    tier: 'excluded',
    runnable: false,
    skill: false,
  },
  // not runnable, non-excluded tier → still dropped
  {
    command: '/compress',
    description: 'Compress conversation context',
    category: 'Session',
    tier: 'prompt',
    runnable: false,
    skill: false,
  },
]

function stubFetch(
  options: {
    catalogOk?: boolean
    userCommands?: boolean
    /** `/api/skills` rows. Omitted ⇒ no metadata, i.e. today's flat list. */
    skills?: Array<Record<string, unknown>>
    /** Appended to the catalog, for tests that need a second skill command. */
    extraCommands?: Array<Record<string, unknown>>
    /**
     * Replaces `CATALOG_COMMANDS` outright, rather than adding to it.
     *
     * For the shadow guard, which drives the catalog off the real
     * `SLASH_EXEC_ALLOWLIST` instead of a fixture — appending would collide
     * with the fixture's deliberately-unrunnable `/compress` entry and make the
     * guard assert something about the fixture rather than about the allowlist.
     */
    commands?: Array<Record<string, unknown>>
  } = {},
) {
  const fetchMock = vi.fn((input: RequestInfo | URL) => {
    const url = String(input)
    if (url.startsWith('/api/skills')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ skills: options.skills ?? [] }),
      } as unknown as Response)
    }
    if (url.startsWith('/api/hermes-commands')) {
      if (options.catalogOk === false) {
        // The documented "capability off" answer.
        return Promise.resolve({
          ok: false,
          status: 503,
          json: () => Promise.resolve({ ok: false }),
        } as unknown as Response)
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            ok: true,
            commands: [
              ...(options.commands ?? CATALOG_COMMANDS),
              ...(options.extraCommands ?? []),
            ],
            categories: ['Session', 'Info', 'Configuration', 'Skills'],
            aliases: {},
            skillCount: 1,
            warning: '',
          }),
      } as unknown as Response)
    }
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          commands:
            options.userCommands === false
              ? []
              : [
                  {
                    id: 'u1',
                    name: 'Mine',
                    slash: '/mine',
                    description: 'My command',
                    prompt: 'do it',
                    enabled: true,
                    createdAt: '',
                    updatedAt: '',
                  },
                ],
        }),
    } as unknown as Response)
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('useSlashCommandDefinitions', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    window.localStorage.clear()
  })

  it("lists the runnable agent commands plus the user's own", async () => {
    stubFetch()
    const { result } = renderHook(() => useSlashCommandDefinitions(), {
      wrapper,
    })

    await waitFor(() => {
      expect(result.current.some((entry) => entry.source === 'agent')).toBe(
        true,
      )
    })
    await waitFor(() => {
      expect(result.current.some((entry) => entry.source === 'user')).toBe(true)
    })

    const byName = new Map(result.current.map((e) => [e.command, e]))

    expect(byName.get('/history')?.source).toBe('agent')
    expect(byName.get('/history')?.category).toBe('Session')
    expect(byName.get('/history')?.featured).toBe(true)

    // The usage hint arrives on its own field, already split out and already
    // reconciled with the exec policy by the server.
    expect(byName.get('/arxiv')?.source).toBe('agent')
    expect(byName.get('/arxiv')?.usage).toBe('<query>')
    expect(byName.get('/arxiv')?.description).toBe('Search arXiv papers')

    expect(byName.get('/status')?.usage).toBeUndefined()

    expect(byName.get('/mine')?.source).toBe('user')
    expect(byName.get('/mine')?.category).toBe(USER_CATEGORY)

    // The catalog's `skill` flag is carried onto the definition — it is the
    // only honest signal for the Skills facet, since skills are agent-sourced.
    expect(byName.get('/arxiv')?.skill).toBe(true)
    expect(byName.get('/history')?.skill).toBeUndefined()
    expect(slashCommandFacet(byName.get('/arxiv')!)).toBe('skill')
    expect(slashCommandFacet(byName.get('/history')!)).toBe('agent')
    expect(slashCommandFacet(byName.get('/mine')!)).toBe('user')

    // Nothing local is advertised any more.
    expect(result.current.some((entry) => entry.source === 'local')).toBe(false)

    expect(new Set(result.current.map((e) => e.command)).size).toBe(
      result.current.length,
    )
  })

  it('carries a bundle slug through to its own facet', async () => {
    // End to end from the wire: the route's `bundle: true` must survive
    // `normalizeHermesCommandCatalog` and `agentCatalogEntries` and land on the
    // definition, or the Bundles tab has nothing to filter on. `runnable: true`
    // with no allowlist entry is the whole point — the server computed it from
    // the catalog's own bundle list.
    stubFetch({
      extraCommands: [
        {
          command: '/research-stack',
          description: 'Load 3 skills for literature work',
          category: 'Bundles',
          tier: 'prompt',
          runnable: true,
          skill: false,
          bundle: true,
        },
      ],
    })
    const { result } = renderHook(() => useSlashCommandDefinitions(), {
      wrapper,
    })

    await waitFor(() => {
      expect(
        result.current.some((entry) => entry.command === '/research-stack'),
      ).toBe(true)
    })

    const entry = result.current.find((e) => e.command === '/research-stack')!
    expect(entry.source).toBe('agent')
    expect(entry.bundle).toBe(true)
    expect(entry.skill).toBeUndefined()
    expect(entry.category).toBe('Bundles')
    expect(slashCommandFacet(entry)).toBe('bundle')
  })

  it('never advertises a command the exec allowlist would refuse', async () => {
    stubFetch()
    const { result } = renderHook(() => useSlashCommandDefinitions(), {
      wrapper,
    })

    await waitFor(() => {
      expect(result.current.some((entry) => entry.source === 'agent')).toBe(
        true,
      )
    })

    const names = result.current.map((entry) => entry.command)
    // `runnable: false` — this is the §8a failure mode, and the reason the
    // flag is computed server-side from the same allowlist the route enforces.
    expect(names).not.toContain('/yolo')
    expect(names).not.toContain('/compress')
  })

  it('drops a runnable agent command that a SwitchUI handler shadows', async () => {
    stubFetch()
    const { result } = renderHook(() => useSlashCommandDefinitions(), {
      wrapper,
    })

    await waitFor(() => {
      expect(result.current.some((entry) => entry.source === 'agent')).toBe(
        true,
      )
    })

    // /help is on the exec allowlist, but typing it opens this picker — badging
    // it "Agent" would misdescribe what happens. It is the only runnable command
    // a SwitchUI handler still shadows; the rule outlives the example.
    expect(result.current.map((e) => e.command)).not.toContain('/help')
    expect(LOCAL_COMMAND_HANDLERS).toContain('/help')
  })

  it('lands every un-excepted allowlisted command in the Agent facet', async () => {
    // The rendered half of the shadow guard, driven off the real allowlist
    // rather than a fixture: if anyone re-adds a local handler — or a
    // DEEP_LINK_ROUTES / SETTINGS_SECTION_COMMANDS mapping — for an allowlisted
    // command, it disappears here and this fails by name.
    //
    // Measured before the fix: 12 allowlisted, 5 shadowed, 7 reaching this tab.
    // After: 12 allowlisted, 1 shadowed (/help), 11 reaching it.
    const expected = Object.keys(SLASH_EXEC_ALLOWLIST)
      .map(lower)
      .filter(
        (command) =>
          !Object.keys(INTENTIONALLY_SHADOWED_COMMANDS)
            .map(lower)
            .includes(command),
      )

    stubFetch({
      // The whole allowlist, exactly as the server would serve it: `runnable`
      // is computed there from this same table.
      commands: Object.keys(SLASH_EXEC_ALLOWLIST).map((command) => ({
        command: lower(command),
        description: `${command} description`,
        category: 'Session',
        tier: 'local',
        runnable: true,
        skill: false,
      })),
    })
    const { result } = renderHook(() => useSlashCommandDefinitions(), {
      wrapper,
    })

    await waitFor(() => {
      expect(result.current.some((entry) => entry.source === 'agent')).toBe(
        true,
      )
    })

    const inAgentFacet = filterSlashCommandsByTab(result.current, 'agent').map(
      (entry) => lower(entry.command),
    )
    for (const command of expected) {
      expect(
        inAgentFacet,
        `${command} is on SLASH_EXEC_ALLOWLIST and is not excepted, so the picker must advertise it. ` +
          `It is missing, which means something in SwitchUI shadows it — see the shadow-guard block above.`,
      ).toContain(command)
    }

    // …and the one exception really is still absent.
    expect(inAgentFacet).not.toContain('/help')
  })

  it('advertises /status in the Agent facet now that nothing shadows it', async () => {
    // The regression guard for §8b: `/status` reports session id, title, model,
    // token count and whether the agent is running — none of which the
    // dashboard shows. Re-adding a local handler (or a /dashboard deep-link)
    // would drop it from the picker as "shadowed" and this must fail loudly if
    // that happens again.
    expect(LOCAL_COMMAND_HANDLERS).not.toContain('/status')

    stubFetch()
    const { result } = renderHook(() => useSlashCommandDefinitions(), {
      wrapper,
    })

    await waitFor(() => {
      expect(result.current.some((entry) => entry.source === 'agent')).toBe(
        true,
      )
    })

    const status = result.current.find((entry) => entry.command === '/status')
    expect(status).toBeDefined()
    expect(status!.source).toBe('agent')
    expect(slashCommandFacet(status!)).toBe('agent')
    expect(
      filterSlashCommandsByTab(result.current, 'agent').map((e) => e.command),
    ).toContain('/status')
  })

  it("degrades to the user's commands alone when the catalog is unavailable", async () => {
    stubFetch({ catalogOk: false })
    const { result } = renderHook(() => useSlashCommandDefinitions(), {
      wrapper,
    })

    await waitFor(() => {
      expect(result.current.some((entry) => entry.source === 'user')).toBe(true)
    })
    expect(result.current.every((entry) => entry.source === 'user')).toBe(true)
  })

  it('is empty when there is neither a catalog nor a user command', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) =>
        String(input).startsWith('/api/hermes-commands')
          ? Promise.resolve({
              ok: false,
              status: 503,
              json: () => Promise.resolve({ ok: false }),
            } as unknown as Response)
          : Promise.resolve({
              ok: true,
              status: 200,
              json: () => Promise.resolve({ commands: [] }),
            } as unknown as Response),
      ),
    )
    const { result } = renderHook(() => useSlashCommandDefinitions(), {
      wrapper,
    })

    await waitFor(() => {
      expect(result.current).toEqual([])
    })
  })
})

// --- Facets and the tab bar ---------------------------------------------
//
// The bar was removed once and is back on purpose. The reasoning for removing
// it held while the picker listed ten SwitchUI commands plus the user's own;
// the change immediately after emptied `LOCAL_SLASH_COMMANDS` and restored the
// agent catalog, so the live list is ~81 entries of which 79 are skills. These
// tests pin the thing that makes the bar necessary — the skill split — so that
// `visibleSlashCommandTabs` is what decides the bar's fate, not a re-run of the
// old judgement call.

const agentEntry: SlashCommandDefinition = {
  command: '/history',
  description: 'Show conversation history',
  source: 'agent',
  category: 'Session',
  featured: true,
}
const skillEntry: SlashCommandDefinition = {
  command: '/arxiv',
  description: 'Search arXiv papers',
  source: 'agent',
  category: 'Skills',
  skill: true,
  featured: true,
}
const otherSkillEntry: SlashCommandDefinition = {
  command: '/ascii-art',
  description: 'Make ASCII art',
  source: 'agent',
  category: 'Skills',
  skill: true,
  featured: true,
}
/**
 * A skill-BUNDLE slug: agent-sourced like the two above, categorized like an
 * ordinary agent command, and neither. This is the entry the fourth facet
 * exists for.
 */
const bundleEntry: SlashCommandDefinition = {
  command: '/research-stack',
  description: 'Load 3 skills for literature work',
  source: 'agent',
  category: 'Bundles',
  bundle: true,
  featured: true,
}
const userEntry: SlashCommandDefinition = {
  command: '/mine',
  description: 'My command',
  source: 'user',
  category: USER_CATEGORY,
  featured: true,
}

describe('slashCommandFacet', () => {
  it('splits the agent source by the catalog skill flag', () => {
    expect(slashCommandFacet(agentEntry)).toBe('agent')
    expect(slashCommandFacet(skillEntry)).toBe('skill')
  })

  it('gives a bundle slug its own facet, not Agent and not Skills', () => {
    // `source` cannot tell these three apart — all agent — and `category`
    // cannot either, because unlike a skill a bundle arrives WITH one. Without
    // the flag a bundle would fall through to `agent` and sit among the
    // read-only report commands, which is not what it is: selecting it starts
    // a turn.
    expect(slashCommandFacet(bundleEntry)).toBe('bundle')
  })

  it('prefers the bundle facet if an entry somehow claimed both', () => {
    // Mutually exclusive in the catalog, asserted so the precedence is a
    // decision rather than an accident of branch order.
    expect(slashCommandFacet({ ...bundleEntry, skill: true })).toBe('bundle')
  })

  it('puts user commands in their own facet', () => {
    expect(slashCommandFacet(userEntry)).toBe('user')
  })

  it('never leaves an entry facetless', () => {
    // Everything must be reachable from some tab; an entry visible only under
    // `All` would vanish the moment a tab is selected. `local` is empty today
    // (§8b) and falls back to `agent` rather than to nothing.
    expect(
      slashCommandFacet({
        command: '/clear',
        description: 'x',
        source: 'local',
      }),
    ).toBe('agent')
    expect(slashCommandFacet({ command: '/x', description: 'x' })).toBe('agent')
  })

  it('a user command is user-faceted even if it were flagged a skill', () => {
    expect(slashCommandFacet({ ...userEntry, skill: true })).toBe('user')
  })
})

describe('countSlashCommandTabs', () => {
  it('counts each facet and the whole set', () => {
    expect(
      countSlashCommandTabs([
        agentEntry,
        skillEntry,
        otherSkillEntry,
        userEntry,
      ]),
    ).toEqual({ all: 4, agent: 1, skill: 2, bundle: 0, user: 1 })
  })

  it('counts bundles apart from skills', () => {
    // The honesty requirement behind the fourth facet: folding bundles into
    // Skills would leave the Skills tab claiming a count that includes things
    // that are not skills and that its `/api/skills` join cannot describe.
    expect(
      countSlashCommandTabs([agentEntry, skillEntry, bundleEntry, userEntry]),
    ).toEqual({ all: 4, agent: 1, skill: 1, bundle: 1, user: 1 })
  })

  it('reports zero for a facet with nothing in it', () => {
    const counts = countSlashCommandTabs([agentEntry, skillEntry])
    expect(counts.user).toBe(0)
    expect(counts.bundle).toBe(0)
    expect(counts.all).toBe(2)
  })

  it('is empty for an empty set', () => {
    expect(countSlashCommandTabs([])).toEqual({
      all: 0,
      agent: 0,
      skill: 0,
      bundle: 0,
      user: 0,
    })
  })
})

describe('visibleSlashCommandTabs', () => {
  it('lists All first, then the non-empty facets in order', () => {
    expect(
      visibleSlashCommandTabs(
        countSlashCommandTabs([agentEntry, skillEntry, userEntry]),
      ),
    ).toEqual(['all', 'agent', 'skill', 'user'])
  })

  it('drops a facet with no commands at all', () => {
    // The user has defined no custom commands: a Custom tab could only ever
    // show nothing, so it is not rendered.
    expect(
      visibleSlashCommandTabs(countSlashCommandTabs([agentEntry, skillEntry])),
    ).toEqual(['all', 'agent', 'skill'])
  })

  it('costs nothing on an install with no bundles, which is every install today', () => {
    // The load-bearing half of "a fourth facet is free". Adding Bundles must
    // not change the bar for anyone who has not created one — and no bundle
    // exists on this host (`bundle_count: 0` live on 2026-08-13).
    expect(
      visibleSlashCommandTabs(
        countSlashCommandTabs([agentEntry, skillEntry, userEntry]),
      ),
    ).toEqual(['all', 'agent', 'skill', 'user'])
  })

  it('slots Bundles between Skills and Custom once one exists', () => {
    expect(
      visibleSlashCommandTabs(
        countSlashCommandTabs([agentEntry, skillEntry, bundleEntry, userEntry]),
      ),
    ).toEqual(['all', 'agent', 'skill', 'bundle', 'user'])
  })

  it('renders no bar at all when only one facet has commands', () => {
    // This is the original removal argument, kept as code: with one facet there
    // is nothing to switch between.
    expect(
      visibleSlashCommandTabs(
        countSlashCommandTabs([skillEntry, otherSkillEntry]),
      ),
    ).toEqual([])
    expect(visibleSlashCommandTabs(countSlashCommandTabs([]))).toEqual([])
  })
})

describe('filterSlashCommandsByTab', () => {
  const all = [agentEntry, skillEntry, otherSkillEntry, bundleEntry, userEntry]

  it('is the identity for All', () => {
    expect(filterSlashCommandsByTab(all, 'all')).toEqual(all)
  })

  it('narrows to one facet', () => {
    expect(
      filterSlashCommandsByTab(all, 'skill').map((e) => e.command),
    ).toEqual(['/arxiv', '/ascii-art'])
    expect(
      filterSlashCommandsByTab(all, 'agent').map((e) => e.command),
    ).toEqual(['/history'])
    expect(filterSlashCommandsByTab(all, 'user').map((e) => e.command)).toEqual(
      ['/mine'],
    )
    // A bundle appears under Bundles and under no other tab — in particular it
    // does not leak into Skills, whose section ordering assumes every entry in
    // a skill section really is one.
    expect(
      filterSlashCommandsByTab(all, 'bundle').map((e) => e.command),
    ).toEqual(['/research-stack'])
  })

  it('keeps the category section headers inside a filtered tab', () => {
    // The pipeline the menu runs: filter by facet, curate, then group.
    const sections = groupByCategory(
      curatedSlashCommands(filterSlashCommandsByTab(all, 'skill'), []),
    )
    expect(sections.map((section) => section.title)).toEqual(['Skills'])
    expect(sections[0].items.map((item) => item.command)).toEqual([
      '/arxiv',
      '/ascii-art',
    ])
  })

  it("pins only the active facet's recents inside a filtered tab", () => {
    // Recents are curated *after* the facet filter, so a recent `/history`
    // cannot surface on the Skills tab.
    const sections = groupByCategory(
      curatedSlashCommands(filterSlashCommandsByTab(all, 'skill'), [
        '/history',
        '/ascii-art',
      ]),
    )
    expect(sections.map((section) => section.title)).toEqual([
      'Recent',
      'Skills',
    ])
    expect(sections[0].items.map((item) => item.command)).toEqual([
      '/ascii-art',
    ])
    expect(sections[1].items.map((item) => item.command)).toEqual(['/arxiv'])
  })

  it('keeps recents across every facet in the All view', () => {
    const sections = groupByCategory(
      curatedSlashCommands(filterSlashCommandsByTab(all, 'all'), [
        '/history',
        '/mine',
      ]),
    )
    expect(sections[0].title).toBe('Recent')
    expect(sections[0].items.map((item) => item.command)).toEqual([
      '/history',
      '/mine',
    ])
  })
})

// --- The bar on screen ---------------------------------------------------

describe('SlashCommandMenu facet tabs', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    )
    // cmdk scrolls its selected row into view; jsdom has no such method.
    Object.defineProperty(Element.prototype, 'scrollIntoView', {
      configurable: true,
      value: () => undefined,
      writable: true,
    })
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    window.localStorage.clear()
  })

  function renderMenu(
    props: {
      query?: string
      ref?: React.RefObject<SlashCommandMenuHandle | null>
    } = {},
  ) {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    })
    const element = (query: string) =>
      createElement(
        QueryClientProvider,
        { client },
        createElement(SlashCommandMenu, {
          open: true,
          query,
          onSelect: () => {},
          ...(props.ref ? { ref: props.ref } : {}),
        }),
      )
    const view = render(element(props.query ?? ''))
    return {
      ...view,
      // cmdk replaces the list's `id` with one of its own, so address it by the
      // wrapper's `data-slot` instead.
      list: () =>
        document.querySelector<HTMLElement>('[data-slot="command-list"]')!,
      retype: (query: string) => view.rerender(element(query)),
      tab: (label: string) =>
        view
          .getAllByRole('tab')
          .find((node) => node.textContent.startsWith(label))!,
    }
  }

  it('shows a tab per non-empty facet, each with its count', async () => {
    stubFetch()
    const view = renderMenu()

    await waitFor(() => {
      expect(view.getAllByRole('tab').length).toBe(4)
    })
    // Agent is 2: `/history` and `/status`. `/help` is runnable too but a local
    // handler shadows it, and `/yolo` / `/compress` are not runnable at all.
    expect(view.getAllByRole('tab').map((node) => node.textContent)).toEqual([
      'All4',
      'Agent2',
      'Skills1',
      'Custom1',
    ])
  })

  it('omits the Custom tab when the user has defined no commands', async () => {
    stubFetch({ userCommands: false })
    const view = renderMenu()

    await waitFor(() => {
      expect(view.getAllByRole('tab').length).toBe(3)
    })
    expect(view.getAllByRole('tab').map((node) => node.textContent)).toEqual([
      'All3',
      'Agent2',
      'Skills1',
    ])
  })

  it('filters the list to the selected facet and keeps the headers', async () => {
    stubFetch()
    const view = renderMenu()

    await waitFor(() => {
      expect(view.getAllByRole('tab').length).toBe(4)
    })
    expect(view.list().textContent).toContain('/history')

    fireEvent.click(view.tab('Skills'))

    await waitFor(() => {
      expect(view.list().textContent).not.toContain('/history')
    })
    expect(view.list().textContent).toContain('/arxiv')
    // The category header survives the filter.
    expect(within(view.list()).getByText('Skills')).toBeTruthy()
    expect(view.tab('Skills').getAttribute('aria-selected')).toBe('true')
  })

  it('shows the source badge in All and drops it inside a facet tab', async () => {
    stubFetch()
    const view = renderMenu()

    await waitFor(() => {
      expect(view.getAllByRole('tab').length).toBe(4)
    })
    // In All, three sources are interleaved and the badge is the only thing
    // saying which is which. Three agent-sourced rows carry it: `/history`,
    // `/status` and the skill `/arxiv` (skills are agent-sourced too).
    expect(within(view.list()).getAllByText('Agent').length).toBe(3)
    expect(within(view.list()).getAllByText('Custom').length).toBe(1)

    fireEvent.click(view.tab('Skills'))

    await waitFor(() => {
      expect(within(view.list()).queryByText('Agent')).toBeNull()
    })
  })

  it('disables a tab the current query leaves with nothing', async () => {
    stubFetch()
    const view = renderMenu()

    await waitFor(() => {
      expect(view.getAllByRole('tab').length).toBe(4)
    })

    view.retype('history')

    await waitFor(() => {
      expect(view.tab('Skills').textContent).toBe('Skills0')
    })
    // Zero *for this query* only disables — the tab keeps its place so the bar
    // does not reflow under the cursor while typing.
    expect((view.tab('Skills') as HTMLButtonElement).disabled).toBe(true)
    expect((view.tab('Agent') as HTMLButtonElement).disabled).toBe(false)
    expect(view.tab('Agent').textContent).toBe('Agent1')
  })

  it('scopes search to the active tab and says so, without stranding the arrow keys', async () => {
    stubFetch()
    const ref = createRef<SlashCommandMenuHandle>()
    const view = renderMenu({ ref })

    await waitFor(() => {
      expect(view.getAllByRole('tab').length).toBe(4)
    })

    fireEvent.click(view.tab('Skills'))
    await waitFor(() => {
      expect(ref.current?.hasItems()).toBe(true)
    })

    // `/history` matches, but not in this tab.
    view.retype('history')

    await waitFor(() => {
      expect(view.list().textContent).toContain('No Skills commands match')
    })
    expect(view.list().textContent).not.toContain('/history')
    // The counts on the bar are computed before the facet filter, so they say
    // where the match went.
    expect(view.tab('Agent').textContent).toBe('Agent1')
    // Nothing on screen ⇒ the composer keeps its arrow keys.
    expect(ref.current?.hasItems()).toBe(false)
    ref.current?.moveSelection(1)
    expect(ref.current?.selectActive()).toBe(false)

    // And the way out is one click, which is why the active tab stays enabled.
    fireEvent.click(view.tab('Agent'))
    await waitFor(() => {
      expect(view.list().textContent).toContain('/history')
    })
    expect(ref.current?.hasItems()).toBe(true)
  })

  it('hides the bar entirely while completing subcommands', async () => {
    stubFetch()
    const view = renderMenu({ query: 'history ' })

    await waitFor(() => {
      expect(view.list().textContent).toContain('/history show')
    })
    // Facets mean nothing when the list is one command's own options.
    expect(view.queryAllByRole('tab')).toEqual([])
  })

  it('still renders nothing when a slash token is followed by prose', async () => {
    // Unchanged by the tab bar: `/arxiv something` is the composer keeping the
    // menu open for a subcommand that does not exist, and the menu must get out
    // of the way rather than show a bar over "No commands found".
    stubFetch()
    const view = renderMenu({ query: 'arxiv wave' })

    await waitFor(() => {
      expect(view.queryAllByRole('tab')).toEqual([])
    })
    expect(document.querySelector('[data-slot="command-list"]')).toBeNull()
  })

  // --- Skills tab, grouped -----------------------------------------------

  const CATALOG_SKILL_ROWS = [
    { id: 'arxiv', name: 'arxiv', category: 'Search & Research', usage: 2 },
    {
      id: 'hermes-switchui-ops',
      name: 'hermes-switchui-ops',
      category: 'AI & LLMs',
      provenance: 'agent',
      usage: 54,
    },
  ]

  /**
   * A second skill command, and — like every real one — with no `args_hint`:
   * that absence is exactly what `SKILL_ARGUMENT_HINT` stands in for.
   */
  const OPS_SKILL_COMMAND = {
    command: '/hermes-switchui-ops',
    description: 'Operate SwitchUI',
    category: 'Skills',
    tier: 'prompt',
    runnable: true,
    skill: true,
  }

  it('splits the Skills tab into the categories /api/skills knows', async () => {
    stubFetch({
      skills: CATALOG_SKILL_ROWS,
      extraCommands: [OPS_SKILL_COMMAND],
    })
    const view = renderMenu()

    await waitFor(() => {
      expect(view.getAllByRole('tab').length).toBe(4)
    })
    fireEvent.click(view.tab('Skills'))

    await waitFor(() => {
      expect(within(view.list()).queryByText('Search & Research')).toBeTruthy()
    })
    // Largest first — `AI & LLMs` and `Search & Research` are one each here, so
    // the alphabetical tie-break decides — and the flat bucket is gone once
    // every skill in view found a row.
    expect(
      Array.from(view.list().querySelectorAll('div')).find((node) =>
        node.textContent.startsWith('AI & LLMs'),
      ),
    ).toBeTruthy()
    expect(within(view.list()).queryByText('Skills')).toBeNull()
    expect(view.list().textContent).toContain('/arxiv')
  })

  it('badges a skill this install produced', async () => {
    stubFetch({
      skills: CATALOG_SKILL_ROWS,
      extraCommands: [OPS_SKILL_COMMAND],
    })
    const view = renderMenu({ query: 'hermes' })

    // Only the agent-authored one; `/arxiv` is bundled and carries no badge.
    await waitFor(() => {
      expect(within(view.list()).getAllByText('Yours')).toHaveLength(1)
    })
    expect(view.list().textContent).toContain('/hermes-switchui-ops')
  })

  it('shows the argument affordance on every skill row', async () => {
    stubFetch({
      skills: CATALOG_SKILL_ROWS,
      extraCommands: [OPS_SKILL_COMMAND],
    })
    const view = renderMenu()

    await waitFor(() => {
      expect(view.getAllByRole('tab').length).toBe(4)
    })
    fireEvent.click(view.tab('Skills'))

    await waitFor(() => {
      expect(within(view.list()).queryAllByText(SKILL_ARGUMENT_HINT).length).toBe(
        1,
      )
    })
    // Not on `/history`, which has a real `args_hint` of its own to render.
    fireEvent.click(view.tab('Agent'))
    await waitFor(() => {
      expect(view.list().textContent).toContain('/history')
    })
    expect(within(view.list()).queryByText(SKILL_ARGUMENT_HINT)).toBeNull()
  })

  it('keeps a skill with no /api/skills row listed, in the flat bucket', async () => {
    // The join is advisory. `/arxiv` matches; nothing here describes `/status`
    // or `/history`, and no skill row exists for a hypothetical miss — so feed
    // it metadata that omits `/arxiv` and check the row survives regardless.
    stubFetch({ skills: [{ id: 'other', name: 'other', category: 'Misc' }] })
    const view = renderMenu()

    await waitFor(() => {
      expect(view.getAllByRole('tab').length).toBe(4)
    })
    fireEvent.click(view.tab('Skills'))

    await waitFor(() => {
      expect(view.list().textContent).toContain('/arxiv')
    })
    expect(within(view.list()).getByText('Skills')).toBeTruthy()
    expect(view.tab('Skills').textContent).toBe('Skills1')
  })

  it('walks the rows with the arrow keys in the order they are rendered', async () => {
    // The sections are reordered after grouping, and the menu navigates by a
    // flat index — so the flattening has to come *from* the sections.
    stubFetch({
      skills: CATALOG_SKILL_ROWS,
      extraCommands: [OPS_SKILL_COMMAND],
    })
    const ref = createRef<SlashCommandMenuHandle>()
    const selected: Array<string> = []
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    })
    render(
      createElement(
        QueryClientProvider,
        { client },
        createElement(SlashCommandMenu, {
          open: true,
          query: '',
          ref,
          onSelect: (item: SlashCommandDefinition) => {
            selected.push(item.command)
          },
        }),
      ),
    )

    // The popover renders into a portal, so the assertion is on the document.
    await waitFor(() => {
      expect(document.body.textContent).toContain('/arxiv')
    })

    // Wait for the metadata join, which is what reorders the sections.
    await waitFor(() => {
      expect(document.body.textContent).toContain('Search & Research')
    })

    const rendered = Array.from(
      document.querySelectorAll('[data-slot="command-item"]'),
    ).map((node) => node.getAttribute('data-value'))
    expect(rendered.length).toBeGreaterThan(3)

    // One arrow-down per row, so the walk is checked at every position rather
    // than only at the first — an off-by-one between the two orders would show
    // up wherever the reordered section starts.
    for (const expected of rendered) {
      await act(() => {
        ref.current?.selectActive()
        ref.current?.moveSelection(1)
      })
      expect(selected.at(-1)).toBe(expected)
    }
    expect(selected).toEqual(rendered)
  })
})

// --- Grouping the skill tail ---------------------------------------------
//
// The Skills facet held 79 entries in one flat alphabetical list, because
// `commands.catalog` gives skills no category — that absence is the only thing
// marking them as skills. The categories are joined in from `/api/skills` by
// slug. The join is advisory: it can only add a heading, never remove a row.

const SKILL_ROWS = [
  {
    id: 'gif-search',
    name: 'GIF Search',
    category: 'Image & Video',
    provenance: 'bundled',
    usage: 2,
  },
  {
    id: 'excalidraw',
    name: 'excalidraw',
    category: 'Image & Video',
    provenance: 'bundled',
    usage: 0,
  },
  {
    id: 'ascii-art',
    name: 'ascii-art',
    category: 'Image & Video',
    provenance: 'bundled',
    usage: 0,
  },
  {
    id: 'hermes-switchui-ops',
    name: 'hermes-switchui-ops',
    category: 'AI & LLMs',
    provenance: 'agent',
    usage: 54,
  },
  {
    id: 'arxiv',
    name: 'arxiv',
    category: 'Search & Research',
    provenance: 'bundled',
    usage: 2,
  },
]

const SKILL_INDEX = buildSkillMetadataIndex({ skills: SKILL_ROWS })

function skillCommand(command: string): SlashCommandDefinition {
  return {
    command,
    description: `${command} does a thing`,
    source: 'agent',
    category: SKILLS_FALLBACK_CATEGORY,
    skill: true,
    featured: true,
  }
}

describe('applySkillMetadata', () => {
  it('replaces the flat Skills bucket with the skill’s own category', () => {
    const [entry] = applySkillMetadata([skillCommand('/arxiv')], SKILL_INDEX)
    expect(entry.category).toBe('Search & Research')
  })

  it('joins by slug, so /gif-search finds the row named "GIF Search"', () => {
    const [entry] = applySkillMetadata(
      [skillCommand('/gif-search')],
      SKILL_INDEX,
    )
    expect(entry.category).toBe('Image & Video')
  })

  it('carries provenance and the invocation counter across', () => {
    const [entry] = applySkillMetadata(
      [skillCommand('/hermes-switchui-ops')],
      SKILL_INDEX,
    )
    expect(entry.provenance).toBe('agent')
    expect(entry.invocations).toBe(54)
  })

  it('never touches a command that is not a skill', () => {
    // A same-named skill row must not repossess `/history`.
    const history: SlashCommandDefinition = {
      command: '/arxiv',
      description: 'not a skill',
      source: 'agent',
      category: 'Session',
    }
    expect(applySkillMetadata([history], SKILL_INDEX)[0].category).toBe(
      'Session',
    )
  })

  it('fails soft: an unmatched command keeps its category and stays listed', () => {
    const entries = applySkillMetadata(
      [skillCommand('/arxiv'), skillCommand('/workspace-dispatch')],
      SKILL_INDEX,
    )
    // Dropping the miss would hide a command that works — always worse than an
    // ungrouped row.
    expect(entries.map((entry) => entry.command)).toEqual([
      '/arxiv',
      '/workspace-dispatch',
    ])
    expect(entries[1].category).toBe(SKILLS_FALLBACK_CATEGORY)
    expect(entries[1].provenance).toBeUndefined()
  })

  it('is the identity when the index is empty', () => {
    const items = [skillCommand('/arxiv')]
    // Capability off, request failed, or still loading ⇒ exactly today's list.
    expect(applySkillMetadata(items, new Map())).toBe(items)
  })
})

describe('orderSlashCommandSections', () => {
  const section = (title: string, commands: Array<string>, skill = true) => ({
    title,
    items: commands.map((command) =>
      skill
        ? skillCommand(command)
        : { command, description: 'x', source: 'agent' as const, category: title },
    ),
  })

  it('orders skill sections largest first', () => {
    const ordered = orderSlashCommandSections([
      section('Search & Research', ['/arxiv']),
      section('Image & Video', ['/a', '/b', '/c']),
      section('AI & LLMs', ['/x', '/y']),
    ])
    expect(ordered.map((entry) => entry.title)).toEqual([
      'Image & Video',
      'AI & LLMs',
      'Search & Research',
    ])
  })

  it('breaks a size tie alphabetically so the list cannot reshuffle', () => {
    const ordered = orderSlashCommandSections([
      section('Productivity', ['/p']),
      section('Communication', ['/c']),
    ])
    expect(ordered.map((entry) => entry.title)).toEqual([
      'Communication',
      'Productivity',
    ])
  })

  it('pins the fail-soft Skills bucket last, however big it is', () => {
    const ordered = orderSlashCommandSections([
      section(SKILLS_FALLBACK_CATEGORY, ['/a', '/b', '/c', '/d']),
      section('AI & LLMs', ['/x']),
    ])
    expect(ordered.map((entry) => entry.title)).toEqual([
      'AI & LLMs',
      SKILLS_FALLBACK_CATEGORY,
    ])
  })

  it('keeps non-skill sections in first-seen order, above the skill tail', () => {
    // Sorting these by size too would sink `/history` and the user's own
    // commands below a twenty-entry skill category on the All tab.
    const ordered = orderSlashCommandSections([
      section('Session', ['/history'], false),
      section(USER_CATEGORY, ['/mine'], false),
      section('Image & Video', ['/a', '/b', '/c']),
    ])
    expect(ordered.map((entry) => entry.title)).toEqual([
      'Session',
      USER_CATEGORY,
      'Image & Video',
    ])
  })

  it('pins Recent first even though it is mostly skills', () => {
    const ordered = orderSlashCommandSections([
      section('Image & Video', ['/a', '/b', '/c']),
      section('Recent', ['/arxiv']),
      section('Session', ['/history'], false),
    ])
    expect(ordered.map((entry) => entry.title)).toEqual([
      'Recent',
      'Session',
      'Image & Video',
    ])
  })
})

describe('rankSkillSectionItems', () => {
  const items = [
    { ...skillCommand('/alpha'), invocations: 0 },
    { ...skillCommand('/beta'), invocations: 9 },
    { ...skillCommand('/gamma'), invocations: 3 },
    { ...skillCommand('/delta'), invocations: 0 },
  ]

  it('puts recents first, in recency order', () => {
    const ranked = rankSkillSectionItems(items, ['/delta', '/alpha'])
    expect(ranked.map((entry) => entry.command).slice(0, 2)).toEqual([
      '/delta',
      '/alpha',
    ])
  })

  it('does not rank on the backend counter alone', () => {
    // The counters are near-zero on a fresh install, so a recently-used skill
    // with zero invocations must still outrank the most-invoked one.
    const ranked = rankSkillSectionItems(items, ['/alpha'])
    expect(ranked[0].command).toBe('/alpha')
    expect(ranked[1].command).toBe('/beta')
  })

  it('falls back to invocations, then alphabetical', () => {
    const ranked = rankSkillSectionItems(items, [])
    expect(ranked.map((entry) => entry.command)).toEqual([
      '/beta',
      '/gamma',
      '/alpha',
      '/delta',
    ])
  })

  it('is stable and total for entries with no counter at all', () => {
    const bare = [skillCommand('/b'), skillCommand('/a')]
    expect(rankSkillSectionItems(bare, []).map((e) => e.command)).toEqual([
      '/a',
      '/b',
    ])
  })
})

describe('buildSlashCommandSections', () => {
  it('groups, ranks and orders in one pass', () => {
    const commands = applySkillMetadata(
      [
        skillCommand('/arxiv'),
        skillCommand('/gif-search'),
        skillCommand('/excalidraw'),
        skillCommand('/ascii-art'),
        skillCommand('/hermes-switchui-ops'),
        skillCommand('/workspace-dispatch'),
      ],
      SKILL_INDEX,
    )
    const sections = buildSlashCommandSections(commands, ['/excalidraw'])

    expect(sections.map((entry) => entry.title)).toEqual([
      'Image & Video',
      'AI & LLMs',
      'Search & Research',
      SKILLS_FALLBACK_CATEGORY,
    ])
    // Recent first inside the section, then the counter, then alphabetical.
    expect(sections[0].items.map((entry) => entry.command)).toEqual([
      '/excalidraw',
      '/gif-search',
      '/ascii-art',
    ])
    // The unmatched command is still there — last, but never dropped.
    expect(sections[3].items.map((entry) => entry.command)).toEqual([
      '/workspace-dispatch',
    ])
  })

  it('reproduces one flat Skills section when no metadata arrived', () => {
    const commands = [skillCommand('/arxiv'), skillCommand('/ascii-art')]
    const sections = buildSlashCommandSections(
      applySkillMetadata(commands, new Map()),
      [],
    )
    expect(sections.map((entry) => entry.title)).toEqual([
      SKILLS_FALLBACK_CATEGORY,
    ])
    expect(sections[0].items).toHaveLength(2)
  })
})

// --- The skill argument affordance ---------------------------------------
//
// The picker inserts `"/skill "` and dismisses — skills carry no `subcommands`
// to complete — and the menu closes for good at the second space. So every hint
// it showed disappears exactly when the user starts typing the argument, which
// is the thing that aims the skill.

describe('findSkillInvocation', () => {
  const commands = [
    applySkillMetadata([skillCommand('/arxiv')], SKILL_INDEX)[0],
    {
      command: '/history',
      description: 'Show conversation history',
      source: 'agent' as const,
      category: 'Session',
    },
  ]

  it('matches the bare token, the token plus a space, and a full argument', () => {
    expect(findSkillInvocation('/arxiv', commands)?.command).toBe('/arxiv')
    expect(findSkillInvocation('/arxiv ', commands)?.command).toBe('/arxiv')
    expect(
      findSkillInvocation('/arxiv quantum error correction', commands)?.command,
    ).toBe('/arxiv')
  })

  it('ignores commands that are not skills, and prose', () => {
    expect(findSkillInvocation('/history show', commands)).toBeNull()
    expect(findSkillInvocation('what does /arxiv do', commands)).toBeNull()
    expect(findSkillInvocation('/', commands)).toBeNull()
    expect(findSkillInvocation('', commands)).toBeNull()
  })

  it('resolves an alias to the skill it spells', () => {
    const aliased = [{ ...skillCommand('/arxiv'), aliases: ['/papers'] }]
    expect(findSkillInvocation('/papers ml', aliased)?.command).toBe('/arxiv')
  })

  it('names the command in the notice, because that is the whole point', () => {
    expect(skillArgumentNotice('/arxiv')).toContain('/arxiv')
    expect(skillArgumentNotice('/arxiv')).toContain('instruction')
  })
})
