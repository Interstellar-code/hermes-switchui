import { describe, expect, it } from 'vitest'
import {
  createQueryClient,
  extractHttpStatus,
  shouldRetry,
} from './query-defaults'

describe('shouldRetry', () => {
  it.each([400, 401, 403, 404, 409, 422, 429, 503])(
    'does not retry HTTP %s in the projects/boards message shape',
    (status) => {
      expect(shouldRetry(0, new Error(`Request failed: ${status}`))).toBe(false)
    },
  )

  it.each([400, 404, 503])(
    'does not retry HTTP %s in the other helper message shapes',
    (status) => {
      expect(shouldRetry(0, new Error(`status ${status}`))).toBe(false)
      expect(
        shouldRetry(0, new Error(`Kanban API error ${status}: nope`)),
      ).toBe(false)
      expect(
        shouldRetry(
          0,
          new Error(`Hermes Dashboard API /api/x: ${status} gone`),
        ),
      ).toBe(false)
    },
  )

  it('does not retry an error carrying a numeric status property', () => {
    const error = Object.assign(new Error('boom'), { status: 404 })
    expect(shouldRetry(0, error)).toBe(false)
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
    expect(shouldRetry(2, new Error('Request failed: 502'))).toBe(false)
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

  it('ignores numbers embedded in longer numbers and status-less messages', () => {
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
    expect(retry(0, new TypeError('Failed to fetch'))).toBe(true)
    expect(retry(1, new TypeError('Failed to fetch'))).toBe(true)
    expect(retry(2, new TypeError('Failed to fetch'))).toBe(false)
  })
})
