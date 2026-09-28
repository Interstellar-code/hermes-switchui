import { beforeEach, describe, expect, it, vi } from 'vitest'

import { compressChatSession } from './session-compress'

const rpc = vi.hoisted(() => ({ hermesRpc: vi.fn() }))
const slash = vi.hoisted(() => ({
  acquireSlashSession: vi.fn(async () => 'handle-1'),
  releaseSlashSession: vi.fn(async () => {}),
}))

vi.mock('./hermes-rpc', () => rpc)
vi.mock('./hermes-slash-session', () => slash)
vi.mock('./hermes-slash-exec', () => ({ SLASH_EXEC_TIMEOUT_MS: 1000 }))

describe('compressChatSession', () => {
  beforeEach(() => vi.clearAllMocks())

  it('compresses on a fresh binding via session.compress and releases it', async () => {
    rpc.hermesRpc.mockResolvedValue({
      status: 'compressed',
      before_messages: 40,
      after_messages: 8,
      info: { stored_session_id: 's1' },
    })
    const out = await compressChatSession('s1')
    expect(rpc.hermesRpc).toHaveBeenCalledWith(
      'session.compress',
      { session_id: 'handle-1' },
      expect.anything(),
    )
    // released before (stale snapshot) and after (stale handle)
    expect(slash.releaseSlashSession).toHaveBeenCalledTimes(2)
    expect(out).toMatchObject({
      compressed: true,
      message: 'Compressed 40 → 8 messages',
      continuationKey: null,
    })
  })

  it('reports the continuation when compression rotated the session', async () => {
    rpc.hermesRpc.mockResolvedValue({
      status: 'compressed',
      info: { stored_session_id: 's1-cont' },
    })
    expect((await compressChatSession('s1')).continuationKey).toBe('s1-cont')
  })

  it('passes through a no-op (too short / lock held) as not compressed', async () => {
    rpc.hermesRpc.mockResolvedValue({
      compressed: false,
      lock_held: true,
      message: 'Another compression is running',
    })
    expect(await compressChatSession('s1')).toMatchObject({
      compressed: false,
      message: 'Another compression is running',
      continuationKey: null,
    })
  })

  it('still releases the binding when compress throws', async () => {
    rpc.hermesRpc.mockRejectedValue(new Error('session busy'))
    await expect(compressChatSession('s1')).rejects.toThrow('session busy')
    expect(slash.releaseSlashSession).toHaveBeenCalledTimes(2)
  })
})
