import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useChatActivityStore } from './chat-activity-store'

function resetStore() {
  useChatActivityStore.getState().stopGatewayPoll()
  useChatActivityStore.setState({
    activity: 'idle',
    localActivity: 'idle',
    gatewayActivity: 'idle',
    changedAt: 0,
  })
}

function activeSessionsResponse() {
  return new Response(
    JSON.stringify({
      ok: true,
      data: {
        sessions: [{ id: 'main', status: 'running', updatedAt: Date.now() }],
      },
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  )
}

describe('chat activity gateway polling', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    resetStore()
  })

  afterEach(() => {
    resetStore()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('does not store interval handles in Zustand state', () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(activeSessionsResponse())

    useChatActivityStore.getState().startGatewayPoll()

    expect('_pollTimer' in useChatActivityStore.getState()).toBe(false)
  })

  it('ignores in-flight gateway poll results after polling stops', async () => {
    let resolveFetch: (response: Response) => void = () => undefined
    vi.spyOn(globalThis, 'fetch').mockReturnValue(
      new Promise<Response>((resolve) => {
        resolveFetch = resolve
      }),
    )

    useChatActivityStore.getState().startGatewayPoll()
    expect(globalThis.fetch).toHaveBeenCalledTimes(1)

    useChatActivityStore.getState().stopGatewayPoll()
    resolveFetch(activeSessionsResponse())
    await vi.runAllTimersAsync()

    expect(useChatActivityStore.getState().gatewayActivity).toBe('idle')
    expect(useChatActivityStore.getState().activity).toBe('idle')
  })
})
