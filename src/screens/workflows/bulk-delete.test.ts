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

const RUN_HISTORY_ERROR =
  "cannot delete 'u2': workflow has run history — delete its runs first"

function routeFetch(calls: Array<{ method: string; url: string }>) {
  return vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = (init?.method ?? 'GET').toUpperCase()
    calls.push({ method, url })
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
    const calls: Array<{ method: string; url: string }> = []
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
      { method: 'DELETE', url: '/api/workflow-definitions/u1' },
      { method: 'DELETE', url: '/api/workflow-definitions/u2' },
      { method: 'DELETE', url: '/api/workflow-definitions/p1' },
      {
        method: 'POST',
        url: '/api/workflow-definitions/f1/reset-factory',
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
    const calls: Array<{ method: string; url: string }> = []
    vi.stubGlobal('fetch', routeFetch(calls))

    const plan = planBulkDelete(
      [makeWf('u2', 'user'), makeWf('u1', 'user')],
      false,
    )
    const summary = await executeBulkDelete(plan)

    expect(calls).toEqual([
      { method: 'DELETE', url: '/api/workflow-definitions/u2' },
      { method: 'DELETE', url: '/api/workflow-definitions/u1' },
    ])
    expect(summary.deleted).toBe(1)
    expect(summary.failed).toBe(1)
  })

  it('reset not opted in: factory row untouched (no call at all)', async () => {
    const calls: Array<{ method: string; url: string }> = []
    vi.stubGlobal('fetch', routeFetch(calls))

    const plan = planBulkDelete(
      [makeWf('u1', 'user'), makeWf('f1', 'bundled')],
      false,
    )
    const summary = await executeBulkDelete(plan)

    expect(calls).toEqual([
      { method: 'DELETE', url: '/api/workflow-definitions/u1' },
    ])
    expect(summary.results.map((r) => r.id)).toEqual(['u1'])
    expect(summary.deleted).toBe(1)
    expect(summary.reset).toBe(0)
  })
})
