/**
 * Error thrown by this app's fetch helpers for a non-2xx response. The
 * message stays exactly what the helper produced (a server `detail` string
 * when present, else its `Request failed: N` fallback); the numeric `status`
 * rides along so query retry logic (`query-defaults.ts`) never has to parse
 * it out of free text.
 */
export class HttpError extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'HttpError'
    this.status = status
  }
}
