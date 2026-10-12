import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchBoards } from './boards-api'
import { fetchProjects } from './projects-api'
import {
  createQueryClient,
  extractHttpStatus,
  shouldRetry,
} from './query-defaults'

const mockFetch = vi.fn()

beforeEach(() => {
  mockFetch.mockReset()
  vi.stubGlobal('fetch', mockFetch)
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function failure(body: unknown, status: number): Response {
  return {
    ok: false,
    status,
    json: () => Promise.resolve(body),
  } as unknown as Response
}

async function captureError(fn: () => Promise<unknown>): Promise<unknown> {
  try {
    await fn()
  } catch (error) {
    return error
  }
  throw new Error('expected the call to throw')
}

describe('shouldRetry', () => {
  it.each([400, 401, 403, 404, 409, 422, 429])(
    'does not retry HTTP %i in the helpers’ message shape or as a status property',
    (status) => {
      expect(shouldRetry(0, new Error(`Request failed: ${status}`))).toBe(false)
      expect(shouldRetry(0, Object.assign(new Error('boom'), { status }))).toBe(
        false,
      )
    },
  )

  it('retries a 503 exactly once: yes at failure count 0, no at 1', () => {
    expect(shouldRetry(0, new Error('Request failed: 503'))).toBe(true)
    expect(shouldRetry(1, new Error('Request failed: 503'))).toBe(false)
    const relayed = Object.assign(
      new Error('Kanban API error 503: dashboard offline'),
      { status: 503 },
    )
    expect(shouldRetry(0, relayed)).toBe(true)
    expect(shouldRetry(1, relayed)).toBe(false)
  })

  it('retries a network error at failure counts 0 and 1, gives up at 2', () => {
    const networkError = new TypeError('Failed to fetch')
    expect(shouldRetry(0, networkError)).toBe(true)
    expect(shouldRetry(1, networkError)).toBe(true)
    expect(shouldRetry(2, networkError)).toBe(false)
  })

  it('retries a status-less error at most twice', () => {
    expect(shouldRetry(0, new Error('Dashboard unavailable'))).toBe(true)
    expect(shouldRetry(1, new Error('Dashboard unavailable'))).toBe(true)
    expect(shouldRetry(2, new Error('Dashboard unavailable'))).toBe(false)
  })

  it('keeps retrying other 5xx at most twice', () => {
    expect(shouldRetry(0, new Error('Request failed: 500'))).toBe(true)
    expect(shouldRetry(0, new Error('Request failed: 502'))).toBe(true)
    expect(shouldRetry(2, new Error('Request failed: 502'))).toBe(false)
  })
})

describe('helper errors carry a numeric status', () => {
  it('projectsJson: a 409 with a string detail keeps the message, gains .status, is not retried', async () => {
    mockFetch.mockResolvedValueOnce(
      failure({ detail: 'Project slug already exists' }, 409),
    )
    const error = await captureError(() => fetchProjects())
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toBe('Project slug already exists')
    expect((error as { status?: unknown }).status).toBe(409)
    expect(shouldRetry(0, error)).toBe(false)
    expect(shouldRetry(1, error)).toBe(false)
  })

  it('boardsJson: a 409 with a string detail keeps the message, gains .status, is not retried', async () => {
    mockFetch.mockResolvedValueOnce(failure({ detail: 'Board conflict' }, 409))
    const error = await captureError(() => fetchBoards())
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toBe('Board conflict')
    expect((error as { status?: unknown }).status).toBe(409)
    expect(shouldRetry(0, error)).toBe(false)
  })

  it('projectsJson: status-less body still yields the fallback message plus .status (503 → one retry)', async () => {
    mockFetch.mockResolvedValueOnce(failure({}, 503))
    const error = await captureError(() => fetchProjects())
    expect((error as Error).message).toBe('Request failed: 503')
    expect((error as { status?: unknown }).status).toBe(503)
    expect(shouldRetry(0, error)).toBe(true)
    expect(shouldRetry(1, error)).toBe(false)
  })
})

describe('extractHttpStatus', () => {
  it('finds statuses in every helper message shape', () => {
    expect(extractHttpStatus(new Error('Request failed: 503'))).toBe(503)
    expect(extractHttpStatus(new Error('status 401'))).toBe(401)
    expect(extractHttpStatus(new Error('Projects API error 422: bad'))).toBe(
      422,
    )
    expect(
      extractHttpStatus(new Error('Hermes Dashboard API /a: 404 gone')),
    ).toBe(404)
  })

  it('never reads 3 digits in free text as a status', () => {
    expect(
      extractHttpStatus(new Error('Project 404 not found in 400 files')),
    ).toBeNull()
    expect(extractHttpStatus(new TypeError('Failed to fetch'))).toBeNull()
    expect(extractHttpStatus(new Error('Request failed: 5030'))).toBeNull()
    expect(extractHttpStatus(new Error('error 1503 in json'))).toBeNull()
    expect(extractHttpStatus(new Error(' Dashboard unavailable '))).toBeNull()
  })
})

describe('createQueryClient', () => {
  it('gives the root QueryClient staleTime 10 s and shouldRetry as defaults', () => {
    const client = createQueryClient()
    const defaults = client.getDefaultOptions().queries
    expect(defaults?.staleTime).toBe(10_000)
    expect(defaults?.retry).toBe(shouldRetry)
  })

  it('wired retry behaves as the predicate', () => {
    const retry = createQueryClient().getDefaultOptions().queries?.retry as (
      failureCount: number,
      error: unknown,
    ) => boolean
    expect(retry(0, new Error('Request failed: 404'))).toBe(false)
    expect(retry(0, new Error('Request failed: 503'))).toBe(true)
    expect(retry(1, new Error('Request failed: 503'))).toBe(false)
    expect(retry(0, new TypeError('Failed to fetch'))).toBe(true)
    expect(retry(1, new TypeError('Failed to fetch'))).toBe(true)
    expect(retry(2, new TypeError('Failed to fetch'))).toBe(false)
  })
})
