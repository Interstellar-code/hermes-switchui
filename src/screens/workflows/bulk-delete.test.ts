/**
 * F8 bulk-delete — execution tests. Mocks only `fetch`; everything else
 * (api-client, planning, sequencing) is the real code.
 *
 * Pins the user decisions from the go (2026-10-07 10:35): user AND project
 * rows delete; factory rows reset only when opted in; run-history errors
 * fail that row with the server's message verbatim; deletes run
 * sequentially, deletes before resets, and nothing is ever retried.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

import { executeBulkDelete, planBulkDelete } from './bulk-delete'
import type { WorkflowSummary } from './types'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function makeWf(
  id: string,
  source: WorkflowSummary['source'],
): WorkflowSummary {
  return {
    id,
    name: `${id}-name`,
    description: '',
    source,
    tags: [],
    node_count: 1,
    last_used_at: null,
    version_tier: 'v1',
    has_loop: false,
    has_approval: false,
    required_inputs: [],
    optional_inputs: [],
    when_to_use: '',
    dag_depth: 1,
    max_parallelism: 1,
    dag: [],
    dag_edges: [],
    yaml: 'nodes: []',
  }
}

/** The route's real 409 body (F8 review LOW: tests used a made-up string). */
const RUN_HISTORY_ERROR =
  "Can't delete — this workflow has run history. Removing runs isn't supported yet (hermes-agent#250)."

interface RecordedCall {
  method: string
  url: string
  contentType: string | null
}

/**
 * Route-like fetch mock (F8 review MED): every mutating call must carry
 * `Content-Type: application/json` or it gets the same 415 the route's
 * requireJsonContentType guard returns — a client regression cannot pass
 * these tests again.
 */
function routeFetch(calls: Array<RecordedCall>) {
  return vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = (init?.method ?? 'GET').toUpperCase()
    const contentType = new Headers(init?.headers).get('content-type') ?? null
    calls.push({ method, url, contentType })
    if (method !== 'GET' && contentType !== 'application/json') {
      return Promise.resolve(
        jsonResponse({ error: 'Content-Type must be application/json' }, 415),
      )
    }
    if (method === 'DELETE') {
      if (url.includes('/u2'))
        return Promise.resolve(jsonResponse({ error: RUN_HISTORY_ERROR }, 409))
      return Promise.resolve(jsonResponse({}, 200))
    }
    if (method === 'POST' && url.includes('/reset-factory')) {
      return Promise.resolve(jsonResponse({ definition: { id: 'f1' } }, 200))
    }
    return Promise.resolve(jsonResponse({ error: 'unexpected call' }, 500))
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('planBulkDelete', () => {
  it('splits user/project into delete, factory into reset-or-skip', () => {
    const plan = planBulkDelete(
      [makeWf('u1', 'user'), makeWf('f1', 'bundled'), makeWf('p1', 'project')],
      true,
    )
    expect(plan.toDelete.map((w) => w.id)).toEqual(['u1', 'p1'])
    expect(plan.toReset.map((w) => w.id)).toEqual(['f1'])
    expect(plan.skipped).toEqual([])
  })

  it('skips factory rows when reset is not opted in', () => {
    const plan = planBulkDelete(
      [makeWf('u1', 'user'), makeWf('f1', 'bundled')],
      false,
    )
    expect(plan.toDelete.map((w) => w.id)).toEqual(['u1'])
    expect(plan.toReset).toEqual([])
    expect(plan.skipped.map((w) => w.id)).toEqual(['f1'])
  })
})

describe('executeBulkDelete', () => {
  it('mixed selection: sequential DELETE then reset, verbatim failure, factory never DELETEd', async () => {
    const calls: Array<RecordedCall> = []
    vi.stubGlobal('fetch', routeFetch(calls))

    const plan = planBulkDelete(
      [
        makeWf('u1', 'user'),
        makeWf('u2', 'user'),
        makeWf('p1', 'project'),
        makeWf('f1', 'bundled'),
      ],
      true,
    )
    const summary = await executeBulkDelete(plan)

    // Exactly four network calls, deletes first then the reset POST.
    expect(calls).toEqual([
      {
        method: 'DELETE',
        url: '/api/workflow-definitions/u1',
        contentType: 'application/json',
      },
      {
        method: 'DELETE',
        url: '/api/workflow-definitions/u2',
        contentType: 'application/json',
      },
      {
        method: 'DELETE',
        url: '/api/workflow-definitions/p1',
        contentType: 'application/json',
      },
      {
        method: 'POST',
        url: '/api/workflow-definitions/f1/reset-factory',
        contentType: 'application/json',
      },
    ])
    expect(
      calls.some((c) => c.method === 'DELETE' && c.url.includes('f1')),
    ).toBe(false)

    expect(summary.deleted).toBe(2)
    expect(summary.reset).toBe(1)
    expect(summary.failed).toBe(1)

    const byId = Object.fromEntries(summary.results.map((r) => [r.id, r]))
    expect(byId.u1.outcome).toBe('deleted')
    expect(byId.p1.outcome).toBe('deleted')
    expect(byId.f1.outcome).toBe('reset')
    expect(byId.u2.outcome).toBe('failed')
    // The server's message, verbatim.
    expect(byId.u2.message).toBe(RUN_HISTORY_ERROR)
  })

  it('a failed row does not stop the run and is never retried', async () => {
    const calls: Array<RecordedCall> = []
    vi.stubGlobal('fetch', routeFetch(calls))

    const plan = planBulkDelete(
      [makeWf('u2', 'user'), makeWf('u1', 'user')],
      false,
    )
    const summary = await executeBulkDelete(plan)

    expect(calls).toEqual([
      {
        method: 'DELETE',
        url: '/api/workflow-definitions/u2',
        contentType: 'application/json',
      },
      {
        method: 'DELETE',
        url: '/api/workflow-definitions/u1',
        contentType: 'application/json',
      },
    ])
    expect(summary.deleted).toBe(1)
    expect(summary.failed).toBe(1)
  })

  it('reset not opted in: factory row untouched (no call at all)', async () => {
    const calls: Array<RecordedCall> = []
    vi.stubGlobal('fetch', routeFetch(calls))

    const plan = planBulkDelete(
      [makeWf('u1', 'user'), makeWf('f1', 'bundled')],
      false,
    )
    const summary = await executeBulkDelete(plan)

    expect(calls).toEqual([
      {
        method: 'DELETE',
        url: '/api/workflow-definitions/u1',
        contentType: 'application/json',
      },
    ])
    expect(summary.results.map((r) => r.id)).toEqual(['u1'])
    expect(summary.deleted).toBe(1)
    expect(summary.reset).toBe(0)
  })
})

describe('executeBulkDelete — guards (F8 review LOWs)', () => {
  it('never deletes an unknown source: anything but user/project/bundled is skipped', () => {
    const odd = { ...makeWf('odd', 'user'), source: 'mystery' as never }
    const plan = planBulkDelete([makeWf('u1', 'user'), odd], false)
    expect(plan.toDelete.map((w) => w.id)).toEqual(['u1'])
    expect(plan.skipped.map((w) => w.id)).toEqual(['odd'])
  })

  it('stops before the next row once aborted; results so far are kept', async () => {
    const calls: Array<RecordedCall> = []
    const inner = routeFetch(calls)
    let aborted = false
    let callCount = 0
    vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
      callCount++
      if (callCount >= 1) aborted = true // flip while u1 is in flight
      return inner(input, init)
    })
    const plan = planBulkDelete(
      [makeWf('u1', 'user'), makeWf('u2', 'user'), makeWf('u3', 'user')],
      false,
    )
    const summary = await executeBulkDelete(plan, {
      isAborted: () => aborted,
    })

    // u1 completed; u2 and u3 are dropped by the abort check.
    expect(calls.map((c) => c.url)).toEqual(['/api/workflow-definitions/u1'])
    expect(summary.results.map((r) => [r.id, r.outcome])).toEqual([
      ['u1', 'deleted'],
    ])
  })

  it('aborts between the delete and reset passes too', async () => {
    const calls: Array<RecordedCall> = []
    const inner = routeFetch(calls)
    let aborted = false
    let callCount = 0
    vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
      callCount++
      if (callCount >= 1) aborted = true
      return inner(input, init)
    })
    const plan = planBulkDelete(
      [makeWf('u1', 'user'), makeWf('f1', 'bundled')],
      true,
    )
    const summary = await executeBulkDelete(plan, {
      isAborted: () => aborted,
    })

    expect(calls).toHaveLength(1) // the DELETE ran; the reset pass was aborted
    expect(summary.results.map((r) => r.id)).toEqual(['u1'])
  })
})
