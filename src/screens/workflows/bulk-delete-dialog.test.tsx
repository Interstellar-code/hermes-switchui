// @vitest-environment jsdom
/**
 * F8 bulk-delete-dialog — confirmation UI tests. Mocks only `fetch`; the
 * dialog runs the real executeBulkDelete against it.
 *
 * Pins: every selected workflow listed by name; the confirm button names
 * the affected count; type-to-confirm above 5 rows; partial failure shows
 * the result view (dialog stays open) and clears only succeeded rows.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BulkDeleteDialog } from './bulk-delete-dialog'
import type { WorkflowSummary } from './types'

function makeWf(
  id: string,
  source: WorkflowSummary['source'],
): WorkflowSummary {
  return {
    id,
    name: `${id} Name`,
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

function renderDialog(
  selected: Array<WorkflowSummary>,
  onCleared: (ids: Array<string>) => void = vi.fn(),
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <BulkDeleteDialog
        open
        selected={selected}
        onClose={vi.fn()}
        onCleared={onCleared}
      />
    </QueryClientProvider>,
  )
}

/** The route's real 409 body (F8 review LOW: tests used a made-up string). */
const RUN_HISTORY_ERROR =
  "Can't delete — this workflow has run history. Removing runs isn't supported yet (hermes-agent#250)."

/**
 * Route-like fetch mock (F8 review MED): mutating calls without a JSON
 * Content-Type get the same 415 the route's guard returns. DELETE /u2
 * fails with the real run-history 409; everything else 200.
 */
function failingFetch() {
  return vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = (init?.method ?? 'GET').toUpperCase()
    const contentType = new Headers(init?.headers).get('content-type') ?? null
    if (method !== 'GET' && contentType !== 'application/json') {
      return Promise.resolve(
        new Response(
          JSON.stringify({ error: 'Content-Type must be application/json' }),
          { status: 415, headers: { 'Content-Type': 'application/json' } },
        ),
      )
    }
    if (method === 'DELETE' && url.includes('/u2')) {
      return Promise.resolve(
        new Response(JSON.stringify({ error: RUN_HISTORY_ERROR }), {
          status: 409,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
    }
    return Promise.resolve(
      new Response(JSON.stringify({ definition: { id: 'x' } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
  })
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('BulkDeleteDialog — confirm view', () => {
  it('lists every selected workflow by name, grouped, with the count in the confirm label', () => {
    renderDialog([
      makeWf('u1', 'user'),
      makeWf('p1', 'project'),
      makeWf('f1', 'bundled'),
    ])

    expect(screen.getByText('u1 Name')).toBeTruthy()
    expect(screen.getByText('p1 Name')).toBeTruthy()
    expect(screen.getByText('f1 Name')).toBeTruthy()
    expect(screen.getAllByText('u1').length).toBeGreaterThan(0)

    // 1 delete (user) + 1 project = 2 affected; reset not opted in yet.
    const confirm = screen.getByRole('button', { name: /Delete 2 workflows/i })
    expect(confirm).toBeTruthy()
  })

  it('reset opt-in adds factory rows to the affected count', () => {
    renderDialog([makeWf('u1', 'user'), makeWf('f1', 'bundled')])

    expect(screen.getByRole('button', { name: /Delete 1 workflow/i }))
    fireEvent.click(screen.getByRole('checkbox'))
    expect(screen.getByRole('button', { name: /Delete 2 workflows/i }))
  })

  it('requires typing the count above 5 affected rows', () => {
    const rows = Array.from({ length: 6 }, (_, i) =>
      makeWf(`u${i + 1}`, 'user'),
    )
    renderDialog(rows)

    const confirm = screen.getByRole<HTMLButtonElement>('button', {
      name: /Delete 6 workflows/i,
    })
    expect(confirm.disabled).toBe(true)

    const input = screen.getByLabelText(/type 6 to confirm/i)
    fireEvent.change(input, { target: { value: '5' } })
    expect(confirm.disabled).toBe(true)

    fireEvent.change(input, { target: { value: '6' } })
    expect(confirm.disabled).toBe(false)
  })

  it('nothing deletable (factory only, no opt-in) keeps confirm disabled', () => {
    renderDialog([makeWf('f1', 'bundled')])
    const confirm = screen.getByRole<HTMLButtonElement>('button', {
      name: /Delete 0 workflows/i,
    })
    expect(confirm.disabled).toBe(true)
  })
})

describe('BulkDeleteDialog — run + result view', () => {
  it('partial failure: result view stays open, failed message verbatim, only succeeded rows cleared', async () => {
    vi.stubGlobal('fetch', failingFetch())
    const onCleared = vi.fn()
    renderDialog([makeWf('u1', 'user'), makeWf('u2', 'user')], onCleared)

    fireEvent.click(screen.getByRole('button', { name: /Delete 2 workflows/i }))

    // Dialog switches to the result view (never auto-closes on failure).
    expect(await screen.findByText('Bulk delete results')).toBeTruthy()
    expect(screen.getByText(/Deleted 1 · Reset 0 · Failed 1/)).toBeTruthy()
    expect(screen.getByText(RUN_HISTORY_ERROR)).toBeTruthy()
    expect(screen.getByText("Can't delete — 1")).toBeTruthy()
    expect(screen.getByRole('button', { name: /close/i })).toBeTruthy()

    // Only the succeeded row leaves the selection.
    expect(onCleared).toHaveBeenCalledTimes(1)
    expect(onCleared).toHaveBeenCalledWith(['u1'])
  })

  it('full success: result view with every row cleared', async () => {
    vi.stubGlobal('fetch', failingFetch())
    const onCleared = vi.fn()
    renderDialog([makeWf('u1', 'user')], onCleared)

    fireEvent.click(screen.getByRole('button', { name: /Delete 1 workflow/i }))

    expect(await screen.findByText('Bulk delete results')).toBeTruthy()
    expect(screen.getByText(/Deleted 1 · Reset 0 · Failed 0/)).toBeTruthy()
    expect(screen.getByText(/Every selected row succeeded/i)).toBeTruthy()
    expect(onCleared).toHaveBeenCalledWith(['u1'])
  })
})

describe('BulkDeleteDialog — run guards (F8 review LOWs)', () => {
  it('a double click in one batch starts exactly one run', async () => {
    const fetchMock = failingFetch()
    vi.stubGlobal('fetch', fetchMock)
    renderDialog([makeWf('u1', 'user'), makeWf('u3', 'user')])

    const confirm = screen.getByRole('button', { name: /Delete 2 workflows/i })
    // One React batch: the disabled re-render cannot land between the clicks.
    fireEvent(confirm, new MouseEvent('click', { bubbles: true }))
    fireEvent(confirm, new MouseEvent('click', { bubbles: true }))

    expect(await screen.findByText('Bulk delete results')).toBeTruthy()
    expect(fetchMock).toHaveBeenCalledTimes(2) // one per row, not two runs
  })

  it('unmounting mid-run stops the remaining rows', async () => {
    const calls: Array<string> = []
    let releaseFirst!: (r: Response) => void
    const first = new Promise<Response>((res) => {
      releaseFirst = res
    })
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        calls.push(url)
        if (url.includes('/u1')) return first
        return Promise.resolve(
          new Response(JSON.stringify({ definition: { id: 'x' } }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        )
      }),
    )
    const { unmount } = renderDialog([
      makeWf('u1', 'user'),
      makeWf('u3', 'user'),
    ])

    fireEvent.click(screen.getByRole('button', { name: /Delete 2 workflows/i }))
    unmount()
    releaseFirst(
      new Response(JSON.stringify({}), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    await Promise.resolve()
    await Promise.resolve()

    // u1 was already in flight; u3 is never requested after the unmount.
    expect(calls).toEqual(['/api/workflow-definitions/u1'])
  })

  it('clears succeeded rows before the query invalidation resolves', async () => {
    const fetchMock = failingFetch()
    vi.stubGlobal('fetch', fetchMock)
    const onCleared = vi.fn()

    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    // Invalidate never resolves — onCleared must not wait for it.
    vi.spyOn(client, 'invalidateQueries').mockImplementation(
      () => new Promise(() => {}),
    )
    render(
      <QueryClientProvider client={client}>
        <BulkDeleteDialog
          open
          selected={[makeWf('u1', 'user')]}
          onClose={vi.fn()}
          onCleared={onCleared}
        />
      </QueryClientProvider>,
    )

    fireEvent.click(screen.getByRole('button', { name: /Delete 1 workflow/i }))
    expect(await screen.findByText('Bulk delete results')).toBeTruthy()
    expect(onCleared).toHaveBeenCalledWith(['u1'])
  })
})
