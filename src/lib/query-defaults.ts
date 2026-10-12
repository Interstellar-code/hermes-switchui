import { QueryClient } from '@tanstack/react-query'

const MAX_NETWORK_RETRIES = 2

/**
 * Extract the HTTP status carried by an error thrown by this app's fetch
 * helpers. They throw plain `Error`s with the status embedded in the message
 * (`Request failed: 503` in projects/boards/api-fetch, `status 401` in the
 * plugin hook, `Kanban/Projects API error 503: …` and `Hermes Dashboard API
 * /x: 503 …` relayed through 503 bodies); a numeric `status` property, when
 * present, wins.
 */
export function extractHttpStatus(error: unknown): number | null {
  if (error && typeof error === 'object') {
    const status = (error as { status?: unknown }).status
    if (typeof status === 'number' && status >= 400 && status < 600) {
      return status
    }
  }
  const message =
    error instanceof Error ? error.message : error == null ? '' : String(error)
  // A 4xx/5xx token not embedded in a longer number (so "1503" / "5030" are
  // not statuses).
  const match = message.match(/(?:^|[^0-9])([45]\d{2})(?![0-9])/)
  return match ? Number(match[1]) : null
}

/**
 * QueryClient retry predicate: a 4xx or 503 will not get better by hammering
 * it (the 12 s dashboard-abort 503 used to retry 3× more), while a network
 * error deserves a couple of attempts.
 */
export function shouldRetry(failureCount: number, error: unknown): boolean {
  const status = extractHttpStatus(error)
  if (status !== null && (status === 503 || (status >= 400 && status < 500))) {
    return false
  }
  return failureCount < MAX_NETWORK_RETRIES
}

export const queryClientDefaultOptions = {
  queries: {
    staleTime: 10_000,
    retry: shouldRetry,
  },
} as const

export function createQueryClient(): QueryClient {
  return new QueryClient({ defaultOptions: queryClientDefaultOptions })
}
