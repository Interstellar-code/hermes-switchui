import { describe, expect, it, vi } from 'vitest'

import { resolveNewChatBootstrapSession } from './new-chat-bootstrap'

describe('resolveNewChatBootstrapSession', () => {
  it('uses main for portable mode without creating a backend session', async () => {
    const createSessionForMessage = vi.fn()

    const result = await resolveNewChatBootstrapSession({
      createSessionForMessage,
      generateThreadId: () => 'unused-id',
      isPortableMode: true,
    })

    expect(result).toEqual({ sessionKey: 'main', friendlyId: 'main' })
    expect(createSessionForMessage).not.toHaveBeenCalled()
  })

  it('creates the backend session before first non-portable send', async () => {
    const createSessionForMessage = vi
      .fn<(preferredFriendlyId?: string) => Promise<{ sessionKey: string; friendlyId: string }>>()
      .mockResolvedValue({
        sessionKey: 'sess-real',
        friendlyId: 'friendly-real',
      })

    const result = await resolveNewChatBootstrapSession({
      createSessionForMessage,
      generateThreadId: () => 'uuid-generated-client-side',
      isPortableMode: false,
    })

    expect(createSessionForMessage).toHaveBeenCalledWith(
      'uuid-generated-client-side',
    )
    expect(result).toEqual({
      sessionKey: 'sess-real',
      friendlyId: 'friendly-real',
    })
  })
})
