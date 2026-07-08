// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { appendHistoryMessage } from '../chat-queries'
import { createOptimisticMessage } from '../chat-screen-utils'
import { resolveNewChatBootstrapSession } from '../new-chat-bootstrap'
import { hasPendingGeneration, setPendingGeneration } from '../pending-send'
import { useComposerSend } from './use-composer-send'
import type {
  ChatComposerAttachment,
  ChatComposerHelpers,
} from '../components/chat-composer-types'
import type { RefObject } from 'react'
import type { ChatMessage } from '../types'
import type { ActiveSendRecord } from './use-send-message-state'
import { hapticTap } from '@/lib/haptics'

// --- Mocks ---

vi.mock('../new-chat-bootstrap', () => ({
  resolveNewChatBootstrapSession: vi.fn(() => ({
    sessionKey: 'thread-1',
    friendlyId: 'friendly-1',
  })),
}))

vi.mock('../chat-screen-utils', () => ({
  createOptimisticMessage: vi.fn(() => ({
    clientId: 'client-test-1',
    optimisticId: 'opt-1',
    optimisticMessage: {
      role: 'user',
      content: [{ type: 'text', text: 'hello' }],
      clientId: 'client-test-1',
      status: 'sending',
    },
  })),
}))

vi.mock('../chat-queries', () => ({
  appendHistoryMessage: vi.fn(),
}))

vi.mock('../pending-send', () => ({
  hasPendingGeneration: vi.fn(() => false),
  setPendingGeneration: vi.fn(),
}))

const enqueueMock = vi.fn()
const isSessionWaitingMock = vi.fn(() => false)
vi.mock('@/stores/chat-store', () => ({
  useChatStore: {
    getState: () => ({
      enqueue: enqueueMock,
      isSessionWaiting: isSessionWaitingMock,
    }),
  },
}))

vi.mock('@/lib/haptics', () => ({
  hapticTap: vi.fn(),
}))

// --- Helpers ---

function makeRef<T>(initial: T): RefObject<T> {
  return { current: initial }
}

function makeHelpers(): ChatComposerHelpers {
  return { reset: vi.fn(), setValue: vi.fn(), setAttachments: vi.fn() }
}

function makeAttachment(
  overrides: Partial<ChatComposerAttachment> = {},
): ChatComposerAttachment {
  return {
    id: 'att-1',
    name: 'file.txt',
    contentType: 'text/plain',
    size: 100,
    ...overrides,
  }
}

type PartialParams = Parameters<typeof useComposerSend>[0]

function makeParams(overrides: Partial<PartialParams> = {}): PartialParams {
  return {
    activeFriendlyId: 'friendly-active',
    activeSessionKey: 'session-active',
    activeCanonicalKey: 'canonical-active',
    activeQueueSessionKey: '',
    forcedSessionKey: undefined,
    resolvedSessionKey: 'resolved-active',
    isNewChat: false,
    isPortableMode: false,
    embedded: false,
    queryClient: { setQueryData: vi.fn() } as any,
    lastSendKeyRef: makeRef(''),
    lastSendAtRef: makeRef(0),
    lastQueueSessionKeyRef: makeRef(''),
    activeSendRef: makeRef<ActiveSendRecord | null>(null),
    isComposerLoadingRef: makeRef(false),
    sendMessage: vi.fn(),
    handleUiSlashCommand: vi.fn(() => false),
    expandCustomSlashCommand: vi.fn(() => null),
    scrollChatToBottom: vi.fn(),
    createSessionForMessage: vi.fn(() => ({
      sessionKey: 'session-new',
      friendlyId: 'friendly-new',
    })),
    upsertSessionInCache: vi.fn(),
    navigate: vi.fn(),
    setSending: vi.fn(),
    setWaitingForResponse: vi.fn(),
    isMobile: false,
    ...overrides,
  }
}

// --- Tests ---

describe('useComposerSend', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns early on empty body and no attachments', async () => {
    const params = makeParams()
    const { result } = renderHook(() => useComposerSend(params))
    const helpers = makeHelpers()

    await act(async () => {
      await result.current.send('   ', [], false, helpers)
    })

    expect(params.sendMessage).not.toHaveBeenCalled()
    expect(helpers.reset).not.toHaveBeenCalled()
  })

  it('calls handleUiSlashCommand for slash commands and returns early', async () => {
    const params = makeParams({
      handleUiSlashCommand: vi.fn(() => true),
    })
    const { result } = renderHook(() => useComposerSend(params))
    const helpers = makeHelpers()

    await act(async () => {
      await result.current.send('/clear', [], false, helpers)
    })

    expect(params.handleUiSlashCommand).toHaveBeenCalledWith('/clear')
    expect(params.sendMessage).not.toHaveBeenCalled()
  })

  it('dedup guard blocks identical send within 500ms', async () => {
    const params = makeParams()
    const { result } = renderHook(() => useComposerSend(params))
    const helpers = makeHelpers()

    // First send succeeds
    await act(async () => {
      await result.current.send('hello', [], false, helpers)
    })
    expect(params.sendMessage).toHaveBeenCalledTimes(1)

    // Immediate second send with same content should be blocked
    await act(async () => {
      await result.current.send('hello', [], false, helpers)
    })
    expect(params.sendMessage).toHaveBeenCalledTimes(1)

    // After 500ms the dedup window expires
    vi.advanceTimersByTime(501)
    await act(async () => {
      await result.current.send('hello', [], false, helpers)
    })
    expect(params.sendMessage).toHaveBeenCalledTimes(2)
  })

  it('queue routing enqueues when composer is busy', async () => {
    const params = makeParams({
      activeQueueSessionKey: 'session-queue',
      isComposerLoadingRef: makeRef(true),
    })
    const { result } = renderHook(() => useComposerSend(params))
    const helpers = makeHelpers()

    await act(async () => {
      await result.current.send('hello', [], false, helpers)
    })

    expect(enqueueMock).toHaveBeenCalledWith(
      'session-queue',
      expect.objectContaining({
        text: 'hello',
      }),
    )
    expect(params.sendMessage).not.toHaveBeenCalled()
    expect(helpers.reset).toHaveBeenCalledTimes(1)
  })

  it('sends directly when composer is free (existing session)', async () => {
    const params = makeParams({
      isComposerLoadingRef: makeRef(false),
    })
    const { result } = renderHook(() => useComposerSend(params))
    const helpers = makeHelpers()

    await act(async () => {
      await result.current.send('hello world', [], true, helpers)
    })

    expect(enqueueMock).not.toHaveBeenCalled()
    expect(params.sendMessage).toHaveBeenCalledWith(
      params.resolvedSessionKey,
      params.activeFriendlyId,
      'hello world',
      [],
      true,
    )
  })

  it('new-chat bootstrap resolves session, creates optimistic message, and navigates', async () => {
    const params = makeParams({
      isNewChat: true,
    })
    const { result } = renderHook(() => useComposerSend(params))
    const helpers = makeHelpers()

    await act(async () => {
      await result.current.send('first message', [], false, helpers)
    })

    expect(resolveNewChatBootstrapSession).toHaveBeenCalledWith(
      expect.objectContaining({
        createSessionForMessage: params.createSessionForMessage,
        isPortableMode: false,
      }),
    )
    expect(createOptimisticMessage).toHaveBeenCalledWith('first message', [])
    expect(appendHistoryMessage).toHaveBeenCalledWith(
      params.queryClient,
      'friendly-1',
      'thread-1',
      expect.objectContaining({ role: 'user' }),
    )
    expect(params.upsertSessionInCache).toHaveBeenCalledWith(
      'friendly-1',
      expect.objectContaining({ role: 'user' }),
    )
    expect(setPendingGeneration).toHaveBeenCalledWith(true)
    expect(params.setSending).toHaveBeenCalledWith(true)
    expect(params.setWaitingForResponse).toHaveBeenCalledWith(true)
    expect(params.sendMessage).toHaveBeenCalledWith(
      'thread-1',
      'friendly-1',
      'first message',
      [],
      false,
      true,
      'client-test-1',
    )
    expect(params.navigate).toHaveBeenCalledWith({
      to: '/chat/$sessionKey',
      params: { sessionKey: 'friendly-1' },
      replace: true,
    })
  })

  it('new-chat bootstrap skips navigation when embedded', async () => {
    const params = makeParams({
      isNewChat: true,
      embedded: true,
    })
    const { result } = renderHook(() => useComposerSend(params))
    const helpers = makeHelpers()

    await act(async () => {
      await result.current.send('first message', [], false, helpers)
    })

    expect(params.navigate).not.toHaveBeenCalled()
  })

  it('calls hapticTap on mobile when sending directly', async () => {
    const params = makeParams({
      isMobile: true,
    })
    const { result } = renderHook(() => useComposerSend(params))
    const helpers = makeHelpers()

    await act(async () => {
      await result.current.send('hello', [], false, helpers)
    })

    expect(hapticTap).toHaveBeenCalled()
  })

  it('does not call hapticTap on desktop', async () => {
    const params = makeParams({
      isMobile: false,
    })
    const { result } = renderHook(() => useComposerSend(params))
    const helpers = makeHelpers()

    await act(async () => {
      await result.current.send('hello', [], false, helpers)
    })

    expect(hapticTap).not.toHaveBeenCalled()
  })

  it('queue routing checks session waiting state', async () => {
    isSessionWaitingMock.mockReturnValue(true)

    const params = makeParams({
      activeQueueSessionKey: 'session-waiting',
      isComposerLoadingRef: makeRef(false),
    })
    const { result } = renderHook(() => useComposerSend(params))
    const helpers = makeHelpers()

    await act(async () => {
      await result.current.send('hello', [], false, helpers)
    })

    expect(isSessionWaitingMock).toHaveBeenCalledWith('session-waiting')
    expect(enqueueMock).toHaveBeenCalled()
    expect(params.sendMessage).not.toHaveBeenCalled()

    isSessionWaitingMock.mockReturnValue(false)
  })

  it('queue routing enqueues when activeSendRef is set', async () => {
    const params = makeParams({
      activeQueueSessionKey: 'session-active',
      activeSendRef: makeRef<ActiveSendRecord | null>({
        sessionKey: 'session-active',
        friendlyId: 'friendly-active',
        clientId: 'client-1',
      }),
    })
    const { result } = renderHook(() => useComposerSend(params))
    const helpers = makeHelpers()

    await act(async () => {
      await result.current.send('hello', [], false, helpers)
    })

    expect(enqueueMock).toHaveBeenCalled()
    expect(params.sendMessage).not.toHaveBeenCalled()
  })

  it('queue routing enqueues when pending generation exists', async () => {
    vi.mocked(hasPendingGeneration).mockReturnValue(true)

    const params = makeParams({
      activeQueueSessionKey: 'session-pending',
    })
    const { result } = renderHook(() => useComposerSend(params))
    const helpers = makeHelpers()

    await act(async () => {
      await result.current.send('hello', [], false, helpers)
    })

    expect(enqueueMock).toHaveBeenCalled()
    expect(params.sendMessage).not.toHaveBeenCalled()

    vi.mocked(hasPendingGeneration).mockReturnValue(false)
  })

  it('portable mode uses main as session key for existing session', async () => {
    const params = makeParams({
      isPortableMode: true,
    })
    const { result } = renderHook(() => useComposerSend(params))
    const helpers = makeHelpers()

    await act(async () => {
      await result.current.send('hello', [], false, helpers)
    })

    expect(params.sendMessage).toHaveBeenCalledWith(
      'main',
      'main',
      'hello',
      [],
      false,
    )
  })
})
