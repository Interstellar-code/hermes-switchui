// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'

import { updateHistoryMessageByClientIdEverywhere } from '../chat-queries'
import {
  RUN_STOP_COPY,
  RUN_STOP_LINGER_MS,
  RUN_STOP_POLL_MS,
  useRunStop,
} from './use-run-stop'

/**
 * The gateway half of Stop, driven against fixtures — the runtime that makes
 * sessions-stream runs stoppable is not deployed yet, so every path here is
 * pinned against the documented contract rather than a live gateway.
 *
 * Two invariants matter more than the copy:
 *  - the UI never waits on this hook (a hung request must not change anything
 *    the composer reads);
 *  - only a CONFIRMED terminal disarms the pending-user-message safety net.
 */

vi.mock('../chat-queries', () => ({
  updateHistoryMessageByClientIdEverywhere: vi.fn(),
}))

vi.mock('@/lib/session-scope', () => ({
  getSessionProfile: () => null,
  profileBody: () => ({}),
}))

const queryClient = { __mock: true } as never

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response
}

function stopAccepted(runId = 'run_1111') {
  return jsonResponse(200, {
    ok: true,
    reason: 'stopping',
    runId,
    status: 'stopping',
  })
}

function statusIs(status: string) {
  return jsonResponse(200, { ok: true, runId: 'run_1111', status })
}

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.useFakeTimers()
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
  vi.mocked(updateHistoryMessageByClientIdEverywhere).mockClear()
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

/** Let queued microtasks and the poll timer run. */
async function tick(ms = RUN_STOP_POLL_MS) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

function renderRunStop() {
  return renderHook(() => useRunStop({ queryClient }))
}

describe('useRunStop', () => {
  it('addresses the session, not a run id the client does not have', async () => {
    fetchMock.mockResolvedValue(stopAccepted())
    const { result } = renderRunStop()

    act(() => {
      result.current.requestStop({ sessionKey: 'sess-1', clientId: 'c-1' })
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/runs/active/stop')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual({ sessionKey: 'sess-1' })
  })

  it('says "Stopping…" immediately, before the request resolves', () => {
    // A request that never settles. The notice must still be there, and
    // nothing the composer reads is derived from it.
    fetchMock.mockReturnValue(new Promise(() => {}))
    const { result } = renderRunStop()

    act(() => {
      result.current.requestStop({ sessionKey: 'sess-1' })
    })

    expect(result.current.stopNotice).toMatchObject({
      phase: 'stopping',
      confirmed: false,
      message: RUN_STOP_COPY.stopping,
    })
  })

  it('does not claim "Stopped" on the 200 — only when the run reports cancelled', async () => {
    fetchMock
      .mockResolvedValueOnce(stopAccepted())
      .mockResolvedValueOnce(statusIs('stopping'))
      .mockResolvedValueOnce(statusIs('cancelled'))

    const { result } = renderRunStop()
    act(() => {
      result.current.requestStop({ sessionKey: 'sess-1', clientId: 'c-1' })
    })

    await tick(0)
    expect(result.current.stopNotice?.phase).toBe('stopping')

    await tick()
    expect(fetchMock.mock.calls[1][0]).toBe('/api/runs/run_1111/status')
    expect(result.current.stopNotice?.phase).toBe('stopping')

    await tick()
    expect(result.current.stopNotice).toMatchObject({
      phase: 'stopped',
      confirmed: true,
      message: RUN_STOP_COPY.stopped,
    })
  })

  it('disarms the resend safety net only once the stop is confirmed', async () => {
    fetchMock
      .mockResolvedValueOnce(stopAccepted())
      .mockResolvedValueOnce(statusIs('stopping'))
      .mockResolvedValueOnce(statusIs('cancelled'))

    const { result } = renderRunStop()
    act(() => {
      result.current.requestStop({ sessionKey: 'sess-1', clientId: 'c-1' })
    })

    await tick()
    // Still unwinding — the user message must stay pending.
    expect(updateHistoryMessageByClientIdEverywhere).not.toHaveBeenCalled()

    await tick()
    expect(updateHistoryMessageByClientIdEverywhere).toHaveBeenCalledWith(
      queryClient,
      'c-1',
      expect.any(Function),
    )
    const patch = vi.mocked(updateHistoryMessageByClientIdEverywhere).mock
      .calls[0][2]
    expect(patch({ status: 'stopping' })).toMatchObject({ status: 'sent' })
  })

  it('stops implying imminence once "stopping" outlives the linger threshold', async () => {
    fetchMock.mockResolvedValueOnce(stopAccepted())
    fetchMock.mockResolvedValue(statusIs('stopping'))

    const { result } = renderRunStop()
    act(() => {
      result.current.requestStop({ sessionKey: 'sess-1', clientId: 'c-1' })
    })

    await tick()
    expect(result.current.stopNotice?.phase).toBe('stopping')

    await tick(RUN_STOP_LINGER_MS)
    expect(result.current.stopNotice).toMatchObject({
      phase: 'lingering',
      confirmed: false,
      tone: 'warning',
      message: RUN_STOP_COPY.lingering,
    })
    // Never claims the work was undone.
    expect(result.current.stopNotice?.message).toContain('stays done')
  })

  it('reads a benign already_finished as "nothing to stop" and confirms it', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(404, {
        ok: false,
        benign: true,
        reason: 'already_finished',
        runId: 'run_1111',
        status: 'completed',
      }),
    )

    const { result } = renderRunStop()
    act(() => {
      result.current.requestStop({ sessionKey: 'sess-1', clientId: 'c-1' })
    })
    await tick(0)

    expect(result.current.stopNotice).toMatchObject({
      phase: 'already-finished',
      confirmed: true,
      message: RUN_STOP_COPY['already-finished'],
    })
    expect(updateHistoryMessageByClientIdEverywhere).toHaveBeenCalledTimes(1)
    // No further polling — there is nothing left to watch.
    await tick(RUN_STOP_POLL_MS * 3)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('keeps the safety net armed when the run is live but not stoppable', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(404, {
        ok: false,
        benign: false,
        reason: 'not_stoppable',
        runId: 'run_1111',
        status: 'running',
      }),
    )

    const { result } = renderRunStop()
    act(() => {
      result.current.requestStop({ sessionKey: 'sess-1', clientId: 'c-1' })
    })
    await tick(0)

    expect(result.current.stopNotice).toMatchObject({
      phase: 'unstoppable',
      confirmed: false,
      tone: 'warning',
      message: RUN_STOP_COPY.unstoppable,
    })
    expect(updateHistoryMessageByClientIdEverywhere).not.toHaveBeenCalled()
  })

  it('keeps the safety net armed on an unknown run', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(404, {
        ok: false,
        benign: false,
        reason: 'run_not_found',
        runId: 'run_1111',
      }),
    )

    const { result } = renderRunStop()
    act(() => {
      result.current.requestStop({ sessionKey: 'sess-1', clientId: 'c-1' })
    })
    await tick(0)

    expect(result.current.stopNotice).toMatchObject({
      phase: 'failed',
      confirmed: false,
      message: RUN_STOP_COPY.failed,
    })
    expect(updateHistoryMessageByClientIdEverywhere).not.toHaveBeenCalled()
  })

  it('keeps the safety net armed when the request itself fails', async () => {
    fetchMock.mockRejectedValueOnce(new Error('offline'))

    const { result } = renderRunStop()
    act(() => {
      result.current.requestStop({ sessionKey: 'sess-1', clientId: 'c-1' })
    })
    await tick(0)

    expect(result.current.stopNotice?.phase).toBe('failed')
    expect(updateHistoryMessageByClientIdEverywhere).not.toHaveBeenCalled()
  })

  it('does not read a vanished status record as a clean stop', async () => {
    fetchMock
      .mockResolvedValueOnce(stopAccepted())
      .mockResolvedValueOnce(
        jsonResponse(404, { ok: false, benign: true, reason: 'run_not_found' }),
      )

    const { result } = renderRunStop()
    act(() => {
      result.current.requestStop({ sessionKey: 'sess-1', clientId: 'c-1' })
    })
    await tick()

    expect(result.current.stopNotice?.phase).toBe('failed')
    expect(updateHistoryMessageByClientIdEverywhere).not.toHaveBeenCalled()
  })

  it('says so plainly when the run finished before the stop reached it', async () => {
    fetchMock
      .mockResolvedValueOnce(stopAccepted())
      .mockResolvedValueOnce(statusIs('completed'))

    const { result } = renderRunStop()
    act(() => {
      result.current.requestStop({ sessionKey: 'sess-1', clientId: 'c-1' })
    })
    await tick()

    expect(result.current.stopNotice).toMatchObject({
      phase: 'finished-first',
      confirmed: true,
      message: RUN_STOP_COPY['finished-first'],
    })
  })

  it('stops polling on unmount', async () => {
    fetchMock.mockResolvedValueOnce(stopAccepted())
    fetchMock.mockResolvedValue(statusIs('stopping'))

    const { result, unmount } = renderRunStop()
    act(() => {
      result.current.requestStop({ sessionKey: 'sess-1', clientId: 'c-1' })
    })
    await tick()
    const callsBefore = fetchMock.mock.calls.length

    unmount()
    await tick(RUN_STOP_POLL_MS * 5)

    expect(fetchMock.mock.calls.length).toBe(callsBefore)
  })

  it('lets a second stop supersede the first', async () => {
    fetchMock.mockResolvedValue(stopAccepted())
    const { result } = renderRunStop()

    act(() => {
      result.current.requestStop({ sessionKey: 'sess-1', clientId: 'c-1' })
    })
    act(() => {
      result.current.requestStop({ sessionKey: 'sess-2', clientId: 'c-2' })
    })
    await tick(0)

    expect(result.current.stopNotice?.sessionKey).toBe('sess-2')
  })

  it('dismisses on request', async () => {
    fetchMock.mockReturnValue(new Promise(() => {}))
    const { result } = renderRunStop()

    act(() => {
      result.current.requestStop({ sessionKey: 'sess-1' })
    })
    act(() => {
      result.current.dismissStopNotice()
    })

    expect(result.current.stopNotice).toBeNull()
  })
})
