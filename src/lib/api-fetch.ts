/**
 * Shared client fetch wrapper.
 *
 * The server's CSRF guard (`requireJsonContentType`) rejects any mutating
 * request (POST/PUT/PATCH/DELETE) that lacks a JSON Content-Type with HTTP 415.
 * Forgetting that header on a new mutation has been a recurring bug
 * (board delete, wiki chat, cron pause/resume/delete). Route mutations through
 * `apiFetch`/`apiJson` so the header is guaranteed and the class of bug is gone.
 *
 * A caller-supplied Content-Type always wins. GET/HEAD requests are untouched.
 * Callers in this codebase pass plain-object headers (or none), so we merge as
 * a plain object to keep the request shape predictable.
 */

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

export async function apiFetch(
  input: string,
  init: RequestInit = {},
): Promise<Response> {
  const method = (init.method ?? 'GET').toUpperCase()
  if (!MUTATING_METHODS.has(method)) return fetch(input, init)

  const headers = {
    'Content-Type': 'application/json',
    ...(init.headers as Record<string, string> | undefined),
  }
  return fetch(input, { ...init, headers })
}

/**
 * `apiFetch` + ok-check + empty/204-body tolerance + error-message extraction.
 * Mirrors the per-domain JSON helpers (kanbanJson/boardsJson) so DELETE
 * endpoints that return 204 / an empty body don't throw "Unexpected end of
 * JSON input".
 */
export async function apiJson<T>(input: string, init?: RequestInit): Promise<T> {
  const res = await apiFetch(input, init)
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as {
      error?: string
      detail?: string
    }
    throw new Error(body.error ?? body.detail ?? `Request failed: ${res.status}`)
  }
  if (res.status === 204) return undefined as T
  const text = await res.text()
  return (text ? JSON.parse(text) : {}) as T
}
