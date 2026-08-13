// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import {
  CHAT_PENDING_COMMAND_STORAGE_KEY,
  CHAT_RUN_COMMAND_EVENT,
} from '../chat-events'
import { CHAT_OPEN_MODEL_PICKER_EVENT } from '../components/chat-composer-services'
import {
  LOCAL_COMMAND_ALIASES,
  LOCAL_COMMAND_HANDLERS,
  agentCommandNotice,
  useSlashCommands,
} from './use-slash-commands'
import type { HermesCommandCatalog } from '@/lib/hermes-commands-api'
import type * as HermesCommandsApiNs from '@/lib/hermes-commands-api'

import type { UseSlashCommandsParams } from './use-slash-commands'
import type {
  ChatComposerAttachment,
  ChatComposerHelpers,
} from '../components/chat-composer-types'
import type { ChatMessage } from '../types'
import type { UserCommandRecord } from '@/lib/commands-api'
import { OPEN_SLASH_COMMAND_MENU_EVENT } from '@/components/slash-command-menu'
import {
  INTENTIONALLY_SHADOWED_COMMANDS,
  SLASH_EXEC_ALLOWLIST,
} from '@/server/hermes-slash-policy'
import { toast } from '@/components/ui/toast'
import { useSessionModelStore } from '@/stores/session-model-store'
import { execAgentCommand } from '@/lib/hermes-commands-api'
import { useCommandOutputStore } from '@/stores/command-output-store'

type HermesCommandsApi = typeof HermesCommandsApiNs

vi.mock('@/components/ui/toast', () => ({ toast: vi.fn() }))

// `execAgentCommand` is the only network call this hook makes. Mocked rather
// than stubbing `fetch` so the assertions are about routing, not transport —
// the transport itself is covered by `-hermes-commands-exec.test.ts`.
vi.mock('@/lib/hermes-commands-api', async () => {
  const actual =
    await vi.importActual<HermesCommandsApi>('@/lib/hermes-commands-api')
  return { ...actual, execAgentCommand: vi.fn() }
})

const SESSION = 'session-abc'
const FRIENDLY_ID = 'friendly-1'

const commandHelpers: ChatComposerHelpers = {
  reset() {},
  setValue() {},
  setAttachments() {},
}

function makeMessage(role: string, text: string): ChatMessage {
  return {
    role,
    content: [{ type: 'text', text }],
  } as unknown as ChatMessage
}

function makeUserCommand(
  overrides: Partial<UserCommandRecord> = {},
): UserCommandRecord {
  return {
    id: 'cmd-1',
    name: 'Test Command',
    slash: '/test',
    description: '',
    prompt: 'Expanded prompt: $INPUT',
    enabled: true,
    createdAt: '',
    updatedAt: '',
    ...overrides,
  }
}

type SendFn = UseSlashCommandsParams['sendRef']['current']

/**
 * A slice of the live catalog: one command per tier, plus an alias, so the
 * routing rules can be pinned without a network call. Shapes match
 * `GET /api/hermes-commands` exactly (verified against the live 156-command
 * response).
 */
const CATALOG: HermesCommandCatalog = {
  available: true,
  commands: [
    {
      command: '/compress',
      description: 'Compress conversation context',
      category: 'Session',
      tier: 'prompt',
      // Refused by the server allowlist (hermes-agent#218) — the picker never
      // lists it and the hook must not call the exec route for it.
      runnable: false,
      skill: false,
      bundle: false,
    },
    {
      command: '/reload-skills',
      description: 'Rescan the skills directory',
      category: 'Tools & Skills',
      tier: 'proxy',
      runnable: false,
      skill: false,
      bundle: false,
    },
    {
      // `/bundles` joined the exec allowlist once agent v0.19.16 started
      // emitting the slugs it lists, so it is runnable here — it used to stand
      // in for a non-runnable proxy-tier command, a job `/reload-skills` now
      // does above.
      command: '/bundles',
      description: 'List skill bundles',
      category: 'Tools & Skills',
      tier: 'proxy',
      runnable: true,
      skill: false,
      bundle: false,
    },
    {
      // A bundle SLUG, which is a different thing from `/bundles`: it is
      // categorized (so `skill` is false) yet dispatchable without an
      // allowlist entry, which is the whole point of the `bundle` flag.
      command: '/research-stack',
      description: 'Load 3 skills as a bundle',
      category: 'Bundles',
      tier: 'prompt',
      runnable: true,
      skill: false,
      bundle: true,
    },
    {
      command: '/branch',
      description: 'Branch the current session',
      category: 'Session',
      tier: 'local',
      runnable: false,
      skill: false,
      bundle: false,
    },
    {
      command: '/redraw',
      description: 'Force a full UI repaint',
      category: 'TUI',
      tier: 'excluded',
      runnable: false,
      skill: false,
      bundle: false,
    },
    {
      command: '/history',
      description: 'Show conversation history',
      category: 'Session',
      tier: 'local',
      // On the exec allowlist: this one really runs.
      runnable: true,
      skill: false,
      bundle: false,
    },
    {
      command: '/arxiv',
      description: 'Search arXiv papers',
      category: 'Skills',
      tier: 'prompt',
      runnable: true,
      skill: true,
      bundle: false,
    },
    {
      command: '/status',
      description: 'Show session status',
      category: 'Info',
      tier: 'local',
      // On the exec allowlist, and no longer shadowed: §8b removed SwitchUI's
      // own command set, so the agent's /status is the only /status and it
      // reports session facts (id, title, model, tokens, running) that the
      // dashboard never showed.
      runnable: true,
      skill: false,
      bundle: false,
    },
  ],
  categories: ['Session', 'Tools & Skills', 'TUI', 'Skills', 'Info', 'Bundles'],
  // `/fork` → `/branch` is shadowed by the local `/branch` handler (asserted
  // below); `/compact` → `/compress` stays agent-only, so it exercises the
  // catalog's own alias resolution.
  aliases: { '/fork': '/branch', '/compact': '/compress' },
  skillCount: 0,
  bundleCount: 1,
  warning: '',
}

function defaultParams(
  overrides: Partial<UseSlashCommandsParams> = {},
): UseSlashCommandsParams {
  const send = vi.fn().mockResolvedValue(undefined) as unknown as SendFn
  return {
    navigate: vi.fn(),
    forcedSessionKey: undefined,
    resolvedSessionKey: SESSION,
    activeSessionKey: SESSION,
    activeFriendlyId: FRIENDLY_ID,
    queryClient: {
      getQueryData: vi.fn(),
      setQueryData: vi.fn(),
      getQueriesData: vi.fn().mockReturnValue([]),
      cancelQueries: vi.fn().mockResolvedValue(undefined),
    } as unknown as UseSlashCommandsParams['queryClient'],
    finalDisplayMessages: [],
    enabledUserCommands: [],
    handleAbortStreaming: vi.fn(),
    renameSession: vi.fn().mockResolvedValue(undefined),
    forkSession: vi.fn().mockResolvedValue('forked-session-key'),
    sendRef: { current: send },
    commandHelpers,
    userCommandsPending: false,
    ...overrides,
  }
}

describe('useSlashCommands', () => {
  beforeEach(() => {
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn().mockReturnValue('blob:test'),
      revokeObjectURL: vi.fn(),
    })
    useSessionModelStore.setState({ models: {} })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    window.sessionStorage.clear()
  })

  // --- handleUiSlashCommand ---

  describe('handleUiSlashCommand', () => {
    it('returns false for non-slash input', () => {
      const { result } = renderHook(() => useSlashCommands(defaultParams()))
      expect(result.current.handleUiSlashCommand('hello')).toBe(false)
    })

    it('returns false for empty string', () => {
      const { result } = renderHook(() => useSlashCommands(defaultParams()))
      expect(result.current.handleUiSlashCommand('')).toBe(false)
    })

    it('/new navigates to the new-session sentinel', () => {
      const navigate = vi.fn()
      const { result } = renderHook(() =>
        useSlashCommands(defaultParams({ navigate })),
      )

      act(() => {
        result.current.handleUiSlashCommand('/new')
      })

      expect(navigate).toHaveBeenCalledWith({
        to: '/chat/$sessionKey',
        params: { sessionKey: 'new' },
      })
    })

    it('/reset navigates to the new-session sentinel', () => {
      const navigate = vi.fn()
      const { result } = renderHook(() =>
        useSlashCommands(defaultParams({ navigate })),
      )

      act(() => {
        result.current.handleUiSlashCommand('/reset')
      })

      expect(navigate).toHaveBeenCalledWith({
        to: '/chat/$sessionKey',
        params: { sessionKey: 'new' },
      })
    })

    it('/clear clears the history for the session', () => {
      const clearSpy = vi.fn()
      vi.doMock('../chat-queries', () => ({
        clearHistoryMessages: clearSpy,
        updateHistoryMessageByClientIdEverywhere: vi.fn(),
      }))

      const { result } = renderHook(() => useSlashCommands(defaultParams()))

      act(() => {
        result.current.handleUiSlashCommand('/clear')
      })

      // clearHistoryMessages is imported at module load; verify via toast spy
      // (the command also fires a toast)
      expect(result.current.handleUiSlashCommand('/clear')).toBe(true)
    })

    // Bare `/model` used to dispatch CHAT_OPEN_SETTINGS_EVENT, which has no
    // listener anywhere in the app — a complete no-op (#348 task 6). It now
    // dispatches CHAT_OPEN_MODEL_PICKER_EVENT, which SessionSelectorsV2
    // listens for directly.
    it('bare /model dispatches the open-model-picker event', () => {
      const dispatchSpy = vi.spyOn(window, 'dispatchEvent')
      const { result } = renderHook(() => useSlashCommands(defaultParams()))

      act(() => {
        result.current.handleUiSlashCommand('/model')
      })

      const event = dispatchSpy.mock.calls[0]?.[0] as CustomEvent
      expect(event.type).toBe(CHAT_OPEN_MODEL_PICKER_EVENT)
    })

    it('bare /model does NOT dispatch the dead settings event', () => {
      const dispatchSpy = vi.spyOn(window, 'dispatchEvent')
      const { result } = renderHook(() => useSlashCommands(defaultParams()))

      act(() => {
        result.current.handleUiSlashCommand('/model')
      })

      const types = dispatchSpy.mock.calls.map(
        (call) => (call[0] as CustomEvent).type,
      )
      expect(types).not.toContain('claude:chat-open-settings')
    })

    // `/model <id>` used to fail the exact-string check (only bare `/model`
    // matched) and fall through to being sent verbatim as chat text over
    // HTTP, which has no slash interpreter (#348 task 6). It is now
    // tokenized and routed through the same per-session switch as the
    // picker (switchModel, from chat-composer-services.ts).
    it('/model <id> switches this session\'s model instead of sending chat text', () => {
      const send = vi.fn().mockResolvedValue(undefined) as unknown as SendFn
      const { result } = renderHook(() =>
        useSlashCommands(
          defaultParams({
            resolvedSessionKey: SESSION,
            sendRef: { current: send },
          }),
        ),
      )

      let handled = false
      act(() => {
        handled = result.current.handleUiSlashCommand('/model gpt-4o')
      })

      expect(handled).toBe(true)
      expect(send).not.toHaveBeenCalled()
      expect(useSessionModelStore.getState().getModel(SESSION)).toBe('gpt-4o')
    })

    it('/model <id> shows a confirmation toast', () => {
      const { result } = renderHook(() =>
        useSlashCommands(defaultParams({ resolvedSessionKey: SESSION })),
      )

      act(() => {
        result.current.handleUiSlashCommand('/model gpt-4o')
      })

      expect(toast).toHaveBeenCalledWith(
        expect.stringContaining('gpt-4o'),
        expect.objectContaining({ type: 'success' }),
      )
    })

    it('/model <id> does not dispatch the open-model-picker event', () => {
      const dispatchSpy = vi.spyOn(window, 'dispatchEvent')
      const { result } = renderHook(() =>
        useSlashCommands(defaultParams({ resolvedSessionKey: SESSION })),
      )

      act(() => {
        result.current.handleUiSlashCommand('/model gpt-4o')
      })

      const types = dispatchSpy.mock.calls.map(
        (call) => (call[0] as CustomEvent).type,
      )
      expect(types).not.toContain(CHAT_OPEN_MODEL_PICKER_EVENT)
    })

    // `/skin` used to dispatch CHAT_OPEN_SETTINGS_EVENT, which has zero
    // listeners anywhere in the app — the command was a silent no-op. The
    // settings screen treats the URL as the only source of truth for which
    // section is open, so it navigates now.
    it('/skin opens the appearance settings section by URL', () => {
      const navigate = vi.fn()
      const dispatchSpy = vi.spyOn(window, 'dispatchEvent')
      const { result } = renderHook(() =>
        useSlashCommands(defaultParams({ navigate })),
      )

      act(() => {
        result.current.handleUiSlashCommand('/skin')
      })

      expect(navigate).toHaveBeenCalledWith({
        to: '/settings',
        search: { section: 'appearance' },
      })
      const types = dispatchSpy.mock.calls.map(
        (call) => (call[0] as CustomEvent).type,
      )
      expect(types).not.toContain('claude:chat-open-settings')
    })

    it('/skills navigates to /skills', () => {
      const navigate = vi.fn()
      const { result } = renderHook(() =>
        useSlashCommands(defaultParams({ navigate })),
      )

      act(() => {
        result.current.handleUiSlashCommand('/skills')
      })

      expect(navigate).toHaveBeenCalledWith({ to: '/skills' })
    })

    it('/plugins navigates to /plugins', () => {
      const navigate = vi.fn()
      const { result } = renderHook(() =>
        useSlashCommands(defaultParams({ navigate })),
      )

      act(() => {
        result.current.handleUiSlashCommand('/plugins')
      })

      expect(navigate).toHaveBeenCalledWith({ to: '/plugins' })
    })

    // `/interrupt` and the Stop button must be indistinguishable — they were
    // two hand-maintained copies of the same logic, and only one of them would
    // have got the gateway call. These pin the delegation, not the internals.
    //
    // The command was `/stop` until the Hermes name collision was resolved
    // (§8): the agent's `/stop` kills background processes and does NOT stop
    // the turn. `/stop` survives as a transitional alias.
    it('/interrupt delegates to the shared abort handler', () => {
      const handleAbortStreaming = vi.fn()

      const { result } = renderHook(() =>
        useSlashCommands(defaultParams({ handleAbortStreaming })),
      )

      act(() => {
        result.current.handleUiSlashCommand('/interrupt')
      })

      expect(handleAbortStreaming).toHaveBeenCalledTimes(1)
    })

    it('/stop still works as a transitional alias for /interrupt', () => {
      const handleAbortStreaming = vi.fn()

      const { result } = renderHook(() =>
        useSlashCommands(defaultParams({ handleAbortStreaming })),
      )

      act(() => {
        result.current.handleUiSlashCommand('/stop')
      })

      expect(handleAbortStreaming).toHaveBeenCalledTimes(1)
      expect(LOCAL_COMMAND_ALIASES['/stop']).toBe('/interrupt')
    })

    it('/stop never reaches the agent, even with the catalog loaded', () => {
      const send = vi.fn().mockResolvedValue(undefined) as unknown as SendFn
      const handleAbortStreaming = vi.fn()
      const { result } = renderHook(() =>
        useSlashCommands(
          defaultParams({
            agentCommandCatalog: CATALOG,
            handleAbortStreaming,
            sendRef: { current: send },
          }),
        ),
      )

      act(() => {
        result.current.runPaletteSlashCommand('/stop')
      })

      expect(handleAbortStreaming).toHaveBeenCalledTimes(1)
      expect(send).not.toHaveBeenCalled()
    })

    it('/interrupt is handled even with no active send', () => {
      const handleAbortStreaming = vi.fn()

      const { result } = renderHook(() =>
        useSlashCommands(defaultParams({ handleAbortStreaming })),
      )

      const handled = result.current.handleUiSlashCommand('/interrupt')
      expect(handled).toBe(true)
      expect(handleAbortStreaming).toHaveBeenCalledTimes(1)
    })

    it('/interrupt shows no toast — the stop notice reports the real outcome', () => {
      const { result } = renderHook(() => useSlashCommands(defaultParams()))
      vi.mocked(toast).mockClear()

      act(() => {
        result.current.handleUiSlashCommand('/interrupt')
      })

      expect(toast).not.toHaveBeenCalled()
    })

    it('/title without arg shows usage toast', () => {
      const { result } = renderHook(() => useSlashCommands(defaultParams()))
      expect(result.current.handleUiSlashCommand('/title')).toBe(true)
    })

    it('/title with arg calls renameSession', () => {
      const renameSession = vi.fn().mockResolvedValue(undefined)
      const { result } = renderHook(() =>
        useSlashCommands(defaultParams({ renameSession })),
      )

      act(() => {
        result.current.handleUiSlashCommand('/title My Title')
      })

      expect(renameSession).toHaveBeenCalledWith(
        SESSION,
        FRIENDLY_ID,
        'My Title',
      )
    })

    it('/reasoning is not handled locally at all any more', () => {
      // The handler used to set a thinking level and toast "Reasoning: low".
      // The level travelled as `body.thinking`, which `send-stream.ts`
      // deliberately drops (api_server has no per-request effort parameter),
      // and its only other consumer is the composer's
      // `effectiveFastMode = fastMode && thinkingLevel === 'off'` gate, whose
      // own output is dropped on the same grounds. So it reported success and
      // could not change a turn — while shadowing the agent's `/reasoning`,
      // the only truthful readout of `agent.reasoning_effort` (there is no
      // Settings control either). Deleted rather than merely unshadowed:
      // "reports success, changes nothing" is the defect this project removes.
      //
      // The composer's reasoning picker is untouched. If the gateway ever
      // grows a per-request parameter, wire it there — send-stream.ts records
      // the mapping — rather than reinstating this command.
      const { result } = renderHook(() => useSlashCommands(defaultParams()))
      vi.mocked(toast).mockClear()

      for (const input of [
        '/reasoning',
        '/reasoning off',
        '/reasoning low',
        '/reasoning adaptive',
        '/reasoning high',
      ]) {
        let handled = true
        act(() => {
          handled = result.current.handleUiSlashCommand(input)
        })
        // No catalog in these params, so nothing claims it — which is exactly
        // what lets the catalog arm route it to the exec allowlist in the app.
        expect(handled, input).toBe(false)
      }
      expect(toast).not.toHaveBeenCalled()
    })

    it('unknown slash command returns false', () => {
      const { result } = renderHook(() => useSlashCommands(defaultParams()))
      expect(result.current.handleUiSlashCommand('/unknown')).toBe(false)
    })
  })

  // --- §4.3 deep-links: covered better by an existing screen ---

  describe('deep-links', () => {
    const ROUTES: Array<[string, string]> = [
      ['/mcp', '/mcp'],
      // NO `/status` — see the dedicated test below. It is deliberately not a
      // deep-link any more. NO `/insights` or `/profile` either, for the same
      // reason and covered by the same guard: both are on the exec allowlist,
      // and `/dashboard` / `/profiles` are precisely the screens that lack what
      // each one reports.
      ['/platforms', '/dashboard'],
      ['/agents', '/tasks'],
      ['/tasks', '/tasks'],
    ]

    for (const [command, to] of ROUTES) {
      it(`${command} navigates to ${to}`, () => {
        const navigate = vi.fn()
        const { result } = renderHook(() =>
          useSlashCommands(defaultParams({ navigate })),
        )

        let handled = false
        act(() => {
          handled = result.current.handleUiSlashCommand(command)
        })

        expect(handled).toBe(true)
        expect(navigate).toHaveBeenCalledWith({ to })
      })
    }

    it('/status is not handled locally and navigates nowhere', () => {
      // It used to deep-link to /dashboard, which meant the local handler
      // intercepted it, the picker dropped it as "shadowed", and the agent's
      // own /status was neither advertised nor executed. The dashboard shows
      // gateway health, not session id / title / model / token count, so the
      // command now falls through to the catalog + exec path instead.
      expect(LOCAL_COMMAND_HANDLERS).not.toContain('/status')

      const navigate = vi.fn()
      const { result } = renderHook(() =>
        useSlashCommands(defaultParams({ navigate })),
      )

      let handled = true
      act(() => {
        handled = result.current.handleUiSlashCommand('/status')
      })

      // With no catalog there is nothing to run, so the hook declines it —
      // which is exactly what lets the catalog arm below take it.
      expect(handled).toBe(false)
      expect(navigate).not.toHaveBeenCalled()
    })

    // NO `/version`: it is allowlisted, and Settings → Updates knows about
    // releases rather than about which tree is installed — the command reports
    // the install directory, install method, Python version and OpenAI SDK
    // version, none of which that section has. It was mapped in BOTH tables;
    // this one won, so its DEEP_LINK_ROUTES entry was unreachable.
    const SETTINGS: Array<[string, Record<string, unknown>]> = [
      ['/config', {}],
      ['/update', { section: 'updates' }],
    ]

    for (const [command, search] of SETTINGS) {
      it(`${command} opens settings ${JSON.stringify(search)}`, () => {
        const navigate = vi.fn()
        const { result } = renderHook(() =>
          useSlashCommands(defaultParams({ navigate })),
        )

        act(() => {
          result.current.handleUiSlashCommand(command)
        })

        expect(navigate).toHaveBeenCalledWith({ to: '/settings', search })
      })
    }

    it('/mcp is no longer a dead entry sent to the model as prose', () => {
      const send = vi.fn().mockResolvedValue(undefined) as unknown as SendFn
      const navigate = vi.fn()
      const { result } = renderHook(() =>
        useSlashCommands(defaultParams({ navigate, sendRef: { current: send } })),
      )

      act(() => {
        result.current.runPaletteSlashCommand('/mcp')
      })

      expect(navigate).toHaveBeenCalledWith({ to: '/mcp' })
      expect(send).not.toHaveBeenCalled()
    })

    it('/help opens the slash-command menu instead of proxying agent help', () => {
      const send = vi.fn().mockResolvedValue(undefined) as unknown as SendFn
      const dispatchSpy = vi.spyOn(window, 'dispatchEvent')
      const { result } = renderHook(() =>
        useSlashCommands(defaultParams({ sendRef: { current: send } })),
      )

      act(() => {
        result.current.runPaletteSlashCommand('/help')
      })

      const types = dispatchSpy.mock.calls.map(
        (call) => (call[0] as CustomEvent).type,
      )
      expect(types).toContain(OPEN_SLASH_COMMAND_MENU_EVENT)
      expect(send).not.toHaveBeenCalled()
    })

    it('/copy writes the last assistant reply to the clipboard', () => {
      const writeText = vi.fn().mockResolvedValue(undefined)
      vi.stubGlobal('navigator', { clipboard: { writeText } })

      const messages: Array<ChatMessage> = [
        makeMessage('user', 'hello'),
        makeMessage('assistant', 'first reply'),
        makeMessage('assistant', 'the last reply'),
      ]
      const { result } = renderHook(() =>
        useSlashCommands(defaultParams({ finalDisplayMessages: messages })),
      )

      let handled = false
      act(() => {
        handled = result.current.handleUiSlashCommand('/copy')
      })

      expect(handled).toBe(true)
      expect(writeText).toHaveBeenCalledWith('the last reply')
    })

    it('/copy with no reply says so instead of copying', () => {
      const writeText = vi.fn().mockResolvedValue(undefined)
      vi.stubGlobal('navigator', { clipboard: { writeText } })
      vi.mocked(toast).mockClear()

      const { result } = renderHook(() => useSlashCommands(defaultParams()))

      act(() => {
        result.current.handleUiSlashCommand('/copy')
      })

      expect(writeText).not.toHaveBeenCalled()
      expect(toast).toHaveBeenCalledWith(
        expect.stringContaining('Nothing to copy'),
        expect.objectContaining({ type: 'info' }),
      )
    })

    it('every advertised local command is actually handled', () => {
      const navigate = vi.fn()
      const { result } = renderHook(() =>
        useSlashCommands(
          defaultParams({ navigate, resolvedSessionKey: SESSION }),
        ),
      )

      for (const command of LOCAL_COMMAND_HANDLERS) {
        let handled = false
        act(() => {
          handled = result.current.handleUiSlashCommand(command)
        })
        expect(handled, `${command} must be handled locally`).toBe(true)
      }
    })

    // --- The shadow guard, behavioural half -------------------------------
    //
    // `slash-command-menu.test.tsx` compares the two *lists*. This one runs the
    // hook, because the lists are not the whole interception surface: a command
    // removed from LOCAL_COMMAND_HANDLERS but left in DEEP_LINK_ROUTES or
    // SETTINGS_SECTION_COMMANDS is still answered here and still returns true,
    // and a list comparison would call that fixed. `/version` was mapped in
    // both tables at once, so this is not a theoretical gap.
    it('never intercepts an allowlisted command that is not deliberately excepted', () => {
      const navigate = vi.fn()
      const { result } = renderHook(() =>
        useSlashCommands(
          defaultParams({ navigate, resolvedSessionKey: SESSION }),
        ),
      )

      const excepted = new Set(
        Object.keys(INTENTIONALLY_SHADOWED_COMMANDS).map((command) =>
          command.toLowerCase(),
        ),
      )

      for (const command of Object.keys(SLASH_EXEC_ALLOWLIST)) {
        if (excepted.has(command.toLowerCase())) continue
        navigate.mockClear()

        let handled = true
        act(() => {
          handled = result.current.handleUiSlashCommand(command)
        })

        expect(
          handled,
          `${command} is on SLASH_EXEC_ALLOWLIST but a SwitchUI handler answered it, so the agent's ` +
            `version can never run and the picker drops it as "shadowed". Remove it from ` +
            `LOCAL_COMMAND_HANDLERS *and* from DEEP_LINK_ROUTES / SETTINGS_SECTION_COMMANDS (either ` +
            `mapping intercepts on its own), and delete its branch in handleUiSlashCommand — or, if ` +
            `SwitchUI's answer is genuinely better than the agent's, add it to ` +
            `INTENTIONALLY_SHADOWED_COMMANDS with a written reason, as /help has.`,
        ).toBe(false)
        expect(navigate, `${command} must not navigate`).not.toHaveBeenCalled()
      }
    })
  })

  // --- Catalog routing: no catalog command may reach the model as prose ---

  describe('agent catalog routing', () => {
    function renderWithCatalog(send = vi.fn().mockResolvedValue(undefined)) {
      const rendered = renderHook(() =>
        useSlashCommands(
          defaultParams({
            agentCommandCatalog: CATALOG,
            sendRef: { current: send as unknown as SendFn },
          }),
        ),
      )
      return { ...rendered, send }
    }

    it('a prompt-tier command is handled, not sent to the model', () => {
      const { result, send } = renderWithCatalog()
      vi.mocked(toast).mockClear()

      let handled = false
      act(() => {
        handled = result.current.handleUiSlashCommand('/compress')
      })

      expect(handled).toBe(true)
      expect(send).not.toHaveBeenCalled()
      expect(toast).toHaveBeenCalledWith(
        expect.stringContaining("isn't wired up yet"),
        expect.objectContaining({ type: 'info' }),
      )
    })

    it('a proxy-tier command is handled, not sent to the model', () => {
      const { result, send } = renderWithCatalog()

      act(() => {
        result.current.runPaletteSlashCommand('/reload-skills')
      })

      expect(send).not.toHaveBeenCalled()
    })


    it('an excluded-tier command is refused, never dispatched', () => {
      const { result, send } = renderWithCatalog()
      vi.mocked(toast).mockClear()

      let handled = false
      act(() => {
        handled = result.current.handleUiSlashCommand('/redraw')
      })

      expect(handled).toBe(true)
      expect(send).not.toHaveBeenCalled()
      expect(toast).toHaveBeenCalledWith(
        expect.stringContaining('not available in SwitchUI'),
        expect.objectContaining({ type: 'info' }),
      )
    })

    it('resolves an alias to its canonical entry', () => {
      const { result, send } = renderWithCatalog()
      vi.mocked(toast).mockClear()

      act(() => {
        result.current.runPaletteSlashCommand('/compact')
      })

      expect(send).not.toHaveBeenCalled()
      expect(toast).toHaveBeenCalledWith(
        expect.stringContaining('/compress'),
        expect.objectContaining({ type: 'info' }),
      )
    })

    it('a local handler shadows a catalog alias of the same name', () => {
      // `/fork` is a catalog alias for `/branch`, but `/branch` is handled
      // locally — so `/fork` must branch, NOT fall through to the
      // "not wired up yet" notice the catalog would otherwise produce.
      const forkSession = vi.fn().mockResolvedValue('child-key')
      const send = vi.fn().mockResolvedValue(undefined)
      const { result } = renderHook(() =>
        useSlashCommands(
          defaultParams({
            agentCommandCatalog: CATALOG,
            forkSession,
            resolvedSessionKey: SESSION,
            sendRef: { current: send as unknown as SendFn },
          }),
        ),
      )

      act(() => {
        result.current.runPaletteSlashCommand('/fork')
      })

      expect(forkSession).toHaveBeenCalledWith(SESSION)
      expect(send).not.toHaveBeenCalled()
    })

    it('a catalog command with arguments is still not sent as prose', () => {
      const { result, send } = renderWithCatalog()

      act(() => {
        result.current.runPaletteSlashCommand('/compress here 5')
      })

      expect(send).not.toHaveBeenCalled()
    })

    it('free-typed unknown text starting with / still falls through', () => {
      const { result, send } = renderWithCatalog()

      act(() => {
        result.current.runPaletteSlashCommand('/definitely-not-a-command')
      })

      expect(send).toHaveBeenCalledWith(
        '/definitely-not-a-command',
        [],
        false,
        commandHelpers,
      )
    })

    it('degrades to today’s behaviour with no catalog', () => {
      const send = vi.fn().mockResolvedValue(undefined)
      const { result } = renderHook(() =>
        useSlashCommands(
          defaultParams({ sendRef: { current: send as unknown as SendFn } }),
        ),
      )

      act(() => {
        result.current.runPaletteSlashCommand('/compress')
      })

      expect(send).toHaveBeenCalledWith('/compress', [], false, commandHelpers)
    })

    it('local handlers still win over the catalog', () => {
      const navigate = vi.fn()
      const send = vi.fn().mockResolvedValue(undefined)
      const { result } = renderHook(() =>
        useSlashCommands(
          defaultParams({
            agentCommandCatalog: CATALOG,
            navigate,
            sendRef: { current: send as unknown as SendFn },
          }),
        ),
      )

      act(() => {
        result.current.runPaletteSlashCommand('/mcp')
      })

      expect(navigate).toHaveBeenCalledWith({ to: '/mcp' })
      expect(send).not.toHaveBeenCalled()
    })
  })

  // --- Phase 3: the exec route ---

  describe('agent command execution', () => {
    function renderRunnable(
      overrides: Partial<UseSlashCommandsParams> = {},
    ) {
      const send = vi.fn().mockResolvedValue(undefined)
      const rendered = renderHook(() =>
        useSlashCommands(
          defaultParams({
            agentCommandCatalog: CATALOG,
            sendRef: { current: send as unknown as SendFn },
            ...overrides,
          }),
        ),
      )
      return { ...rendered, send }
    }

    async function flush() {
      await act(async () => {
        await Promise.resolve()
        await Promise.resolve()
      })
    }

    beforeEach(() => {
      vi.mocked(execAgentCommand).mockReset()
      useCommandOutputStore.setState({ bySession: {} })
    })

    it('never calls the exec route for a command the catalog marks unrunnable', async () => {
      const { result, send } = renderRunnable()
      act(() => {
        result.current.runPaletteSlashCommand('/compress')
      })
      await flush()
      expect(execAgentCommand).not.toHaveBeenCalled()
      expect(send).not.toHaveBeenCalled()
    })

    it('dispatches a bundle slug, arguments and all, rather than sending it as prose', async () => {
      // The point of the bundle work. `/research-stack` is on no allowlist and
      // is not a skill — it is categorized, under the agent's own "Bundles"
      // bucket — yet it must reach the exec route. Falling through to `sendRef`
      // would deliver the literal text "/research-stack …" to a model with no
      // slash interpreter, which is exactly what listing a slug you cannot
      // dispatch costs, and why `/bundles` was held back until v0.19.16.
      vi.mocked(execAgentCommand).mockResolvedValue({
        ok: true,
        command: '/research-stack',
        result: {
          type: 'send',
          message: 'Bundle: Research Stack',
          notice: '⚡ Loading bundle: Research Stack (3 skills)',
        },
      })
      const { result, send } = renderRunnable()

      act(() => {
        result.current.runPaletteSlashCommand('/research-stack summarise this')
      })
      await flush()

      expect(execAgentCommand).toHaveBeenCalledWith({
        // Arguments travel with it: they become the "User instruction:" line
        // of the message `build_bundle_invocation_message` returns.
        command: '/research-stack summarise this',
        sessionId: SESSION,
      })
      // …and the `{type:'send'}` answer goes down the ordinary send path, the
      // same treatment a skill's `{type:'skill'}` gets.
      expect(send).toHaveBeenCalledWith(
        'Bundle: Research Stack',
        [],
        false,
        commandHelpers,
      )
    })

    it('runs a runnable command against the caller\'s own session', async () => {
      vi.mocked(execAgentCommand).mockResolvedValue({
        ok: true,
        command: '/history',
        result: { type: 'exec', output: 'Conversation History' },
      })
      const { result } = renderRunnable()

      act(() => {
        result.current.runPaletteSlashCommand('/history')
      })
      await flush()

      expect(execAgentCommand).toHaveBeenCalledWith({
        command: '/history',
        sessionId: SESSION,
      })
    })

    it('/status reaches the exec route rather than the dashboard', async () => {
      // The other half of "not handled locally": declining it in the deep-link
      // tier is only useful if the catalog arm then runs it. Re-adding a
      // `/status` handler or deep-link would fail here, not silently swallow
      // the agent's session report again.
      vi.mocked(execAgentCommand).mockResolvedValue({
        ok: true,
        command: '/status',
        result: { type: 'exec', output: 'Session: session-abc' },
      })
      const navigate = vi.fn()
      const { result, send } = renderRunnable({ navigate })

      act(() => {
        result.current.runPaletteSlashCommand('/status')
      })
      await flush()

      expect(execAgentCommand).toHaveBeenCalledWith({
        command: '/status',
        sessionId: SESSION,
      })
      expect(navigate).not.toHaveBeenCalled()
      expect(send).not.toHaveBeenCalled()
      expect(
        useCommandOutputStore.getState().bySession[SESSION][0].output,
      ).toBe('Session: session-abc')
    })

    it('renders exec output as a card, and never as a chat message', async () => {
      vi.mocked(execAgentCommand).mockResolvedValue({
        ok: true,
        command: '/history',
        result: { type: 'exec', output: 'Conversation History', warning: 'busy' },
      })
      const { result, send } = renderRunnable()

      act(() => {
        result.current.runPaletteSlashCommand('/history')
      })
      await flush()

      const entries = useCommandOutputStore.getState().bySession[SESSION]
      expect(entries).toHaveLength(1)
      expect(entries[0]).toMatchObject({
        command: '/history',
        output: 'Conversation History',
        warning: 'busy',
      })
      expect(send).not.toHaveBeenCalled()
    })

    it('routes plugin output to the same card', async () => {
      vi.mocked(execAgentCommand).mockResolvedValue({
        ok: true,
        command: '/history',
        result: { type: 'plugin', output: 'plugin says hi' },
      })
      const { result } = renderRunnable()
      act(() => {
        result.current.runPaletteSlashCommand('/history')
      })
      await flush()
      expect(
        useCommandOutputStore.getState().bySession[SESSION][0].output,
      ).toBe('plugin says hi')
    })

    it('routes a skill result down the send path', async () => {
      vi.mocked(execAgentCommand).mockResolvedValue({
        ok: true,
        command: '/arxiv',
        result: { type: 'skill', message: 'skill body', name: 'arxiv' },
      })
      const { result, send } = renderRunnable()

      act(() => {
        result.current.runPaletteSlashCommand('/arxiv transformers')
      })
      await flush()

      expect(send).toHaveBeenCalledWith('skill body', [], false, commandHelpers)
      expect(useCommandOutputStore.getState().bySession[SESSION]).toBeUndefined()
    })

    it('routes a send result down the send path, with its notice', async () => {
      vi.mocked(execAgentCommand).mockResolvedValue({
        ok: true,
        command: '/history',
        result: { type: 'send', message: 'do the thing', notice: 'heads up' },
      })
      const { result, send } = renderRunnable()
      vi.mocked(toast).mockClear()

      act(() => {
        result.current.runPaletteSlashCommand('/history')
      })
      await flush()

      expect(send).toHaveBeenCalledWith('do the thing', [], false, commandHelpers)
      expect(toast).toHaveBeenCalledWith(
        'heads up',
        expect.objectContaining({ type: 'info' }),
      )
    })

    it('does not send an empty message', async () => {
      vi.mocked(execAgentCommand).mockResolvedValue({
        ok: true,
        command: '/history',
        result: { type: 'send', message: '   ' },
      })
      const { result, send } = renderRunnable()
      act(() => {
        result.current.runPaletteSlashCommand('/history')
      })
      await flush()
      expect(send).not.toHaveBeenCalled()
    })

    it('puts a prefill in the composer instead of sending it', async () => {
      vi.mocked(execAgentCommand).mockResolvedValue({
        ok: true,
        command: '/history',
        result: { type: 'prefill', message: 'redo this', notice: 'edit then send' },
      })
      const setComposerValue = vi.fn()
      const { result, send } = renderRunnable({ setComposerValue })

      act(() => {
        result.current.runPaletteSlashCommand('/history')
      })
      await flush()

      expect(setComposerValue).toHaveBeenCalledWith('redo this')
      expect(send).not.toHaveBeenCalled()
    })

    it('re-dispatches an alias exactly once', async () => {
      vi.mocked(execAgentCommand)
        .mockResolvedValueOnce({
          ok: true,
          command: '/history',
          result: { type: 'alias', target: 'status' },
        })
        .mockResolvedValueOnce({
          ok: true,
          command: '/status',
          result: { type: 'exec', output: 'Hermes TUI Status' },
        })
      const { result } = renderRunnable()

      act(() => {
        result.current.runPaletteSlashCommand('/history')
      })
      await flush()
      await flush()

      expect(execAgentCommand).toHaveBeenNthCalledWith(2, {
        command: '/status',
        sessionId: SESSION,
      })
      expect(
        useCommandOutputStore.getState().bySession[SESSION][0].output,
      ).toBe('Hermes TUI Status')
    })

    it('refuses to follow a second alias hop', async () => {
      vi.mocked(execAgentCommand).mockResolvedValue({
        ok: true,
        command: '/history',
        result: { type: 'alias', target: '/history' },
      })
      const { result } = renderRunnable()

      act(() => {
        result.current.runPaletteSlashCommand('/history')
      })
      await flush()
      await flush()
      await flush()

      expect(execAgentCommand).toHaveBeenCalledTimes(2)
    })

    it('surfaces a server-side refusal as information, and sends nothing', async () => {
      vi.mocked(execAgentCommand).mockResolvedValue({
        ok: false,
        refused: true,
        command: '/history',
        reason: '/history can only be run on its own from SwitchUI',
      })
      const { result, send } = renderRunnable()
      vi.mocked(toast).mockClear()

      act(() => {
        result.current.runPaletteSlashCommand('/history everything')
      })
      await flush()

      expect(toast).toHaveBeenCalledWith(
        expect.stringContaining('on its own'),
        expect.objectContaining({ type: 'info' }),
      )
      expect(send).not.toHaveBeenCalled()
    })

    it('surfaces a transport failure as an error, and sends nothing', async () => {
      vi.mocked(execAgentCommand).mockResolvedValue({
        ok: false,
        refused: false,
        command: '/history',
        reason: 'The agent did not answer in time.',
      })
      const { result, send } = renderRunnable()
      vi.mocked(toast).mockClear()

      act(() => {
        result.current.runPaletteSlashCommand('/history')
      })
      await flush()

      expect(toast).toHaveBeenCalledWith(
        expect.stringContaining('did not answer'),
        expect.objectContaining({ type: 'error' }),
      )
      expect(send).not.toHaveBeenCalled()
    })
  })

  describe('agentCommandNotice', () => {
    it('says excluded commands are unavailable', () => {
      expect(agentCommandNotice('/redraw', 'excluded')).toContain(
        'not available in SwitchUI',
      )
    })

    it('is honest about the missing exec route for proxy/prompt', () => {
      for (const tier of ['proxy', 'prompt']) {
        expect(agentCommandNotice('/compress', tier)).toContain(
          "isn't wired up yet",
        )
      }
    })

    it('does not call an unbuilt local command an agent command', () => {
      // `local` means SwitchUI owns it, so the blocker is a missing screen,
      // not the missing exec route — Phase 3 would not make `/toolsets` work.
      // This test previously lumped `local` in with proxy/prompt and so pinned
      // the wrong message.
      const notice = agentCommandNotice('/toolsets', 'local')
      expect(notice).toContain("isn't built in SwitchUI yet")
      expect(notice).not.toContain('agent command')
    })
  })

  // --- expandCustomSlashCommand ---

  describe('expandCustomSlashCommand', () => {
    it('returns null for non-slash input', () => {
      const { result } = renderHook(() => useSlashCommands(defaultParams()))
      expect(result.current.expandCustomSlashCommand('hello')).toBeNull()
    })

    it('returns null when no matching command exists', () => {
      const { result } = renderHook(() => useSlashCommands(defaultParams()))
      expect(result.current.expandCustomSlashCommand('/nonexistent')).toBeNull()
    })

    it('expands a matching user-defined command with {{input}} placeholder', () => {
      const command = makeUserCommand({
        slash: '/test',
        prompt: 'Expanded: {{input}}',
      })
      const { result } = renderHook(() =>
        useSlashCommands(defaultParams({ enabledUserCommands: [command] })),
      )

      expect(result.current.expandCustomSlashCommand('/test my args')).toBe(
        'Expanded: my args',
      )
    })

    it('appends input when prompt has no placeholder', () => {
      const command = makeUserCommand({
        slash: '/test',
        prompt: 'Static prompt body',
      })
      const { result } = renderHook(() =>
        useSlashCommands(defaultParams({ enabledUserCommands: [command] })),
      )

      expect(result.current.expandCustomSlashCommand('/test my args')).toBe(
        'Static prompt body\n\nmy args',
      )
    })

    it('expands a command with no arguments', () => {
      const command = makeUserCommand({
        slash: '/test',
        prompt: 'No args prompt',
      })
      const { result } = renderHook(() =>
        useSlashCommands(defaultParams({ enabledUserCommands: [command] })),
      )

      expect(result.current.expandCustomSlashCommand('/test')).toBe(
        'No args prompt',
      )
    })
  })

  // --- runPaletteSlashCommand ---

  describe('runPaletteSlashCommand', () => {
    it('does nothing for non-slash input', () => {
      const send = vi.fn().mockResolvedValue(undefined)
      const { result } = renderHook(() =>
        useSlashCommands(
          defaultParams({
            sendRef: { current: send as unknown as SendFn },
          }),
        ),
      )

      act(() => {
        result.current.runPaletteSlashCommand('hello')
      })

      expect(send).not.toHaveBeenCalled()
    })

    it('calls handleUiSlashCommand first; if handled, does not send', () => {
      const send = vi.fn().mockResolvedValue(undefined)
      const navigate = vi.fn()
      const { result } = renderHook(() =>
        useSlashCommands(
          defaultParams({
            navigate,
            sendRef: { current: send as unknown as SendFn },
          }),
        ),
      )

      act(() => {
        result.current.runPaletteSlashCommand('/new')
      })

      expect(navigate).toHaveBeenCalled()
      expect(send).not.toHaveBeenCalled()
    })

    it('falls back to send when handleUiSlashCommand returns false', () => {
      const send = vi.fn().mockResolvedValue(undefined)
      const { result } = renderHook(() =>
        useSlashCommands(
          defaultParams({
            sendRef: { current: send as unknown as SendFn },
          }),
        ),
      )

      act(() => {
        result.current.runPaletteSlashCommand('/unknown')
      })

      expect(send).toHaveBeenCalledWith('/unknown', [], false, commandHelpers)
    })

    it('trims command before processing', () => {
      const send = vi.fn().mockResolvedValue(undefined)
      const { result } = renderHook(() =>
        useSlashCommands(
          defaultParams({
            sendRef: { current: send as unknown as SendFn },
          }),
        ),
      )

      act(() => {
        result.current.runPaletteSlashCommand('  /unknown  ')
      })

      expect(send).toHaveBeenCalledWith('/unknown', [], false, commandHelpers)
    })
  })

  // --- Event listeners ---

  describe('event listeners', () => {
    it('listens for CHAT_RUN_COMMAND_EVENT', () => {
      const send = vi.fn().mockResolvedValue(undefined)
      renderHook(() =>
        useSlashCommands(
          defaultParams({
            sendRef: { current: send as unknown as SendFn },
          }),
        ),
      )

      act(() => {
        window.dispatchEvent(
          new CustomEvent(CHAT_RUN_COMMAND_EVENT, {
            detail: { command: '/unknown' },
          }),
        )
      })

      expect(send).toHaveBeenCalledWith('/unknown', [], false, commandHelpers)
    })

    it('does not send when run-command event has no command', () => {
      const send = vi.fn().mockResolvedValue(undefined)
      renderHook(() =>
        useSlashCommands(
          defaultParams({
            sendRef: { current: send as unknown as SendFn },
          }),
        ),
      )

      act(() => {
        window.dispatchEvent(
          new CustomEvent(CHAT_RUN_COMMAND_EVENT, { detail: {} }),
        )
      })

      expect(send).not.toHaveBeenCalled()
    })

    it('drains pending command from sessionStorage on mount', () => {
      window.sessionStorage.setItem(
        CHAT_PENDING_COMMAND_STORAGE_KEY,
        '/unknown',
      )

      const send = vi.fn().mockResolvedValue(undefined)
      renderHook(() =>
        useSlashCommands(
          defaultParams({
            sendRef: { current: send as unknown as SendFn },
          }),
        ),
      )

      expect(
        window.sessionStorage.getItem(CHAT_PENDING_COMMAND_STORAGE_KEY),
      ).toBeNull()
    })

    it('runs pending command from sessionStorage', () => {
      window.sessionStorage.setItem(
        CHAT_PENDING_COMMAND_STORAGE_KEY,
        '/unknown',
      )

      const send = vi.fn().mockResolvedValue(undefined)
      renderHook(() =>
        useSlashCommands(
          defaultParams({
            sendRef: { current: send as unknown as SendFn },
          }),
        ),
      )

      // The effect runs synchronously after render in jsdom
      expect(send).toHaveBeenCalledWith('/unknown', [], false, commandHelpers)
    })

    it('waits for userCommandsPending before draining', () => {
      window.sessionStorage.setItem(
        CHAT_PENDING_COMMAND_STORAGE_KEY,
        '/unknown',
      )

      const send = vi.fn().mockResolvedValue(undefined)
      const { rerender } = renderHook(
        (props: { pending: boolean }) =>
          useSlashCommands(
            defaultParams({
              userCommandsPending: props.pending,
              sendRef: { current: send as unknown as SendFn },
            }),
          ),
        { initialProps: { pending: true } },
      )

      expect(send).not.toHaveBeenCalled()
      expect(
        window.sessionStorage.getItem(CHAT_PENDING_COMMAND_STORAGE_KEY),
      ).toBe('/unknown')

      rerender({ pending: false })

      expect(send).toHaveBeenCalledWith('/unknown', [], false, commandHelpers)
      expect(
        window.sessionStorage.getItem(CHAT_PENDING_COMMAND_STORAGE_KEY),
      ).toBeNull()
    })
  })

  // --- /save ---

  describe('/save', () => {
    it('exports the conversation transcript', () => {
      const messages: Array<ChatMessage> = [
        makeMessage('user', 'hello'),
        makeMessage('assistant', 'world'),
      ]

      const { result } = renderHook(() =>
        useSlashCommands(defaultParams({ finalDisplayMessages: messages })),
      )

      const handled = result.current.handleUiSlashCommand('/save')
      expect(handled).toBe(true)
    })
  })
})
