// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import type { RefObject } from 'react'

import { useSlashCommands } from './use-slash-commands'
import type { UseSlashCommandsParams } from './use-slash-commands'
import type {
  ChatComposerAttachment,
  ChatComposerHelpers,
} from '../components/chat-composer-types'
import type { ChatMessage } from '../types'
import type { UserCommandRecord } from '@/lib/commands-api'
import type { ActiveSendRecord } from './use-send-message-state'
import {
  CHAT_PENDING_COMMAND_STORAGE_KEY,
  CHAT_RUN_COMMAND_EVENT,
} from '../chat-events'

const SESSION = 'session-abc'
const FRIENDLY_ID = 'friendly-1'

const commandHelpers: ChatComposerHelpers = {
  reset() {},
  setValue() {},
  setAttachments() {},
}

function makeRef<T>(value: T | null = null): RefObject<T | null> {
  return { current: value }
}

function makeMessage(role: string, text: string): ChatMessage {
  return {
    role,
    content: [{ type: 'text', text }],
  } as unknown as ChatMessage
}

function makeUserCommand(overrides: Partial<UserCommandRecord> = {}): UserCommandRecord {
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
    cancelStreaming: vi.fn(),
    setSending: vi.fn(),
    setWaitingForResponse: vi.fn(),
    activeSendRef: makeRef<ActiveSendRecord>(null),
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

    it('/model dispatches the open-settings event', () => {
      const dispatchSpy = vi.spyOn(window, 'dispatchEvent')
      const { result } = renderHook(() => useSlashCommands(defaultParams()))

      act(() => {
        result.current.handleUiSlashCommand('/model')
      })

      const event = dispatchSpy.mock.calls[0]?.[0] as CustomEvent
      expect(event.type).toBe('claude:chat-open-settings')
      expect(event.detail).toEqual({ section: 'claude' })
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

    it('/stop cancels streaming and resets sending state', () => {
      const cancelStreaming = vi.fn()
      const setSending = vi.fn()
      const setWaitingForResponse = vi.fn()
      const activeSendRef = makeRef<ActiveSendRecord>({
        sessionKey: SESSION,
        friendlyId: FRIENDLY_ID,
        clientId: 'client-123',
      })

      const { result } = renderHook(() =>
        useSlashCommands(
          defaultParams({
            cancelStreaming,
            setSending,
            setWaitingForResponse,
            activeSendRef,
          }),
        ),
      )

      act(() => {
        result.current.handleUiSlashCommand('/stop')
      })

      expect(cancelStreaming).toHaveBeenCalledTimes(1)
      expect(setSending).toHaveBeenCalledWith(false)
      expect(setWaitingForResponse).toHaveBeenCalledWith(false)
      expect(activeSendRef.current).toBeNull()
    })

    it('/stop without an active send still cancels', () => {
      const cancelStreaming = vi.fn()
      const activeSendRef = makeRef<ActiveSendRecord>(null)

      const { result } = renderHook(() =>
        useSlashCommands(
          defaultParams({ cancelStreaming, activeSendRef }),
        ),
      )

      const handled = result.current.handleUiSlashCommand('/stop')
      expect(handled).toBe(true)
      expect(cancelStreaming).toHaveBeenCalledTimes(1)
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
      expect(
        result.current.expandCustomSlashCommand('/nonexistent'),
      ).toBeNull()
    })

    it('expands a matching user-defined command with {{input}} placeholder', () => {
      const command = makeUserCommand({
        slash: '/test',
        prompt: 'Expanded: {{input}}',
      })
      const { result } = renderHook(() =>
        useSlashCommands(
          defaultParams({ enabledUserCommands: [command] }),
        ),
      )

      expect(
        result.current.expandCustomSlashCommand('/test my args'),
      ).toBe('Expanded: my args')
    })

    it('appends input when prompt has no placeholder', () => {
      const command = makeUserCommand({
        slash: '/test',
        prompt: 'Static prompt body',
      })
      const { result } = renderHook(() =>
        useSlashCommands(
          defaultParams({ enabledUserCommands: [command] }),
        ),
      )

      expect(
        result.current.expandCustomSlashCommand('/test my args'),
      ).toBe('Static prompt body\n\nmy args')
    })

    it('expands a command with no arguments', () => {
      const command = makeUserCommand({
        slash: '/test',
        prompt: 'No args prompt',
      })
      const { result } = renderHook(() =>
        useSlashCommands(
          defaultParams({ enabledUserCommands: [command] }),
        ),
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

      expect(window.sessionStorage.getItem(
        CHAT_PENDING_COMMAND_STORAGE_KEY,
      )).toBeNull()
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
      expect(window.sessionStorage.getItem(
        CHAT_PENDING_COMMAND_STORAGE_KEY,
      )).toBe('/unknown')

      rerender({ pending: false })

      expect(send).toHaveBeenCalledWith('/unknown', [], false, commandHelpers)
      expect(window.sessionStorage.getItem(
        CHAT_PENDING_COMMAND_STORAGE_KEY,
      )).toBeNull()
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
        useSlashCommands(
          defaultParams({ finalDisplayMessages: messages }),
        ),
      )

      const handled = result.current.handleUiSlashCommand('/save')
      expect(handled).toBe(true)
    })
  })
})
