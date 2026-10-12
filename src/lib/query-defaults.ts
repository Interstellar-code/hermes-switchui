import { QueryClient } from '@tanstack/react-query'

const MAX_NETWORK_RETRIES = 2

/**
 * Message shapes this app's own fetch helpers build, each anchored so free
 * text is never misread as a status ("Project 404 not found in 400 files"
 * matches none of them). Helpers that relay a server-provided `detail`
 * string (projects/boards/api-fetch) now attach a numeric `status` to the
 * thrown error instead — see `http-error.ts` — and `extractHttpStatus`
 * reads that property first; these patterns only cover the helpers whose
 * fallback message still embeds the status.
 */
const MESSAGE_STATUS_PATTERNS = [
  // projects/boards/api-fetch/tasks/commands/templates/nav-counts fallback.
  /^Request failed:\s*(\d{3})\s*$/,
  // use-self-improve-available.
  /^status (\d{3})$/,
  // Dashboard errors relayed through route bodies into helper messages.
  /^(?:Kanban|Projects) API error (\d{3})(?![0-9])/,
  /^Hermes Dashboard API .*?: (\d{3})(?![0-9])/,
] as const

/**
 * Extract the HTTP status carried by an error thrown by this app's fetch
 * helpers: a numeric `status` property (attached by the helpers as an
 * `HttpError`) wins; the message is consulted only when it is exactly one
 * of the helpers' own status-embedding shapes above — never any 3 digits
 * in free text.
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
  for (const pattern of MESSAGE_STATUS_PATTERNS) {
    const match = message.match(pattern)
    if (match) return Number(match[1])
  }
  return null
}

/**
 * QueryClient retry predicate: a 4xx will not get better by hammering it;
 * a 503 (gateway/dashboard startup race) gets exactly one retry; network
 * and other errors get a couple of attempts.
 */
export function shouldRetry(failureCount: number, error: unknown): boolean {
  const status = extractHttpStatus(error)
  if (status !== null) {
    if (status >= 400 && status < 500) return false
    if (status === 503) return failureCount < 1
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
