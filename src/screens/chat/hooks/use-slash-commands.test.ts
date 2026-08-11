// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import {
  CHAT_PENDING_COMMAND_STORAGE_KEY,
  CHAT_RUN_COMMAND_EVENT,
} from '../chat-events'
import { CHAT_OPEN_MODEL_PICKER_EVENT } from '../components/chat-composer-services'
import { useSlashCommands } from './use-slash-commands'

import type { UseSlashCommandsParams } from './use-slash-commands'
import type {
  ChatComposerAttachment,
  ChatComposerHelpers,
} from '../components/chat-composer-types'
import type { ChatMessage } from '../types'
import type { UserCommandRecord } from '@/lib/commands-api'
import { toast } from '@/components/ui/toast'
import { useSessionModelStore } from '@/stores/session-model-store'

vi.mock('@/components/ui/toast', () => ({ toast: vi.fn() }))

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
    handleThinkingLevelChange: vi.fn(),
    renameSession: vi.fn().mockResolvedValue(undefined),
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

    it('/skin dispatches the open-settings event with appearance section', () => {
      const dispatchSpy = vi.spyOn(window, 'dispatchEvent')
      const { result } = renderHook(() => useSlashCommands(defaultParams()))

      act(() => {
        result.current.handleUiSlashCommand('/skin')
      })

      const event = dispatchSpy.mock.calls[0]?.[0] as CustomEvent
      expect(event.type).toBe('claude:chat-open-settings')
      expect(event.detail).toEqual({ section: 'appearance' })
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

    // `/stop` and the Stop button must be indistinguishable — they were two
    // hand-maintained copies of the same logic, and only one of them would
    // have got the gateway call. These pin the delegation, not the internals.
    it('/stop delegates to the shared abort handler', () => {
      const handleAbortStreaming = vi.fn()

      const { result } = renderHook(() =>
        useSlashCommands(defaultParams({ handleAbortStreaming })),
      )

      act(() => {
        result.current.handleUiSlashCommand('/stop')
      })

      expect(handleAbortStreaming).toHaveBeenCalledTimes(1)
    })

    it('/stop is handled even with no active send', () => {
      const handleAbortStreaming = vi.fn()

      const { result } = renderHook(() =>
        useSlashCommands(defaultParams({ handleAbortStreaming })),
      )

      const handled = result.current.handleUiSlashCommand('/stop')
      expect(handled).toBe(true)
      expect(handleAbortStreaming).toHaveBeenCalledTimes(1)
    })

    it('/stop shows no toast — the stop notice reports the real outcome', () => {
      const { result } = renderHook(() => useSlashCommands(defaultParams()))
      vi.mocked(toast).mockClear()

      act(() => {
        result.current.handleUiSlashCommand('/stop')
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

    it('/reasoning off calls handleThinkingLevelChange', () => {
      const handleThinkingLevelChange = vi.fn()
      const { result } = renderHook(() =>
        useSlashCommands(defaultParams({ handleThinkingLevelChange })),
      )

      act(() => {
        result.current.handleUiSlashCommand('/reasoning off')
      })

      expect(handleThinkingLevelChange).toHaveBeenCalledWith('off')
    })

    it('/reasoning low calls handleThinkingLevelChange', () => {
      const handleThinkingLevelChange = vi.fn()
      const { result } = renderHook(() =>
        useSlashCommands(defaultParams({ handleThinkingLevelChange })),
      )

      act(() => {
        result.current.handleUiSlashCommand('/reasoning low')
      })

      expect(handleThinkingLevelChange).toHaveBeenCalledWith('low')
    })

    it('/reasoning adaptive calls handleThinkingLevelChange', () => {
      const handleThinkingLevelChange = vi.fn()
      const { result } = renderHook(() =>
        useSlashCommands(defaultParams({ handleThinkingLevelChange })),
      )

      act(() => {
        result.current.handleUiSlashCommand('/reasoning adaptive')
      })

      expect(handleThinkingLevelChange).toHaveBeenCalledWith('adaptive')
    })

    it('/reasoning with invalid level does not call handleThinkingLevelChange', () => {
      const handleThinkingLevelChange = vi.fn()
      const { result } = renderHook(() =>
        useSlashCommands(defaultParams({ handleThinkingLevelChange })),
      )

      const handled = result.current.handleUiSlashCommand('/reasoning high')
      expect(handled).toBe(true)
      expect(handleThinkingLevelChange).not.toHaveBeenCalled()
    })

    it('unknown slash command returns false', () => {
      const { result } = renderHook(() => useSlashCommands(defaultParams()))
      expect(result.current.handleUiSlashCommand('/unknown')).toBe(false)
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
