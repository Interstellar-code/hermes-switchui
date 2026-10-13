// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  branchSelectionToNewSession,
  composeBranchSelectionMessage,
} from './branch-selection-send'
import { readPendingMessage, resetPendingSend } from './pending-send'
import { useSessionModelStore } from '@/stores/session-model-store'

/**
 * Selection-mode branch (plan `branch-selection` P1.3). Only the network
 * edge (fetch) and the router navigate are mocked; everything else —
 * composer, pending-send stash, the per-session model store — is the real
 * production code the chat screen runs.
 */

// The YouTube-catalog-shaped anchor message the user branches FROM.
const CATALOG_MESSAGE_TEXT = [
  '# YouTube catalog tools',
  '',
  '- yt-dlp — download a single video or the whole channel',
  '- gallery-dl — image sets from a channel page',
  '- ffmpeg — normalize audio and cut intro silence',
  '',
  '[Catalog notes](https://example.com/catalog-notes)',
].join('\n')

// POST /api/sessions success shape, captured from the route handler
// (src/routes/api/sessions.ts, POST → createSession): ok, sessionKey,
// friendlyId, entry, modelApplied.
const CREATE_SESSION_RESPONSE = {
  ok: true,
  sessionKey: 'sess-branch-1',
  friendlyId: 'chat-branch-1',
  entry: {
    key: 'sess-branch-1',
    id: 'sess-branch-1',
    title: 'sess-branch-1',
    message_count: 0,
  },
  modelApplied: true,
}

// Mirrors the production create call in chat-screen.tsx createSessionForMessage.
async function createSessionViaApi(): Promise<{
  sessionKey: string
  friendlyId: string
}> {
  const res = await fetch('/api/sessions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({}),
  })
  if (!res.ok) throw new Error(`Could not create session (${res.status})`)
  const data = (await res.json()) as {
    sessionKey?: string
    friendlyId?: string
  }
  if (!data.sessionKey || !data.friendlyId) {
    throw new Error('Invalid session response')
  }
  return { sessionKey: data.sessionKey, friendlyId: data.friendlyId }
}

function okResponse(body: unknown) {
  return { ok: true, status: 200, json: () => Promise.resolve(body) }
}

function errorResponse(body: unknown, status: number) {
  return { ok: false, status, json: () => Promise.resolve(body) }
}

describe('composeBranchSelectionMessage (contract C3)', () => {
  it('prefixes every quote line with "> " and separates the prompt with a blank line', () => {
    expect(composeBranchSelectionMessage('line1\nline2', 'prompt')).toBe(
      '> line1\n> line2\n\nprompt',
    )
  })

  it('keeps a multi-line markdown selection verbatim inside the blockquote', () => {
    const composed = composeBranchSelectionMessage(CATALOG_MESSAGE_TEXT, 'go')
    expect(composed.startsWith('> # YouTube catalog tools')).toBe(true)
    expect(composed).toContain('> - yt-dlp — download a single video')
    expect(composed).toContain(
      '> [Catalog notes](https://example.com/catalog-notes)',
    )
    expect(composed.endsWith('\n\ngo')).toBe(true)
  })

  it('returns only the prompt when the context was cleared', () => {
    expect(composeBranchSelectionMessage('   ', 'just do it')).toBe(
      'just do it',
    )
  })
})

describe('branchSelectionToNewSession (selection mode)', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock)
    useSessionModelStore.setState({ models: {} })
    resetPendingSend()
    window.localStorage.clear()
    fetchMock.mockReset()
    fetchMock.mockResolvedValue(okResponse(CREATE_SESSION_RESPONSE))
  })

  afterEach(() => {
    resetPendingSend()
    useSessionModelStore.setState({ models: {} })
    window.localStorage.clear()
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('creates the session over POST /api/sessions and never fetches /fork', async () => {
    const navigate = vi.fn()
    await branchSelectionToNewSession(
      { quote: CATALOG_MESSAGE_TEXT, prompt: 'expand on yt-dlp' },
      { createSession: createSessionViaApi, navigate, toast: vi.fn() },
    )

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [unknown, RequestInit]
    expect(String(url)).toBe('/api/sessions')
    expect(init.method).toBe('POST')
    expect(
      fetchMock.mock.calls.every(
        ([callUrl]) => !String(callUrl).includes('fork'),
      ),
    ).toBe(true)
  })

  it('stashes quote+prompt for the NEW session key, seeds the model before navigate, and jumps to the friendlyId', async () => {
    let modelAtNavigate: string | undefined = '__not_read__'
    const navigate = vi.fn(() => {
      modelAtNavigate = useSessionModelStore
        .getState()
        .getModel('sess-branch-1')
    })
    const toast = vi.fn()
    const renameSession = vi.fn().mockResolvedValue(undefined)

    await branchSelectionToNewSession(
      {
        quote: 'line1\nline2',
        prompt: 'prompt',
        title: 'Catalog follow-up',
        model: 'anthropic/claude-opus-4',
      },
      { createSession: createSessionViaApi, navigate, renameSession, toast },
    )

    // First user message of the new session: blockquote + blank line + prompt.
    const pending = readPendingMessage('sess-branch-1', 'chat-branch-1')
    expect(pending).not.toBeNull()
    expect(pending!.message).toBe('> line1\n> line2\n\nprompt')
    expect(pending!.attachments).toEqual([])
    expect(pending!.optimisticMessage.role).toBe('user')
    expect(pending!.optimisticMessage.content?.[0]).toMatchObject({
      type: 'text',
      text: '> line1\n> line2\n\nprompt',
    })

    // Navigate targets the new session's friendlyId (no replace — Back
    // returns to the source), and the model was already seeded for the new
    // session key when it fired.
    expect(navigate).toHaveBeenCalledTimes(1)
    expect(navigate).toHaveBeenCalledWith({
      to: '/chat/$sessionKey',
      params: { sessionKey: 'chat-branch-1' },
    })
    expect(modelAtNavigate).toBe('anthropic/claude-opus-4')

    // Best-effort rename after the jump, then the success toast.
    expect(renameSession).toHaveBeenCalledWith(
      'sess-branch-1',
      'chat-branch-1',
      'Catalog follow-up',
    )
    expect(toast).toHaveBeenCalledWith('Branched selection to new session', {
      type: 'success',
    })
  })

  it('leaves the title alone and skips the model seed when neither is given', async () => {
    const navigate = vi.fn()
    const toast = vi.fn()
    const renameSession = vi.fn().mockResolvedValue(undefined)

    await branchSelectionToNewSession(
      { quote: 'line1', prompt: 'go' },
      { createSession: createSessionViaApi, navigate, renameSession, toast },
    )

    expect(renameSession).not.toHaveBeenCalled()
    expect(
      useSessionModelStore.getState().getModel('sess-branch-1'),
    ).toBeUndefined()
    expect(toast).toHaveBeenCalledWith('Branched selection to new session', {
      type: 'success',
    })
  })

  it('toasts the error and hands the typed values back when the create fails', async () => {
    fetchMock.mockResolvedValue(
      errorResponse({ ok: false, error: 'profile scope refused' }, 409),
    )
    const navigate = vi.fn()
    const toast = vi.fn()
    const onSessionCreateFailed = vi.fn()

    await branchSelectionToNewSession(
      {
        quote: 'line1\nline2',
        prompt: 'prompt',
        title: 'Catalog follow-up',
        model: 'anthropic/claude-opus-4',
      },
      {
        createSession: createSessionViaApi,
        navigate,
        toast,
        onSessionCreateFailed,
      },
    )

    expect(toast).toHaveBeenCalledWith('Could not create session (409)', {
      type: 'error',
    })
    expect(onSessionCreateFailed).toHaveBeenCalledWith({
      quote: 'line1\nline2',
      prompt: 'prompt',
      title: 'Catalog follow-up',
      model: 'anthropic/claude-opus-4',
    })
    expect(navigate).not.toHaveBeenCalled()
    expect(readPendingMessage('sess-branch-1', 'chat-branch-1')).toBeNull()
  })
})
